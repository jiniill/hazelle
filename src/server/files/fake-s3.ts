import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { R2Config } from './r2-bucket';
import { sha256Hex } from '../http';
import { authorization } from './sigv4';

// In-memory test R2 endpoint: verify signatures against received headers and paginate listings so paging executes.
// requests captures method/path in arrival order.
export async function fakeS3(page = 2) {
  const config: R2Config = { endpoint: '', bucket: 'pictures', accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
  const objects = new Map<string, Uint8Array>();
  const requests: string[] = [];
  const signer = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: 'auto', service: 's3' };

  const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    requests.push(`${request.method} ${url.pathname}`);
    const body = await read(request);
    const payload = String(request.headers['x-amz-content-sha256']);
    const date = String(request.headers['x-amz-date']);
    const expected = authorization(signer, request.method!, url, { host: request.headers.host!, 'x-amz-content-sha256': payload, 'x-amz-date': date, ...(payload === 'UNSIGNED-PAYLOAD' ? { 'content-length': String(request.headers['content-length']) } : {}) }, payload, date);
    if (request.headers.authorization !== expected || (payload === 'UNSIGNED-PAYLOAD' ? Number(request.headers['content-length']) !== body.length : payload !== sha256Hex(body))) return response.writeHead(403).end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
    const [, bucket, ...rest] = url.pathname.split('/');
    if (bucket !== config.bucket) return response.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
    const key = rest.join('/');

    if (key === '' && request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const delimiter = url.searchParams.get('delimiter');
      const after = url.searchParams.get('continuation-token') ?? '';
      const names = new Set<string>();
      for (const name of objects.keys()) {
        if (!name.startsWith(prefix)) continue;
        const cut = delimiter ? name.indexOf(delimiter, prefix.length) : -1;
        names.add(cut === -1 ? name : name.slice(0, cut + 1));
      }
      const all = [...names].sort().filter((name) => name > after);
      const shown = all.slice(0, page);
      const truncated = all.length > shown.length;
      const entries = shown.map((name) => (name.endsWith('/') ? `<CommonPrefixes><Prefix>${name}</Prefix></CommonPrefixes>` : `<Contents><Key>${name}</Key><LastModified>${new Date().toISOString()}</LastModified><Size>${objects.get(name)!.byteLength}</Size></Contents>`));
      return response
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><IsTruncated>${truncated}</IsTruncated>${entries.join('')}${truncated ? `<NextContinuationToken>${shown.at(-1)}</NextContinuationToken>` : ''}</ListBucketResult>`);
    }
    const held = objects.get(key);
    switch (request.method) {
      case 'PUT':
        objects.set(key, body);
        return response.writeHead(200).end();
      case 'GET':
      case 'HEAD':
        if (!held) return response.writeHead(404).end(request.method === 'GET' ? '<Error><Code>NoSuchKey</Code></Error>' : undefined);
        return response.writeHead(200, { 'content-length': held.byteLength }).end(request.method === 'GET' ? held : undefined);
      case 'DELETE':
        objects.delete(key);
        return response.writeHead(204).end();
    }
    response.writeHead(405).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { config, objects, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
