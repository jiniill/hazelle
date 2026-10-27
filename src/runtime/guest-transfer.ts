import { isRecord } from '../connectors/values';
import { BATCH_LIMITS, type SealedChange, type SealedWrite } from '../contracts/objects';
import { isValue, KINDS, type Kind } from '../model/kinds';
import { ORDER_ID, toFront, type Order } from '../model/order';
import { forgetGuestVault, recallGuest, rememberVault } from '../vault/device';
import type { VaultKey } from '../vault/keys';
import { objectKey, openObject, sealObject } from '../vault/objects';
import { feedQuery, serverBackend, type Backend } from './backend';
import { api, type ApiFailure, type ApiResult } from './api';
import { deviceCache } from './device-cache';
import { clearGuestStore, guestBackend, guestBoardSecret } from './guest-store';
import { SEEDED } from './backup-core';
import { inOrder, transfers } from './files';
import { toolAssetId, toolChatId, toolDataId, toolFileId } from './tools/store';

export type GuestTransferStep = { kind: 'objects' | 'pictures'; done: number; total: number };
export type GuestTransferOptions = { signal?: AbortSignal; progress?: (step: GuestTransferStep) => void };
type Guest = { accountId: string; vaultKey: VaultKey };
type Inventory = { rows: SealedChange[]; timeline: string; rev: number };
const failed = (error: string) => ({ ok: false as const, error });
// Pictures asked about at once; the next ones are asked while these go up, the room each answer gives counting only its own.
const PICTURES_PER_ASK = 100;

async function inventory(backend: Backend, signal?: AbortSignal): Promise<ApiResult<Inventory>> {
  const rows: SealedChange[] = [];
  let since = 0;
  let timeline: string | null = null;
  let until: number | null = null;
  for (;;) {
    if (signal?.aborted) return failed('stopped');
    const page = await backend.feed(feedQuery({ since, timeline, bootstrap: true, until, metadata: true }), signal);
    if (!page.ok) return page;
    timeline = page.data.timeline;
    until = page.data.until!;
    rows.push(...page.data.changes);
    since = page.data.cursor;
    if (!page.data.more) return { ok: true, data: { rows, timeline, rev: until } };
  }
}

export async function guestWithContent(): Promise<ApiResult<Guest | null>> {
  const guest = await recallGuest();
  if (!guest) return { ok: true, data: null };
  const secret = await guestBoardSecret(guest.accountId);
  if (!secret.ok) return secret;
  if (secret.data) return { ok: true, data: guest };
  const held = await inventory(guestBackend(guest.accountId));
  if (!held.ok) return held;
  // Ignore untouched starter defaults when deciding to prompt; guest data stays intact until explicit upload/discard.
  if (held.data.rows.some(({ id, body }) => body !== null && !SEEDED.has(id))) return { ok: true, data: guest };
  const files = await guestBackend(guest.accountId).heldFiles(null);
  return files.ok ? { ok: true, data: files.data.ids.length ? guest : null } : files;
}

export async function discardGuest(): Promise<ApiResult<null>> {
  const guest = await recallGuest();
  if (!guest) return { ok: true, data: null };
  const cleared = await clearGuestStore(guest.accountId);
  if (!cleared.ok) return cleared;
  await forgetGuestVault(guest.accountId);
  return cleared;
}

