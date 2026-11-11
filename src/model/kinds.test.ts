import { unavailableCalibration } from './token-calibration';
import { expect, it } from 'vitest';
import { isValue } from './kinds';

it("reads folders and chats written before chat folders, and a chat folder only with the character it belongs to", () => {
  expect(isValue('folder', { name: '판타지' })).toBe(true);
  expect(isValue('folder', { name: '판타지', of: 'chat', character: null })).toBe(true);
  expect(isValue('folder', { name: '판타지', of: 'chat' })).toBe(false);
  const chat = { title: null, character: null, models: {} };
  expect(isValue('chat', chat)).toBe(true);
  expect(isValue('chat', { ...chat, folder: 'f' })).toBe(true);
  expect(isValue('chat', { ...chat, folder: null })).toBe(false);
});

it("reads a summary's verdict as absent or well formed, and refuses a malformed one", () => {
  const summary = { version: 1, head: 0, chatRev: 1, dependencies: [], rendered: { now: 0, timeZone: 'UTC' }, character: null, title: '', preview: '', count: 0, at: null, order: 1, recent: [] };
  expect(isValue('summary', summary)).toBe(true);
  expect(isValue('summary', { ...summary, stuck: { dependencies: [{ kind: 'character', id: 'c', rev: 2 }] } })).toBe(true);
  expect(isValue('summary', { ...summary, stuck: null })).toBe(false);
  expect(isValue('summary', { ...summary, stuck: { dependencies: 'c' } })).toBe(false);
});

it('accepts an illustration as the run stores it, and refuses one whose scene lost a field', () => {
  const scene = { paragraph: 1, shape: 'portrait', setting: '1girl, indoors', framing: 'cowboy shot', characters: [{ name: 'Ari', look: 'girl, silver hair', outfit: 'white dress', action: 'smile', x: 0.5, y: 0.5 }] };
  const sent = { prompt: '1girl, indoors', negative: 'lowres', characters: [{ prompt: 'girl', negative: '', center: { x: 0.5, y: 0.5 } }], width: 832, height: 1216, seed: 7 };
  const illustration = { message: 'm', version: 'v', scene, receipt: null, model: { connection: 'c', model: 'nai' }, sent, file: { id: 'f', key: 'k' }, type: 'image/png', size: 10, at: 1 };
  expect(isValue('illustration', illustration)).toBe(true);
  expect(isValue('illustration', { ...illustration, scene: { ...scene, framing: undefined } })).toBe(false);
});

it('reads an asset stored before backgrounds as a plain one, and refuses a use it does not know', () => {
  const asset = { name: 'smile', type: 'image/png', size: 10, file: { id: 'f', key: 'k' } };
  expect(isValue('asset', asset)).toBe(true);
  expect(isValue('asset', { ...asset, use: 'background' })).toBe(true);
  expect(isValue('asset', { ...asset, use: 'voice' })).toBe(false);
});

it('accepts a tool\'s picture with no scene, and refuses one that lost its tool\'s name', () => {
  const attached = { message: 'm', version: 'v', file: { id: 'f', key: 'k' }, type: 'image/png', size: 10, at: 1, paragraph: 0, width: 96, height: 96, tool: { module: 'mod', name: 'Sample' } };
  expect(isValue('illustration', attached)).toBe(true);
  expect(isValue('illustration', { ...attached, caption: 'A tide' })).toBe(true);
  expect(isValue('illustration', { ...attached, tool: { module: 'mod' } })).toBe(false);
});


