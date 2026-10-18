import { describe, expect, it } from 'vitest';
import { resolveAssets } from './assets';
import { evaluate } from './cbs/evaluate';
import { display, DisplayPass, storyHtml, stripStyles } from './display';
import type { HistoryMessage } from './history';
import { blankCard } from './import/card';
import type { Card } from './import/types';
import { onProgress } from './progress';
import { contexts, type ChatScope, type LuaDisplay } from './render';

const card: Card = {
  ...blankCard('Luna'),
  regex: [
    { id: 'regex-0', name: 'hp', find: '\\[HP (\\d+)\\]', replace: '{{setvar::hp::$1}}<style>.x-risu-box { color: red }</style><div class="box">HP $1</div>', stage: 'output', flags: null },
    { id: 'regex-1', name: 'box', find: 'BOX', replace: '<style>.x-risu-box { color: red }</style><div class="box">box</div>', stage: 'display', flags: null },
  ],
  background: '<style>.hp::after { content: "{{getvar::hp}}" }',
};
const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, message: id, seed: id, role, text, time: null });
const scope: ChatScope = {
  card,
  cast: [],
  packs: [card],
  persona: { name: 'jin', description: '' },
  prompt: null,
  note: null,
  lore: [],
  loreFolders: {},
  loreBudget: 800,
  messages: [message('a1', 'assistant', 'BOX'), message('a2', 'assistant', 'The lamp. [HP 7]')],
  greeting: null,
  toggles: new Map(),
  model: null,
  axModel: null,
  clock: { now: 0, timeZone: 'UTC' },
  assets: [],
  inlays: [],
  modules: [],
  faces: { char: null, user: null },
  screen: null,
  pick: 'luna:chat',
  variables: [],
};

describe('display', () => {
  it('passes the backgroundHTML through the display scripts, which fill its placeholders, repeating nothing there', () => {
    const regex = [
      { id: 'regex-2', name: 'border', find: '{border}', replace: '3px solid red', stage: 'display' as const, flags: null },
      { id: 'regex-3', name: 'again', find: 'zzz', replace: 'end', stage: 'display' as const, flags: '<repeat_back>' },
    ];
    const { css } = display({ ...scope, packs: [{ ...card, background: '<style>.frame { border: {border} }</style>', regex }] });
    expect(css.split('\n')[0]).toBe('.frame { border: 3px solid red }');
  });

  it('takes every <style>, one left open too, out of the texts into one stylesheet for the chat, the backgroundHTML’s first, read with the last variables', () => {
    const { texts, css } = display(scope);
    expect(texts).toEqual(['<div class="box">box</div>\n', 'The lamp. <div class="box">HP 7</div>\n']);
    expect(css.split('\n')).toEqual(['.hp::after { content: "7" }', '.x-risu-box { color: red }']);
  });
});

describe('stripStyles', () => {
  it('takes what the style regex takes, in one pass over openers with no > after them', () => {
    const pieces = ['<style>', '<style a="b">', '<STYLE', '</style>', '</style >', '</Style\n>', '>', '<b>', 'x', '<styles>'];
    let state = 7;
    const pick = () => pieces[(state = (state * 1103515245 + 12345) & 0x7fffffff) % pieces.length]!;
    const take = (text: string) => {
      const blocks: string[] = [];
      return { text: stripStyles(text, blocks), blocks };
    };
    for (let n = 0; n < 2000; n++) {
      const text = Array.from({ length: n % 13 }, pick).join('');
      const blocks: string[] = [];
      const kept = text.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (_, css: string) => (blocks.push(css), ''));
      expect(take(text)).toEqual({ text: kept, blocks });
    }
    const open = '<style '.repeat(150_000);
    expect(take(open)).toEqual({ text: open, blocks: [] });
  });
});

describe('a message whose commands ran away', () => {
  it('shows as stored, its tags as written, and says the display stopped them', () => {
    const runaway = '{{settempvar::x::ab}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(24);
    const shown = display({ ...scope, messages: [message('a1', 'assistant', runaway), message('a2', 'assistant', 'The lamp.')] });
    expect(shown.texts).toEqual([runaway, 'The lamp.']);
    expect(shown.stopped).not.toBeNull();
  });
});