// The caller closes the guest session before transferring and opens the account only after success. The last
// revision check refuses cleanup if another guest tab wrote meanwhile; the browser remains master until then.
export async function transferGuest(accountId: string, vaultKey: VaultKey, options: GuestTransferOptions = {}, target: Backend = serverBackend()): Promise<ApiResult<null>> {
  const guest = await recallGuest();
  if (!guest) return { ok: true, data: null };
  const conversion = guest.accountId === accountId;
  if (conversion && !sameKey(guest.vaultKey, vaultKey)) return failed('unreadable');
  const source = guestBackend(guest.accountId);
  const held = await inventory(source, options.signal);
  if (!held.ok) return held;
  let replacements: ReadonlyMap<string, string> | null = null;
  if (!conversion) {
    const copying = await copyAddresses(guest, accountId, source, held.data, options.signal);
    if (!copying.ok) return copying;
    replacements = copying.data;
  }
  const destination = await inventory(target, options.signal);
  if (!destination.ok) return destination;
  const { signal, progress = () => {} } = options;
  const pictures: string[] = [];
  for (;;) {
    if (signal?.aborted) return failed('stopped');
    const page = await source.heldFiles(pictures.at(-1) ?? null);
    if (!page.ok) return page;
    if (page.data.timeline !== held.data.timeline || page.data.rev !== held.data.rev) return failed('conflict');
    pictures.push(...page.data.ids);
    if (!page.data.more) break;
  }
  progress({ kind: 'pictures', done: 0, total: pictures.length });
  let picturesDone = 0;
  const move = async (ids: string[]): Promise<ApiFailure | null> => {
    const missing = await target.missingFiles(ids);
    if (!missing.ok) return missing;
    const needed = new Set(missing.data.missing);
    let room = missing.data.room;
    let failure: ApiFailure | null = null;
    await Promise.all(ids.map((id) => transfers.run(async () => {
      if (failure || signal?.aborted) return;
      if (needed.has(id)) {
        const body = await source.readFile(id);
        if (!body.ok) { failure ??= body; return; }
        if (body.data.length > missing.data.maxBytes) { failure ??= failed('too-large'); return; }
        if (room !== null) {
          if (body.data.length > room) { failure ??= failed('files-full'); return; }
          room -= body.data.length;
        }
        if (failure || signal?.aborted) return;
        const sent = await target.putFile(id, body.data);
        if (!sent.ok) { failure ??= sent; return; }
      }
      progress({ kind: 'pictures', done: ++picturesDone, total: pictures.length });
    }, true)));
    return failure;
  };
  const asks = Array.from({ length: Math.ceil(pictures.length / PICTURES_PER_ASK) }, (_, index) => pictures.slice(index * PICTURES_PER_ASK, (index + 1) * PICTURES_PER_ASK));
  for await (const [, failure] of inOrder(asks, move, { ahead: 2 })) {
    if (signal?.aborted) return failed('stopped');
    if (failure) return failure;
  }
  const present = new Map(destination.data.rows.map((row) => [row.id, row]));
  const countable = (row: SealedChange) => row.body !== null && (conversion || !('id' in KINDS[row.kind as Kind]));
  if (held.data.rows.some((row) => !Object.hasOwn(KINDS, row.kind))) return failed('unreadable');
  const total = held.data.rows.filter(countable).length;
  let done = 0;
  let known = destination.data.rev;
  progress({ kind: 'objects', done, total });
  let guestOrder: Order | null = null;
  let since = 0;
  for (;;) {
    if (signal?.aborted) return failed('stopped');
    const page = await source.feed(feedQuery({ since, timeline: held.data.timeline, bootstrap: true, until: held.data.rev }), signal);
    if (!page.ok) return page;
    if (!conversion) {
      const row = page.data.changes.find(({ id, body }) => id === ORDER_ID && body !== null);
      if (row) {
        const value = await openObject(await objectKey(guest.vaultKey), guest.accountId, row, row.body!);
        if (!isValue('order', value)) return failed('unreadable');
        guestOrder = value;
      }
    }
    const prepared = conversion ? { ok: true as const, data: page.data.changes } : await copies(guest, accountId, vaultKey, page.data.changes, replacements!, present);
    if (!prepared.ok) return prepared;
    const writes: SealedWrite[] = [];
    for (const row of prepared.data) {
      const prior = present.get(row.id);
      if (!conversion && prior) {
        progress({ kind: 'objects', done: ++done, total });
        continue;
      }
      if (prior && (prior.kind !== row.kind || prior.parent !== row.parent)) return failed('conflict');
      // Conversion reconciles guest edits/deletions. Copies never revise an account row, even an earlier copy.
      if (row.body === null && (!conversion || !prior || prior.body === null)) continue;
      writes.push({ id: row.id, kind: row.kind, parent: row.parent, body: row.body!, baseRev: conversion ? prior?.rev ?? null : null });
    }
    for (let start = 0; start < writes.length;) {
      if (signal?.aborted) return failed('stopped');
      const batch: SealedWrite[] = [];
      let end = start;
      while (end < writes.length && batch.length < BATCH_LIMITS.items) {
        const candidate = [...batch, writes[end]!];
        if (new TextEncoder().encode(JSON.stringify({ timeline: destination.data.timeline, writes: candidate, files: [] })).length > BATCH_LIMITS.bytes) break;
        batch.push(writes[end++]!);
      }
      if (!batch.length) return failed('too-large');
      const sent = await target.batch(destination.data.timeline, batch, [], signal);
      if (!sent.ok) return sent;
      known = Math.max(known, ...sent.data.revs);
      done += batch.filter(({ body }) => body !== null).length;
      progress({ kind: 'objects', done, total });
      start = end;
    }
    since = page.data.cursor;
    if (!page.data.more) break;
  }
  if (guestOrder) {
    const copied = new Set(held.data.rows.filter(({ kind, body }) => body !== null && (kind === 'character' || kind === 'folder')).map(({ id }) => id));
    const ids = guestOrder.ids.filter((id) => copied.has(id)).map((id) => replacements!.get(id)!);
    if (ids.length) {
      const ordered = await copyOrder(target, accountId, vaultKey, destination.data.timeline, ids, signal);
      if (!ordered.ok) return ordered;
      known = Math.max(known, ordered.data);
    }
  }
  if (signal?.aborted) return failed('stopped');
  const confirmed = await target.feed(feedQuery({ since: known, timeline: destination.data.timeline, metadata: true }), signal);
  if (!confirmed.ok) return confirmed;
  const secret = await guestBoardSecret(guest.accountId);
  if (!secret.ok) return secret;
  if (secret.data) {
    const moved = await api<undefined>('POST', 'board/claim', { secret: secret.data }, signal);
    if (!moved.ok) return moved;
  }
  // No cached timeline or guest-era row may stand in front of the account's first pull.
  if (conversion) await deviceCache(accountId).forget();
  const cleared = await clearGuestStore(guest.accountId, { ...held.data, files: pictures });
  if (!cleared.ok) return cleared;
  // Remember before removing the only guest key: a close between these writes can still sign in and finish cleanup.
  await rememberVault(accountId, vaultKey);
  await forgetGuestVault(guest.accountId);
  return { ok: true, data: null };
}

