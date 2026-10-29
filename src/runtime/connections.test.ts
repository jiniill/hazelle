import { describe, expect, it } from 'vitest';
import { CONNECTION_TYPES, RETRIES } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import openRouterKey from '../connectors/fixtures/openrouter-key.json';
import openRouterModels from '../connectors/fixtures/openrouter-models.json';
import { SETTINGS_ID } from '../model/settings';
import { addConnection, addCopy, addModel, changeKey, providerConnection, putModelBack, refreshStarred, removeModel, renameModel, retriesOf, setSharedRetries } from './connections';
import { bareModel } from '../connectors/chat-completions';
import type { Model } from '../connectors/types';
import { stubRelay, testModel, testServer, upstream } from './testing';

const server = testServer();

const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-v1-x' }], turns: null, starred: [] };
const KEY = 'https://openrouter.ai/api/v1/key';

describe('providerConnection', () => {
  it('holds one account, named only for a sign-in, and gives a pool type its first group', () => {
    const type = CONNECTION_TYPES.find((entry) => entry.id === 'openrouter')!;
    expect(providerConnection(type, 'sk-or-v1-x')).toEqual({ ...openRouter, accounts: [{ id: expect.any(String), secret: 'sk-or-v1-x' }] });
    const copilot = providerConnection(CONNECTION_TYPES.find((entry) => entry.id === 'copilot')!, 'gho_x', 'jin');
    expect(copilot).toMatchObject({ accounts: [{ secret: 'gho_x', name: 'jin' }], turns: { day: 16, groups: [{ name: '그룹 1', accounts: [copilot.accounts[0]!.id] }] } });
    const first = providerConnection(type, 'first');
    const second = providerConnection(type, 'second');
    expect(first.starred).not.toBe(second.starred);
  });
});

describe('addConnection', () => {
  it('saves nothing for a key the meters refuse, though the public model list loaded, and answers the new id otherwise', () =>
    server.withSession(async (session) => {
      let key = upstream(401, { error: { message: 'User not found.' } });
      stubRelay(({ url }) => (url === KEY ? key : upstream(200, openRouterModels)));
      expect(await addConnection(session, openRouter)).toMatchObject({ ok: false, failure: { kind: 'key', failure: { kind: 'provider', status: 401 } } });
      expect(session.store.list('connection')).toEqual([]);

      key = upstream(200, openRouterKey);
      const added = await addConnection(session, openRouter);
      expect(session.store.list('connection').map((stored) => [stored.id, stored.value])).toEqual([[added.ok && added.id, openRouter]]);
    }));

  it('numbers a label another connection already holds', () =>
    server.withSession(async (session) => {
      stubRelay(({ url }) => upstream(200, url === KEY ? openRouterKey : openRouterModels));
      await addConnection(session, openRouter);
      await addConnection(session, openRouter);
      await addConnection(session, openRouter);
      expect(session.store.list('connection').map(({ value }) => value.label).sort()).toEqual(['OpenRouter', 'OpenRouter 2', 'OpenRouter 3']);
    }));
});

describe('changeKey', () => {
  it('keeps the old key when the meters refuse the new one, and otherwise swaps only the secret', () =>
    server.withSession(async (session) => {
      const starred = { ...openRouter, starred: [{ id: 'm' }] as never };
      const saved = await session.store.create('connection', starred);
      const id = saved.ok ? saved.data.id : '';
      let key = upstream(401, { error: { message: 'User not found.' } });
      stubRelay(({ url }) => (url === KEY ? key : upstream(200, openRouterModels)));
      expect(await changeKey(session, id, 'sk-or-v1-new')).toMatchObject({ kind: 'key' });
      expect(session.store.get('connection', id)?.value).toEqual(starred);

      key = upstream(200, openRouterKey);
      expect(await changeKey(session, id, 'sk-or-v1-new')).toBeNull();
      expect(session.store.get('connection', id)?.value).toEqual({ ...starred, accounts: [{ id: 'key', secret: 'sk-or-v1-new' }] });
    }));
});

