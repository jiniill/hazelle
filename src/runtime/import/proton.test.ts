import { expect, it, vi } from 'vitest';

const drive = vi.hoisted(() => {
  const named = (uid: string, type: string, name: string, claimedSize?: number) => ({ uid, type, name: { ok: true, value: name }, activeRevision: { claimedSize } });
  const children: Record<string, ReturnType<typeof named>[]> = {
    root: [named('a', 'file', 'a.png', 3), named('notes', 'file', 'notes.txt'), named('b', 'file', 'b.charx'), named('m', 'file', 'm.risum', 5), named('p', 'file', 'p.risup', 7), named('sub', 'folder', 'more')],
    sub: [named('c', 'file', 'c.risum', 9), named('deep', 'file', 'deep.txt')],
  };
  const downloaded: string[] = [];
  const link = {
    getRootNode: async () => named('root', 'folder', 'bots'),
    async *iterateFolderChildren(folder: string) {
      yield* children[folder]!;
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

it('lists a folder of bots, modules and prompts with its subfolders before downloading any, then downloads only the ones chosen', async () => {
  const signal = new AbortController().signal;
  const answer = await downloadProton('https://drive.proton.me/urls/A#b', undefined, signal, () => {});
  if (!answer.ok || !('folder' in answer)) throw new Error('no folder');
  expect(answer.folder.files).toEqual([{ name: 'a.png', size: 3 }, { name: 'b.charx', size: undefined }, { name: 'm.risum', size: 5 }, { name: 'p.risup', size: 7 }, { name: 'more/c.risum', size: 9 }]);
  expect(answer.folder.skipped).toEqual(['notes.txt', 'more/deep.txt']);
  expect(drive.downloaded).toEqual([]);
  const taken = await answer.folder.take([4], signal, () => {});
  expect(taken.ok && 'files' in taken && [taken.files.map((file) => file.name), taken.skipped]).toEqual([['c.risum'], []]);
  expect(drive.downloaded).toEqual(['c']);
});
