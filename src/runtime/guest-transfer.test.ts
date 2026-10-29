import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { readTool } from '../engine/import/tool';
import { cachePrintId } from '../model/cache';
import { likenessId } from '../model/likeness';
import { toolId } from '../model/tool';
import { unavailableCalibration } from '../model/token-calibration';
import { ledgerId } from './usage';
import { summaryId } from './summary';
import { blankCard } from '../engine/import/card';
import { BATCH_LIMITS, type SealedChange } from '../contracts/objects';
import { SETTINGS_ID } from '../model/settings';
import { ORDER_ID } from '../model/order';
import { addDefaults, addPrompt, PREREADER_ID, STARTER_ID } from './prompts';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { KINDS, type Kind } from '../model/kinds';
import { memoryId, vectorsId } from '../model/memory';
import { testApp, sessionCookie, signupBody, testConnection, png } from './testing';
import { randomBytes } from '../vault/aead';
import { lockVault, recallGuest, recallVault, rememberVault } from '../vault/device';
import { createVault, openVault, passwordCredential, stretchPassword, recoveryCredential } from '../vault/keys';
import { objectKey, openObject } from '../vault/objects';
import { logIn, prepareGuestSignup, signUp, signUpGuest, uploadGuest } from './account';
import { writePost, writeComment, readPost, readPosts } from './board';
import { holdAccount } from './api';
import { feedQuery, serverBackend, type Backend } from './backend';
import { deviceCache } from './device-cache';
import { Files } from './files';
import { guestAccount, guestBackend, guestBoardSecret } from './guest-store';
import { discardGuest, guestWithContent, transferGuest } from './guest-transfer';
import { openSession } from './session';
import { ObjectStore } from './store';
import { exportBackup, readBackup, restoreBackup } from './testing/backup';
import type { BackupOutput } from './backup-zip';
import { importTool, readToolAsset, saveToolAsset, saveToolChat, setToolData, toolChatId, toolData, toolDataId, toolFileId, TOOL_ROW_BYTES } from './tools/store';

let app: Awaited<ReturnType<typeof testApp>>;
let password: Awaited<ReturnType<typeof passwordCredential>>;
let cookie: string | null = null;
let dropBatches = false;
const stores: ObjectStore[] = [];
beforeAll(async () => {
  app = await testApp();
  password = await passwordCredential('tester', 'a password', stretchPassword);
});
afterAll(() => app.dispose());
beforeEach(async () => {
  await app.reset();
  holdAccount(null);
  cookie = null;
  dropBatches = false;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.slice('/api/'.length);
    const response = await app.raw(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(cookie && { cookie }) } });
    if (response.headers.has('set-cookie')) cookie = sessionCookie(response);
    if (dropBatches && path === 'objects/batch') throw new TypeError('Lost upload answer');
    return response;
  });
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await discardGuest();
  await lockVault();
  vi.unstubAllGlobals();
});

async function guest() {
  const account = await guestAccount();
  const backend = guestBackend(account.accountId);
  const store = await ObjectStore.open(account.accountId, account.vaultKey, backend);
  stores.push(store);
  expect(await store.pull()).toBeNull();
  return { ...account, backend, store, files: new Files(backend, store) };
}

async function destination() {
  const accountId = crypto.randomUUID();
  const account = await createVault(accountId, password);
  expect((await signUp({ accountId, username: 'tester', ...account.signup })).ok).toBe(true);
  holdAccount(accountId);
  const backend = serverBackend();
  const store = await ObjectStore.open(accountId, account.vaultKey, backend);
  stores.push(store);
  expect(await store.pull()).toBeNull();
  return { accountId, vaultKey: account.vaultKey, backend, store, files: new Files(backend, store) };
}

async function rows(backend: Backend) {
  const rows: SealedChange[] = [];
  let since = 0;
  let until: number | null = null;
  let timeline: string | null = null;
  for (;;) {
    const page = await backend.feed(feedQuery({ since, until, timeline, bootstrap: true }));
    if (!page.ok) throw new Error(page.error);
    rows.push(...page.data.changes);
    since = page.data.cursor;
    until = page.data.until!;
    timeline = page.data.timeline;
    if (!page.data.more) return rows;
  }
}

async function contents() {
  const held = await guest();
  const character = crypto.randomUUID();
  const chat = crypto.randomUUID();
  const message = crypto.randomUUID();
  const image = randomBytes(256);
  const saved = await held.files.save([image]);
  if (!saved.ok || !saved.data[0]) throw new Error('Picture failed');
  const ref = saved.data[0];
  const written = await held.store.batch([
    { type: 'create', kind: 'character', id: character, parent: null, value: { card: blankCard('Guest bot'), folder: null, loreFolders: [], persona: FIRST_ID } },
    { type: 'create', kind: 'persona', id: FIRST_ID, parent: null, value: { name: 'Guest persona', description: 'Only here', picture: null } },
    { type: 'create', kind: 'chat', id: chat, parent: null, value: { character, title: 'A chat', models: {}, persona: FIRST_ID } },
    { type: 'create', kind: 'entry', id: message, parent: chat, value: { type: 'message', role: 'user', text: 'Hello', at: 1, receipt: null, follows: null } },
    { type: 'create', kind: 'avatar', id: crypto.randomUUID(), parent: character, value: { type: 'image/png', size: image.length, thumb: 'thumb', file: ref } },
  ], undefined, { unheld: true });
  expect(written.ok).toBe(true);
  await held.store.upsert('settings', () => ({ models: {}, persona: FIRST_ID }));
  return { ...held, character, chat, message, image, ref };
}