describe('addModel', () => {
  it('makes the first model added that can talk the 대화 모델, and leaves one already set alone', () =>
    server.withSession(async ({ store }) => {
      const saved = await store.create('connection', openRouter);
      const id = saved.ok ? saved.data.id : '';
      const model = (name: string, output: Model['output'] = null): Model => ({ ...bareModel(name), output });
      await addModel(store, id, model('painter', ['image']));
      await addModel(store, id, model('first'));
      await addModel(store, id, model('second'));
      expect(store.get('settings', SETTINGS_ID)?.value.models.main).toEqual({ connection: id, model: 'first' });
    }));

  it("keys a model's first entry by its id and a copy by the entry it was given, and adds neither twice", () =>
    server.withSession(async ({ store }) => {
      const saved = await store.create('connection', openRouter);
      const id = saved.ok ? saved.data.id : '';
      const copy = { label: 'M (low)', entry: '#low' };
      expect(await addModel(store, id, testModel)).toEqual({ ok: true, data: testModel.id });
      expect(await addModel(store, id, testModel, copy)).toEqual({ ok: true, data: '#low' });
      await addModel(store, id, testModel);
      await addModel(store, id, testModel, copy);
      expect(store.get('connection', id)?.value.starred).toEqual([testModel, { ...testModel, ...copy }]);
    }));
});

describe('addCopy', () => {
  it("makes the copy's own 설정 from the first entry's before the entry points at it", () =>
    server.withSession(async ({ store }) => {
      const profile = await store.create('profile', { name: 'high', settings: { temperature: 1 } });
      const saved = await store.create('connection', { ...openRouter, starred: [{ ...testModel, profile: profile.ok ? profile.data.id : '' }] });
      const id = saved.ok ? saved.data.id : '';
      const copied = await addCopy(store, id, testModel, 'M (low)');
      const copy = store.get('connection', id)!.value.starred[1]!;
      expect(copied).toEqual({ ok: true, data: copy.entry });
      expect(store.get('profile', copy.profile!)?.value).toEqual({ name: 'M (low)용', settings: { temperature: 1 } });
    }));
});

describe('renameModel', () => {
  it("keeps a typed name, even the list's own, and a blank clears it so the list's name shows again", () =>
    server.withSession(async ({ store }) => {
      const saved = await store.create('connection', { ...openRouter, starred: [testModel] });
      const id = saved.ok ? saved.data.id : '';
      const label = () => store.get('connection', id)!.value.starred[0]!.label;
      await renameModel(store, id, testModel.id, testModel.name);
      expect(label()).toBe(testModel.name);
      await renameModel(store, id, testModel.id, '');
      expect(label()).toBeUndefined();
    }));
});

describe('removeModel', () => {
  it('puts a removed copy back whole, in its place, under the key every reference names', () =>
    server.withSession(async ({ store }) => {
      const copy = { ...testModel, entry: '#low', label: 'M (low)', profile: 'low' };
      const starred = [testModel, copy, { ...testModel, id: 'other' }];
      const saved = await store.create('connection', { ...openRouter, starred });
      const id = saved.ok ? saved.data.id : '';
      const removed = await removeModel(store, id, '#low');
      expect(store.get('connection', id)?.value.starred).toEqual([testModel, { ...testModel, id: 'other' }]);
      await putModelBack(store, id, removed.ok ? removed.data : { entry: copy, index: 1 });
      expect(store.get('connection', id)?.value.starred).toEqual(starred);
    }));
});

describe('refreshStarred', () => {
  it('takes what the list says of each entry of a listed model now, keeping its own fields, a price, inputs and tool support the list leaves out, and a model it no longer lists', () =>
    server.withSession(async ({ store }) => {
      const price = { input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] };
      const copy = { ...testModel, entry: '#low', label: 'M (low)', profile: 'q' };
      const saved = await store.create('connection', { ...openRouter, starred: [{ ...testModel, input: ['text', 'image'], tools: true, price, profile: 'p' }, copy, { ...testModel, id: 'gone' }] });
      const id = saved.ok ? saved.data.id : '';
      const listed = { ...testModel, name: 'M 2', protocol: 'anthropic-messages' as const, later: 'a field a later version adds' };
      await refreshStarred(store, id, [listed]);
      expect(store.get('connection', id)?.value.starred).toEqual([{ ...listed, input: ['text', 'image'], tools: true, price, profile: 'p' }, { ...listed, entry: '#low', label: 'M (low)', profile: 'q' }, { ...testModel, id: 'gone' }]);
      const rev = store.get('connection', id)!.rev;
      await refreshStarred(store, id, [{ ...listed }]);
      expect(store.get('connection', id)!.rev).toBe(rev);
    }));
});

describe('retriesOf', () => {
  it("takes the model's 설정 묶음 first, then its connection, then the shared count, else the default", () =>
    server.withSession(async ({ store }) => {
      expect(retriesOf(store, openRouter, {})).toBe(RETRIES);
      await setSharedRetries(store, 4);
      expect(retriesOf(store, openRouter, {})).toBe(4);
      expect(retriesOf(store, { ...openRouter, retries: 0 }, {})).toBe(0);
      expect(retriesOf(store, { ...openRouter, retries: 0 }, { retries: 5 })).toBe(5);
    }));
});
