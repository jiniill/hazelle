import 'core-js/proposals/array-buffer-base64';
import { CryptoProxy } from '@protontech/crypto';
import { Api } from '@protontech/crypto/proxy/endpoint/api.ts';
import { computeKeyPassword, getSrp } from '@protontech/crypto/srp';
import {
  ConnectionError,
  DecryptionError,
  IntegrityError,
  MemoryCache,
  NodeType,
  OpenPGPCryptoWithCryptoProxy,
  ProtonDriveClient,
  RateLimitedError,
  ServerError,
  ValidationError,
  type ProtonDriveHTTPClientBlobRequest,
  type ProtonDriveHTTPClientJsonRequest,
} from '@protontech/drive-sdk';
import { importable } from '../../engine/import/extensions';
import { BUILT_VERSION } from '../installation';
import { relayRaw, type RelayFailure } from '../models/relay';
import type { LinkAnswer, LinkFailure, Progress } from './link';

// The SDK's terms ask for this exact form and forbid passing as a Proton client.
const APP_VERSION = `external-drive-hazelle@${BUILT_VERSION?.replace(/^v/, '') ?? '0.0.0'}-stable`;

// In this page, not the package's worker pool: its workers are built from a plain URL, which this app's Trusted Types
// policy refuses, and the package exports no way to build them otherwise.
let cryptoReady = false;
function startCrypto() {
  if (cryptoReady) return;
  Api.init({});
  CryptoProxy.setEndpoint(new Api());
  cryptoReady = true;
}

type Named = { uid: string; type: NodeType; name: { ok: true; value: string } | { ok: false }; activeRevision?: { claimedSize?: number } };
const nameOf = ({ name }: Named) => (name.ok ? name.value : null);
// path: from the link's root, which tells apart files of one name in different folders.
type Found = { node: Named; path: string };

