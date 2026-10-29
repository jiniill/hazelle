import { expect, it, vi } from 'vitest';
import { identity, readTool } from '../../engine/import/tool';
import { toolId } from '../../model/tool';
import { setModuleDeleted } from '../modules';
import { testServer } from '../testing';
import { addDraftAsk, applyDraft, applyPreview, blankPlugin, createDraft, deleteDraft, DRAFT_BYTES, draftOfTool, draftsOf, draftState, saveDraftText } from './drafts';
import { importTool } from './store';

const server = testServer();
const text = blankPlugin('jin');
const ask = { ask: '바꿔 줘', note: '바꿨어요.', model: { connection: 'c', model: 'm' }, cost: null, at: 1 };

it('refuses oversized UTF-8 text on every draft write without losing its previous text or history', async () => {
  const { store } = await server.account();
  const id = crypto.randomUUID();
  const large = '가'.repeat(Math.ceil(DRAFT_BYTES / 3));
  const refused = { ok: false, error: 'draft-too-large' };
  expect(await createDraft(store, large, id)).toEqual(refused);
  expect(store.list('tooldraft')).toEqual([]);
  expect(await createDraft(store, 'a'.repeat(DRAFT_BYTES), id)).toEqual({ ok: true, data: null });
  expect(await saveDraftText(store, id, large)).toEqual(refused);
  expect(await addDraftAsk(store, id, ask, large)).toEqual(refused);
  expect(store.get('tooldraft', id)!.value).toMatchObject({ text: 'a'.repeat(DRAFT_BYTES), asks: [] });
});

it('derives all three states from the draft alone', () => {
  const draft = { text, module: null, applied: null, asks: [], at: 0 };
  expect(draftState(draft)).toBe('unapplied');
  expect(draftState({ ...draft, applied: text })).toBe('applied');
  expect(draftState({ ...draft, applied: 'old' })).toBe('differs');
});

it('keeps the latest 30 asks, optionally replaces text and sorts by edit time rather than revision', async () => {
  const { store } = await server.account();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await createDraft(store, text, first);
  await createDraft(store, text, second);
  await store.update('tooldraft', first, (draft) => ({ ...draft, at: 300, asks: Array.from({ length: 30 }, (_, at) => ({ ...ask, at })) }));
  await store.update('tooldraft', second, (draft) => ({ ...draft, at: 100 }));
  expect(draftsOf(store).map(({ id }) => id)).toEqual([first, second]);
  const now = vi.spyOn(Date, 'now').mockReturnValue(500);
  await saveDraftText(store, first, 'changed');
  await addDraftAsk(store, first, { ...ask, at: 30 }, null);
  expect(store.get('tooldraft', first)!.value).toMatchObject({ text: 'changed', at: 500 });
  expect(store.get('tooldraft', first)!.value.asks.map(({ at }) => at)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  await addDraftAsk(store, first, ask, text);
  expect(store.get('tooldraft', first)!.value.text).toBe(text);
  now.mockRestore();
  expect((await deleteDraft(store, second)).ok).toBe(true);
  expect(store.get('tooldraft', second)).toBeNull();
});

it('applies through the importer, preserving identity, undo data and consent, and records the exact applied version', async () => {
  const { store, files } = await server.account();
  const id = crypto.randomUUID();
  await createDraft(store, text, id);
  expect(applyPreview(store, text)).toMatchObject({ ok: true, previous: null, added: [] });
  const installed = await applyDraft(store, files, id);
  if (!installed.ok) throw new Error(installed.error);
  const module = installed.data.id;
  expect(store.get('tooldraft', id)!.value).toMatchObject({ module, applied: text });
  expect(await files.read(store.get('tool', toolId(module))!.value.file)).toEqual({ ok: true, data: new TextEncoder().encode(text) });
  await store.update('module', module, (value) => ({ ...value, botModels: true }));
  const changed = text.replace('//@version 0.1.0', '//@version 0.2.0\n//@uses model');
  await saveDraftText(store, id, changed);
  expect(applyPreview(store, changed)).toMatchObject({ ok: true, previous: { module, manifest: { version: '0.1.0' } }, added: ['model'] });
  const updated = await applyDraft(store, files, id);
  expect(updated).toMatchObject({ ok: true, data: { id: module, previous: { manifest: { version: '0.1.0' } } } });
  expect(store.get('module', module)!.value.botModels).toBeUndefined();
  expect(store.get('tooldraft', id)!.value).toMatchObject({ module, applied: changed });
  const renamed = changed.replace('//@name my-plugin', '//@name renamed');
  await saveDraftText(store, id, renamed);
  expect(applyPreview(store, renamed)).toMatchObject({ ok: true, previous: null });
  const added = await applyDraft(store, files, id);
  expect(added.ok && added.data.id).not.toBe(module);
  expect(store.list('module')).toHaveLength(2);
  await setModuleDeleted(store, module, Date.now());
  await saveDraftText(store, id, changed);
  expect(await applyDraft(store, files, id)).toEqual({ ok: false, error: 'gone' });
});

it('opens the installed file once, reuses its edited draft and refuses Risu or oversized plugins', async () => {
  const { store, files } = await server.account();
  const read = readTool(new TextEncoder().encode(text));
  if (!read.ok) throw new Error('fixture');
  const installed = await importTool(store, files, read.tool);
  if (!installed.ok) throw new Error(installed.error);
  const module = installed.data.id;
  const opened = await draftOfTool(store, files, module);
  if (!opened.ok) throw new Error(opened.error);
  expect(store.get('tooldraft', opened.data)!.value).toMatchObject({ text, applied: text, module });
  await saveDraftText(store, opened.data, 'unfinished');
  const reading = vi.spyOn(files, 'read');
  expect(await draftOfTool(store, files, module)).toEqual(opened);
  expect(reading).not.toHaveBeenCalled();
  await deleteDraft(store, opened.data);
  await store.update('tool', toolId(module), (tool) => ({ ...tool, size: DRAFT_BYTES + 1 }));
  expect(await draftOfTool(store, files, module)).toEqual({ ok: false, error: 'draft-too-large' });
  await store.update('tool', toolId(module), (tool) => ({ ...tool, manifest: { ...tool.manifest, risu: { verdict: 'all', missing: [], hosts: [] } } }));
  expect(await draftOfTool(store, files, module)).toEqual({ ok: false, error: 'risu-plugin' });
});

it('starts with a readable native plugin and accepts every allowed username character without a fallback author', () => {
  const author = '진_Jin.9-';
  expect(identity(author)).toBe(true);
  expect(readTool(new TextEncoder().encode(blankPlugin(author)))).toMatchObject({ ok: true, tool: { manifest: { api: 1, author, version: '0.1.0' } } });
});
