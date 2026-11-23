import type { ChatMessage, InputPicture } from '../../connectors/types';
import { imageType } from '../../engine/import/card';
import type { Assembled } from '../../engine/pipeline';
import type { Inlay, TextFile } from '../../model/library';
import { toBase64 } from '../../base64';
import type { ApiResult } from '../api';
import type { Drafts } from '../device/drafts';
import type { Files } from './files';
import type { Write } from '../store/object-writes';
import { sentPicture } from './picture';
import type { ObjectStore } from '../store/store';

// Normalize composer pictures once at attachment time so repeated sends use identical bytes.
// False means the browser cannot draw it.
export async function addDraftPicture({ drafts, files }: { drafts: Drafts; files: Pick<Files, 'save'> }, key: string, file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sent = await sentPicture({ bytes, type: imageType(bytes) ?? file.type }).catch(() => null);
  if (!sent) return false;
  const name = crypto.randomUUID();
  const saved = files.save([sent.bytes]).then((saved) => {
    const file = saved.ok ? saved.data[0] : null;
    const state = file ? { kind: 'saved' as const, value: { name, type: sent.type, size: sent.bytes.length, file, attached: true as const } } : { kind: 'failed' as const, failure: saved.ok ? ('refused' as const) : saved };
    drafts.settle(name, state);
    return state;
  });
  drafts.attach(key, { kind: 'picture', name, url: URL.createObjectURL(new Blob([sent.bytes], { type: sent.type })), state: { kind: 'saving' }, saved });
  return true;
}

// A text file's row stays well inside one object's sealed body (BATCH_LIMITS.body), whatever its text deflates to.
export const TEXT_FILE_BYTES = 512 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// A text file put in the composer: UTF-8 with no NUL, which no binary file passes.
export async function addDraftFile({ drafts }: { drafts: Drafts }, key: string, file: File): Promise<'added' | 'not-text' | 'too-large'> {
  if (file.size > TEXT_FILE_BYTES) return 'too-large';
  let text: string;
  try {
    text = UTF8.decode(await file.arrayBuffer());
  } catch {
    return 'not-text';
  }
  if (text.includes('\0')) return 'not-text';
  drafts.attach(key, { kind: 'file', value: { name: crypto.randomUUID(), title: file.name, text } });
  return 'added';
}

// Save attachment rows before the turn reads them; retain the new chat across its first render.
// Retrying a failed send reuses existing names instead of duplicating rows.
export async function keepAttachments(store: ObjectStore, chat: string, pictures: readonly Inlay[], files: readonly TextFile[]): Promise<ApiResult<null>> {
  const lease = store.retainChat(chat);
  try {
    const unloaded = await lease.ready;
    if (unloaded) return unloaded;
    const heldPictures = new Set(store.children('inlay', chat).map(({ value }) => value.name));
    const heldFiles = new Set(store.children('textfile', chat).map(({ value }) => value.name));
    const writes = [
      ...pictures.filter(({ name }) => !heldPictures.has(name)).map((value): Write => ({ type: 'create', kind: 'inlay', id: crypto.randomUUID(), parent: chat, value })),
      ...files.filter(({ name }) => !heldFiles.has(name)).map((value): Write => ({ type: 'create', kind: 'textfile', id: crypto.randomUUID(), parent: chat, value })),
    ];
    return writes.length ? await store.batch(writes) : { ok: true, data: null };
  } finally {
    lease.release();
  }
}

const HELD_CHARS = 32 * 1024 * 1024;

// What a model is sent of a stored picture, kept by the file it was drawn from: a file's bytes never change, so a
// chat's pictures are read, drawn and encoded once, not at every send. Only one that was read is kept: a failure is
// tried again.
export class SentPictures {
  private readonly held = new Map<string, InputPicture>();
  private chars = 0;

  constructor(private readonly files: Pick<Files, 'read'>, private readonly budget = HELD_CHARS) {}

  async read({ file, type }: Pick<Inlay, 'file' | 'type'>, signal?: AbortSignal): Promise<ApiResult<InputPicture>> {
    const key = `${type}:${file.id}`;
    const held = this.held.get(key);
    if (held) {
      this.held.delete(key);
      this.held.set(key, held);
      return { ok: true, data: held };
    }
    const bytes = await this.files.read(file, { signal });
    if (!bytes.ok) return bytes;
    const sent = await sentPicture({ bytes: bytes.data, type }).catch(() => null);
    if (!sent) return { ok: false, error: 'unreadable' };
    const data = { type: sent.type, data: toBase64(sent.bytes) };
    // Two messages of one send may name the same picture: the second to land is not counted twice.
    if (!this.held.has(key)) this.chars += data.data.length;
    this.held.set(key, data);
    // The longest unsent go first, the one just read never.
    for (const [oldest, { data: { length } }] of this.held) {
      if (this.chars <= this.budget || oldest === key) break;
      this.held.delete(oldest);
      this.chars -= length;
    }
    return { ok: true, data };
  }
}

// Resolve picture ids only at send time. Imported inlays need resizing; composer attachments are already normalized.
export async function withPictures({ store, pictures }: { store: Pick<ObjectStore, 'get'>; pictures: SentPictures }, prompt: Assembled, signal?: AbortSignal): Promise<ApiResult<Assembled>> {
  if (!prompt.messages.some(({ inlays }) => inlays)) return { ok: true, data: prompt };
  const read = async (id: string): Promise<ApiResult<InputPicture>> => {
    const inlay = store.get('inlay', id)?.value;
    return inlay ? pictures.read(inlay, signal) : { ok: false, error: 'not-found' };
  };
  const messages: ChatMessage[] = [];
  for (const { inlays, ...message } of prompt.messages) {
    if (!inlays) {
      messages.push(message);
      continue;
    }
    const pictures = await Promise.all(inlays.map(read));
    const failed = pictures.find((picture) => !picture.ok);
    if (failed && !failed.ok) return failed;
    messages.push({ ...message, pictures: pictures.flatMap((picture) => (picture.ok ? [picture.data] : [])) });
  }
  return { ok: true, data: { ...prompt, messages } };
}
