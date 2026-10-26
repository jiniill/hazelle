import { expect, it, vi } from 'vitest';
import { withAttachments } from '../engine/assets';
import { toBase64 } from '../vault/aead';
import { setDefaultModel } from './assignment';
import { startChat } from './chat-log';
import { addDraftFile, keepAttachments } from './attachments';
import { exportRisuChat } from './risu-export';
import { png, saying, stubRelay, testConnection, testModel, testServer } from './testing';
import { takeTurn } from './turn';

// The browser draws pictures; here one passes as it is, as one already within what a model is sent does.
vi.mock('./picture', () => ({ sentPicture: async (picture: unknown) => picture }));

const server = testServer();

it("sends a new chat's first message with its attached picture, its row written before the turn, to a model that reads pictures", () =>
  server.withSession(async (session) => {
    const { store, files } = session;
    const connection = await store.create('connection', { ...testConnection, starred: [{ ...testModel, input: ['text', 'image'] }] });
    if (!connection.ok) throw new Error(connection.error);
    await setDefaultModel(store, 'main', { connection: connection.data.id, model: testModel.id });
    const log = stubRelay(() => saying('보여.'));
    const bytes = png();
    const saved = await files.save([bytes]);
    if (!saved.ok) throw new Error(saved.error);
    const picture = { name: crypto.randomUUID(), type: 'image/png', size: bytes.length, file: saved.data[0]!, attached: true as const };
    const chat = crypto.randomUUID();
    const start = { greeting: null, saved: startChat(store, chat, { title: null, character: null, models: {} }, null) };
    expect(await start.saved).toBeNull();
    expect(await keepAttachments(store, chat, [picture], [])).toEqual({ ok: true, data: null });
    expect(await takeTurn(session, chat, { kind: 'send', text: withAttachments({ pictures: [picture.name], files: [] }, '이거 봐') }, start)).toBeNull();
    const last = (JSON.parse(log.at(-1)!.sent.body!) as { messages: { content: unknown }[] }).messages.at(-1)!;
    expect(last.content).toEqual([{ type: 'image_url', image_url: { url: `data:image/png;base64,${toBase64(bytes)}` } }, { type: 'text', text: '이거 봐' }]);
  }));

it("sends a text file ahead of its message's text, named, refuses a binary one, and exports it to Risu as Risu's file tag", () =>
  server.withSession(async (session) => {
    const { store, drafts } = session;
    const connection = await store.create('connection', { ...testConnection, starred: [testModel] });
    if (!connection.ok) throw new Error(connection.error);
    await setDefaultModel(store, 'main', { connection: connection.data.id, model: testModel.id });
    const log = stubRelay(() => saying('읽었어.'));
    expect(await addDraftFile(session, 'k', new File([new Uint8Array([104, 0, 105])], 'a.bin'))).toBe('not-text');
    expect(await addDraftFile(session, 'k', new File(['const a = 1;'], 'a.ts'))).toBe('added');
    const [draft] = drafts.take('k').attachments;
    if (draft?.kind !== 'file') throw new Error('no file');
    const chat = crypto.randomUUID();
    const start = { greeting: null, saved: startChat(store, chat, { title: null, character: null, models: {} }, null) };
    expect(await start.saved).toBeNull();
    expect(await keepAttachments(store, chat, [], [draft.value])).toEqual({ ok: true, data: null });
    expect(await takeTurn(session, chat, { kind: 'send', text: withAttachments({ pictures: [], files: [draft.value.name] }, '이거 봐') }, start)).toBeNull();
    const last = (JSON.parse(log.at(-1)!.sent.body!) as { messages: { content: unknown }[] }).messages.at(-1)!;
    expect(last.content).toBe('<file name="a.ts">\nconst a = 1;\n</file>\n\n이거 봐');
    const exported = await exportRisuChat(session, chat);
    expect(exported.ok && exported.data.text).toContain(`{{file::a.ts::${toBase64(new TextEncoder().encode('const a = 1;'))}}}이거 봐`);
  }));