const sameKey = (one: VaultKey, two: VaultKey) => one.length === two.length && one.every((byte, index) => byte === two[index]);

async function copyOrder(target: Backend, accountId: string, vaultKey: VaultKey, timeline: string, ids: string[], signal?: AbortSignal): Promise<ApiResult<number>> {
  const key = await objectKey(vaultKey);
  const address = { id: ORDER_ID, kind: 'order', parent: null };
  for (;;) {
    if (signal?.aborted) return failed('stopped');
    const page = await target.feed(feedQuery({ since: 0, timeline, bootstrap: true, kind: 'order' }), signal);
    if (!page.ok) return page;
    const row = page.data.changes[0];
    let current: Order = { ids: [] };
    if (row && row.body !== null) {
      const value = await openObject(key, accountId, row, row.body!);
      if (!isValue('order', value)) return failed('unreadable');
      current = value;
    }
    // Retrying after this write landed puts the same copies first again, even if another device moved one meanwhile.
    const body = await sealObject(key, accountId, address, { ids: toFront(current.ids, ids) });
    const sent = await target.batch(timeline, [{ ...address, body, baseRev: row?.rev ?? null }], [], signal);
    if (sent.ok) return { ok: true, data: sent.data.revs[0]! };
    if (sent.error !== 'conflict') return sent;
  }
}