describe('the editDisplay pass', () => {
  it('stamps each message with the variables the chat starts from, so a pass run from other ones is not fresh', () => {
    const stamps = (variables: [string, string][]) => {
      const seen: string[] = [];
      display({ ...scope, variables }, undefined, (_version, _text, stamp) => (seen.push(stamp), null));
      return seen;
    };
    expect(stamps([['mood', 'calm']])).toEqual(stamps([['mood', 'calm']]));
    expect(stamps([['mood', 'calm']])).not.toEqual(stamps([['mood', 'angry']]));
  });
});

it('gives a sign of life per stage of each message, and per row a Lua pass patches', () => {
  let signs = 0;
  onProgress(() => signs++);
  try {
    const pass = new DisplayPass({ ...scope, messages: [message('a', 'user', 'one'), message('b', 'assistant', 'two')] }, new Set(), () => null);
    expect(signs).toBe(4);
    pass.patch([{ version: 'b', text: 'done' }]);
    expect(signs).toBe(5);
  } finally {
    onProgress(() => {});
  }
});

it('finishes newest-first Lua patches like a full display, including variable history, boxes and CSS order', () => {
  const changed: ChatScope = { ...scope, messages: [
    { ...message('a', 'assistant', '{{setvar::hp::7}}BOX'), after: [['hp', '8']] },
    message('b', 'assistant', '{{setvar::hp::9}}BOX'),
  ] };
  const runaway = '{{settempvar::x::ab}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(24);
  const values = new Map<string, string>([['b', runaway]]);
  const complete = new Set<string>();
  const lua: LuaDisplay = (id) => values.has(id) ? { text: values.get(id)!, fresh: complete.has(id) } : null;
  const take = new Set([1]);
  const pass = new DisplayPass(changed, take, lua);
  expect(pass.value.stopped).not.toBeNull();
  for (const [version, text] of [['b', '<style>.last { color: blue }</style>BOX {{getvar::hp}}'], ['a', '<style>.first { color: red }</style>BOX {{getvar::hp}}']]) {
    values.set(version!, text!);
    complete.add(version!);
    pass.patch([{ version: version!, text: text! }]);
    expect(pass.value).toEqual(display(changed, take, lua));
  }
  expect(pass.value.texts[0]).toContain('8');
  expect(pass.value.texts[1]).toContain('9');
  expect(pass.value.pass).toBe(false);
  expect(pass.value.stopped).toBeNull();
});

describe('asset tags', () => {
  const smile = '11111111-1111-4111-8111-111111111111';
  const wave = '22222222-2222-4222-8222-222222222222';
  const clip = '33333333-3333-4333-8333-333333333333';
  const withAssets: ChatScope = { ...scope, assets: [{ id: smile, name: 'Smile.png', type: 'image/png' }, { id: wave, name: 'wave', type: 'image/png' }, { id: clip, name: 'clip', type: 'video/mp4' }], faces: { char: 'data:char', user: null } };
  const run = (text: string, stage: 'display' | 'prompt') => evaluate(text, contexts(withAssets, stage, null, '', null)({ seed: 's' }, new Map()));

  it('show a picture by name in any case, or the nearest name, on screen only, and list the names everywhere', () => {
    expect(run('{{img::smile.png}}|{{raw::smiling}}|{{image::none of these}}|{{source::char}}{{source::user}}', 'display')).toBe(
      `<img src="asset:${smile}">|asset:${smile}||data:char`,
    );
    expect(run('{{img::smile.png}} {{assetlist}}', 'prompt')).toBe('{{img::smile.png}} ["Smile.png","wave","clip"]');
  });

  it('show a video as Risu draws it, the asset tag choosing by what the file is', () => {
    expect(run('{{video::clip}}|{{video-img::clip}}|{{asset::clip}}|{{asset::wave}}', 'display')).toBe(
      `<video src="asset:${clip}" controls autoplay loop></video>|<video src="asset:${clip}" autoplay muted loop></video>|<video src="asset:${clip}" autoplay muted loop></video>\n|<img src="asset:${wave}">\n`,
    );
  });

  it('tell the names no asset answers, a near one aside, from messages and backgroundHTML', () => {
    const shown = display({ ...withAssets, messages: [message('a1', 'assistant', '{{img::smiel.png}}{{img::night_forest}}')], packs: [{ ...withAssets.packs[0]!, background: '{{raw::backdrop}}' }] });
    expect(shown.unfound).toEqual(['night_forest', 'backdrop']);
  });

  it('take the picture’s URL once the chat has it, and nothing before', () => {
    const shown = `<img src="asset:${smile}"><div style="background: url(asset:${wave})">`;
    expect(resolveAssets(shown, (_, id) => (id === smile ? 'blob:smile' : undefined))).toBe('<img src="blob:smile"><div style="background: url()">');
  });
});