it('does not ask about a guest that holds only the first open’s defaults', async () => {
  const { accountId, vaultKey, backend } = await guest();
  const opened = await openSession(accountId, vaultKey, '손님', new AbortController().signal, undefined, { backend });
  if (!opened.ok) throw new Error(opened.error);
  opened.data.close();
  expect(await guestWithContent()).toEqual({ ok: true, data: null });
});

it('keeps account-bound seals and content-sealed pictures unchanged, clears the device cache, and opens a fresh account session', async () => {
  const source = await contents();
  const before = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  if (!before.ok) throw new Error(before.error);
  const row = before.data.changes.find(({ kind }) => kind === 'character')!;
  const key = await objectKey(source.vaultKey);
  expect(await openObject(key, crypto.randomUUID(), row, row.body!)).toBeUndefined();
  const cache = deviceCache(source.accountId);
  const { generation } = await cache.open();
  const adopted = await cache.adopt(generation, 'guest-era');
  await cache.write(adopted, { changes: before.data.changes, feed: { cursor: 999, complete: true, until: null, limits: BATCH_LIMITS, heads: [], revisions: [] } });
  const draft = await prepareGuestSignup('tester', password);
  const recovered = (await recoveryCredential(draft.recoveryKey))!;
  expect(await openVault(source.accountId, draft.signup, recovered)).toEqual(source.vaultKey);
  const progress: unknown[] = [];
  expect((await signUpGuest(draft, { progress: (step) => progress.push(step) })).ok).toBe(true);
  expect(progress).toContainEqual({ kind: 'objects', done: before.data.changes.length, total: before.data.changes.length });
  expect(await recallGuest()).toBeNull();
  expect(await recallVault(source.accountId)).toEqual(source.vaultKey);
  expect((await cache.open()).saved).toBeNull();
  const uploaded = await serverBackend().feed(feedQuery({ since: 0, timeline: null }));
  expect(uploaded.ok && uploaded.data.changes.map(({ id, body }) => ({ id, body }))).toEqual(before.data.changes.map(({ id, body }) => ({ id, body })));
  const opened = await openSession(source.accountId, source.vaultKey, 'tester', new AbortController().signal);
  if (!opened.ok) throw new Error(opened.error);
  try {
    expect(opened.data.store.get('character', source.character)?.value.card.name).toBe('Guest bot');
    const lease = opened.data.store.retainChat(source.chat);
    expect(await lease.ready).toBeNull();
    expect(opened.data.store.children('entry', source.chat)[0]?.value).toMatchObject({ text: 'Hello' });
    lease.release();
    expect(await opened.data.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  } finally { opened.data.close(); }
  const emptied = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  expect(emptied.ok && emptied.data.changes).toEqual([]);
  expect(await source.backend.readFile(source.ref.id)).toEqual({ ok: false, error: 'not-found' });
});

it('resumes lost batch answers through repeated signup and normal sign-in without duplicate objects or a different recovery key', async () => {
  const source = await guest();
  expect((await source.store.batch(Array.from({ length: 620 }, (_, index) => ({ type: 'create' as const, kind: 'persona' as const, id: crypto.randomUUID(), parent: null, value: { name: `Person ${index}`, description: '', picture: null } })))).ok).toBe(true);
  const draft = await prepareGuestSignup('tester', password);
  dropBatches = true;
  expect(await signUpGuest(draft)).toMatchObject({ ok: false, error: 'offline' });
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
  const again = await prepareGuestSignup('tester', password);
  expect(again.recoveryKey).toBe(draft.recoveryKey);
  expect(await signUpGuest(again)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  const signedIn = await logIn('tester', password);
  expect(signedIn.ok).toBe(true);
  if (!signedIn.ok) throw new Error(signedIn.error);
  expect(await openVault(source.accountId, signedIn.data.vault, (await recoveryCredential(again.recoveryKey))!)).toEqual(source.vaultKey);
  expect(await recallGuest()).toBeNull();
  const fresh = await ObjectStore.open(source.accountId, source.vaultKey, serverBackend());
  stores.push(fresh);
  expect(await fresh.pull()).toBeNull();
  expect(fresh.list('persona')).toHaveLength(620);
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(1);
});

it('refuses a full signup cap without changing guest content, pictures or its vault mark', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  const before = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  await app.env.db.prepare('UPDATE service SET signup_cap = 0').run();
  expect(await signUpGuest(draft)).toEqual({ ok: false, error: 'signup-closed' });
  expect(await source.backend.feed(feedQuery({ since: 0, timeline: null }))).toEqual(before);
  expect(await source.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
});

it('remaps inventory ids regardless of field names, preserving engine seeds, literal tool keys and draft source text', async () => {
  const source = await contents();
  expect((await addPrompt(source.store, 'Guest starter', 'conversation', STARTER_ID)).ok).toBe(true);
  await source.store.update('prompt', STARTER_ID, (current) => ({ ...current, authorNote: 'Guest instructions' }));
  await source.store.update('chat', source.chat, (current) => ({ ...current, prompt: STARTER_ID, futureReference: source.character }));
  await source.store.upsert('order', () => ({ ids: [source.character] }));
  const sealedPicture = await source.backend.readFile(source.ref.id);
  const module = crypto.randomUUID();
  const providerModel = testConnection.starred[0]!.id;
  const connectionAccount = crypto.randomUUID();
  const group = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const call = crypto.randomUUID();
  const toolKey = source.character;
  await source.store.batch([
    { type: 'create', kind: 'connection', id: connectionId, parent: null, value: { ...testConnection, accounts: [{ id: connectionAccount, secret: 'synthetic' }], turns: { day: 1, groups: [{ id: group, name: 'one', accounts: [connectionAccount] }], anchor: { group, cycle: 0 } }, starred: [{ ...testConnection.starred[0]!, id: providerModel, profile: FIRST_PROFILE_ID }] } },
    { type: 'create', kind: 'profile', id: FIRST_PROFILE_ID, parent: null, value: { name: 'Guest profile', settings: {} } },
    { type: 'create', kind: 'memory', id: memoryId(source.chat), parent: source.chat, value: { records: [], chapters: [], state: [], threads: [] } },
    { type: 'create', kind: 'vectors', id: vectorsId(source.chat), parent: source.chat, value: { model: providerModel, items: {} } },
    { type: 'create', kind: 'tooldraft', id: crypto.randomUUID(), parent: null, value: { identity: { name: source.character, author: source.chat, displayName: source.message, version: source.chat, description: source.character }, body: source.character, applied: source.message, module, asks: [{ ask: source.chat, note: source.character, model: { connection: connectionId, model: providerModel }, cost: null, at: 1 }], at: 2 } },
    { type: 'create', kind: 'cacheprint', id: cachePrintId(source.chat), parent: source.chat, value: { call, connection: connectionId, account: connectionAccount, model: providerModel, messages: [] } },
    { type: 'create', kind: 'likeness', id: likenessId(source.character), parent: source.character, value: { portraits: [], at: 1, receipt: null } },
    { type: 'create', kind: 'summary', id: summaryId(source.chat), parent: source.chat, value: { version: 1, head: 0, chatRev: 0, dependencies: [{ kind: 'character', id: source.character, rev: 1 }], rendered: { now: 1, timeZone: 'UTC' }, character: source.character, title: 'A chat', preview: 'Hello', count: 1, at: 1, order: 1, recent: [] } },
    { type: 'create', kind: 'ledger', id: ledgerId(call), parent: SETTINGS_ID, value: { type: 'call', at: 1, call: { id: call, connection: connectionId, model: providerModel, modelName: 'Model', source: 'Connection', usage: null, cost: null, calibration: unavailableCalibration('historical') }, chat: source.chat, character: source.character } },
    { type: 'create', kind: 'module', id: module, parent: null, value: { name: 'Tool', description: '', namespace: null, loreFolders: [], toggles: [], regex: [], triggers: [] } },
  ], undefined, { unheld: true });
  expect((await setToolData(source, module, toolKey, {
    message: source.message, nested: [{ unrecognized: STARTER_ID }, FIRST_PROFILE_ID, SETTINGS_ID],
    [source.character]: { self: await toolDataId(module, toolKey), unrelated: call },
    text: source.character, seed: source.message, replyId: source.message, fragment: `prefix ${source.character}`,
  })).ok).toBe(true);
  expect((await setToolData(source, module, 'big', 'g'.repeat(TOOL_ROW_BYTES))).ok).toBe(true);
  expect((await source.store.withChat(source.chat, () => saveToolChat(source.store, module, source.chat,
    [[toolKey, { replyId: source.message }]], [{ message: source.message, version: source.message, text: 'A badge' }],
  ))).ok).toBe(true);
  const accountId = crypto.randomUUID();
  const account = await createVault(accountId, password);
  expect((await signUp({ accountId, username: 'tester', ...account.signup })).ok).toBe(true);
  holdAccount(accountId);
  await rememberVault(accountId, account.vaultKey);
  expect((await logIn('tester', password)).ok).toBe(true);
  expect(await guestWithContent()).toEqual({ ok: true, data: { accountId: source.accountId, vaultKey: source.vaultKey } });
  const target = await ObjectStore.open(accountId, account.vaultKey, serverBackend());
  stores.push(target);
  await target.pull();
  await target.upsert('settings', () => ({ models: {}, persona: FIRST_ID, prompt: STARTER_ID, translatorNote: 'Account preference' }));
  await target.create('persona', { name: 'Account persona', description: '', picture: null }, { id: FIRST_ID });
  await target.create('profile', { name: 'Account profile', settings: {} }, { id: FIRST_PROFILE_ID });
  await addPrompt(target, 'Account starter', 'conversation', STARTER_ID);
  const accountCharacter = crypto.randomUUID();
  await target.create('character', { card: blankCard('Account bot'), folder: null, loreFolders: [] }, { id: accountCharacter });
  await target.upsert('order', () => ({ ids: [accountCharacter] }));
  const untouched = [target.get('character', accountCharacter), target.get('persona', FIRST_ID), target.get('profile', FIRST_PROFILE_ID), target.get('prompt', STARTER_ID), target.get('settings', SETTINGS_ID)];
  dropBatches = true;
  expect(await uploadGuest(accountId, account.vaultKey)).toMatchObject({ ok: false, error: 'offline' });
  expect(await recallGuest()).not.toBeNull();
  dropBatches = false;
  expect(await uploadGuest(accountId, account.vaultKey)).toEqual({ ok: true, data: null });
  await target.pull();
  expect(target.list('character').map(({ value }) => value.card.name).sort()).toEqual(['Account bot', 'Guest bot']);
  expect([target.get('character', accountCharacter), target.get('persona', FIRST_ID), target.get('profile', FIRST_PROFILE_ID), target.get('prompt', STARTER_ID), target.get('settings', SETTINGS_ID)]).toEqual(untouched);
  const character = target.list('character').find(({ value }) => value.card.name === 'Guest bot')!;
  expect(character.id).not.toBe(source.character);
  expect(target.list('persona')).toHaveLength(2);
  expect(target.list('profile')).toHaveLength(2);
  expect(target.list('prompt')).toHaveLength(2);
  const prompt = target.list('prompt').find(({ value }) => value.name === 'Guest starter')!;
  expect(prompt.id).not.toBe(STARTER_ID);
  expect(prompt.value).toMatchObject({ authorNote: 'Guest instructions' });
  const persona = target.list('persona').find(({ value }) => value.name === 'Guest persona')!;
  expect(persona.id).not.toBe(FIRST_ID);
  const connection = target.list('connection')[0]!.value;
  expect(connection.starred[0]!.id).toBe(providerModel);
  expect(connection.accounts[0]!.id).toBe(connectionAccount);
  expect(connection.turns?.groups[0]!.id).toBe(group);
  const profile = target.list('profile').find(({ value }) => value.name === 'Guest profile')!;
  expect(profile.id).not.toBe(FIRST_PROFILE_ID);
  expect(connection.starred[0]!.profile).toBe(profile.id);
  const chat = target.list('chat')[0]!;
  expect(chat.value.persona).toBe(persona.id);
  expect(chat.id).not.toBe(source.chat);
  expect(chat.value.character).toBe(character.id);
  expect(chat.value).toMatchObject({ futureReference: character.id });
  expect(chat.value.prompt).toBe(prompt.id);
  expect(chat.value.seed).toBe(source.chat);
  const lease = target.retainChat(chat.id);
  expect(await lease.ready).toBeNull();
  expect(target.get('memory', memoryId(chat.id))).not.toBeNull();
  expect(target.get('vectors', vectorsId(chat.id))?.value.model).toBe(providerModel);
  expect(target.get('likeness', likenessId(character.id))).not.toBeNull();
  const cached = target.get('cacheprint', cachePrintId(chat.id))!.value;
  expect(cached).toMatchObject({ connection: target.list('connection')[0]!.id, account: connectionAccount, model: providerModel });
  expect(cached.call).toBe(call);
  const summary = target.get('summary', summaryId(chat.id))!.value;
  expect(summary.character).toBe(character.id);
  expect(summary.dependencies).toContainEqual(expect.objectContaining({ kind: 'character', id: character.id }));
  const ledger = (await rows(serverBackend())).find(({ kind }) => kind === 'ledger')!;
  expect(ledger.id).not.toBe(ledgerId(call));
  expect(await openObject(await objectKey(account.vaultKey), accountId, ledger, ledger.body!)).toMatchObject({ chat: chat.id, character: character.id, call: { id: cached.call, connection: target.list('connection')[0]!.id } });
  const message = target.children('entry', chat.id)[0]!;
  expect(message.id).not.toBe(source.message);
  expect(message.value).toMatchObject({ text: 'Hello' });
  expect('seed' in message.value && message.value.seed).toBe(source.message);
  const badge = target.children('toolchat', chat.id).find(({ value }) => value.key === null)!;
  const importedModule = target.list('module')[0]!.id;
  expect(importedModule).not.toBe(module);
  expect(target.list('tooldraft')[0]!.value).toEqual({ identity: { name: source.character, author: source.chat, displayName: source.message, version: source.chat, description: source.character }, body: source.character, applied: source.message, module: importedModule, asks: [{ ask: source.chat, note: source.character, model: { connection: target.list('connection')[0]!.id, model: providerModel }, cost: null, at: 1 }], at: 2 });
  expect(badge.id).toBe(await toolChatId(importedModule, chat.id, null));
  expect(badge.value.value).toEqual({ [message.id]: { version: message.id, text: 'A badge' } });
  const data = target.get('tooldata', await toolDataId(importedModule, toolKey))!.value;
  expect(data.key).toBe(toolKey);
  expect(data.value).toEqual({ message: message.id, nested: [{ unrecognized: prompt.id }, profile.id, SETTINGS_ID], [character.id]: { self: await toolDataId(importedModule, toolKey), unrelated: call }, text: character.id, seed: message.id, replyId: message.id, fragment: `prefix ${source.character}` });
  expect(target.get('toolchat', await toolChatId(importedModule, chat.id, toolKey))?.value).toEqual({ module: importedModule, key: toolKey, value: { replyId: message.id } });
  expect(target.get('toolfile', await toolFileId(importedModule, 'big'))?.value.key).toBe('big');
  expect(await toolData({ store: target, files: new Files(serverBackend(), target) }, importedModule, 'big')).toEqual({ ok: true, data: 'g'.repeat(TOOL_ROW_BYTES) });
  lease.release();
  expect(await serverBackend().readFile(source.ref.id)).toEqual(sealedPicture);
  expect(target.children('avatar', character.id)[0]!.value.file).toEqual(source.ref);
  expect(await new Files(serverBackend(), target).read(source.ref)).toEqual({ ok: true, data: source.image });
  expect(await recallGuest()).toBeNull();
});

it('puts copied characters and folders first in the guest manual order without moving the account ids, retrying an order conflict', async () => {
  const source = await guest();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const folder = crypto.randomUUID();
  expect((await source.store.batch([
    { type: 'create', kind: 'character', id: first, parent: null, value: { card: blankCard('A guest'), folder: null, loreFolders: [] } },
    { type: 'create', kind: 'character', id: second, parent: null, value: { card: blankCard('Z guest'), folder: null, loreFolders: [] } },
    { type: 'create', kind: 'folder', id: folder, parent: null, value: { name: 'Guest folder' } },
  ])).ok).toBe(true);
  await source.store.upsert('order', () => ({ ids: [second, folder, first] }));
  const target = await destination();
  const accountIds: string[] = [];
  for (const name of ['Z account', 'A account']) {
    const made = await target.store.create('character', { card: blankCard(name), folder: null, loreFolders: [] });
    if (!made.ok) throw new Error(made.error);
    accountIds.push(made.data.id);
  }
  await target.store.upsert('order', () => ({ ids: accountIds }));
  const feed = vi.fn(target.backend.feed);
  let raced = false;
  const batch = vi.fn(async (...args: Parameters<Backend['batch']>) => {
    if (!raced && args[1].some(({ kind }) => kind === 'order')) {
      raced = true;
      expect((await target.store.upsert('order', () => ({ ids: accountIds }))).ok).toBe(true);
    }
    return target.backend.batch(...args);
  });
  expect(await transferGuest(target.accountId, target.vaultKey, {}, { ...target.backend, feed, batch })).toEqual({ ok: true, data: null });
  expect(await target.store.pull()).toBeNull();
  const copiedFirst = target.store.list('character').find(({ value }) => value.card.name === 'A guest')!.id;
  const copiedSecond = target.store.list('character').find(({ value }) => value.card.name === 'Z guest')!.id;
  const copiedFolder = target.store.list('folder')[0]!.id;
  expect(copiedFirst).not.toBe(first);
  expect(copiedSecond).not.toBe(second);
  expect(copiedFolder).not.toBe(folder);
  expect(target.store.get('order', ORDER_ID)?.value.ids).toEqual([copiedSecond, copiedFolder, copiedFirst, ...accountIds]);
  expect(batch.mock.calls.flatMap(([, writes]) => writes).filter(({ kind }) => kind === 'order')).toHaveLength(2);
  expect(feed.mock.calls.every(([query]) => query.metadata || query.kind === 'order')).toBe(true);
  expect(await recallGuest()).toBeNull();
});

it('keeps copied tools and their content-named pictures at the addresses computed from the new module', async () => {
  const source = await guest();
  const parsed = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@version 1\nhazelle.on("message", () => {});'));
  if (!parsed.ok) throw new Error('Tool failed');
  const imported = await importTool(source.store, source.files, parsed.tool);
  if (!imported.ok) throw new Error(imported.error);
  const picture = png();
  const saved = await saveToolAsset(source.store, source.files, imported.data.id, picture);
  if (!saved.ok) throw new Error(saved.error);
  const target = await destination();
  expect(await transferGuest(target.accountId, target.vaultKey)).toEqual({ ok: true, data: null });
  expect(await target.store.pull()).toBeNull();
  const module = target.store.list('module')[0]!.id;
  expect(module).not.toBe(imported.data.id);
  const tool = target.store.get('tool', toolId(module))!;
  expect(await target.files.read(tool.value.file)).toEqual({ ok: true, data: parsed.tool.bytes });
  expect(await readToolAsset(target.store, target.files, module, saved.data)).toEqual({ ok: true, data: picture });
  const asset = target.store.children('asset', module)[0]!;
  expect((await saveToolAsset(target.store, target.files, module, picture)).ok).toBe(true);
  expect(target.store.children('asset', module)).toEqual([asset]);
});

it('adds an account backup loaded into a guest as new objects, leaving every account revision and body untouched', async () => {
  const original = await contents();
  const draft = await prepareGuestSignup('tester', password);
  expect((await signUpGuest(draft)).ok).toBe(true);
  const backend = serverBackend();
  const target = await ObjectStore.open(original.accountId, original.vaultKey, backend);
  stores.push(target);
  expect(await target.pull()).toBeNull();
  const files = new Files(backend, target);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  expect(await exportBackup(target, files, { write: async (bytes) => { chunks.push(bytes.slice()); }, close: async () => {}, abort: async () => {} })).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  const read = await readBackup(new Blob(chunks));
  if (!read.ok) throw new Error(read.error);
  await target.update('character', original.character, (value) => ({ ...value, card: { ...value.card, name: 'Account now' } }));
  await target.update('chat', original.chat, (value) => ({ ...value, title: 'Account now' }));
  const before = await rows(backend);
  const source = await guest();
  try {
    expect(await restoreBackup(source.store, source.files, read.backup)).toEqual({ ok: true, data: { skipped: 0 } });
  } finally { await read.backup.records.close(); }
  const imported = (await rows(source.backend)).filter((row) => row.body !== null && !('id' in KINDS[row.kind as Kind]));
  expect(await transferGuest(original.accountId, original.vaultKey)).toEqual({ ok: true, data: null });
  const after = await rows(backend);
  const originals = new Set(before.map(({ id }) => id));
  expect(after.filter(({ id }) => originals.has(id))).toEqual(before);
  expect(after.filter(({ id }) => !originals.has(id))).toHaveLength(imported.length);
  expect(await target.pull()).toBeNull();
  const character = target.list('character').find(({ value }) => value.card.name === 'Guest bot')!;
  expect(character.id).not.toBe(original.character);
  const chat = target.list('chat').find(({ value }) => value.character === character.id)!;
  expect(chat.id).not.toBe(original.chat);
  const lease = target.retainChat(chat.id);
  expect(await lease.ready).toBeNull();
  const message = target.children('entry', chat.id)[0]!;
  expect(message.id).not.toBe(original.message);
  expect(message.value).toMatchObject({ text: 'Hello', seed: original.message });
  lease.release();
  expect(target.children('avatar', character.id)[0]!.value.file).toEqual(original.ref);
  expect(await files.read(original.ref)).toEqual({ ok: true, data: original.image });
});

it('reads a lost import batch answer and resumes later batches without recreating or rewriting any landed copy', async () => {
  const source = await guest();
  expect((await source.store.batch(Array.from({ length: 420 }, (_, index) => ({ type: 'create' as const, kind: 'persona' as const, id: crypto.randomUUID(), parent: null, value: { name: `Guest ${index}`, description: '', picture: null } })))).ok).toBe(true);
  const target = await destination();
  dropBatches = true;
  expect(await transferGuest(target.accountId, target.vaultKey)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  const landed = await rows(target.backend);
  expect(landed).toHaveLength(BATCH_LIMITS.items);
  const batch = vi.fn(target.backend.batch);
  const feed = vi.fn(target.backend.feed);
  expect(await transferGuest(target.accountId, target.vaultKey, {}, { ...target.backend, batch, feed })).toEqual({ ok: true, data: null });
  expect(feed.mock.calls).toHaveLength(2);
  expect(feed.mock.calls.every(([query]) => query.metadata)).toBe(true);
  const after = await rows(target.backend);
  expect(after).toHaveLength(420);
  expect(new Set(after.map(({ id }) => id)).size).toBe(420);
  expect(after.filter(({ id }) => landed.some((row) => row.id === id))).toEqual(landed);
  const sent = batch.mock.calls.flatMap(([, writes]) => writes);
  expect(sent).toHaveLength(220);
  expect(sent.every(({ id, baseRev }) => baseRev === null && !landed.some((row) => row.id === id))).toBe(true);
});

it.each(['edited', 'deleted'] as const)('finishes an interrupted import without overwriting an account-%s copy', async (change) => {
  const source = await guest();
  const made = await source.store.create('persona', { name: 'Guest', description: '', picture: null });
  if (!made.ok) throw new Error(made.error);
  const target = await destination();
  dropBatches = true;
  expect(await transferGuest(target.accountId, target.vaultKey)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  expect(await target.store.pull()).toBeNull();
  const copy = target.store.list('persona')[0]!;
  if (change === 'edited') await target.store.update('persona', copy.id, (value) => ({ ...value, name: 'Account edit' }));
  else expect((await target.store.remove(copy.id)).ok).toBe(true);
  await source.store.update('persona', made.data.id, (value) => ({ ...value, name: 'Later guest edit' }));
  const before = await rows(target.backend);
  const feed = vi.fn(target.backend.feed);
  const batch = vi.fn(target.backend.batch);
  expect(await transferGuest(target.accountId, target.vaultKey, {}, { ...target.backend, feed, batch })).toEqual({ ok: true, data: null });
  expect(feed.mock.calls.every(([query]) => query.metadata)).toBe(true);
  expect(batch).not.toHaveBeenCalled();
  expect(await rows(target.backend)).toEqual(before);
  expect(await recallGuest()).toBeNull();
  expect(await rows(source.backend)).toEqual([]);
});

it('adds the guest pre-reader alongside the account pre-reader without changing the account prompt or settings', async () => {
  const source = await guest();
  await source.store.upsert('settings', () => ({ models: {}, labs: ['preread'] }));
  await addDefaults(source.store);
  await source.store.update('prompt', PREREADER_ID, (value) => ({ ...value, name: 'Guest pre-reader' }));
  const target = await destination();
  await target.store.upsert('settings', () => ({ models: {}, labs: ['preread'] }));
  await addDefaults(target.store);
  const before = await rows(target.backend);
  expect(await transferGuest(target.accountId, target.vaultKey)).toEqual({ ok: true, data: null });
  const after = await rows(target.backend);
  expect(after.filter(({ id }) => before.some((row) => row.id === id))).toEqual(before);
  expect(await target.store.pull()).toBeNull();
  const copied = target.store.list('prompt').find(({ value }) => value.name === 'Guest pre-reader')!;
  expect(copied.id).not.toBe(PREREADER_ID);
  expect(copied.value).toMatchObject({ task: 'preread' });
  expect(target.store.list('prompt')).toHaveLength(12);
});

it('retains the guest master on a concurrent tab write or a destination rewind, and reconciles edits and deletions on retry', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  dropBatches = true;
  expect(await signUpGuest(draft)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  await source.store.update('character', source.character, (current) => ({ ...current, alias: 'Changed since the first upload' }));
  const avatar = source.store.children('avatar', source.character)[0]!;
  await source.store.remove(avatar.id);
  const backend = serverBackend();
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend,
    feed: (query, signal) => query.since > 0 ? Promise.resolve({ ok: false, error: 'cache-reset' }) : backend.feed(query, signal),
  })).toEqual({ ok: false, error: 'cache-reset' });
  expect(await recallGuest()).not.toBeNull();
  let written = false;
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend,
    batch: async (...args) => {
      const result = await backend.batch(...args);
      if (!written) {
        written = true;
        await source.files.save([randomBytes(32)]);
      }
      return result;
    },
  })).toEqual({ ok: false, error: 'conflict' });
  expect(await recallGuest()).not.toBeNull();
  expect(await transferGuest(source.accountId, source.vaultKey)).toEqual({ ok: true, data: null });
  const fresh = await ObjectStore.open(source.accountId, source.vaultKey, backend);
  stores.push(fresh);
  expect(await fresh.pull()).toBeNull();
  expect(fresh.get('character', source.character)?.value.alias).toBe('Changed since the first upload');
  expect(fresh.children('avatar', source.character)).toEqual([]);
});