// A link's password and share keys stay in this page: the relay carries the handshake's proof and the encrypted blocks only.
export async function downloadProton(url: string, password: string | undefined, signal: AbortSignal, progress: Progress): Promise<LinkAnswer> {
  // The listing's, then each later take of a folder's files: the user stops one apart from the other.
  let line = signal;
  let relayFailure: RelayFailure | null = null;
  const send = async (request: ProtonDriveHTTPClientJsonRequest | ProtonDriveHTTPClientBlobRequest) => {
    request.headers.set('x-pm-appversion', APP_VERSION);
    const json = 'json' in request && request.json !== undefined ? JSON.stringify(request.json) : null;
    const answer = await relayRaw(
      { url: request.url, method: request.method === 'POST' ? 'POST' : 'GET', headers: Object.fromEntries(request.headers), body: json },
      AbortSignal.any([line, AbortSignal.timeout(request.timeoutMs), ...(request.signal ? [request.signal] : [])]),
    );
    if (answer instanceof Response) return answer;
    relayFailure = answer;
    throw new Error(answer.kind);
  };
  const refusal = (error: unknown): LinkFailure => {
    if (line.aborted) return { kind: 'cancelled' };
    if (relayFailure) return { kind: 'relay', failure: relayFailure };
    if (error instanceof ValidationError) return { kind: 'missing' };
    if (error instanceof DecryptionError || error instanceof IntegrityError) return { kind: 'damaged' };
    return { kind: error instanceof ConnectionError ? 'lost' : 'refused' };
  };

  const attempt = async (next: AbortSignal, work: () => Promise<LinkAnswer>): Promise<LinkAnswer> => {
    line = next;
    relayFailure = null;
    try {
      return await work();
    } catch (error) {
      return { ok: false, failure: error === WRONG ? { kind: 'wrong-password' } : refusal(error) };
    }
  };

  return attempt(signal, async () => {
    startCrypto();
    const client = new ProtonDriveClient({
      httpClient: { fetchJson: send, fetchBlob: send },
      entitiesCache: new MemoryCache(),
      cryptoCache: new MemoryCache(),
      // An anonymous visitor has no addresses; the public-link client never signs anything for this read.
      account: { getOwnPrimaryAddress: unavailable, getOwnAddresses: async () => [], getOwnAddress: unavailable, hasProtonAccount: async () => false, getPublicKeys: async () => [] },
      openPGPCryptoModule: new OpenPGPCryptoWithCryptoProxy(CryptoProxy as never),
      srpModule: {
        getSrp: (version, modulus, serverEphemeral, salt, secret) =>
          getSrp({ Version: version, Modulus: modulus, ServerEphemeral: serverEphemeral, Username: '', Salt: salt }, { username: '', password: secret }, version),
        computeKeyPassword,
        getSrpVerifier: unavailable,
        generateKeySalt: () => {
          throw new Error('not available to an anonymous visitor');
        },
      },
      telemetry: { getLogger: () => QUIET, recordMetric: () => {} },
    });
    const { isCustomPasswordProtected } = await client.experimental.getURLAccessInfo(url);
    if (isCustomPasswordProtected && password === undefined) return { ok: false, failure: { kind: 'needs-password' } };
    const link = await client.experimental.authURLAccess(url, password, true).catch((error: unknown) => {
      // A refusal in Proton's own codes, as a wrong proof gets; an outage carries an HTTP status and a limit its own class.
      if (isCustomPasswordProtected && error instanceof ServerError && error.statusCode === undefined && !(error instanceof RateLimitedError)) throw WRONG;
      throw error;
    });
    const root = (await link.getRootNode()) as Named;
    const found: Found[] = root.type === NodeType.Folder ? [] : [{ node: root, path: nameOf(root) ?? '?' }];
    const walk = async (folder: string, above: string) => {
      for await (const child of link.iterateFolderChildren(folder, undefined, line)) {
        const node = child as Named;
        const path = `${above}${nameOf(node) ?? '?'}`;
        if (node.type === NodeType.Folder) await walk(node.uid, `${path}/`);
        else found.push({ node, path });
      }
    };
    if (root.type === NodeType.Folder) await walk(root.uid, '');
    const skipped: string[] = [];
    const wanted = found.filter(({ node, path }) => {
      const name = nameOf(node);
      if (node.type === NodeType.File && name && importable(name)) return true;
      if (node.type === NodeType.File) skipped.push(path);
      return false;
    });
    const fetch = async (chosen: readonly Named[], progress: Progress) => {
      const files: File[] = [];
      const downloaders = await Promise.all(chosen.map((node) => link.getFileDownloader(node.uid, line)));
      const claimed = downloaders.map((downloader) => downloader.getClaimedSizeInBytes());
      const total = claimed.every((size) => size !== undefined) ? claimed.reduce<number>((all, size) => all + size!, 0) : undefined;
      let before = 0;
      for (const [index, downloader] of downloaders.entries()) {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        const taken = before;
        const stream = new WritableStream<Uint8Array<ArrayBuffer>>({ write: (part) => void parts.push(part) });
        await downloader.downloadToStream(stream, (done) => progress(taken + done, total)).completion();
        files.push(new File(parts, nameOf(chosen[index]!)!));
        before += files.at(-1)!.size;
      }
      return files;
    };
    if (wanted.length < 2) return { ok: true, files: await fetch(wanted.map(({ node }) => node), progress), skipped };
    // The listing told what was skipped, so the files taken after it do not tell it again.
    const take = (chosen: readonly number[], next: AbortSignal, progress: Progress) =>
      attempt(next, async () => ({ ok: true, files: await fetch(chosen.map((at) => wanted[at]!.node), progress), skipped: [] }));
    return { ok: true, folder: { files: wanted.map(({ node, path }) => ({ name: path, size: node.activeRevision?.claimedSize })), skipped, take } };
  });
}

const WRONG = new Error('wrong password');
const QUIET = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const unavailable = async (): Promise<never> => {
  throw new Error('not available to an anonymous visitor');
};
