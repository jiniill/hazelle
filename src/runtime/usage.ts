import { unavailableCalibration } from '../model/token-calibration';
import { ChangeSignal } from '../change-signal';
import { loggedCalls, usageCall, type Entry, type Receipt } from '../model/chat';
import type { Cost } from '../connectors/types';
import { isValue, type Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import { counted, type Counted, type Ledger, type UsageCall } from '../model/usage';
import type { ApiFailure, ApiResult } from './api';
import type { Write } from './object-writes';
import type { ObjectStore, Pin } from './store';

// Derive a stable UUID-v8 ledger id from the call id; random UUID-v4 stream ids cannot collide.
// Repeating the same call lands idempotently (server once).
export const ledgerId = (call: string) => `${call.slice(0, 14)}8${call.slice(15)}`;

export type CallPlace = { chat: string | null; character: string | null };

function callRow({ at, call }: UsageCall, { chat, character }: CallPlace): Write {
  const row = { at, call: call.calibration === undefined ? { ...call, calibration: unavailableCalibration('historical') } : call, chat, character };
  return { type: 'create', kind: 'ledger', id: ledgerId(call.id), parent: SETTINGS_ID, value: call.calibration?.refusal ? { type: 'input-refusal', ...row } : { type: 'call', ...row } };
}

export const receiptRow = (receipt: Receipt, at: number, place: CallPlace) => callRow(usageCall(receipt, at), place);

export const chatPlace = (store: ObjectStore, chat: string): CallPlace => ({ chat, character: store.get('chat', chat)?.value.character ?? null });

export const costRow = (call: string, cost: Cost | null): Write =>
  ({ type: 'create', kind: 'ledger', id: crypto.randomUUID(), parent: SETTINGS_ID, value: { type: 'cost', call, cost, at: Date.now() } });

// Only for a call no other write saves: one that saves its receipt puts receiptRow in that write's batch.
export const keepRow = (store: ObjectStore, receipt: Receipt, at: number, place: CallPlace) => store.batch([receiptRow(receipt, at, place)]);

const FILL_STEP = 100;

// This page's fill: how far it has gone while it runs, failed when it stopped short (the account keeps where).
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
  private readonly changes = new ChangeSignal();

  constructor(private readonly store: ObjectStore) {}

  readonly subscribe = this.changes.subscribe;

  readonly filling = () => this.filled;

  // Tokens uses this stable identity to skip derivation until the ledger changes.
  calibrationRows(): readonly Counted[] {
    return this.measuredRows ??= [...this.rows.values()].flatMap((row) => row.type === 'cost' ? [] : [{ at: row.at, call: row.call, chat: row.chat, character: row.character }]);
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

  // Backfill every pre-ledger call once, including binned chats, illustrations/memory and profiles.
  // Process originals before branches so copied calls stay attributed to their origin.
  // Persist progress in settings; timeline rewind stops the fill and restored settings decide resumption.
  async fill(signal: AbortSignal = this.closing.signal): Promise<void> {
    if (this.filled && this.filled !== 'failed') return;
    this.filled = { read: 0, of: 0 };
    this.changes.notify();
    const stop = AbortSignal.any([signal, this.closing.signal]);
    let failure: ApiFailure | null;
    try {
      failure = await this.store.pinned((pin) => this.filledAll(pin, stop), stop);
    } catch {
      failure = { ok: false, error: 'usage-unavailable' };
    }
    this.filled = !failure || failure.error === 'stopped' || failure.error === 'timeline-changed' ? null : 'failed';
    this.changes.notify();
  }

  private async filledAll(pin: Pin, signal: AbortSignal): Promise<ApiFailure | null> {
    const settings = this.store.get('settings', SETTINGS_ID)?.value;
    if (!settings || settings.ledger === 'filled') return null;
    const { ledger } = settings;
    const depth = ({ value }: Stored<'chat'>) => {
      let depth = 0;
      for (let origin = value.origin?.id; origin; origin = this.store.get('chat', origin)?.value.origin?.id) depth++;
      return depth;
    };
    const order = (chat: Stored<'chat'>) => `${String(depth(chat)).padStart(3, '0')}:${chat.id}`;
    const chats = this.store.list('chat').map((chat) => ({ chat, order: order(chat) })).filter((one) => one.order > (ledger?.after ?? ''))
      .sort((a, b) => (a.order < b.order ? -1 : 1));
    const mark = async (ledger: 'filled' | { after: string }) => {
      const marked = await this.store.upsert('settings', (current) => ({ ...current!, ledger }));
      return marked.ok ? null : marked;
    };
    const write = async (rows: Write[]) => {
      const written = rows.length ? await this.store.batch(rows, undefined, { signal }) : null;
      return written && !written.ok ? written : null;
    };
    for (const [index, { chat, order }] of chats.entries()) {
      this.filled = { read: index, of: chats.length };
      this.changes.notify();
      const rows = await this.chatRows(chat, pin, signal);
      if (!rows.ok) return rows;
      const failure = (await write(rows.data)) ?? ((index + 1) % FILL_STEP === 0 ? await mark({ after: order }) : null);
      if (failure) return failure;
    }
    const profiles = this.store.list('likeness').flatMap(({ parent, value }) =>
      (value.receipt ? [receiptRow(value.receipt, value.at, { chat: null, character: parent && this.store.get('character', parent) ? parent : null })] : []));
    return (await write(profiles)) ?? mark('filled');
  }

  private async chatRows({ id, value }: Stored<'chat'>, pin: Pin, signal: AbortSignal): Promise<ApiResult<Write[]>> {
    const entries: Entry[] = [];
    const calls: UsageCall[] = [];
    let unreadable = false;
    const failure = await this.store.scan({ parent: id }, (row, held) => {
      if (row.kind === 'entry') {
        if (isValue('entry', held)) entries.push(held);
        else unreadable = true;
      } else if (row.kind === 'illustration') {
        if (!isValue('illustration', held)) unreadable = true;
        else if ('receipt' in held && held.receipt) calls.push(usageCall(held.receipt, held.at));
      } else if (row.kind === 'memory') {
        if (!isValue('memory', held)) unreadable = true;
        else for (const { receipt, at } of [...held.records, ...held.chapters]) if (receipt) calls.push(usageCall(receipt, at));
      }
    }, pin, signal);
    if (failure) return failure;
    if (unreadable) return { ok: false, error: 'unreadable' };
    const place = { chat: id, character: value.character };
    const logged = loggedCalls(entries);
    // A batch takes an id once.
    const once = new Map<string, Write>();
    for (const one of [...logged.calls, ...calls]) if (!once.has(one.call.id)) once.set(one.call.id, callRow(one, place));
    return { ok: true, data: [...once.values(), ...logged.booked.map(({ call, cost }) => costRow(call, cost))] };
  }
}