it('accepts tool files and per-key data without changing existing module shapes', () => {
  const manifest = { api: 1, name: 'notes', author: 'jin', displayName: 'Notes', version: '1', description: '', uses: [], page: null, menu: [], settings: [] };
  const tool = { manifest, file: { id: 'f', key: 'k' }, size: 30, settings: {} };
  expect(isValue('tool', tool)).toBe(true);
  expect(isValue('tool', { ...tool, file: {} })).toBe(false);
  expect(isValue('tool', { ...tool, manifest: { ...manifest, api: 2 } })).toBe(false);
  expect(isValue('tooldata', { key: 'note', value: { text: 'hello' } })).toBe(true);
  expect(isValue('tooldata', { key: 'note', value: null })).toBe(true);
  expect(isValue('tooldata', { key: 'note' })).toBe(false);
  expect(isValue('toolfile', { key: 'note', size: 1, file: { id: 'f', key: 'k' } })).toBe(true);
  expect(isValue('toolfile', { key: 'note', size: 1 })).toBe(false);
  expect(isValue('tool', { ...tool, manifest: { ...manifest, uses: ['model', 'embed', 'memory', 'network'], actions: [{ id: 'a', label: 'A' }], composer: { label: '기억' } } })).toBe(true);
  expect(isValue('tool', { ...tool, manifest: { ...manifest, uses: ['web'] } })).toBe(false);
  expect(isValue('toolchat', { module: 'm', key: 'index', value: [1, 2] })).toBe(true);
  expect(isValue('toolchat', { module: 'm', key: null, value: { message: { version: 'v', text: '요약됨' } } })).toBe(true);
  expect(isValue('toolchat', { key: 'index', value: 1 })).toBe(false);
});

it('accepts a prompt whose toggles hold layout and unread lines, and refuses a toggle without its key, a mark without its label or an unread line without its text', () => {
  const lines = [{ kind: 'group', label: '모드' }, { key: 'sims', label: '시뮬레이터', kind: 'check', default: '0' }, { kind: 'groupEnd' }, { kind: 'divider', label: '' }, { kind: 'caption', label: '설명' }, { kind: 'unread', text: '모드 고르기' }];
  const prompt = { name: 'p', blocks: [], authorNote: '', models: {}, toggles: lines };
  expect(isValue('prompt', prompt)).toBe(true);
  expect(isValue('prompt', { ...prompt, toggles: [{ label: '시뮬레이터', kind: 'check', default: '0' }] })).toBe(false);
  expect(isValue('prompt', { ...prompt, toggles: [{ kind: 'divider' }] })).toBe(false);
  expect(isValue('prompt', { ...prompt, toggles: [{ kind: 'unread' }] })).toBe(false);
});

it("reads a conversation prompt's default variables as absent or a list of pairs", () => {
  const prompt = { name: 'p', blocks: [], authorNote: '', models: {}, toggles: [] };
  expect(isValue('prompt', { ...prompt, variables: [['hp', '10']] })).toBe(true);
  expect(isValue('prompt', { ...prompt, variables: 'hp=10' })).toBe(false);
});

it("reads a chat's bookmarks and cast as absent or well formed, and refuses a malformed list", () => {
  const chat = { title: null, character: null, models: {} };
  expect(isValue('chat', chat)).toBe(true);
  expect(isValue('chat', { ...chat, bookmarks: [{ message: 'm', name: '고백' }] })).toBe(true);
  expect(isValue('chat', { ...chat, bookmarks: ['m'] })).toBe(false);
  expect(isValue('chat', { ...chat, cast: ['c'] })).toBe(true);
  expect(isValue('chat', { ...chat, cast: 'c' })).toBe(false);
});

it('accepts a call’s marker held by the server (its key) or by a provider’s batch, and refuses one held by neither', () => {
  const marker = { calibration: unavailableCalibration('historical'), call: { connection: 'c', source: 'Anthropic', model: 'm', modelName: 'M' }, at: 1, result: 'r', for: { kind: 'reply', message: null, replaces: null, continues: null } };
  expect(isValue('stream', { ...marker, key: { kty: 'EC' } })).toBe(true);
  expect(isValue('stream', { ...marker, batch: 'msgbatch_1' })).toBe(true);
  expect(isValue('stream', marker)).toBe(false);
  expect(isValue('stream', { ...marker, key: {}, calibration: { measurement: null } })).toBe(false);
});

