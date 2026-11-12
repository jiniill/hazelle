import { unavailableCalibration } from '../../model/token-calibration';
import { ChangeSignal } from '../../change-signal';
import { loggedCalls, usageCall, type Entry, type Receipt } from '../../model/chat';
import type { Cost } from '../../connectors/types';
import { isValue, type Stored } from '../../model/kinds';
import { grouped } from '../../model/fields';
import { SETTINGS_ID, type Settings } from '../../model/settings';
import { counted, type CallPurpose, type Counted, type Ledger, type LoggedCall } from '../../model/usage';
import type { ApiFailure, ApiResult } from '../api';
import type { Write } from '../store/object-writes';
import { isHalted, type ObjectStore, type Pin } from '../store/store';
import { accountSettings, changeSettings } from '../account-settings';

// Derive a stable UUID-v8 ledger id from the call id; random UUID-v4 stream ids cannot collide.
// Repeating the same call lands idempotently (server once).
export const ledgerId = (call: string) => `${call.slice(0, 14)}8${call.slice(15)}`;

export type CallPlace = { chat: string | null; character: string | null };

function callRow({ at, call, purpose }: LoggedCall, { chat, character }: CallPlace): Write {
  const row = { at, call: call.calibration === undefined ? { ...call, calibration: unavailableCalibration('historical') } : call, chat, character, purpose };
  return { type: 'create', kind: 'ledger', id: ledgerId(call.id), parent: SETTINGS_ID, value: call.calibration?.refusal ? { type: 'input-refusal', ...row } : { type: 'call', ...row } };
}

export const receiptRow = (purpose: CallPurpose, receipt: Receipt, at: number, place: CallPlace) => callRow({ ...usageCall(receipt, at), purpose }, place);

export const chatPlace = (store: ObjectStore, chat: string): CallPlace => ({ chat, character: store.get('chat', chat)?.value.character ?? null });

export const costRow = (call: string, cost: Cost | null): Write =>
  ({ type: 'create', kind: 'ledger', id: crypto.randomUUID(), parent: SETTINGS_ID, value: { type: 'cost', call, cost, at: Date.now() } });

const purposeRow = (call: string, purpose: CallPurpose): Write =>
  ({ type: 'create', kind: 'ledger', id: crypto.randomUUID(), parent: SETTINGS_ID, value: { type: 'purpose', call, purpose, at: Date.now() } });

// Only for a call no other write saves: one that saves its receipt puts receiptRow in that write's batch.
export const keepRow = (store: ObjectStore, purpose: CallPurpose, receipt: Receipt, at: number, place: CallPlace) => store.batch([receiptRow(purpose, receipt, at, place)]);

const FILL_STEP = 100;

// This page's fill (of the ledger, or of its calls' purposes): how far it has gone while it runs, failed when it stopped
// short (the account keeps where).
export type Filling = { read: number; of: number } | 'failed' | null;

// The ledger read for the usage screens. Its rows stay for the session and are cached on the device by the store's
// walk, so a read after the first asks only for the rows written since.
export class Usage {
  private readonly rows = new Map<string, Ledger>();
  private cursor = 0;
  private countedRows: Counted[] | null = null;
  private measuredRows: Counted[] | null = null;
  private readonly closing = new AbortController();
  private running: Promise<unknown> | null = null;
  private filled: Filling = null;
  private purposed: Filling = null;
  private readonly changes = new ChangeSignal();

  constructor(private readonly store: ObjectStore) {}

  readonly subscribe = this.changes.subscribe;

  readonly filling = () => this.filled;

  readonly purposing = () => this.purposed;

  // Tokens uses this stable identity to skip derivation until the ledger changes.
  calibrationRows(): readonly Counted[] {
    return this.measuredRows ??= [...this.rows.values()].flatMap((row) => row.type === 'cost' || row.type === 'purpose' ? [] : [{ at: row.at, call: row.call, chat: row.chat, character: row.character, purpose: row.purpose }]);
  }

  close() {
    this.closing.abort();
    this.rows.clear();
    this.countedRows = null;
    this.measuredRows = null;
    this.changes.clear();
  }

