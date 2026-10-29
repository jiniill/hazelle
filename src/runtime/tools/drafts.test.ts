import { expect, it, vi } from 'vitest';
import { identity, readTool, toolSource } from '../../engine/import/tool';
import { toolId } from '../../model/tool';
import { setModuleDeleted } from '../modules';
import { testServer } from '../testing';
import { addDraftAsk, applyDraft, applyPreview, blankDraft, createDraft, deleteDraft, DRAFT_BYTES, draftOfTool, draftsOf, draftState, saveDraft } from './drafts';
import { importTool } from './store';

const server = testServer();
const file = blankDraft('jin');
const text = toolSource(file.identity, file.body);
const ask = { ask: '바꿔 줘', note: '바꿨어요.', model: { connection: 'c', model: 'm' }, cost: null, at: 1 };

it('refuses an oversized UTF-8 file on every draft write without losing its previous body or history', async () => {
  const { store } = await server.account();
  const id = crypto.randomUUID();
  const large = '가'.repeat(Math.ceil(DRAFT_BYTES / 3));
  const fits = 'a'.repeat(DRAFT_BYTES - new TextEncoder().encode(toolSource(file.identity, '')).byteLength);
  const refused = { ok: false, error: 'draft-too-large' };
  expect(await createDraft(store, id, { ...file, body: large })).toEqual(refused);
  expect(store.list('tooldraft')).toEqual([]);
  expect(await createDraft(store, id, { ...file, body: fits })).toEqual({ ok: true, data: null });
  expect(await saveDraft(store, id, { body: large })).toEqual(refused);
  expect(await addDraftAsk(store, id, ask, large)).toEqual(refused);
  expect(store.get('tooldraft', id)!.value).toMatchObject({ body: fits, asks: [] });
});

it('derives all three states from the draft alone, its identity included', () => {
  const draft = { ...file, module: null, applied: null, asks: [], at: 0 };
  expect(draftState(draft)).toBe('unapplied');
  expect(draftState({ ...draft, applied: text })).toBe('applied');
  expect(draftState({ ...draft, applied: text, identity: { ...file.identity, displayName: '새 이름' } })).toBe('differs');
});

it('keeps the latest 30 asks, optionally replaces the body and sorts by edit time rather than revision', async () => {
  const { store } = await server.account();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await createDraft(store, first, file);
  await createDraft(store, second, file);
  await store.update('tooldraft', first, (draft) => ({ ...draft, at: 300, asks: Array.from({ length: 30 }, (_, at) => ({ ...ask, at })) }));
  await store.update('tooldraft', second, (draft) => ({ ...draft, at: 100 }));
  expect(draftsOf(store).map(({ id }) => id)).toEqual([first, second]);
  const now = vi.spyOn(Date, 'now').mockReturnValue(500);
  await saveDraft(store, first, { body: 'changed' });
  await addDraftAsk(store, first, { ...ask, at: 30 }, null);
  expect(store.get('tooldraft', first)!.value).toMatchObject({ body: 'changed', at: 500 });
  expect(store.get('tooldraft', first)!.value.asks.map(({ at }) => at)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  await addDraftAsk(store, first, ask, file.body);
  expect(store.get('tooldraft', first)!.value.body).toBe(file.body);
  now.mockRestore();
  expect((await deleteDraft(store, second)).ok).toBe(true);
  expect(store.get('tooldraft', second)).toBeNull();
});

it('applies through the importer, raising an unchanged version once per change, and records the exact applied file', async () => {
  const { store, files } = await server.account();
  const id = crypto.randomUUID();
  await createDraft(store, id, file);
  const current = () => store.get('tooldraft', id)!.value;
  expect(applyPreview(store, current())).toMatchObject({ ok: true, previous: null, added: [] });
  const installed = await applyDraft(store, files, id);
  if (!installed.ok) throw new Error(installed.error);
  const module = installed.data.id;
  expect(current()).toMatchObject({ module, applied: text });
  expect(await files.read(store.get('tool', toolId(module))!.value.file)).toEqual({ ok: true, data: new TextEncoder().encode(text) });
  await store.update('module', module, (value) => ({ ...value, botModels: true }));
  await saveDraft(store, id, { body: `//@uses model\n\n${file.body}` });
  expect(applyPreview(store, current())).toMatchObject({ ok: true, manifest: { version: '0.1.1' }, previous: { module, manifest: { version: '0.1.0' } }, added: ['model'] });
  const updated = await applyDraft(store, files, id);
  expect(updated).toMatchObject({ ok: true, data: { id: module, previous: { manifest: { version: '0.1.0' } } } });
  expect(store.get('module', module)!.value.botModels).toBeUndefined();
  expect(current()).toMatchObject({ identity: { version: '0.1.1' }, applied: toolSource({ ...file.identity, version: '0.1.1' }, `//@uses model\n\n${file.body}`) });
  expect(draftState(current())).toBe('applied');
  expect(applyPreview(store, current())).toMatchObject({ ok: true, manifest: { version: '0.1.1' } });
  await saveDraft(store, id, { identity: { ...current().identity, version: '2.0.0' }, body: file.body });
  expect(applyPreview(store, current())).toMatchObject({ ok: true, manifest: { version: '2.0.0' } });
  await saveDraft(store, id, { identity: { ...current().identity, name: 'renamed' } });
  expect(applyPreview(store, current())).toMatchObject({ ok: true, previous: null });
  const added = await applyDraft(store, files, id);
  expect(added.ok && added.data.id).not.toBe(module);
  expect(store.list('module')).toHaveLength(2);
  await setModuleDeleted(store, module, Date.now());
  await saveDraft(store, id, { identity: { ...current().identity, name: file.identity.name } });
  expect(await applyDraft(store, files, id)).toEqual({ ok: false, error: 'gone' });
});

it('opens the installed file once as identity and body, reuses its edited draft and refuses Risu or oversized plugins', async () => {
  const { store, files } = await server.account();
  const read = readTool(new TextEncoder().encode(text));
  if (!read.ok) throw new Error('fixture');
  const installed = await importTool(store, files, read.tool);
  if (!installed.ok) throw new Error(installed.error);
  const module = installed.data.id;
  const opened = await draftOfTool(store, files, module);
  if (!opened.ok) throw new Error(opened.error);
  const draft = store.get('tooldraft', opened.data)!.value;
  expect(draft).toMatchObject({ identity: file.identity, body: file.body, applied: text, module });
  await saveDraft(store, opened.data, { body: 'unfinished' });
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
  const blank = blankDraft(author);
  expect(readTool(new TextEncoder().encode(toolSource(blank.identity, blank.body)))).toMatchObject({ ok: true, tool: { manifest: { api: 1, author, version: '0.1.0' } } });
});
