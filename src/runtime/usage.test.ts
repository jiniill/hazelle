import { expect, it, vi } from 'vitest';
import type { Entry, Receipt } from '../model/chat';
import { blankCard } from '../engine/import/card';
import { memoryId, type Memory } from '../model/memory';
import type { Counted } from '../model/usage';
import { appendCost, appendReply } from './chat-log';
import type { ObjectStore } from './store';
import { accountSettings, changeSettings } from './account-settings';
import type { Write } from './object-writes';
import { testServer } from './testing';
import { Usage } from './usage';

const server = testServer();
const receipt = (id = crypto.randomUUID(), over: Partial<Receipt> = {}): Receipt => ({
  id, connection: 'connection', model: 'model', source: 'source', modelName: 'model', state: 'done', cut: null, error: null, finishReason: 'stop',
  usage: null, cost: null, replyId: null, firstTextMs: null, totalMs: 100, cache: null, ...over,
});
const message = (call: Receipt): Entry => ({ type: 'message', role: 'assistant', text: 'reply', at: 10, receipt: call });
const write = (parent: string, value: Entry, id = crypto.randomUUID()): Write => ({ type: 'create', kind: 'entry', id, parent, value });
const chat = (id: string, origin?: string): Write => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {}, ...(origin && { origin: { id: origin, name: '', after: '' } }) } });
const places = (calls: Counted[]) => Object.fromEntries(calls.map(({ call, chat }) => [call.id, chat]));
const filled = (store: ObjectStore) => accountSettings(store).ledger;

const account = async () => (await server.account()).store;

it('fills the ledger once from every call kept before it, a branch’s copy under the chat that made it, and writing a row again lands as written', async () => {
  const store = await account();
  // The branch of the branch sorts before the branch it copies.
  const [nested, branch] = [crypto.randomUUID(), crypto.randomUUID()].sort() as [string, string];
  const original = crypto.randomUUID();
  const [first, continued, translated, bot, summary, profile, reply, branched] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
  const booked = { unit: 'usd' as const, amount: 0.5, source: 'reported' as const };
  const record = { id: 'r1', sources: [], print: '', when: null, where: null, who: [], what: '', lines: [], outcome: '', state: [], opens: [], closes: [], receipt: receipt(summary), at: 11 };
  const memory: Memory = { records: [record], chapters: [], state: [], threads: [] };
  expect((await store.batch([
    write(original, message(receipt(continued, { continues: receipt(first), cost: 'pending', replyId: 'reply' })), reply),
    write(original, { type: 'translation', version: reply, at: 12, text: 'translation', receipt: receipt(translated) }),
    write(original, { type: 'call', version: reply, at: 13, receipt: receipt(bot) }),
    write(branch, message(receipt(continued, { continues: receipt(first), cost: 'pending', replyId: 'reply' }))),
    write(branch, { type: 'cost', replyId: 'reply', cost: booked, at: 14 }),
    write(branch, message(receipt(branched))),
    write(nested, message(receipt(branched))),
    { type: 'create', kind: 'memory', id: memoryId(original), parent: original, value: memory },
    chat(original),
    chat(branch, original),
    chat(nested, branch),
  ], undefined, { unheld: true })).ok).toBe(true);
  const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  expect((await store.create('likeness', { portraits: [], at: 14, receipt: receipt(profile) }, { parent: character.data.id })).ok).toBe(true);

  const usage = new Usage(store);
  await usage.fill();
  expect(filled(store)).toBe('filled');
  const read = await usage.read(new AbortController().signal);
  if (!read.ok) throw new Error(read.error);
  expect(places(read.data)).toEqual({ [first]: original, [continued]: original, [translated]: original, [bot]: original, [summary]: original, [profile]: null, [branched]: branch });
  expect(read.data.find(({ call }) => call.id === profile)!.character).toBe(character.data.id);
  // The branch booked the cost its original was still waiting for.
  expect(read.data.find(({ call }) => call.id === continued)!.call.cost).toEqual(booked);

  expect((await changeSettings(store, (current) => ({ ...current, ledger: undefined }))).ok).toBe(true);
  await usage.fill();
  expect(filled(store)).toBe('filled');
  expect(await usage.read(new AbortController().signal)).toMatchObject({ ok: true, data: { length: 7 } });
  usage.close();
});

it('goes on from the chat a fill cut short reached', async () => {
  const store = await account();
  const [before, after] = [crypto.randomUUID(), crypto.randomUUID()].sort();
  const [skipped, made] = [crypto.randomUUID(), crypto.randomUUID()];
  expect((await store.batch([write(before!, message(receipt(skipped))), write(after!, message(receipt(made))), chat(before!), chat(after!)], undefined, { unheld: true })).ok).toBe(true);
  expect((await changeSettings(store, (current) => ({ ...current, ledger: { after: `000:${before}` } }))).ok).toBe(true);
  const usage = new Usage(store);
  await usage.fill();
  expect(await usage.read(new AbortController().signal)).toMatchObject({ ok: true, data: [{ call: { id: made } }] });
  usage.close();
});

it('ends a fill that threw as failed, and a fill asked again goes on', async () => {
  const store = await account();
  vi.spyOn(store, 'scan').mockRejectedValueOnce(new Error('unreadable store'));
  expect((await store.batch([write(crypto.randomUUID(), message(receipt())), chat(crypto.randomUUID())], undefined, { unheld: true })).ok).toBe(true);
  const usage = new Usage(store);
  await usage.fill();
  expect(usage.filling()).toBe('failed');
  await usage.fill();
  expect([usage.filling(), filled(store)]).toEqual([null, 'filled']);
  usage.close();
});

it('counts a reply as it is saved, and the cost booked for it after', async () => {
  const store = await account();
  const id = crypto.randomUUID();
  await server.hold(store, id);
  const call = receipt(undefined, { cost: 'pending', replyId: 'r1' });
  expect((await store.batch([chat(id)])).ok).toBe(true);
  expect((await appendReply(store, id, { id: crypto.randomUUID(), message: null, replaces: null, at: 1, text: '답', receipt: call })).ok).toBe(true);
  const usage = new Usage(store);
  const signal = new AbortController().signal;
  const walk = vi.spyOn(store, 'walk');
  expect(await usage.read(signal)).toMatchObject({ ok: true, data: [{ call: { id: call.id, cost: 'pending' }, chat: id }] });
  // No row landed since: the same answer without asking the server again.
  expect(await usage.read(signal)).toMatchObject({ ok: true, data: [{ call: { id: call.id, cost: 'pending' }, chat: id }] });
  expect(walk).toHaveBeenCalledOnce();
  expect((await appendCost(store, id, call, { unit: 'usd', amount: 0.5, source: 'reported' })).ok).toBe(true);
  expect(await usage.read(signal)).toMatchObject({ ok: true, data: [{ call: { cost: { amount: 0.5 } } }] });
  expect(walk).toHaveBeenCalledTimes(2);
  usage.close();
});