  async read(signal: AbortSignal): Promise<ApiResult<Counted[]>> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    while (this.running) {
      await this.running;
      if (stop.aborted) return { ok: false, error: 'stopped' };
    }
    const running = this.walk(stop).catch((): ApiResult<Counted[]> => ({ ok: false, error: stop.aborted ? 'stopped' : 'usage-unavailable' }));
    this.running = running;
    try { return await running; }
    finally { this.running = null; }
  }

  private async walk(signal: AbortSignal): Promise<ApiResult<Counted[]>> {
    const pinned = await this.store.pin(signal);
    if (!pinned.ok) return pinned;
    const pin = pinned.data;
    // A row lands through the store whoever wrote it (this device's write, another's with the pull) and raises this
    // revision; at or under the cursor there is nothing past it to ask the server for.
    if (this.cursor && this.store.revision({ kind: 'ledger', parent: SETTINGS_ID }) <= this.cursor) return { ok: true, data: this.countedRows ??= counted(this.rows.values()) };
    let unreadable = false;
    const walked = await this.store.walk(SETTINGS_ID, 'ledger', (row, value) => {
      if (isValue('ledger', value)) {
        this.rows.set(row.id, value);
        this.countedRows = null;
        this.measuredRows = null;
      } else unreadable = true;
    }, this.cursor, pin, signal);
    if (!walked.ok) return walked;
    if (unreadable) return { ok: false, error: 'unreadable' };
    this.cursor = walked.data;
    return { ok: true, data: this.countedRows ??= counted(this.rows.values()) };
  }

  // Backfill every pre-ledger call once, including binned chats, illustrations, memory, mascot lines and profiles.
  // Process originals before branches so copied calls stay attributed to their origin.
  // Persist progress in settings; timeline rewind stops the fill and restored settings decide resumption.
  async fill(signal: AbortSignal = this.closing.signal): Promise<void> {
    if (this.filled && this.filled !== 'failed') return;
    await this.oneFill(signal, (state) => (this.filled = state), (pin, stop) => this.filledAll(pin, stop));
  }

  // Once per account, after the fill: the purposes of the calls whose rows were saved before rows kept one, each found
  // in the chat that saved it, booked as rows of their own. Only the chats that saved such a call are read, once each; a
  // call whose chat is gone, or whose purpose its log cannot tell, stays unknown.
  async fillPurposes(signal: AbortSignal = this.closing.signal): Promise<void> {
    if (this.purposed && this.purposed !== 'failed') return;
    await this.oneFill(signal, (state) => (this.purposed = state), (pin, stop) => this.purposedAll(pin, stop));
  }

  private async oneFill(signal: AbortSignal, set: (state: Filling) => void, run: (pin: Pin, signal: AbortSignal) => Promise<ApiFailure | null>) {
    set({ read: 0, of: 0 });
    this.changes.notify();
    const stop = AbortSignal.any([signal, this.closing.signal]);
    let failure: ApiFailure | null;
    try {
      failure = await this.store.pinned((pin) => run(pin, stop), stop);
    } catch {
      failure = { ok: false, error: 'usage-unavailable' };
    }
    set(!failure || isHalted(failure) ? null : 'failed');
    this.changes.notify();
  }

  private async filledAll(pin: Pin, signal: AbortSignal): Promise<ApiFailure | null> {
    const { ledger } = accountSettings(this.store);
    if (ledger === 'filled') return null;
    const depth = ({ value }: Stored<'chat'>) => {
      let depth = 0;
      for (let origin = value.origin?.id; origin; origin = this.store.get('chat', origin)?.value.origin?.id) depth++;
      return depth;
    };
    const order = (chat: Stored<'chat'>) => `${String(depth(chat)).padStart(3, '0')}:${chat.id}`;
    const chats = this.store.list('chat').map((chat) => ({ chat, order: order(chat) })).filter((one) => one.order > (ledger?.after ?? ''))
      .sort((a, b) => (a.order < b.order ? -1 : 1));
    for (const [index, { chat, order }] of chats.entries()) {
      this.filled = { read: index, of: chats.length };
      this.changes.notify();
      const rows = await this.chatRows(chat, pin, signal);
      if (!rows.ok) return rows;
      const failure = (await this.written(rows.data, signal)) ?? ((index + 1) % FILL_STEP === 0 ? await this.marked({ ledger: { after: order } }) : null);
      if (failure) return failure;
    }
    const profiles = this.store.list('likeness').flatMap(({ parent, value }) =>
      (value.receipt ? [receiptRow('likeness', value.receipt, value.at, { chat: null, character: parent && this.store.get('character', parent) ? parent : null })] : []));
    return (await this.written(profiles, signal)) ?? this.marked({ ledger: 'filled' });
  }

  private async purposedAll(pin: Pin, signal: AbortSignal): Promise<ApiFailure | null> {
    const { ledger, purposes } = accountSettings(this.store);
    if (ledger !== 'filled' || purposes === 'filled') return null;
    const read = await this.read(signal);
    if (!read.ok) return read;
    const unknown = grouped(read.data.filter(({ purpose }) => purpose === null), ({ chat }) => chat);
    const chats = [...unknown.keys()].flatMap((chat) => (chat !== null && chat > (purposes?.after ?? '') && this.store.get('chat', chat) ? [chat] : [])).sort();
    const booked = (kept: LoggedCall[], among: Counted[] = []) => {
      const found = new Map(kept.map(({ call, purpose }) => [call.id, purpose]));
      return among.flatMap(({ call }) => {
        const purpose = found.get(call.id);
        return purpose ? [purposeRow(call.id, purpose)] : [];
      });
    };
    for (const [index, chat] of chats.entries()) {
      this.purposed = { read: index, of: chats.length };
      this.changes.notify();
      const kept = await this.chatCalls(chat, pin, signal);
      if (!kept.ok) return kept;
      const failure = (await this.written(booked(kept.data.calls, unknown.get(chat)), signal)) ?? ((index + 1) % FILL_STEP === 0 ? await this.marked({ purposes: { after: chat } }) : null);
      if (failure) return failure;
    }
    const profiles = this.store.list('likeness').flatMap(({ value }) => (value.receipt ? [{ ...usageCall(value.receipt, value.at), purpose: 'likeness' as const }] : []));
    return (await this.written(booked(profiles, unknown.get(null)), signal)) ?? this.marked({ purposes: 'filled' });
  }

  private async marked(change: Pick<Settings, 'ledger'> | Pick<Settings, 'purposes'>) {
    const marked = await changeSettings(this.store, (current) => ({ ...current, ...change }));
    return marked.ok ? null : marked;
  }

  private async written(rows: Write[], signal: AbortSignal) {
    const written = rows.length ? await this.store.batch(rows, undefined, { signal }) : null;
    return written && !written.ok ? written : null;
  }

  // Every call a chat keeps: its log's, its 삽화's, its memory's and its mascot's lines'.
  private async chatCalls(chat: string, pin: Pin, signal: AbortSignal): Promise<ApiResult<ReturnType<typeof loggedCalls>>> {
    const entries: Entry[] = [];
    const calls: LoggedCall[] = [];
    let unreadable = false;
    const failure = await this.store.scan({ parent: chat }, (row, held) => {
      if (row.kind === 'entry') {
        if (isValue('entry', held)) entries.push(held);
        else unreadable = true;
      } else if (row.kind === 'illustration') {
        if (!isValue('illustration', held)) unreadable = true;
        else if ('receipt' in held && held.receipt) calls.push({ ...usageCall(held.receipt, held.at), purpose: 'illustration' });
      } else if (row.kind === 'memory') {
        if (!isValue('memory', held)) unreadable = true;
        else for (const { receipt, at } of [...held.records, ...held.chapters]) if (receipt) calls.push({ ...usageCall(receipt, at), purpose: 'memory' });
      } else if (row.kind === 'remark') {
        if (!isValue('remark', held)) unreadable = true;
        else calls.push({ ...usageCall(held.receipt, held.at), purpose: 'mascot' });
      }
    }, pin, signal);
    if (failure) return failure;
    if (unreadable) return { ok: false, error: 'unreadable' };
    const logged = loggedCalls(entries);
    return { ok: true, data: { calls: [...logged.calls, ...calls], booked: logged.booked } };
  }

  private async chatRows({ id, value }: Stored<'chat'>, pin: Pin, signal: AbortSignal): Promise<ApiResult<Write[]>> {
    const kept = await this.chatCalls(id, pin, signal);
    if (!kept.ok) return kept;
    const place = { chat: id, character: value.character };
    // A batch takes an id once.
    const once = new Map<string, Write>();
    for (const one of kept.data.calls) if (!once.has(one.call.id)) once.set(one.call.id, callRow(one, place));
    return { ok: true, data: [...once.values(), ...kept.data.booked.map(({ call, cost }) => costRow(call, cost))] };
  }
}
