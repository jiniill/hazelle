import { describe, expect, it, vi } from 'vitest';
import { readTool } from '../../engine/import/tool';
import { toolId } from '../../model/tool';
import { setModuleDeleted } from '../modules';
import { purgeNow } from '../removal';
import { exportBackup, readBackup, restoreBackup } from '../testing/backup';
import { testServer } from '../testing';
import { deleteToolData, exportTool, importTool, readToolAsset, saveToolAsset, saveToolChat, setToolData, setToolSettings, toolBadges, toolChatData, toolChatKeys, toolData, toolDataId, toolKeys, TOOL_CHAT_BYTES, TOOL_DATA_BYTES, TOOL_KEY_CHARS, TOOL_ROW_BYTES, TOOL_VALUE_BYTES, ToolStorage, undoToolImport } from './store';
import { CLAIM_SETTLE_MS } from '../../contracts/files';
import type { Files } from '../files';

const server = testServer();
// The sweep a removal for good starts is runtime/files' to test.
const unswept = { sweep: async () => {} } as unknown as Files;
const source = (version = '1.0', uses = '') => {
  const result = readTool(new TextEncoder().encode(`//@api 1\n//@name notes\n//@author jin\n//@version ${version}\n${uses}//@setting {"key":"title","type":"text","label":"제목","default":"메모"}\nhazelle.on('message', () => {});`));
  if (!result.ok) throw new Error('fixture');
  return result.tool;
};

