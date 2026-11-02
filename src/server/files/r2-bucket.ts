import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { checkedKey, checkedPrefix, isKey, isPrefix, type R2Bucket } from './bucket';
import { sha256Hex } from '../http';
import { authorization, type Signer } from './sigv4';

// Objects in an R2 bucket through its S3 API, path-style: <endpoint>/<bucket>/<key>. A PUT that answered 200 is
// durable, and an object is whole or absent. Only pictures use cached-r2-bucket.ts.

export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

const HEADERS_MS = 30_000;
// Deletes at a time while a prefix is removed: R2 deletes one key per request.
const DELETES = 8;
const EMPTY = sha256Hex('');

const unescape = (text: string) =>
  text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]!);
const tags = (xml: string, pattern: RegExp) => [...xml.matchAll(pattern)].map((match) => unescape(match[1]!));

export function r2Bucket(config: R2Config): R2Bucket {
  const signer: Signer = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: 'auto', service: 's3' };
  const base = new URL(config.endpoint);

  // Only the wait for the answer's headers is timed: a picture's body streams to a reader as slowly as it reads.
  const send = async (method: string, path: string, query: Record<string, string> = {}, body?: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>, length?: number) => {
    const url = new URL(`/${config.bucket}/${path}`, base);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const payload = length === undefined ? (body ? sha256Hex(body as Uint8Array<ArrayBuffer>) : EMPTY) : 'UNSIGNED-PAYLOAD';
    // fetch sends the host itself.
    const headers = { 'x-amz-content-sha256': payload, 'x-amz-date': amzDate, ...(length === undefined ? {} : { 'content-length': String(length) }) };
    const signed = { host: url.host, ...headers };
    const abort = new AbortController();
    // A file PUT cannot answer before its upload finishes; the small-request header deadline would cut archives off.
    const timeout = length === undefined ? HEADERS_MS : 30 * 60_000;
    const timer = setTimeout(() => abort.abort(new Error(`r2: ${method} ${path} had no answer in ${timeout / 1000} s`)), timeout);
    try {
      return await fetch(url, { method, headers: { ...headers, authorization: authorization(signer, method, url, signed, payload, amzDate) }, body, signal: abort.signal, ...(length === undefined ? {} : { duplex: 'half' }) } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
  };
  // A refusal names the request and its status, never the credential.
  const refused = async (response: Response, what: string): Promise<never> => {
    await response.body?.cancel();
    throw new Error(`r2: ${what} answered ${response.status}`);
  };

  const listing = async (query: Record<string, string>) => {
    const objects: { key: string; size: number; modified: number }[] = [];
    const prefixes: string[] = [];
    let token: string | null = null;
    do {
      const response = await send('GET', '', { 'list-type': '2', ...query, ...(token ? { 'continuation-token': token } : {}) });
      if (!response.ok) await refused(response, `list ${query.prefix}`);
      const xml = await response.text();
      for (const entry of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = tags(entry[1]!, /<Key>([^<]*)<\/Key>/g)[0]!;
        if (isKey(key)) objects.push({ key, size: Number(tags(entry[1]!, /<Size>([^<]*)<\/Size>/g)[0]), modified: Date.parse(tags(entry[1]!, /<LastModified>([^<]*)<\/LastModified>/g)[0]!) });
      }
      prefixes.push(...tags(xml, /<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (tags(xml, /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/g)[0] ?? null) : null;
    } while (token);
    return { objects, prefixes };
  };

  const remove = async (key: string) => {
    const response = await send('DELETE', checkedKey(key));
    if (!response.ok && response.status !== 404) await refused(response, `delete ${key}`);
    await response.body?.cancel();
  };
  const list = async (prefix: string) => (await listing({ prefix: checkedPrefix(prefix) })).objects.map(({ key }) => key).sort();

  return {
    kind: 'r2',
    name: config.bucket,
    archives: async () => (await listing({ prefix: 'snapshots/' })).objects.map(({ key, modified }) => ({ key, modified })),
    putFile: async (key, path) => {
      checkedKey(key);
      const { size } = await stat(path);
      const source = createReadStream(path);
      try {
        const body = Readable.toWeb(source) as ReadableStream<Uint8Array>;
        const response = await send('PUT', key, {}, body, size);
        if (!response.ok) await refused(response, `put ${key}`);
        await response.body?.cancel();
      } finally {
        source.destroy();
      }
    },
    put: async (key, body) => {
      // A view of an ArrayBuffer is sent as it is; a Uint8Array, which may view a shared buffer, is copied.
      const response = await send('PUT', checkedKey(key), {}, body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body));
      if (!response.ok) await refused(response, `put ${key}`);
      await response.body?.cancel();
    },
    get: async (key) => {
      const response = await send('GET', checkedKey(key));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || !response.body) return refused(response, `get ${key}`);
      return response.body;
    },
    sizes: async (prefix) => new Map((await listing({ prefix: checkedPrefix(prefix) })).objects.map(({ key, size }) => [key, size])),
    delete: remove,
    list,
    deletePrefix: async (prefix) => {
      const keys = await list(prefix);
      for (let start = 0; start < keys.length; start += DELETES) await Promise.all(keys.slice(start, start + DELETES).map(remove));
    },
    prefixes: async () => (await listing({ prefix: 'files/', delimiter: '/' })).prefixes.filter(isPrefix).sort(),
    trim: async () => [],
  };
}