it('reads a connection’s retry count as absent or a number, and refuses any other', () => {
  const connection = { type: 'openai', label: 'OpenAI', baseUrl: null, protocol: null, accounts: [{ id: 'a', secret: 's' }], turns: null, starred: [] };
  expect(isValue('connection', connection)).toBe(true);
  expect(isValue('connection', { ...connection, retries: 0 })).toBe(true);
  expect(isValue('connection', { ...connection, retries: '2' })).toBe(false);
});

it('requires stored vectors to have usable timestamps, quantization scales and canonical base64 bytes', () => {
  const vector = { at: 1, scale: 0.5, data: 'fwA=' };
  const vectors = { model: 'm', items: { record: vector } };
  expect(isValue('vectors', vectors)).toBe(true);
  expect(isValue('vectors', { ...vectors, items: { record: { ...vector, data: '%' } } })).toBe(false);
  expect(isValue('vectors', { ...vectors, items: { record: { ...vector, scale: 0 } } })).toBe(false);
  expect(isValue('vectors', { ...vectors, items: { record: { ...vector, at: '1' } } })).toBe(false);
});

it('accepts an account-level tool draft with typed ask history, and refuses incomplete drafts', () => {
  const identity = { name: 'n', author: 'a', displayName: '이름', version: '0.1.0', description: '' };
  const draft = { identity, body: 'code', module: null, applied: null, asks: [{ ask: 'write', note: 'done', model: { connection: 'c', model: 'm' }, cost: null, at: 1 }], at: 2 };
  expect(isValue('tooldraft', draft)).toBe(true);
  expect(isValue('tooldraft', { ...draft, module: 'mod', applied: 'code' })).toBe(true);
  expect(isValue('tooldraft', { ...draft, applied: undefined })).toBe(false);
  expect(isValue('tooldraft', { ...draft, identity: { ...identity, version: undefined } })).toBe(false);
  expect(isValue('tooldraft', { ...draft, asks: [{ ...draft.asks[0], model: { connection: 'c' } }] })).toBe(false);
});

it('reads a state definition as absent or well formed on a prompt and a module, and a state entry by who made it', () => {
  const definition = { id: 'd', name: '기본', writer: 'after', fields: [{ id: 'f', name: 'HP', kind: 'gauge', min: 0, max: 100 }], groups: [{ id: 'g', name: '인물', fields: [], members: [{ id: 'm', name: '서하' }] }], logs: [] };
  const prompt = { name: '기본', blocks: [], toggles: [], authorNote: '', models: {} };
  const module = { name: '종', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [] };
  expect(isValue('prompt', prompt)).toBe(true);
  expect(isValue('prompt', { ...prompt, status: definition })).toBe(true);
  expect(isValue('prompt', { ...prompt, status: { ...definition, writer: 'both' } })).toBe(false);
  expect(isValue('module', { ...module, status: definition })).toBe(true);
  expect(isValue('module', { ...module, status: { ...definition, groups: [{ id: 'g', name: '인물', fields: [] }] } })).toBe(false);
  const view = { id: 'v', name: '기본', frame: 'card', mood: 'hazelle' };
  expect(isValue('module', { ...module, status: { ...definition, views: [{ ...view, blocks: [{ kind: 'field', field: 'f' }] }] } })).toBe(true);
  expect(isValue('module', { ...module, status: { ...definition, views: [view] } })).toBe(false);
  const entry = { type: 'status', version: 'v', changes: [{ definition: 'd', kind: 'set', field: 'f', value: 3 }], at: 1 };
  expect(isValue('entry', { ...entry, byHand: true })).toBe(true);
  expect(isValue('entry', { ...entry, of: ['d'], receipt: null })).toBe(true);
  expect(isValue('entry', entry)).toBe(false);
  expect(isValue('entry', { ...entry, changes: [{ kind: 'set' }], byHand: true })).toBe(false);
});
