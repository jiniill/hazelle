import { TooLarge } from './inflate';
import { UNPACKED_EXTENSIONS } from './extensions';
import { readPng } from './png';
import { openZip, type Zip } from './zip';
import { ZipEncrypted } from './zip-format';

export type UnpackFailure = 'encrypted' | 'too-large' | 'unreadable';
export type Unpacked<F> = { ok: true; files: F[]; skipped: string[] } | { ok: false; failure: UnpackFailure };

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
// What a zipper adds on its own, which no one packed and no one needs told about.
const unasked = (path: string) => path.endsWith('/') || path.startsWith('__MACOSX/') || baseName(path).startsWith('.');

// A bot's zip often holds its preview pictures: one that holds no card is no failed import, only a file left out.
function holdsCard(name: string, bytes: Uint8Array<ArrayBuffer>): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) {
    const png = readPng(bytes);
    return png !== null && (png.card !== null || png.persona !== null);
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return openZip(bytes)?.names.includes('card.json') ?? false;
  return true;
}

function entries(zip: Zip): Unpacked<{ name: string; bytes: Uint8Array<ArrayBuffer> }> {
  const files: { name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  const skipped: string[] = [];
  for (const path of zip.names) {
    if (unasked(path)) continue;
    const name = baseName(path);
    const bytes = UNPACKED_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)) ? zip.read(path) : null;
    if (bytes && holdsCard(name, bytes)) files.push({ name, bytes });
    else skipped.push(name);
  }
  return { ok: true, files, skipped };
}

// A charx is a zip with card.json at its root, and people rename one to .zip; the card's own files are not separate imports.
export function unpackZip(fileName: string, bytes: Uint8Array<ArrayBuffer>): Unpacked<{ name: string; bytes: Uint8Array<ArrayBuffer> }> {
  try {
    const zip = openZip(bytes);
    if (!zip) return { ok: false, failure: 'unreadable' };
    if (zip.names.includes('card.json')) return { ok: true, files: [{ name: `${fileName.replace(/\.zip$/i, '')}.charx`, bytes }], skipped: [] };
    return entries(zip);
  } catch (error) {
    if (error instanceof ZipEncrypted) return { ok: false, failure: 'encrypted' };
    if (error instanceof TooLarge) return { ok: false, failure: 'too-large' };
    throw error;
  }
}
