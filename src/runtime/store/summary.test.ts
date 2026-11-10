import { describe, expect, it, vi } from 'vitest';
import { scopeOf } from '../chat/chat-context';
import { EvaluationStuck } from '../evaluation/evaluation';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';
import { saveSummaries, summaryId } from './summary';
import { testServer } from '../testing';

const server = testServer();

const message = (parent: string, text: string): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent, value: { type: 'message', role: 'user', at: 0, text, receipt: null } });
const root = (id: string, persona?: string): Write => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {}, ...(persona && { persona }) } });

// As the worker does on a stall: the chat is judged before the job fails.
function stickOnce(store: ObjectStore, chat: string) {
  const display = store.evaluation.display.bind(store.evaluation);
  return vi.spyOn(store.evaluation, 'display').mockImplementation(async (lane, ...rest) => {
    if (lane.chat !== chat || store.projections.verdict(chat)) return display(lane, ...rest);
    store.projections.judge(chat);
    throw new EvaluationStuck('stuck', true);
  });
}

describe('a chat whose bot does not end', () => {
  it('is summarized from its display without the regex, carries the verdict to another device, and backfill goes past it', async () => {
    const { store, open } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.batch([root(a), root(b), message(a, 'one'), message(b, 'two')], undefined, { unheld: true })).ok).toBe(true);
    const displayed = stickOnce(store, a);
    expect(await saveSummaries(store, [a, b])).toBeNull();
    expect(displayed.mock.calls.filter(([lane]) => lane.chat === a)).toHaveLength(2);
    expect(store.get('summary', summaryId(a))!.value).toMatchObject({ preview: 'one', stuck: { dependencies: expect.any(Array) } });
    expect(store.get('summary', summaryId(b))!.value).toMatchObject({ preview: 'two' });
    expect(store.get('summary', summaryId(b))!.value.stuck).toBeUndefined();
    const phone = await open();
    await phone.pull();
    expect(phone.projections.verdict(a)).not.toBeNull();
    expect(phone.projections.verdict(b)).toBeNull();
  });

  it("keeps its verdict out of the reads of the display that asked for a job", async () => {
    const { store } = await server.account();
    const a = crypto.randomUUID();
    const scope = scopeOf({ store }, a, { title: null, character: null, models: {} }, []);
    const { value, reads } = store.capture(() => store.evaluation.display({ asker: 'headless', chat: a }, scope, new Set()));
    await value;
    expect(reads).toEqual([]);
  });

  it('fails as bot-stuck, once, when even its display without the regex does not end', async () => {
    const { store } = await server.account();
    const a = crypto.randomUUID();
    expect((await store.batch([root(a), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    const displayed = vi.spyOn(store.evaluation, 'display').mockRejectedValue(new EvaluationStuck('stuck', false));
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.scopeError(a)).toEqual({ ok: false, error: 'bot-stuck' }));
    expect(displayed).toHaveBeenCalledTimes(1);
    lease.release();
  });

  it('is shown with the regex again once what it was judged on changes, or 다시 시도 clears it, and its summary drops the verdict', async () => {
    const { store } = await server.account();
    const [a, persona] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.create('persona', { name: 'Mina', description: '', picture: null }, { id: persona })).ok).toBe(true);
    expect((await store.batch([root(a, persona), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    expect(store.get('summary', summaryId(a))!.value.stuck).toBeUndefined();
    expect(store.projections.verdict(a)).toBeNull();
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeDefined());
    await store.update('persona', persona, (value) => ({ ...value, name: 'Luna' }));
    expect(store.projections.verdict(a)).toBeNull();
    store.projections.judge(a);
    expect(store.projections.verdict(a)).not.toBeNull();
    store.projections.clear(a);
    expect(store.projections.verdict(a)).toBeNull();
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeUndefined());
    expect(store.projections.get(a)!.summary.stuck).toBeUndefined();
    lease.release();
  });

  it("is no longer judged once the chat's own prompt changes", async () => {
    const { store } = await server.account();
    const a = crypto.randomUUID();
    expect((await store.batch([root(a), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeDefined());
    await store.update('chat', a, (value) => ({ ...value, prompt: crypto.randomUUID() }));
    expect(store.projections.verdict(a)).toBeNull();
    lease.release();
  });

  it('takes 다시 시도 on another device over the verdict this device holds, and never writes it back', async () => {
    const { store, open } = await server.account();
    const a = crypto.randomUUID();
    expect((await store.batch([root(a), message(a, 'one')], undefined, { unheld: true })).ok).toBe(true);
    const lease = store.retainChat(a);
    expect(await lease.ready).toBeNull();
    store.projections.judge(a);
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.stuck).toBeDefined());
    const phone = await open();
    await phone.pull();
    const held = phone.retainChat(a);
    expect(await held.ready).toBeNull();
    expect(phone.projections.verdict(a)).not.toBeNull();
    phone.projections.clear(a);
    await vi.waitFor(() => expect(phone.get('summary', summaryId(a))!.value.stuck).toBeUndefined());
    await store.pull();
    expect(store.projections.verdict(a)).toBeNull();
    expect((await store.batch([message(a, 'two')])).ok).toBe(true);
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))!.value.preview).toBe('two'));
    expect(store.get('summary', summaryId(a))!.value.stuck).toBeUndefined();
    held.release();
    lease.release();
  });

  it('is passed over by backfill when even its display without the regex does not end', async () => {
    const { store } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.batch([root(a), root(b), message(a, 'one'), message(b, 'two')], undefined, { unheld: true })).ok).toBe(true);
    const display = store.evaluation.display.bind(store.evaluation);
    vi.spyOn(store.evaluation, 'display').mockImplementation(async (lane, ...rest) => {
      if (lane.chat !== a) return display(lane, ...rest);
      const regex = !store.projections.verdict(a);
      store.projections.judge(a);
      throw new EvaluationStuck('stuck', regex);
    });
    expect(await saveSummaries(store, [a, b])).toBeNull();
    expect(store.get('summary', summaryId(a))).toBeNull();
    expect(store.get('summary', summaryId(b))!.value).toMatchObject({ preview: 'two' });
  });
});