// Account-pair masks make retry-stable ids; XOR ids commute, hash-addressed tool rows use remapped owners.
// Rewrite inventory references only, never arbitrary UUID values. Existing copies, even tombstones, acknowledge upload:
// never overwrite subsequent account edits with guest data.
async function copyAddresses(guest: Guest, accountId: string, source: Backend, held: Inventory, signal?: AbortSignal): Promise<ApiResult<ReadonlyMap<string, string>>> {
  const mask = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`risu-alpha/guest-import/v1/${guest.accountId}/${accountId}`)));
  const singletons = new Set<string>(Object.values(KINDS).flatMap((rule) => 'id' in rule ? [rule.id] : []));
  const replacements = new Map(held.rows.filter(({ id }) => !singletons.has(id)).map(({ id }) => {
    let index = 0;
    const copy = id.replace(/[0-9a-f]/g, (digit, offset: number) => {
      const at = index++;
      return offset === 14 || offset === 19 ? digit : (parseInt(digit, 16) ^ (mask[at]! & 15)).toString(16);
    });
    return [id, copy];
  }));
  const copyId = (id: string) => replacements.get(id) ?? id;
  const kinds = new Map(held.rows.map(({ id, kind }) => [id, kind]));
  const key = await objectKey(guest.vaultKey);
  // Resolve these before copying any page: a summary on an earlier page can refer to one on a later page.
  for (const kind of ['tooldata', 'toolfile', 'toolchat', 'asset']) {
    if (!held.rows.some((row) => row.kind === kind && row.body !== null)) continue;
    let since = 0;
    for (;;) {
      if (signal?.aborted) return failed('stopped');
      const page = await source.feed(feedQuery({ since, timeline: held.timeline, until: held.rev, bootstrap: true, kind }), signal);
      if (!page.ok) return page;
      for (const row of page.data.changes) {
        if (row.body === null) continue;
        const value = await openObject(key, guest.accountId, row, row.body!);
        if (!isRecord(value)) return failed('unreadable');
        if (kind === 'tooldata') replacements.set(row.id, await toolDataId(copyId(row.parent!), value.key as string));
        else if (kind === 'toolfile') replacements.set(row.id, await toolFileId(copyId(row.parent!), value.key as string));
        else if (kind === 'toolchat') replacements.set(row.id, await toolChatId(copyId(value.module as string), copyId(row.parent!), value.key as string | null));
        else if (kinds.get(row.parent!) === 'module' && row.id === await toolAssetId(row.parent!, value.name as string)) {
          replacements.set(row.id, await toolAssetId(copyId(row.parent!), value.name as string));
        }
      }
      since = page.data.cursor;
      if (!page.data.more) break;
    }
  }
  return { ok: true, data: replacements };
}

async function copies(guest: Guest, accountId: string, vaultKey: VaultKey, rows: SealedChange[], replacements: ReadonlyMap<string, string>, present: ReadonlyMap<string, SealedChange>): Promise<ApiResult<SealedChange[]>> {
  const oldKey = await objectKey(guest.vaultKey);
  const nextKey = await objectKey(vaultKey);
  const result: SealedChange[] = [];
  const copyId = (id: string) => replacements.get(id) ?? id;
  for (const row of rows) {
    if (row.body === null) continue;
    if (!Object.hasOwn(KINDS, row.kind)) return failed('unreadable');
    const kind = row.kind as Kind;
    if ('id' in KINDS[kind]) continue;
    const address = { id: copyId(row.id), kind, parent: row.parent === null ? null : copyId(row.parent) };
    if (present.has(address.id)) {
      result.push({ ...address, rev: row.rev, omitted: true });
      continue;
    }
    const value = await openObject(oldKey, guest.accountId, row, row.body!);
    if (!isRecord(value)) return failed('unreadable');
    // Seeds are values, not references. Materialize the implicit one before changing its object's identity.
    if (kind === 'chat' || (kind === 'entry' && (value.type === 'message' || value.type === 'version'))) value.seed ??= row.id;
    result.push({ ...address, rev: row.rev, body: await sealObject(nextKey, accountId, address, remap(value, replacements, kind)) });
  }
  return { ok: true, data: result };
}

function remap(value: unknown, replacements: ReadonlyMap<string, string>, kind: Kind, path: string[] = []): unknown {
  const field = path.at(-1);
  // Engine seeds keep their original roll; tool keys keep the literal lookup name used by tools/store's hashes.
  if ((kind === 'chat' || kind === 'entry') && path.length === 1 && field === 'seed') return value;
  if (kind === 'stream' && path.join('.') === 'for.continues.seed') return value;
  if ((kind === 'tooldata' || kind === 'toolfile' || kind === 'toolchat') && path.length === 1 && field === 'key') return value;
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item: unknown) => remap(item, replacements, kind, [...path, '*']));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [replacements.get(key) ?? key, remap(item, replacements, kind, [...path, key])]));
}
