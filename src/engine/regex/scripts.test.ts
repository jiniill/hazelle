import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import type { RegexScript } from '../import/types';
import { onProgress } from '../progress';
import { checkScript, Scripts, trySample, type Context } from './scripts';

const script = (find: string, replace: string, over: Partial<RegexScript> = {}): RegexScript => ({ id: find, name: find, find, replace, stage: 'display', flags: null, ...over });
const message = (role: HistoryMessage['role'], text: string, index: number): HistoryMessage => ({ id: `m${index}`, message: `m${index}`, seed: `m${index}`, role, text, time: null });
const cbs = (text: string) => text.replaceAll('{{user}}', 'jin');
const apply = (scripts: RegexScript[], text: string, over: Partial<Context> = {}) =>
  new Scripts(scripts, [message('assistant', text, 0)]).apply('display', text, { index: 0, cbs, ...over });

describe('Scripts', () => {
  it('gives a sign of life before a text\'s CBS read, each script\'s search and what a script that found something writes, so a bot of many scripts is not one silent unit', () => {
    try {
      const kinds: string[] = [];
      onProgress((kind) => kinds.push(kind));
      apply([script('a', 'b'), script('x', 'y'), script('q', 'r', { stage: 'output' })], 'a');
      expect(kinds).toEqual(['cbs', 'regex', 'write', 'regex']);
    } finally {
      onProgress(() => {});
    }
  });

  it('gives a sign of life before each earlier message a repeat_back reads, so a long chat is not one silent unit', () => {
    const history = ['A1', 'none', 'none', 'none', 'none'].map((text, index) => message('assistant', text, index));
    const scripts = new Scripts([script('A\\d', '@@repeat_back end')], history);
    let signs = 0;
    onProgress(() => signs++);
    try {
      scripts.apply('display', 'none', { index: 4, cbs: (text) => text });
      expect(signs).toBe(6);
    } finally {
      onProgress(() => {});
    }
  });

  it('runs only its stage, globally by default; a custom flag string replaces g and keeps only valid flag letters', () => {
    expect(apply([script('a', 'b'), script('a', 'X', { stage: 'output' })], 'aAa').text).toBe('bAb');
    expect(apply([script('a', 'b', { flags: 'iz' })], 'AaA').text).toBe('baA');
    expect(apply([script('a', 'b', { flags: '<no_end_nl>' })], 'aa').text).toBe('bb');
    // No valid letter means no flags, not Risu's `u`, under which `\-` does not compile.
    expect(apply([script('\\-', '+', { flags: 'z' })], 'a-b-')).toMatchObject({ text: 'a+b-' });
  });

  it('stable-sorts by <order N>, highest first, with scripts that have none at 0', () => {
    const scripts = [script('a', 'b'), script('a', 'c', { flags: '<order 5>' }), script('c', 'd', { flags: '<order 5>' }), script('b', 'e', { flags: '<order -1>' })];
    expect(apply(scripts, 'a').text).toBe('d');
  });

  it('expands $<name>, $2, $& and $$, fills {{data}} with the whole match (design §5 row 10), and turns $n into a newline', () => {
    expect(apply([script('(?<key>\\w+)=(\\d)', '[$<key>:$2:$&:$$:{{data}}]$nok')], 'hp=3').text).toBe('[hp:3:hp=3:$:hp=3]\nok');
  });

  it('ends a replacement that ends in a tag with a newline, unless <no_end_nl>', () => {
    expect(apply([script('x', '<br>')], 'x').text).toBe('<br>\n');
    expect(apply([script('x', '<br>', { flags: '<no_end_nl>' })], 'x').text).toBe('<br>');
  });

  it('fills CBS in the text before the scripts and after each replacement, and in the pattern only with <cbs>', () => {
    expect(apply([script('jin', 'hi {{user}}')], '{{user}}').text).toBe('hi jin');
    expect(apply([script('{{user}}', 'X')], '{{user}}').text).toBe('jin');
    expect(apply([script('{{user}}', 'X', { flags: '<cbs>' })], '{{user}}').text).toBe('X');
  });

  it('keeps raw same-role repeat matches before the row during backwards display patches', () => {
    const history = ['A1', 'none', 'A3', 'none', 'none'].map((text, index) => message('assistant', text, index));
    const scripts = new Scripts([script('A\\d', '@@repeat_back end')], history);
    const read = (index: number) => scripts.apply('display', 'none', { index, cbs: (text) => text }).text;
    expect(read(4)).toBe('noneA3');
    expect(read(2)).toBe('noneA1');
    expect(read(0)).toBe('none');
    expect(read(3)).toBe('noneA3');
    expect(read(1)).toBe('noneA1');
  });

  it('reads CBS again after a plain script that matched nothing, as Risu does, and not after one with an action', () => {
    const twice = (text: string) => text.replace('{{w}}', 'W').replace('{{v}}', '{{w}}');
    expect(apply([script('none', 'x')], '{{v}}', { cbs: twice }).text).toBe('W');
    expect(apply([script('none', 'x', { flags: '<no_end_nl>' })], '{{v}}', { cbs: twice }).text).toBe('{{w}}');
    const legacy = (text: string) => text.replace('{#w#}', 'W').replace('{{v}}', '{#w#}');
    expect(apply([script('none', 'x')], '{{v}}', { cbs: legacy }).text).toBe('W');
  });

  it('reads a text a CBS pass left as it was once, however many scripts match nothing in it', () => {
    let reads = 0;
    const counted = (text: string) => (reads++, text.replace('{{v}}', '{{w}}'));
    expect(apply([script('none', 'x'), script('nor', 'x'), script('neither', 'x'), script('never', 'x')], '{{v}}', { cbs: counted }).text).toBe('{{w}}');
    expect(reads).toBe(2);
  });

  it('skips a script whose pattern is empty, also after CBS', () => {
    const blank = (text: string) => text.replaceAll('{{unset}}', '');
    expect(apply([script('', 'X'), script('{{unset}}', 'X', { flags: '<cbs>' })], 'ab', { cbs: blank })).toMatchObject({ text: 'ab' });
  });

  it('keeps no result cache, so a random tag in a replacement rolls on each call (design §5 row 11)', () => {
    let rolls = 0;
    const roll = (text: string) => text.replaceAll('{{roll}}', () => String(++rolls));
    const scripts = [script('a', '{{roll}}')];
    expect([apply(scripts, 'a', { cbs: roll }).text, apply(scripts, 'a', { cbs: roll }).text]).toEqual(['1', '2']);
  });

  it('prepares a pass once while resetting sticky/global patterns and reevaluating random replacements and CBS patterns', () => {
    let options = 0;
    let replacements = 0;
    let rolls = 0;
    let needle = 'a';
    const scripts = [
      { ...script('a', 'b'), get flags() { options++; return 'y'; }, get replace() { replacements++; return 'b'; } },
      script('b', '{{roll}}'),
      script('{{needle}}', 'X', { stage: 'output', flags: '<cbs>' }),
    ];
    const executor = new Scripts(scripts, [message('assistant', 'aa', 0), message('assistant', 'aa', 1)]);
    const cbs = (text: string) => text.replaceAll('{{roll}}', () => String(++rolls)).replaceAll('{{needle}}', needle);
    expect(executor.apply('display', 'aa', { index: 0, cbs }).text).toBe('1a');
    expect(executor.apply('display', 'aa', { index: 1, cbs }).text).toBe('2a');
    expect(executor.apply('output', 'aa', { index: 0, cbs }).text).toBe('XX');
    needle = 'b';
    expect(executor.apply('output', 'bb', { index: 1, cbs }).text).toBe('XX');
    expect([options, replacements]).toEqual([1, 1]);
  });

  it('moves only the first match to the top or the bottom on a line of its own, with $1 expanded', () => {
    const text = 'a<s>1</s>b<s>2</s>';
    expect(apply([script('<s>(\\d)</s>', '@@move_top [$1]')], text).text).toBe('[1]\nab<s>2</s>');
    expect(apply([script('<s>(\\d)</s>', '<t>$1</t>', { flags: '<move_bottom>' })], text).text).toBe('ab<s>2</s>\n<t>1</t>\n');
  });

  it('repeats the latest earlier same-role match onto a message without one, and leaves a message with one alone', () => {
    const messages = [
      message('assistant', 'hi <hp>9</hp>', 0),
      message('user', 'a <hp>1</hp>', 1),
      message('assistant', 'no status', 2),
      message('user', 'b', 3),
      message('assistant', 'still none', 4),
    ];
    const at = (out: string, text: string, flags: string | null = null) =>
      new Scripts([script('<hp>\\d+</hp>', out, { flags })], messages).apply('display', text, { index: 4, cbs }).text;
    expect(at('@@repeat_back end_nl', 'still none')).toBe('still none\n<hp>9</hp>');
    expect(at('@@repeat_back start', 'still none')).toBe('<hp>9</hp>still none');
    expect(at('', 'still none', '<repeat_back>')).toBe('still none<hp>9</hp>');
    expect(at('@@repeat_back end', 'now <hp>4</hp>')).toBe('now <hp>4</hp>');
  });

  it('runs a <repeat_back> flag as a plain replacement on a message that has a match, as Risu does', () => {
    const scripts = new Scripts([script('<hp>(\\d+)</hp>', 'HP $1 {{x}}', { flags: '<repeat_back>' })], [message('assistant', '<hp>9</hp>', 0), message('assistant', 'now <hp>4</hp>', 1)]);
    expect(scripts.apply('display', 'now <hp>4</hp>', { index: 1, cbs: (text) => text.replaceAll('{{x}}', 'cbs') }).text).toBe('now HP 4 cbs');
  });

  it('shares raw-history matches within a pass without mixing roles, expanded patterns, flags or edited snapshots', () => {
    const messages = [message('assistant', '<HP>9</HP>', 0), message('user', '<hp>1</hp>', 1), message('assistant', '<hp>8</hp>', 2), message('assistant', 'none', 3)];
    const scripts = [script('{{pattern}}', '@@repeat_back end', { flags: 'i<cbs>' })];
    const executor = new Scripts(scripts, messages);
    const at = (index: number, pattern: string) => executor.apply('display', 'none', { index, cbs: (text) => text.replaceAll('{{pattern}}', pattern) }).text;
    expect(at(1, '<hp>.*?</hp>')).toBe('none');
    expect(at(2, '<hp>.*?</hp>')).toBe('none<HP>9</HP>');
    expect(at(3, '<hp>9</hp>')).toBe('none<HP>9</HP>');
    expect(at(3, '<hp>.*?</hp>')).toBe('none<hp>8</hp>');
    const edited = [message('assistant', '<hp>4</hp>', 0), ...messages.slice(1)];
    expect(new Scripts([script('<hp>.*?</hp>', '@@repeat_back end')], edited).apply('display', 'none', { index: 2, cbs }).text).toBe('none<hp>4</hp>');
  });

  it('removes the matches on inject, whatever the replacement says (design §5 row 19), and replaces them in the backgroundHTML, as Risu does', () => {
    expect(apply([script('red', 'blue', { flags: '<inject>' })], '.a{color:red}', { index: -1 }).text).toBe('.a{color:blue}');
    expect(apply([script('\\[\\w\\]', '@@inject')], 'a [x] b [y]').text).toBe('a  b ');
    expect(apply([script('\\[\\w\\]', 'kept?', { flags: '<inject>' })], 'a [x] b [y]').text).toBe('a  b ');
  });

  it('takes a status box out of the text, notes which end it stood at, runs the later scripts over it too, and says which scripts drew a box', () => {
    const scripts = [
      script('\\[hp=(\\d+)\\]', '<div class="status">HP $1 <img src="face"></div>', { flags: '<order 1>' }),
      script('<img src="(\\w+)">', '<img src="pic:$1">'),
      script('hi', '<span>hi</span>'),
    ];
    const kept = apply(scripts, 'hi [hp=3]');
    expect(kept.drawn).toEqual([0, 1]);
    expect(kept.boxes).toEqual([]);
    const taken = apply(scripts, 'hi [hp=3]', { take: new Set([0]) });
    expect(taken.text).toBe('<span>hi</span>\n ');
    expect(taken.boxes).toEqual([{ script: 0, html: '<div class="status">HP 3 <img src="pic:face">\n</div>\n', at: 'bottom' }]);
    expect(apply(scripts, '[hp=3] hi', { take: new Set([0]) }).boxes).toMatchObject([{ at: 'top' }]);
    expect(taken.drawn).toEqual([0]);
  });

  it('says a script drew a box only where its evaluated replacement holds one', () => {
    const lastOnly = (text: string) => text.replace(/\{\{#if (\d)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, on: string, body: string) => (on === '1' ? body : ''));
    expect(apply([script('$', '{{#if 1}}<div>panel</div>{{/if}}')], 'hi', { cbs: lastOnly })).toMatchObject({ text: 'hi<div>panel</div>', drawn: [0] });
    expect(apply([script('$', '{{#if 0}}<div>panel</div>{{/if}}')], 'hi', { cbs: lastOnly })).toMatchObject({ text: 'hi', drawn: [] });
  });

  it('takes a block a script moves as its box', () => {
    const scripts = [script('\\[hp=(\\d+)\\]', '@@move_top <div>HP $1</div>')];
    expect(apply(scripts, 'hi [hp=3]')).toMatchObject({ text: '<div>HP 3</div>\n\nhi ', drawn: [0] });
    expect(apply(scripts, 'hi [hp=3]', { take: new Set([0]) })).toMatchObject({ text: 'hi ', boxes: [{ script: 0, html: '<div>HP 3</div>\n', at: 'top' }] });
  });

  it('skips a script with an invalid pattern and runs the rest', () => {
    const scripts = [script('(', 'x'), script('a', 'b')];
    expect(apply(scripts, 'a(')).toEqual({ text: 'b(', drawn: [], boxes: [] });
  });

  it('skips an emotion script, since emotion images are not supported, and leaves the text', () => {
    const scripts = [script('a', '@@emo happy'), script('b', 'c')];
    expect(apply(scripts, 'ab')).toEqual({ text: 'ac', drawn: [], boxes: [] });
  });

  it('skips a script turned off, and the scripts after it keep their places', () => {
    const scripts = [script('a', 'x', { off: true }), script('b', '<div>box</div>')];
    expect(apply(scripts, 'ab', { take: new Set([1]) })).toMatchObject({ text: 'a', boxes: [{ script: 1 }], drawn: [1] });
  });
});

describe('checkScript', () => {
  it('says why a script never runs: no pattern, a pattern that does not compile, or an emotion image; a <cbs> pattern waits for its run', () => {
    expect(checkScript(script('', 'b'))).toBe('empty');
    expect(checkScript(script('(', 'b'))).toBe('invalid');
    expect(checkScript(script('a', '@@emo happy'))).toBe('unsupported');
    expect(checkScript(script('(', 'b', { flags: '<cbs>' }))).toBeNull();
    expect(checkScript(script('a', 'b'))).toBeNull();
  });
});

describe('trySample', () => {
  it('runs one script over a sample at its own stage, even one turned off, and leaves CBS as written', () => {
    expect(trySample(script('a', '{{user}}', { stage: 'output', off: true }), 'abca')).toBe('{{user}}bc{{user}}');
  });
});