it('discard clears the guest objects, pictures and key but preserves the remembered account', async () => {
  const source = await contents();
  const accountId = crypto.randomUUID();
  const key = randomBytes(32);
  await rememberVault(accountId, key);
  expect((await guestWithContent()).ok).toBe(true);
  expect(await discardGuest()).toEqual({ ok: true, data: null });
  expect(await recallGuest()).toBeNull();
  expect(await recallVault(accountId)).toEqual(key);
  expect(await source.backend.readFile(source.ref.id)).toEqual({ ok: false, error: 'not-found' });
  const all = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  expect(all.ok && all.data.changes).toEqual([]);
});

it('writes a version-3 guest backup and loads it into a fresh guest without any server request', async () => {
  const source = await contents();
  const fetched = vi.fn(() => Promise.reject(new Error('Guest backup used the server')));
  vi.stubGlobal('fetch', fetched);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const output: BackupOutput = { write: async (bytes) => { chunks.push(bytes.slice()); }, close: async () => {}, abort: async () => {} };
  expect(await exportBackup(source.store, source.files, output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  const file = new Blob(chunks);
  expect(JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await file.arrayBuffer()))['manifest.json']))).toEqual({ format: 'risu-alpha-backup', version: 3 });
  const backup = await readBackup(file);
  if (!backup.ok) throw new Error(backup.error);
  await discardGuest();
  const fresh = await guest();
  try {
    expect(await restoreBackup(fresh.store, fresh.files, backup.backup)).toEqual({ ok: true, data: { skipped: 0 } });
    expect(fresh.store.get('character', source.character)?.value.card.name).toBe('Guest bot');
    expect(await fresh.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  } finally { await backup.backup.records.close(); }
  expect(fetched).not.toHaveBeenCalled();
});