describe('storyHtml', () => {
  it('shows each line as its own paragraph, with actions, bold and dialogue marked, and Korean marks read', () => {
    expect(storyHtml('*고개를 끄덕였다.*그리고 **굵게**\n"좋아."그리고 “네” 했다.', true)).toBe(
      '<p><em>고개를 끄덕였다.</em>그리고 <strong>굵게</strong></p>\n<p><mark risu-mark="quote2">&quot;좋아.&quot;</mark>그리고 <mark risu-mark="quote2">“네”</mark> 했다.</p>\n',
    );
  });

  it('runs a mark left open to the end of its line, and closes and reopens one a closing mark cuts through', () => {
    expect(storyHtml('*그녀가 "안녕\n다음 줄', true)).toBe('<p><em>그녀가 <mark risu-mark="quote2">&quot;안녕</mark></em></p>\n<p>다음 줄</p>\n');
    expect(storyHtml('*a "b* c"', true)).toBe('<p><em>a <mark risu-mark="quote2">&quot;b</mark></em><mark risu-mark="quote2"> c&quot;</mark></p>\n');
  });

  it('marks 속마음 in single quotes as Risu’s quote1, and leaves an apostrophe and a lone trailing quote as text', () => {
    expect(storyHtml(`"왜?" '신경 쓰이네'라고 생각했다. ‘정말’`, true)).toBe(
      '<p><mark risu-mark="quote2">&quot;왜?&quot;</mark> <mark risu-mark="quote1">\'신경 쓰이네\'</mark>라고 생각했다. <mark risu-mark="quote1">‘정말’</mark></p>\n',
    );
    expect(storyHtml(`I don't know, it’s the users' book.`, true)).toBe(`<p>I don't know, it’s the users' book.</p>\n`);
  });

  it('keeps a paragraph of block-level HTML whole, joined by <br> as Risu does, so a line indented with non-breaking spaces stays beside its siblings', () => {
    expect(storyHtml('\u00a0<div class="w">\n\u00a0<input id="t">\n\u00a0</div>', true)).toBe('<p>\u00a0<div class="w"><br>\n\u00a0<input id="t"><br>\n\u00a0</div></p>\n');
    expect(storyHtml('a <p-chip>x</p-chip>\nb', true)).toBe('<p>a <p-chip>x</p-chip></p>\n<p>b</p>\n');
    expect(storyHtml('\u00a0<fieldset>\n\u00a0<input id="t">\n\u00a0</fieldset>', true)).toBe('<p>\u00a0<fieldset><br>\n\u00a0<input id="t"><br>\n\u00a0</fieldset></p>\n');
  });

  it('keeps a bot’s HTML block as written and escapes it without bot', () => {
    expect(storyHtml('<div class="box">\n*raw*\n</div>\n\n*act*', true)).toBe('<div class="box">\n*raw*\n</div>\n<p><em>act</em></p>\n');
    expect(storyHtml('<b>x</b> \\*y\\*', false)).toBe('<p>&lt;b&gt;x&lt;/b&gt; *y*</p>\n');
  });

  it('stands a bot’s picture at the start of a line as its own line, and leaves two on one block as written', () => {
    expect(storyHtml('<img src="a.png">\n\n본문', true)).toBe('<p><img src="a.png"></p>\n<p>본문</p>\n');
    expect(storyHtml('<img src="a.png"> "네." 본문 <img src="b.png">', true)).toBe(
      '<p><img src="a.png"></p>\n<p><mark risu-mark="quote2">&quot;네.&quot;</mark> 본문 <img src="b.png"></p>\n',
    );
    expect(storyHtml('<img src="a.png">\n<img src="b.png">', true)).toBe('<img src="a.png">\n<img src="b.png">');
  });

  it('marks a closed $$ pair outside code as a formula, as written, with no escape or mark read inside it', () => {
    expect(storyHtml('값 $$\\{a\\}*"b"*$$ `$$c$$` $$d', false)).toBe('<p>값 <span data-tex>$$\\{a\\}*&quot;b&quot;*$$</span> <code>$$c$$</code> $$d</p>\n');
  });
});
