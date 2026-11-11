import { expect, it } from 'vitest';
import { setAccountTaskModel, setDefaultModel, setPromptModel } from '../models/assignment';
import { overviewOf } from './overview';
import { addPrompt, setDefaultPrompt } from '../library/prompts';
import { answerable, testServer } from '../testing';

const server = testServer();

it('says where each role was picked, which task follows 보조 모델 and which prompts pin a 대화 모델 of their own', () =>
  server.withSession(async (session) => {
    const { store } = session;
    await answerable(session);
    const [connection] = store.list('connection');
    await store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, ...['aux', 'pin'].map((id) => ({ ...current.starred[0]!, id, name: id }))] }));
    const ref = (model: string) => ({ connection: connection!.id, model });
    const [byDefault, pinning] = await Promise.all([addPrompt(store, '기본', 'conversation'), addPrompt(store, '고정', 'conversation')]);
    await setDefaultPrompt(store, byDefault.ok ? byDefault.data.id : '');
    await setPromptModel(store, pinning.ok ? pinning.data.id : '', 'main', ref('pin'));
    const read = () => overviewOf(store, null);

    expect(read().roles.aux).toMatchObject({ runs: { model: { id: 'm' } }, from: { layer: 'settings', role: 'main' } });
    expect(read().roles.embed).toEqual({ runs: { kind: 'no-model' }, from: null });
    expect(read().talk.pins.map(({ prompt, ref }) => [prompt.value.name, ref.model])).toEqual([['고정', 'pin']]);
    const used = (overview: ReturnType<typeof read>) => overview.used.map(({ model }) => model).sort();
    expect(used(read())).toEqual(['m', 'pin']);

    await setDefaultModel(store, 'aux', ref('aux'));
    await setAccountTaskModel(store, 'mascot', ref('pin'));
    const tasks = Object.fromEntries(read().tasks.map((task) => [task.feature, { own: task.own?.model, runs: 'kind' in task.runs ? task.runs.kind : task.runs.route.model.id }]));
    expect(read().roles.aux.from).toEqual({ layer: 'settings', role: 'aux' });
    expect(tasks.translate).toEqual({ own: undefined, runs: 'aux' });
    expect(tasks.mascot).toEqual({ own: 'pin', runs: 'pin' });
    expect(used(read())).toEqual(['aux', 'm', 'pin']);

    const created = await store.create('chat', { title: null, character: null, prompt: pinning.ok ? pinning.data.id : '', models: {} });
    const chat = overviewOf(store, created.ok ? created.data.value : null);
    expect(chat.roles.main).toMatchObject({ runs: { model: { id: 'pin' } }, from: { layer: 'prompt', role: 'main' } });
    expect(chat.talk.pins).toEqual([]);
    expect(used(chat)).toEqual(['aux', 'pin']);
  }));
