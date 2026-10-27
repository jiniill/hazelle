import { fileStem } from '../../engine/file-name';
import type { BackupOutput } from '../../runtime/backup';

const TEMPORARY = 'risu-alpha-backup-downloads';
// Page-held Web Lock protects active spools across tabs; reclaim only unlocked files after a page dies.
const lockName = (name: string) => `${TEMPORARY}/${name}`;
type Spool = { written: boolean; end: () => Promise<void> };
const spools = new Set<Spool>();

function clickDownload(filename: string, url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

export const fileNamed = (name: string, fallback: string, extension: string) => `${fileStem(name, fallback)}.${extension}`;

export function download(filename: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  clickDownload(filename, url);
  URL.revokeObjectURL(url);
}

const spooling = () => navigator.storage?.getDirectory !== undefined && navigator.locks !== undefined;

// Call in the click handler, before any await: a picker requires the original user activation.
export function downloadOutput(filename: string): Promise<BackupOutput> {
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    const extension = filename.slice(filename.lastIndexOf('.'));
    return picker.call(window, { suggestedName: filename, types: [{ description: extension.slice(1).toUpperCase(), accept: { 'application/octet-stream': [extension] } }] })
      .then((handle) => handle.createWritable())
      .then((stream) => ({ write: (chunk) => stream.write(chunk), close: () => stream.close(), abort: () => stream.abort() }));
  }
  if (!spooling()) return Promise.resolve(memoryOutput(filename));
  return temporaryOutput(filename);
}

// On startup/lock/logout remove every plaintext spool, including active exports, so none outlives the unlocked page.
// Browser downloads still copying can fail: no event tells when they finished.
export async function clearDownloads(): Promise<void> {
  if (spooling()) await sweep(true);
}

async function sweep(everything: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(TEMPORARY, { create: true });
  await Promise.all([...spools].filter((spool) => everything || spool.written).map((spool) => spool.end()));
  const names: string[] = [];
  for await (const name of directory.keys()) names.push(name);
  await Promise.all(names.map((name) => navigator.locks.request(lockName(name), { ifAvailable: true }, async (lock) => {
    if (lock) await directory.removeEntry(name);
  })));
  return directory;
}

function hold(name: string): Promise<() => void> {
  return new Promise((held, failed) => {
    navigator.locks.request(name, () => new Promise<void>((release) => held(release))).catch(failed);
  });
}

// Only a browser with neither a save picker nor a writable disk spool lands here; it holds the whole archive.
function memoryOutput(filename: string): BackupOutput {
  let parts: BlobPart[] = [];
  return {
    write: async (chunk) => { parts.push(new Blob([chunk])); },
    close: async () => {
      download(filename, new Blob(parts, { type: 'application/octet-stream' }));
      parts = [];
    },
    abort: async () => { parts = []; },
  };
}

// The spool is plaintext, and encrypting it would not help: the browser downloads the File as it is, so the readable
// copy has to exist somewhere, and keeping it out of memory is the spool's whole point.
async function temporaryOutput(filename: string): Promise<BackupOutput> {
  const directory = await sweep(false);
  const name = `${crypto.randomUUID()}.zip`;
  const release = await hold(lockName(name));
  let handle: FileSystemFileHandle;
  let stream: FileSystemWritableFileStream;
  try {
    handle = await directory.getFileHandle(name, { create: true });
    if (!handle.createWritable) {
      await directory.removeEntry(name);
      release();
      return memoryOutput(filename);
    }
    stream = await handle.createWritable();
  } catch (error) {
    await directory.removeEntry(name).catch(() => {});
    release();
    throw error;
  }
  let url: string | undefined;
  let closing: Promise<File> | undefined;
  let ending: Promise<void> | undefined;
  const spool: Spool = {
    written: false,
    end: () => (ending ??= (async () => {
      spools.delete(spool);
      try {
        // A close already committing cannot be aborted; its entry is removed once it has committed.
        if (closing) await closing.catch(() => {});
        else await stream.abort();
      } finally {
        if (url) URL.revokeObjectURL(url);
        try { await directory.removeEntry(name); } finally { release(); }
      }
    })()),
  };
  spools.add(spool);
  return {
    write: (chunk) => stream.write(chunk),
    close: async () => {
      closing = stream.close().then(() => handle.getFile());
      // getFile is disk-backed. Removing its entry may invalidate the File during the browser's download, so a
      // completed spool stays until a sweep (https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile).
      const file = await closing;
      if (ending) throw new DOMException('The spool was cleared', 'AbortError');
      url = URL.createObjectURL(file);
      spool.written = true;
      clickDownload(filename, url);
    },
    abort: spool.end,
  };
}