it('asks for persistence only at guest creation', async () => {
  const persist = vi.fn(async () => true);
  vi.stubGlobal('navigator', { locks: navigator.locks, storage: { persist } });
  const made = await guestAccount();
  expect(await guestAccount()).toEqual(made);
  expect(persist).toHaveBeenCalledTimes(1);
});

it('refuses cancellation before signup and picture limits before an upload, retaining the guest', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  const stopped = new AbortController();
  stopped.abort();
  expect(await signUpGuest(draft, { signal: stopped.signal })).toEqual({ ok: false, error: 'stopped' });
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(0);
  expect((await signUp({ accountId: source.accountId, username: 'tester', ...draft.signup })).ok).toBe(true);
  holdAccount(source.accountId);
  const backend = serverBackend();
  const putFile = vi.fn(backend.putFile);
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend, putFile,
    missingFiles: async (ids) => ({ ok: true, data: { missing: ids, maxBytes: 1, room: null } }),
  })).toEqual({ ok: false, error: 'too-large' });
  expect(putFile).not.toHaveBeenCalled();
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
  expect(await source.files.read(source.ref)).toEqual({ ok: true, data: source.image });
});

it('validates client ids and refuses a taken id', async () => {
  const body = signupBody();
  expect((await app.post('signup', { ...body, accountId: 'not-an-id' })).status).toBe(400);
  expect((await app.post('signup', body)).status).toBe(201);
  await app.env.db.prepare('UPDATE service SET signup_cap = 2').run();
  expect((await app.post('signup', { ...body, username: 'another' })).status).toBe(409);
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(1);
});

