import { expect, it } from 'vitest';
import type { Display } from '../../engine/display';
import type { Receipt, Version } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import { placeMark } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import { displayed, logDraft, resolveLog, untranslated, type LogText } from './exportLog';

const picture = '0f8fad5b-d9cb-469f-a165-70867728950e';
const failed = { state: 'failed' } as Receipt;
const message = (id: string, role: Shown['role'], version: Partial<Version> = {}, live: string | null = null): Shown => ({ id, role, at: 0, selected: 0, live, versions: [{ id, seed: id, text: '', receipt: null, edited: false, at: 0, ...version }] });
const messages = [
  message('a', 'assistant', { translation: { text: '안녕', receipt: null, at: 0 } }),
  message('b', 'user'),
  message('c', 'assistant', { receipt: failed }),
  message('d', 'assistant'),
  message('e', 'assistant', {}, 'e'),
];
const view: Display = {
  texts: ['Hello', '반가워', 'broken', '', 'writing'],
  css: `.x { background: url(asset:${picture}) }`,
  drawn: [[], [], [], [], []],
  boxes: [[{ script: 0, html: '<b>HP 7</b>', at: 'bottom' }], [], [], [], []],
  pass: false,
  unfound: [],
  stopped: null,
};
const NONE = { placed: new Map(), pictures: new Map() };
const names = { character: { name: '루나', image: null }, me: { name: '진', image: null }, modelName: null };

it('draws the shown rows in range with their boxes, leaving out failed, empty and live ones, and collects their pictures', () => {
  const draft = logDraft(messages, view, NONE, new Set(), true, names, { pictures: true, hideMe: true, text: 'both', from: 1, to: 5 });
  expect(draft.rows.map(({ key, name, mine, stories }) => [key, name, mine, stories.length])).toEqual([['a', '루나', false, 3], ['b', '나', true, 1]]);
  expect(draft.rows[0]!.stories.map((story) => story.replace(/<[^>]+>/g, '').trim())).toEqual(['Hello', '안녕', 'HP 7']);
  expect([...draft.pictures.values()]).toEqual([{ kind: 'asset', id: picture }]);
  expect(resolveLog(draft, () => 'data:image/png;base64,AA').css).toBe('.x { background: url(data:image/png;base64,AA) }');
  expect(logDraft(messages, view, NONE, new Set(), true, names, { pictures: true, hideMe: false, text: 'translation', from: 2, to: 2 }).rows.map(({ name }) => name)).toEqual(['진']);
});

it('keeps a version flipped to its original on screen in its original, and shows the translation elsewhere', () => {
  const said = (flipped: Set<string>) => logDraft(messages, view, NONE, flipped, true, names, { pictures: true, hideMe: false, text: 'translation', from: 1, to: 1 }).rows[0]!.stories[0]!.replace(/<[^>]+>/g, '').trim();
  expect(said(new Set())).toBe('안녕');
  expect(said(new Set(['a']))).toBe('Hello');
});

it('puts the newest 삽화 of each place in a version’s text where the chat places it, and in a translation after the same paragraphs', () => {
  const illustration = (id: string, paragraph: number, at: number) => ({ id, value: { version: 'a', at, scene: { paragraph } } }) as Stored<'illustration'>;
  const [older, newer, first] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const pictures = new Map([['a', [illustration(older, 1, 1), illustration(newer, 1, 2), illustration(first, 0, 3)]]]);
  const shownAs = (text: LogText) => logDraft([message('a', 'assistant', { translation: { text: '하나\n둘\n셋', receipt: null, at: 0 } })], { ...view, texts: ['One\nTwo\nThree'] }, { placed: new Map([[0, `One\n${placeMark(0)}\nTwo\n${placeMark(1)}\nThree`]]), pictures }, new Set(), true, names, { pictures: true, hideMe: false, text, from: 1, to: 1 });
  const picture = (id: string) => `<p><img src="illustration:${id}"></p>`;
  expect(shownAs('original').rows[0]!.stories[0]).toBe(`<p>One</p>\n${picture(first)}\n<p>Two</p>\n${picture(newer)}\n<p>Three</p>\n`);
  expect(shownAs('translation').rows[0]!.stories[0]).toBe(`<p>하나</p>\n${picture(first)}\n<p>둘</p>\n${picture(newer)}\n<p>셋</p>\n`);
  const boxed = logDraft([message('a', 'assistant')], { ...view, texts: ['<div>\nOne\nTwo\n</div>'] }, { placed: new Map([[0, `<div>\nOne\n${placeMark(0)}\nTwo\n${placeMark(1)}\n</div>`]]), pictures }, new Set(), true, names, { pictures: true, hideMe: false, text: 'original', from: 1, to: 1 });
  expect(boxed.rows[0]!.stories[0]).toBe(`<div>\nOne\n<img src="illustration:${first}">\nTwo\n<img src="illustration:${newer}">\n</div>`);
  const both = shownAs('both');
  expect([both.rows[0]!.stories.join('').split('illustration:').length - 1, both.pictures.has(`illustration:${older}`)]).toEqual([2, false]);
});

it('offers to translate only what a translated log would show untranslated', () => {
  expect(untranslated(messages, view, { from: 1, to: 5 }).map(({ id }) => id)).toEqual(['b']);
  expect(untranslated(messages, view, { from: 3, to: 5 })).toEqual([]);
});

it('gives a message as the display has it, its boxes around its text, with no pictures, and the sheet only with the bot\'s style', () => {
  const first = displayed(view, 0, true);
  expect(first.stories.map((story) => story.replace(/<[^>]+>/g, '').trim())).toEqual(['Hello', 'HP 7']);
  expect(first.css).not.toContain(picture);
  expect(displayed(view, 3, true).stories).toEqual([]);
  expect(displayed(view, 0, false).css).toBe('');
});
