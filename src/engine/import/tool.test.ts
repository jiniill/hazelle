import { describe, expect, it } from 'vitest';
import { readTool, splitTool, toolSource, TOOL_FILE_BYTES } from './tool';

const read = (source: string) => readTool(new TextEncoder().encode(source));
const header = '//@api 1\n//@name notes\n//@author jin\n';

describe('tool header', () => {
  it('reads only the leading declarations and never evaluates the code', () => {
    const result = read(`\ufeff${header}//@display-name 메모\n//@version 1.0\n//@uses model\n//@page 열기\n//@menu clear 지우기\n//@setting {"key":"count","type":"number","label":"개수","default":3}\nthrow new Error('never run');\n//@name wrong`);
    expect(result).toMatchObject({ ok: true, tool: { manifest: { api: 1, name: 'notes', author: 'jin', displayName: '메모', version: '1.0', uses: ['model'], page: { label: '열기' }, menu: [{ id: 'clear', label: '지우기' }], settings: [{ key: 'count', type: 'number', default: 3 }] } } });
  });

  it.each([
    '//@api 2\n//@name notes\n//@author jin',
    '//@api 1\n//@author jin',
    '//@api 1\n//@name notes',
    `${header}//@setting nope`,
    `${header}//@setting {"key":"n","type":"number","label":"N","default":"3"}`,
    `${header}//@setting {"key":"n","type":"choice","label":"N","options":["a"],"default":"b"}`,
    `${header}//@name ../notes`,
    `${header}//@uses web`,
  ])('refuses an unsupported or malformed declaration: %s', (source) => {
    expect(read(source)).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
  });

  it('reads every use, message actions and the composer item with its fields', () => {
    const result = read(`${header}//@uses model\n//@uses embed\n//@uses memory\n//@uses embed\n//@uses network\n//@action redo 이 부분 다시 정리\n//@composer 기억\n//@input tidy 문장 다듬기\n//@setting {"key":"chunk","type":"number","label":"요약 단위","default":30,"composer":true}`);
    expect(result).toMatchObject({ ok: true, tool: { manifest: { uses: ['model', 'embed', 'memory', 'network'], actions: [{ id: 'redo', label: '이 부분 다시 정리' }], inputs: [{ id: 'tidy', label: '문장 다듬기' }], composer: { label: '기억' }, settings: [{ key: 'chunk', composer: true }] } } });
    expect(read(header)).toMatchObject({ ok: true, tool: { manifest: { actions: [], composer: null, functions: [] } } });
  });

  it('reads the tools the chat model may call, one without parameters as one that takes none', () => {
    const roll = { name: 'roll', description: 'Rolls dice.', parameters: { type: 'object', properties: { sides: { type: 'number' } } } };
    const result = read(`${header}//@tool ${JSON.stringify(roll)}\n//@tool {"name":"bag","description":"Lists the bag."}`);
    expect(result).toMatchObject({ ok: true, tool: { manifest: { functions: [roll, { name: 'bag', description: 'Lists the bag.', parameters: { type: 'object', properties: {} } }] } } });
  });

  it.each([
    ['a fourth action', '//@action a A\n//@action b B\n//@action c C\n//@action d D', 'tool-action'],
    ['a long action label', '//@action a 열일곱글자열일곱글자열일곱글자열일곱글', 'tool-action'],
    ['a repeated action', '//@action a A\n//@action a B', 'tool-action'],
    ['a long composer label', '//@composer 아홉글자아홉글자아홉', 'tool-composer'],
    ['a second composer', '//@composer 기억\n//@composer 메모', 'tool-composer'],
    ['a composer field without the item', '//@setting {"key":"x","type":"switch","label":"X","composer":true}', 'tool-composer-needed'],
    ['an input item without the button', '//@input tidy 다듬기', 'tool-composer-needed'],
    ['a fourth input item', '//@composer 글\n//@input a A\n//@input b B\n//@input c C\n//@input d D', 'tool-input'],
    ['a tool name no provider takes', '//@tool {"name":"주사위","description":"Rolls."}', 'tool-function'],
    ['a tool without a description', '//@tool {"name":"roll","description":" "}', 'tool-function'],
    ['tool parameters that are no object schema', '//@tool {"name":"roll","description":"Rolls.","parameters":{"type":"array"}}', 'tool-function'],
    ['a repeated tool', '//@tool {"name":"roll","description":"Rolls."}\n//@tool {"name":"roll","description":"Again."}', 'tool-function'],
  ])('refuses %s', (_, lines, detail) => {
    expect(read(`${header}${lines}`)).toMatchObject({ ok: false, failure: { detail } });
  });

  it('refuses an unknown declaration by its line, but a file for another app as not a tool', () => {
    expect(read(`${header}//@uses model\n//@use memory`)).toMatchObject({ ok: false, failure: { detail: 'tool-unknown', line: '//@use memory' } });
    expect(read('//@name risu-plugin\n//@api 3.0\n//@arg chunk int Chunk size')).toMatchObject({ ok: false, failure: { detail: 'tool-api' } });
    expect(read(`${header}//@uses memroy`)).toMatchObject({ ok: false, failure: { detail: 'tool-uses', line: '//@uses memroy' } });
  });

  it('refuses duplicate settings and menus and files over the byte cap', () => {
    const field = '//@setting {"key":"x","type":"text","label":"X"}\n';
    expect(read(header + field + field).ok).toBe(false);
    expect(read(header + '//@menu x X\n//@menu x X').ok).toBe(false);
    expect(readTool(new Uint8Array(TOOL_FILE_BYTES + 1))).toMatchObject({ ok: false, failure: { detail: 'tool-too-large' } });
    expect(readTool(new Uint8Array([0xff]))).toMatchObject({ ok: false, failure: { detail: 'tool-encoding' } });
  });
});

it('splits the identity lines from the code\'s own header and joins them back into a readable file', () => {
  const text = '//@api 1\n//@name notes\n//@uses model\n//@author jin\n//@display-name 메모\n\nhazelle.on("prompt", () => "");';
  const split = splitTool(text);
  expect(split).toMatchObject({ identity: { name: 'notes', author: 'jin', displayName: '메모' }, body: '//@uses model\n\nhazelle.on("prompt", () => "");' });
  expect(split.found.map(({ key }) => key)).toEqual(['api', 'name', 'author', 'display-name']);
  const read = readTool(new TextEncoder().encode(toolSource({ name: 'notes', author: 'jin', displayName: '메모', version: '0.1.0', description: '' }, split.body)));
  expect(read).toMatchObject({ ok: true, tool: { manifest: { name: 'notes', author: 'jin', displayName: '메모', version: '0.1.0', description: '', uses: ['model'] } } });
});