it('keeps the board usable after failed signup, then converts a board-only guest without uploading its secret', async () => {
  const source = await guest();
  const prepared = await prepareGuestSignup('tester', password);
  await app.env.db.prepare('UPDATE service SET signup_cap = 0').run();
  expect(await signUpGuest(prepared)).toMatchObject({ ok: false, error: 'signup-closed' });
  const written = await writePost({ title: '가입이 안 돼요', text: '본문', category: 'bug', visibility: 'operator', diagnostics: null });
  if (!written.ok) throw new Error(written.error);
  expect((await writeComment(written.data.id, '추가 내용', null)).ok).toBe(true);
  const secret = await guestBoardSecret(source.accountId);
  expect(await guestWithContent()).toEqual({ ok: true, data: { accountId: source.accountId, vaultKey: source.vaultKey } });
  await app.env.db.prepare('UPDATE service SET signup_cap = 1').run();
  source.store.close();
  expect((await signUpGuest(prepared)).ok).toBe(true);
  expect(await recallGuest()).toBeNull();
  const post = await readPost(written.data.id);
  expect(post).toMatchObject({ ok: true, data: { post: { author: { mine: true }, comments: [{ byAuthor: true, author: { mine: true } }] } } });
  if (!post.ok) throw new Error(post.error);
  expect(post.data.post.author.guest).toBeUndefined();
  expect(post.data.post.comments[0]!.author.guest).toBeUndefined();
  expect(JSON.stringify(await rows(serverBackend()))).not.toContain(secret.ok ? secret.data! : '');
  expect(await guestBoardSecret(source.accountId)).toEqual({ ok: true, data: null });
});

it('moves a board-only guest to an existing account when 올리기 is chosen and keeps its posts in 내 글', async () => {
  const target = await destination();
  const signedInCookie = cookie;
  holdAccount(null);
  cookie = null;
  const source = await guest();
  const written = await writePost({ title: '손님 제안', text: '본문', category: 'idea', visibility: 'public', diagnostics: null });
  if (!written.ok) throw new Error(written.error);
  expect((await writeComment(written.data.id, '보충', null)).ok).toBe(true);
  expect(await guestWithContent()).toMatchObject({ ok: true, data: { accountId: source.accountId } });
  cookie = signedInCookie;
  expect((await logIn('tester', password)).ok).toBe(true);
  source.store.close();
  expect(await uploadGuest(target.accountId, target.vaultKey)).toEqual({ ok: true, data: null });
  expect(await readPosts(null, { sort: 'new', mine: true })).toMatchObject({ ok: true, data: { rows: [{ id: written.data.id, author: { mine: true } }] } });
  const post = await readPost(written.data.id);
  expect(post).toMatchObject({ ok: true, data: { post: { comments: [{ author: { mine: true } }] } } });
  expect(await recallGuest()).toBeNull();
});