describe('tool storage', () => {
  it('updates the identity in place, retaining data and settings and resetting only expanded consent', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    expect((await setToolSettings({ store }, module, { title: 'mine' })).ok).toBe(true);
    await setToolData({ store, files }, module, 'note', { text: 'hello' });
    await store.update('module', module, (current) => ({ ...current, botModels: true }));
    const updated = await importTool(store, files, source('1.1', '//@uses model\n'));
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.data.id).toBe(module);
    expect(store.list('module')).toHaveLength(1);
    expect(store.get('module', module)!.value.botModels).toBeUndefined();
    expect(store.get('tool', toolId(module))!.value.settings).toEqual({ title: 'mine' });
    expect(await toolData({ store, files }, module, 'note')).toEqual({ ok: true, data: { text: 'hello' } });
    await store.update('module', module, (current) => ({ ...current, botModels: false }));
    await importTool(store, files, source('1.2', '//@uses model\n'));
    expect(store.get('module', module)!.value.botModels).toBe(false);
    await store.update('module', module, (current) => ({ ...current, botModels: true, takesMemory: false }));
    await importTool(store, files, source('1.3', '//@uses model\n//@uses memory\n'));
    expect(store.get('module', module)!.value).toMatchObject({ botModels: true });
    expect(store.get('module', module)!.value.takesMemory).toBeUndefined();
    await store.update('module', module, (current) => ({ ...current, takesMemory: true }));
    await importTool(store, files, source('1.4', '//@uses model\n//@uses memory\n//@uses embed\n'));
    expect(store.get('module', module)!.value.botModels).toBeUndefined();
    expect(store.get('module', module)!.value.takesMemory).toBe(true);
    await store.update('module', module, (current) => ({ ...current, botModels: true, network: false }));
    await importTool(store, files, source('1.5', '//@uses model\n//@uses memory\n//@uses embed\n//@uses network\n'));
    expect(store.get('module', module)!.value).toMatchObject({ botModels: true, takesMemory: true });
    expect(store.get('module', module)!.value.network).toBeUndefined();
    await undoToolImport(store, module, updated.data.previous!);
    expect(store.get('tool', toolId(module))!.value.manifest.version).toBe('1.0');
    expect(await files.read(store.get('tool', toolId(module))!.value.file)).toEqual({ ok: true, data: source().bytes });
    expect(store.get('tool', toolId(module))!.value.settings.title).toBe('mine');
    const next = source('3');
    next.manifest.settings = [{ key: 'new', type: 'switch', label: 'New', default: true }];
    const replaced = await importTool(store, files, next);
    if (!replaced.ok) throw new Error(replaced.error);
    expect(store.get('tool', toolId(module))!.value.settings).toEqual({ title: 'mine', new: true });
    await undoToolImport(store, module, replaced.data.previous!);
    expect(store.get('tool', toolId(module))!.value.settings.title).toBe('mine');
  });

  it('exports the file as imported, without its settings, and reads back as the same plugin', async () => {
    const { store, files } = await server.account();
    const tool = source();
    const added = await importTool(store, files, tool);
    if (!added.ok) throw new Error(added.error);
    await setToolSettings({ store }, added.data.id, { title: 'mine' });
    const chunks: Uint8Array[] = [];
    const output = { write: async (chunk: Uint8Array<ArrayBuffer>) => void chunks.push(chunk), close: async () => {}, abort: async () => {} };
    expect((await exportTool(store, files, added.data.id, output)).ok).toBe(true);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(tool.bytes));
    expect(readTool(Buffer.concat(chunks) as Uint8Array<ArrayBuffer>)).toMatchObject({ ok: true, tool: { manifest: tool.manifest } });
  });

  it('does not revive a binned identity and purges both child kinds', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    await setToolData({ store, files }, module, 'note', 'kept');
    await setToolData({ store, files }, module, 'big', 'x'.repeat(TOOL_ROW_BYTES));
    await setModuleDeleted(store, module, Date.now());
    expect(await importTool(store, files, source('2'))).toEqual({ ok: false, error: 'gone' });
    expect(store.list('module')).toHaveLength(1);
    expect((await purgeNow(store, unswept, 'module', module, () => {})).ok).toBe(true);
    expect(store.list('tool')).toEqual([]);
    expect(store.list('tooldata')).toEqual([]);
    expect(store.list('toolfile')).toEqual([]);
  });

  it('addresses keys deterministically, updates and deletes, and enforces value and total limits', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    expect(toolId('01234567-89ab-4def-8123-456789abcdef')).toBe('fedcba98-89ab-4def-8123-456789abcdef');
    expect(await toolDataId(module, 'a')).toBe(await toolDataId(module, 'a'));
    expect(await toolDataId(module, 'a')).not.toBe(await toolDataId(module, 'b'));
    const session = { store, files };
    expect((await setToolData(session, module, 'a', 1)).ok).toBe(true);
    expect((await setToolData(session, module, 'a', 2)).ok).toBe(true);
    expect(await toolData(session, module, 'a')).toEqual({ ok: true, data: 2 });
    expect(toolKeys(store, module)).toEqual(['a']);
    await deleteToolData(store, module, 'a');
    expect(await toolData(session, module, 'a')).toEqual({ ok: true, data: undefined });
    expect((await setToolData(session, module, 'a', '가'.repeat(TOOL_VALUE_BYTES / 3))).ok).toBe(false);
    expect(await setToolData(session, module, 'k'.repeat(TOOL_KEY_CHARS + 1), 1)).toEqual({ ok: false, error: 'key-too-long' });
    expect(await setToolData(session, module, '가'.repeat(TOOL_KEY_CHARS), 'x'.repeat(TOOL_VALUE_BYTES - 2))).toEqual({ ok: false, error: 'too-large' });
    // Past one row's bytes a value moves to a file, and back into its row once it fits again.
    const big = 'x'.repeat(TOOL_ROW_BYTES);
    expect((await setToolData(session, module, 'big', big)).ok).toBe(true);
    expect(store.list('tooldata')).toEqual([]);
    expect(await toolData(session, module, 'big')).toEqual({ ok: true, data: big });
    expect(toolKeys(store, module)).toEqual(['big']);
    expect((await setToolData(session, module, 'big', 'small')).ok).toBe(true);
    expect(store.list('toolfile')).toEqual([]);
    expect(await toolData(session, module, 'big')).toEqual({ ok: true, data: 'small' });
    await deleteToolData(store, module, 'big');
    const value = 'x'.repeat(TOOL_VALUE_BYTES - 3);
    for (let i = 0; i < TOOL_DATA_BYTES / TOOL_VALUE_BYTES; i++) expect((await setToolData(session, module, String(i), value)).ok).toBe(true);
    expect(await setToolData(session, module, 'extra', 1)).toEqual({ ok: false, error: 'too-large' });
    expect((await setToolData(session, module, '0', 1)).ok).toBe(true);
    expect((await setToolData(session, module, 'extra', 1)).ok).toBe(true);
  });

  it('keeps a picture as one asset of its module by its hash, again after the user deletes it, and reads it for that module only', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    const picture = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
    const save = vi.spyOn(files, 'save');
    const saved = await saveToolAsset(store, files, module, picture);
    if (!saved.ok) throw new Error(saved.error);
    expect(await saveToolAsset(store, files, module, picture.slice())).toEqual(saved);
    expect(save).toHaveBeenCalledOnce();
    const [asset] = store.children('asset', module);
    expect(asset!.value).toMatchObject({ name: saved.data, type: 'image/png', size: picture.length });
    expect(await readToolAsset(store, files, module, saved.data)).toEqual({ ok: true, data: picture });
    expect(await readToolAsset(store, files, crypto.randomUUID(), saved.data)).toEqual({ ok: true, data: null });
    expect(await saveToolAsset(store, files, module, new TextEncoder().encode('not a picture'))).toEqual({ ok: false, error: 'unsupported-file' });
    await store.remove(asset!.id);
    expect(await readToolAsset(store, files, module, saved.data)).toEqual({ ok: true, data: null });
    expect(await saveToolAsset(store, files, module, picture)).toEqual(saved);
    expect(store.children('asset', module).map(({ id }) => id)).toEqual([asset!.id]);
    await setModuleDeleted(store, module, Date.now());
    expect((await purgeNow(store, unswept, 'module', module, () => {})).ok).toBe(true);
    expect(store.list('asset')).toEqual([]);
  });

  it('keeps per-chat data and badges in one batch per event, within the per-chat limit, and purges them in a chat never opened', async () => {
    const { store, files, open } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    const chat = crypto.randomUUID();
    await store.create('chat', { title: null, character: null, models: {} }, { id: chat });
    const lease = store.retainChat(chat, { created: true });
    await lease.ready;
    const batch = vi.spyOn(store, 'batch');
    expect((await saveToolChat(store, module, chat, [['a', 1], ['b', [2]]], [{ message: 'm1', version: 'v1', text: '요약됨' }])).ok).toBe(true);
    expect(batch).toHaveBeenCalledOnce();
    expect(toolChatData(store, module, chat, 'b')).toEqual([2]);
    expect(toolChatKeys(store, module, chat).sort()).toEqual(['a', 'b']);
    expect(toolBadges(store, module, chat)).toEqual({ m1: { version: 'v1', text: '요약됨' } });
    expect((await saveToolChat(store, module, chat, [['a', undefined]], [{ message: 'm1', version: 'v1', text: null }])).ok).toBe(true);
    expect(toolChatKeys(store, module, chat)).toEqual(['b']);
    expect(toolBadges(store, module, chat)).toEqual({});
    const value = 'x'.repeat(TOOL_ROW_BYTES - 3);
    const full = Array.from({ length: TOOL_CHAT_BYTES / TOOL_ROW_BYTES }, (_, i): [string, string] => [String(i), value]);
    expect(await saveToolChat(store, module, chat, [['one', 'x'.repeat(TOOL_ROW_BYTES)]], [])).toEqual({ ok: false, error: 'too-large' });
    expect(await saveToolChat(store, module, chat, full, [])).toEqual({ ok: false, error: 'too-large' });
    expect(await saveToolChat(store, module, chat, [['k'.repeat(TOOL_KEY_CHARS + 1), 1]], [])).toEqual({ ok: false, error: 'key-too-long' });
    lease.release();

    const fresh = await open();
    expect(fresh.scopeState(chat)).toBe('unloaded');
    await setModuleDeleted(fresh, module, Date.now());
    expect((await purgeNow(fresh, unswept, 'module', module, () => {})).ok).toBe(true);
    const reopened = fresh.retainChat(chat);
    await reopened.ready;
    expect(fresh.children('toolchat', chat)).toEqual([]);
    reopened.release();
  });

  it('sweeps once a claim has passed after a write replaces a value kept as a file, and the sweep releases the old file', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    const storage = new ToolStorage({ store, files });
    const sweep = vi.spyOn(files, 'sweep').mockResolvedValue();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const big = storage.write(module, 'big', 'x'.repeat(TOOL_ROW_BYTES));
      await vi.advanceTimersByTimeAsync(1001);
      await big;
      const old = store.list('toolfile')[0]!.value.file;
      const small = storage.write(module, 'big', 'small');
      await vi.advanceTimersByTimeAsync(1001);
      await small;
      await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
      expect(sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sweep).toHaveBeenCalledOnce();
      sweep.mockRestore();
      vi.useRealTimers();
      const later = Date.now() + 2 * CLAIM_SETTLE_MS;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => later);
      try {
        expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
        expect(await files.read(old)).toEqual({ ok: false, error: 'not-found' });
      } finally { clock.mockRestore(); }
    } finally { vi.useRealTimers(); storage.close(); }
  });

  it('round trips tool code, settings, data and per-chat data through an account backup', async () => {
    const old = await server.account();
    const imported = source();
    const added = await importTool(old.store, old.files, imported);
    if (!added.ok) throw new Error(added.error);
    await setToolData(old, added.data.id, 'note', 'backup note');
    await setToolData(old, added.data.id, 'big', 'b'.repeat(TOOL_ROW_BYTES));
    const chat = crypto.randomUUID();
    await old.store.create('chat', { title: null, character: null, models: {} }, { id: chat });
    const lease = old.store.retainChat(chat, { created: true });
    await lease.ready;
    await saveToolChat(old.store, added.data.id, chat, [['index', 'chat note']], []);
    lease.release();
    const parts: BlobPart[] = [];
    expect((await exportBackup(old.store, old.files, { write: async (bytes) => { parts.push(bytes); }, close: async () => {}, abort: async () => {} })).ok).toBe(true);
    const read = await readBackup(new Blob(parts));
    if (!read.ok) throw new Error(read.error);
    await server.wipe();
    const restored = await server.account();
    expect(await restoreBackup(restored.store, restored.files, read.backup)).toEqual({ ok: true, data: { skipped: 0 } });
    const tool = restored.store.get('tool', toolId(added.data.id))!.value;
    expect(tool.manifest).toEqual(imported.manifest);
    expect(tool.settings).toEqual({ title: '메모' });
    expect(await restored.files.read(tool.file)).toEqual({ ok: true, data: imported.bytes });
    expect(await toolData(restored, added.data.id, 'note')).toEqual({ ok: true, data: 'backup note' });
    expect(await toolData(restored, added.data.id, 'big')).toEqual({ ok: true, data: 'b'.repeat(TOOL_ROW_BYTES) });
    const reopened = restored.store.retainChat(chat);
    await reopened.ready;
    expect(toolChatData(restored.store, added.data.id, chat, 'index')).toBe('chat note');
    reopened.release();
  });
});
