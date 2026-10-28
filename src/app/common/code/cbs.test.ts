import { describe, expect, it } from 'vitest';
import type { InspectedVariable } from '../../../engine/render';
import { cbsLanguage, formTemplate } from './cbs';
import { COMMANDS } from './cbsCommands';

const language = cbsLanguage({ variables: { defaults: [['호감도', '30']], chat: null } });
const spans = (text: string) => (language.syntax as (text: string) => { from: number; to: number; kind: string }[])(text).map(({ from, to, kind }) => [text.slice(from, to), kind]);
const problems = (text: string, of = language) => (of.lint(text) as { from: number; to: number; message: string; fix?: { insert: string } }[]).map(({ from, to, message, fix }) => [text.slice(from, to), message, fix?.insert]);

describe('cbsLanguage', () => {
  it('reads tags into spans from the engine parser: names, separators, arguments, comments, a wrapper slot', () => {
    expect(spans('안녕 {{getvar::{{user}}}}{{// 메모}}{{slot}}')).toEqual([
      ['{{getvar', 'tag'],
      ['::', 'separator'],
      ['{{user', 'tag'],
      ['}}', 'tag'],
      ['}}', 'tag'],
      ['{{// 메모}}', 'comment'],
      ['{{slot}}', 'slot'],
    ]);
    expect(spans('{{#pure}}{{user}}{{/pure}}').map(([text]) => text)).toEqual(['{{#pure', '}}', '{{/pure', '}}']);
  });

  it('marks what the engine would not run as written', () => {
    expect(problems('{{getvr::a}} {{bgm::x}} {{#when::1}}a {{/if}} {{:else}} {{/each}} {{user')).toEqual([
      ['getvr', 'getvar의 오타 같아요.', 'getvar'],
      ['{{bgm::x}}', '헤이젤에 없는 명령어라 적은 그대로 남아요.', undefined],
      ['{{/if}}', '#when 블록을 닫는 태그예요.', '{{/when}}'],
      ['{{:else}}', '{{:else}}는 #when 블록 안에서만 써요.', undefined],
      ['{{/each}}', '열린 블록 없이 닫는 태그예요.', undefined],
      ['{{', '짝이 되는 }}가 없어서 글자 그대로 들어가요.', undefined],
    ]);
    expect(problems('{{#when::a::b}}x{{/when}} {{#if 1}}')).toEqual([
      ['{{#when::a::b}}', '조건을 읽을 수 없어서 늘 아닐 때 쪽이 들어가요.', undefined],
      ['{{#if 1}}', '블록을 닫는 {{/if}} 태그가 없어요.', undefined],
    ]);
    expect(problems('{{original}} {{position::a}} {{ }} {{-}} {{getvar::{{user}}}} {{? 1+1}}', cbsLanguage({ placeholder: 'original' }))).toEqual([]);
    expect(problems('{{original}}')).toEqual([['original', '모르는 명령어라 적은 그대로 남아요.', undefined]]);
    expect(problems('{{data}} {{DATA}} {{data::x}}', cbsLanguage({ placeholder: 'data' }))).toEqual([
      ['{{DATA}}', '{{data}} 그대로 적어야 바뀌어요.', '{{data}}'],
      ['{{data::x}}', '{{data}} 그대로 적어야 바뀌어요.', '{{data}}'],
    ]);
    expect(problems('{{{{getvr::a}}}}')).toEqual([['getvr', 'getvar의 오타 같아요.', 'getvar']]);
  });

  it('completes a tag after {{ as a snippet over the }} already typed, a variable in its slot, and the open block’s close', () => {
    const tag = language.complete('{{getv}}', 6, 'code', false)!;
    expect(tag).toMatchObject({ from: 2, closing: '}}' });
    expect(tag.items.find((item) => item.label === 'getvar')).toMatchObject({ template: 'getvar::${1:이름}}}${0}' });

    const typed = '{{setvar::기분::좋음}}{{#pure}}{{setvar::날것::1}}{{/pure}}{{Set_Var:mood:happy}}{{getvar::호}}';
    const slot = language.complete(typed, typed.length - 2, 'code', false)!;
    expect(slot.items.map((item) => [item.label, item.detail])).toEqual([
      ['호감도', '30'],
      ['기분', undefined],
      ['mood', undefined],
    ]);

    const blocks = '{{#each 가 as 나}}{{#when::1}}x{{/}}';
    const close = language.complete(blocks, blocks.indexOf('{{/') + 3, 'code', false)!;
    expect(close.items[0]).toMatchObject({ label: '/when', template: '/when}}${0}' });
  });

  it('explains a tag from its command, and a variable by its 기본 변수', () => {
    const text = '{{getvar::호감도}} {{/when}}';
    expect(language.explain(text, 12)?.doc).toEqual({ form: '호감도', text: '채팅 변수예요.', facts: [['기본 변수', '30']] });
    expect(language.explain(text, 3)?.doc.form).toBe('{{getvar::이름}}');
    expect(language.explain(text, 20)?.doc.form).toBe('{{#when::조건}}맞을 때 글{{:else}}아닐 때 글{{/when}}');
  });

  it('explains and offers a variable with the value 시험해 보기 read from a chat, and where it was set', () => {
    const set: InspectedVariable = { name: '호감도', nameTruncated: false, last: { writer: { kind: 'cbs', version: 'v', message: 'm', index: 2, stage: 'output' }, value: '45', truncated: false }, history: [], omitted: 0 };
    const read = cbsLanguage({ variables: { defaults: [['호감도', '30']], chat: { label: '예시 채팅', values: new Map([['호감도', set], ['날씨', { ...set, name: '날씨', last: { ...set.last, value: '비' } }]]), partial: false } } });
    expect(read.explain('{{getvar::호감도}}', 12)?.doc.facts).toEqual([['기본 변수', '30'], ['채팅', '예시 채팅'], ['현재 값', '45'], ['설정 위치', '3번째 메시지 · 출력 CBS']]);
    expect(read.explain('{{getvar::없음}}', 12)?.doc.facts).toEqual([['기본 변수', '없음'], ['채팅', '예시 채팅'], ['현재 값', '없음']]);
    expect(read.complete('{{getvar::}}', 10, 'code', false)?.items.map((item) => [item.label, item.detail])).toEqual([['호감도', '45'], ['날씨', '비']]);
  });

  it('turns every command form into a snippet whose stops count from 1', () => {
    for (const { form } of COMMANDS.flatMap((group) => group.commands)) {
      const template = formTemplate(form);
      const stops = [...template.matchAll(/\$\{(\d+)/g)].map((found) => Number(found[1]));
      expect(stops.at(-1), form).toBe(0);
      expect(stops.slice(0, -1), form).toEqual(stops.slice(0, -1).map((_, index) => index + 1));
      expect(template, form).not.toMatch(/#\{/);
    }
  });

  it('reads a long line of unclosed tags in time', () => {
    const open = '{'.repeat(100_000);
    expect(spans(`${open}}}`)).toEqual([
      ['{{', 'tag'],
      ['}}', 'tag'],
    ]);
  });
});
