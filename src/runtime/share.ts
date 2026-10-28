import { FILE_ID } from '../contracts/files';
import { COVER_LENGTH, type ShareCover } from '../contracts/shares';
import { isRecord } from '../connectors/values';
import { imageType } from '../engine/import/card';
import type { Card } from '../engine/import/types';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import { fromBase64, toBase64 } from '../vault/aead';
import { openFile, type FileRef } from '../vault/files';
import { newShareKey, openShare, sealShare } from '../vault/shares';
import { api, type ApiResult } from './api';
import { charxContent, writeCharxFile, type CharxContent, type ExportStep } from './card-file';
import type { BackupOutput } from './backup-zip';
import { transfers, type Files } from './files';
import { shareOf } from './share-link';
import type { ObjectStore } from './store';

// Version manifests are sealed with a key kept only in link fragments/vaults.
// Only a report sends the full keyed link to the server (server/shares).

// The manifest is the charx's content with each picture by its stored file, never its bytes.
const MANIFEST = 1;
const utf8 = new TextEncoder();

function encodeManifest({ entries, pictures }: CharxContent): Uint8Array<ArrayBuffer> {
  return utf8.encode(JSON.stringify({
    format: MANIFEST,
    entries: entries.map(({ path, bytes }) => ({ path, bytes: toBase64(bytes) })),
    pictures: pictures.map(({ path, ref }) => ({ path, id: ref.id, key: ref.key })),
  }));
}

// null for anything but a manifest this format wrote.
function decodeManifest(bytes: Uint8Array): CharxContent | null {
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(raw) || raw.format !== MANIFEST || !Array.isArray(raw.entries) || !Array.isArray(raw.pictures)) return null;
    const entries = raw.entries.map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.bytes !== 'string') throw new Error('entry');
      return { path: entry.path, bytes: fromBase64(entry.bytes) };
    });
    const pictures = raw.pictures.map((picture: unknown) => {
      if (!isRecord(picture) || typeof picture.path !== 'string' || typeof picture.id !== 'string' || !FILE_ID.test(picture.id) || typeof picture.key !== 'string') throw new Error('picture');
      return { path: picture.path, ref: { id: picture.id, key: picture.key } };
    });
    return entries.some(({ path }) => path === 'card.json') ? { entries, pictures } : null;
  } catch {
    return null;
  }
}

// The embed text a sharer may opt into: the card's name, its creator field and its notes' first line; none for a card
// without a name, which the embed could not title.
function coverOf(card: Pick<Card, 'name' | 'creator' | 'creatorNotes'>): ShareCover | null {
  const name = card.name.trim().slice(0, COVER_LENGTH.name);
  const line = card.creatorNotes.split('\n').map((each) => each.trim()).find(Boolean) ?? '';
  return name ? { name, creator: card.creator.trim().slice(0, COVER_LENGTH.creator), line: line.slice(0, COVER_LENGTH.line) } : null;
}

// 링크 만들기 and 새 버전으로 바꾸기: the character as it is now, sealed under the link's key, its manifest stored among the
// account's files and named with its pictures. tools: modules left out, as 내보내기 counts them.
export async function publishShare(store: ObjectStore, files: Files, character: string, covered: boolean, signal?: AbortSignal): Promise<ApiResult<{ share: Stored<'share'>; version: number; tools: number }>> {
  const content = charxContent(store, character);
  if (!content.ok) return content;
  const held = shareOf(store, character);
  const key = held?.value.key ?? newShareKey();
  const manifest = await files.put(await sealShare(key, encodeManifest(content.data)), signal);
  if (!manifest.ok) return manifest;
  const card = live(store.get('character', character))!.value.card;
  const body = { manifest: manifest.data, files: content.data.pictures.map(({ ref }) => ref.id), cover: covered ? coverOf(card) : null };
  const published = await api<{ id: string; version: number }>('POST', held ? `shares/${held.value.share}/versions` : 'shares', body);
  if (!published.ok) return published;
  const { version } = published.data;
  const { tools } = content.data;
  if (held) return { ok: true, data: { share: held, version, tools } };
  const created = await store.create('share', { share: published.data.id, key }, { parent: character });
  return created.ok ? { ok: true, data: { share: created.data, version, tools } } : created;
}

export async function setShareCover(store: ObjectStore, share: Stored<'share'>, covered: boolean): Promise<ApiResult<undefined>> {
  const card = live(store.get('character', share.parent!))?.value.card;
  if (!card) return { ok: false, error: 'gone' };
  return api<undefined>('PUT', `shares/${share.value.share}/cover`, { cover: covered ? coverOf(card) : null });
}

// Where a share is read: its page reads the live link; the operator reads it in any state (server/admin).
export type ShareSource = { id: string; operator: boolean };
const base = ({ id, operator }: ShareSource) => (operator ? `admin/shares/${id}` : `shares/${id}`);

async function readSharedFile(source: ShareSource, ref: FileRef): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
  const body = await api<Uint8Array<ArrayBuffer>>('GET', `${base(source)}/files/${ref.id}`);
  if (!body.ok) return body;
  const bytes = await openFile(ref, body.data);
  return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
}

// What the page shows of a version before anything is taken: the card's name, creator field and notes, and its face.
export type Preview = { name: string; creator: string; notes: string; avatar: Blob | null };
export type Opened = { content: CharxContent; preview: Preview };

// A key that is not the link's, or a manifest it did not seal, answers 'unreadable'.
export async function openVersion(source: ShareSource, manifest: string, key: string): Promise<ApiResult<Opened>> {
  const body = await api<Uint8Array<ArrayBuffer>>('GET', `${base(source)}/files/${manifest}`);
  if (!body.ok) return body;
  const opened = await openShare(key, body.data);
  const content = opened && decodeManifest(opened);
  if (!content) return { ok: false, error: 'unreadable' };
  const data = (() => {
    try {
      const raw: unknown = JSON.parse(new TextDecoder().decode(content.entries.find(({ path }) => path === 'card.json')!.bytes));
      return isRecord(raw) && isRecord(raw.data) ? raw.data : {};
    } catch {
      return {};
    }
  })();
  const text = (field: string) => (typeof data[field] === 'string' ? data[field] : '');
  const icon = content.pictures.find(({ path }) => path.startsWith('assets/icon/'));
  const face = icon ? await readSharedFile(source, icon.ref) : null;
  const type = face?.ok ? imageType(face.data) : null;
  return {
    ok: true,
    data: { content, preview: { name: text('name'), creator: text('creator'), notes: text('creator_notes'), avatar: face?.ok && type ? new Blob([face.data], { type }) : null } },
  };
}

// 파일로 받기: the same charx 내보내기 writes, from the share's files.
export const writeShared = (source: ShareSource, content: CharxContent, output: BackupOutput, progress: (step: ExportStep) => void) =>
  writeCharxFile(content, (ref) => transfers.run(() => readSharedFile(source, ref), true), output, progress);

// The charx whole in memory, for 헤이젤로 가져오기, which reads it as a dropped file.
export async function sharedFile(source: ShareSource, content: CharxContent, name: string, progress: (step: ExportStep) => void): Promise<ApiResult<File>> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const written = await writeShared(source, content, { write: async (chunk) => void parts.push(chunk), close: async () => {}, abort: async () => {} }, progress);
  return written.ok ? { ok: true, data: new File(parts, name, { type: 'application/zip' }) } : written;
}
