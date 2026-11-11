import { expect, it, vi } from 'vitest';

const drive = vi.hoisted(() => {
  const named = (uid: string, type: string, name: string, claimedSize?: number) => ({ uid, type, name: { ok: true, value: name }, activeRevision: { claimedSize } });
  const children = [named('a', 'file', 'a.png', 3), named('notes', 'file', 'notes.txt'), named('b', 'file', 'b.charx'), named('sub', 'folder', 'more')];
  const downloaded: string[] = [];
  const link = {
    getRootNode: async () => named('root', 'folder', 'bots'),
    async *iterateFolderChildren() {
      yield* children;
    },
    getFileDownloader: async (uid: string) => ({
      getClaimedSizeInBytes: () => 2,
      downloadToStream: (stream: WritableStream<Uint8Array>, progress: (done: number) => void) => ({
        completion: async () => {
          downloaded.push(uid);
          const writer = stream.getWriter();
          await writer.write(new Uint8Array(2));
          await writer.close();
          progress(2);
        },
      }),
    }),
  };
  return { link, downloaded };
});

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint: () => {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({ Api: class { static init() {} } }));
vi.mock('@protontech/crypto/srp', () => ({ computeKeyPassword: () => {}, getSrp: () => {} }));
vi.mock('@protontech/drive-sdk', () => {
  class Failure extends Error {}
  return {
    NodeType: { File: 'file', Folder: 'folder' },
    ConnectionError: Failure,
    DecryptionError: Failure,
    IntegrityError: Failure,
    RateLimitedError: Failure,
    ServerError: Failure,
    ValidationError: Failure,
    MemoryCache: class {},
    OpenPGPCryptoWithCryptoProxy: class {},
    ProtonDriveClient: class {
      experimental = { getURLAccessInfo: async () => ({ isCustomPasswordProtected: false }), authURLAccess: async () => drive.link };
    },
  };
});

const { downloadProton } = await import('./proton');

it('lists a folder of bot files before downloading any, then downloads only the ones chosen', async () => {
  const signal = new AbortController().signal;
  const answer = await downloadProton('https://drive.proton.me/urls/A#b', undefined, signal, () => {});
  if (!answer.ok || !('folder' in answer)) throw new Error('no folder');
  expect(answer.folder.files).toEqual([{ name: 'a.png', size: 3 }, { name: 'b.charx', size: undefined }]);
  expect(answer.folder.skipped).toEqual(['notes.txt']);
  expect(drive.downloaded).toEqual([]);
  const taken = await answer.folder.take([1], signal, () => {});
  expect(taken.ok && 'files' in taken && [taken.files.map((file) => file.name), taken.skipped]).toEqual([['b.charx'], []]);
  expect(drive.downloaded).toEqual(['b']);
});
