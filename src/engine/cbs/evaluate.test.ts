import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import { blankCard } from '../import/card';
import type { Card } from '../import/types';
import { unescapeCbs } from './escape';
import { evaluate, Runaway, type CbsContext, type CbsProblem, type CbsTrace } from './evaluate';
import { previousMessages } from './history';
import { Scripts } from '../regex/scripts';
import { placeInlays } from '../assets';

const card = (over: Partial<Card> = {}): Card => ({ ...blankCard('Luna'), ...over });

const message = (id: string, role: HistoryMessage['role'], text: string): HistoryMessage => ({ id, message: id, seed: id, role, text, time: null });

const context = (over: Partial<CbsContext> = {}): CbsContext => {
  const messages = over.messages ?? [message('v1', 'assistant', 'Hello')];
  return {
    stage: 'prompt',
    card: card(),
    persona: { name: 'jin', description: '' },
    prompt: { main: '', globalNote: '', authorNote: '' },
    lore: [],
    messages,
    previous: previousMessages(messages),
    source: { seed: 'request-1' },
    greeting: { index: 0 },
    variables: new Map(),
    toggle: () => null,
    model: { id: 'model', maxContext: null, prefill: null },
    axModel: 'aux',
    triggerId: '',
    screen: null,
    clock: { now: Date.UTC(2026, 8, 28, 5, 4, 3), timeZone: 'UTC' },
    language: null,
    assets: [],
    unfound: null,
    problems: null,
    modules: [],
    faces: { char: null, user: null },
    pickSeed: 'pick-1',
    ...over,
  };
};
const run = (text: string, over: Partial<CbsContext> = {}) => evaluate(text, context(over));
const inMessage = { source: { message: 0 } };

describe('evaluate', () => {
  it('stops an evaluation whose commands keep doubling their text, and gives none of it', () => {
    expect(() => run('{{description}}', { card: card({ description: '{{description}}{{description}}' }) })).toThrow(Runaway);
    expect(() => run('{{settempvar::x::abcdefghijklmnop}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(22))).toThrow(Runaway);
  });

  it('reads names without case, spaces, _ or -, and splits at a single colon when the first colon is single', () => {
    expect(run('{{Get_Var:mood}} {{ USER }}', { variables: new Map([['mood', 'calm']]) })).toBe('calm jin');
  });

  it('reads <user>, <char> and <bot> as the tags', () => {
    expect(run('<USER> meets <char> and <Bot>')).toBe('jin meets Luna and Luna');
  });

  it('leaves an unknown or unsupported tag as written with its inner tags evaluated, and {{char}} with no character', () => {
    expect(run('{{img::{{user}}.png}} {{nope}} {{jb}}')).toBe('{{img::jin.png}} {{nope}} {{jb}}');
    expect(run('{{char}}', { card: null })).toBe('{{char}}');
  });

  it('collects an unknown tag or block as written, and an error text a tag gave, where a request asks for them', () => {
    const problems: CbsProblem[] = [];
    expect(run('{{nope::{{user}}}} {{#gone x}}y{{/gone}} {{metadata::bad}} {{slot}}', { problems })).toBe('{{nope::jin}} {{#gone x}}y{{/gone}} Error: bad is not a valid metadata key. {{slot}}');
    expect(problems).toEqual([
      { kind: 'unknown-tag', text: '{{nope::jin}}' },
      { kind: 'unknown-tag', text: '{{#gone x}}' },
      { kind: 'error-text', text: 'Error: bad is not a valid metadata key.' },
    ]);
  });

  it('reports no problem for a tag or block whose name has no letter, and leaves it as written', () => {
    const problems: CbsProblem[] = [];
    expect(run('not a {{...}} macro {{#--}}y{{/--}}', { problems })).toBe('not a {{...}} macro {{#--}}y{{/--}}');
    expect(problems).toEqual([]);
  });

  it('re-emits an unclosed tag or block as written and evaluates the tags after it', () => {
    expect(run('a {{ b {{user}}')).toBe('a {{ b jin');
    expect(run('{{#if 1}}x {{user}}')).toBe('{{#if 1}}x jin');
  });

  it('evaluates only the #when branch it takes', () => {
    const variables = new Map<string, string>();
    expect(run('{{#when::0}}{{setvar::a::1}}yes{{:else}}{{setvar::b::1}}no{{/when}}', { ...inMessage, variables })).toBe('no');
    expect([...variables]).toEqual([['b', '1']]);
  });

  it('folds #when operators right to left over variables and toggles', () => {
    const over = { variables: new Map([['hp', '3'], ['met', 'true']]), toggle: (key: string) => ({ nsfw: '1', mode: '2' })[key] ?? null };
    const holds = (condition: string) => run(`{{#when::${condition}}}y{{:else}}n{{/when}}`, over);
    expect(['not::1::and::0', 'var::met', 'hp::vis::3', 'toggle::nsfw', 'mode::tis::2', '3::>::2', 'var::none', 'a::b'].map(holds)).toEqual(['y', 'y', 'y', 'y', 'y', 'y', 'n', 'n']);
    expect(run('{{#when 1}}y{{/when}}')).toBe('y');
  });

  it('trims the blank lines around a #when branch unless keep, and keeps what inner tags output', () => {
    expect(run('{{#when::1}}\n  yes\n{{:else}}\nno\n{{/when}}')).toBe('  yes');
    expect(run('{{#when::keep::1}}\nyes\n{{/when}}')).toBe('\nyes\n');
    expect(run('{{#when::1}}{{br}}yes{{/when}}')).toBe('\nyes');
  });

  it('trims each line of a true #if, leaves a false one unevaluated, and keeps whitespace in #if_pure', () => {
    const variables = new Map<string, string>();
    expect(run('{{#if 1}}\n  a\n  b\n{{/if}}|{{#if 0}}{{setvar::x::1}}{{/if}}|{{#if_pure true}} c {{/if_pure}}', { ...inMessage, variables })).toBe('a\nb|| c ');
    expect(variables.size).toBe(0);
  });

  it("reads Risu's legacy {#if …#} by its own falsy values, evaluates a false body not at all, and leaves other {# as written", () => {
    const variables = new Map([['n', '3']]);
    const legacy = '{#if {{greater::{{getvar::n}}::0}}\n{#if 2\n  in  \n#}\n#}|{#if -1\n{{setvar::x::1}}#}|{#if 0\nno#}|{#if {{user}}#}|{{getvar::n}}#}';
    expect(run(legacy, { ...inMessage, variables })).toBe('in|||{#if jin#}|3#}');
    expect(variables.has('x')).toBe(false);
  });

  it("trims #each's body layout, so the items it writes for split and filter carry no padding", () => {
    expect(run('{{#each ["a","b"] as x}}\n    <i>{{slot::x}}</i>\n{{/each}}')).toBe('<i>a</i><i>b</i>');
    expect(run('{{filter::{{split::{{#each ["Pa","x","Pb"] as a}} {{#if {{startswith::{{slot::a}}::P}}}} {{slot::a}}$$ {{/if}} {{/each}}::$$}}}}')).toBe('["Pa","Pb"]');
  });

  it('repeats #each per item of a JSON or § array, each item rolling its own random tags', () => {
    expect(run('{{#each ["a","b"] as x}}[{{slot::x}}]{{/each}} {{#each 1§2 y}}{{slot::y}}{{/each}}')).toBe('[a][b] 12');
    expect(run('[{{#each {{getvar::none}} as x}}{{slot::x}}{{/each}}]')).toBe('[]');
    const rolls = run('{{#each [1,2,3] as n}}{{randint::1::1000000}},{{/each}}').split(',').slice(0, 3);
    expect(new Set(rolls).size).toBe(3);
  });

  it('keeps escaped text through a later pass, and unescapes {{<}} to the character itself', () => {
    const once = run('{{#escape}}{{user}}(){{/escape}} {{<}}b{{>}} {{#puredisplay}}{{char}}{{/puredisplay}}');
    expect(unescapeCbs(run(once))).toBe('{{user}}() <b> {{char}}');
    expect(run('{{#pure}}{{user}}{{/pure}}')).toBe('{{user}}');
  });

  it('calls a #func with its arguments, ends a call at {{return}}, and stops recursion at the limit', () => {
    expect(run('{{#func greet}}\nHi {{arg::1}}\n{{/func}}{{call::greet::Bo}}')).toBe('Hi Bo');
    expect(run('{{#func test}}{{#if {{arg::1}}}}{{return::yes}}{{/if}}no{{/func}}{{call::test::1}}/{{call::test::0}}')).toBe('yes/no');
    expect(run('{{#func loop}}{{call::loop}}{{/func}}{{iserror::{{call::loop}}}}')).toBe('1');
  });

  it('drops {{//…}} in the prompt and leaves it in display', () => {
    expect(run('a{{// note: x}}b')).toBe('ab');
    expect(run('a{{// note}}b', { stage: 'display' })).toBe('a{{// note}}b');
  });

  it('writes variables from a chat message only, reads an unset one as null, and adds to it from 0', () => {
    const variables = new Map([['hp', '10']]);
    const text = '{{setvar::mood::calm}}{{addvar::hp::5}}{{addvar::gold::3}}{{setdefaultvar::mood::angry}}{{setdefaultvar::name::Bo}}[{{getvar::mood}}{{getvar::none}}]';
    expect(run(text, { ...inMessage, variables })).toBe('[calmnull]');
    expect(Object.fromEntries(variables)).toEqual({ hp: '15', mood: 'calm', gold: '3', name: 'Bo' });

    const unchanged = new Map(variables);
    expect(run('{{setvar::mood::x}}{{description}}.', { variables: unchanged, card: card({ description: '{{setvar::hp::0}}d' }) })).toBe('d.');
    expect(run('{{description}}', { ...inMessage, variables: unchanged, card: card({ description: '{{setvar::hp::0}}d' }) })).toBe('d');
    expect(unchanged).toEqual(variables);
  });

  it('reads a toggle as the global variable toggle_<key>, and every other global variable as unset', () => {
    expect(run('[{{getglobalvar::toggle_nsfw}}|{{getglobalvar::other}}|{{getglobalvar::toggle_none}}]', { toggle: (key) => (key === 'nsfw' ? '1' : null) })).toBe('[1|null|null]');
  });

  it('rolls a message random tag by its version and place, text outside messages by the request, and pick by its own seed', () => {
    const rolls = '{{randint::1::1000000}} {{randint::1::1000000}}';
    const [first, second] = run(rolls, inMessage).split(' ');
    expect(first).not.toBe(second);
    expect(run(rolls, { ...inMessage, stage: 'display' })).toBe(run(rolls, inMessage));
    expect(run(rolls, { ...inMessage, messages: [message('v2', 'assistant', 'Hello')] })).not.toBe(run(rolls, inMessage));
    expect(run(rolls, { source: { seed: 'request-2' } })).not.toBe(run(rolls));

    const picks = '{{pick::[1,2,3,4,5,6,7,8,9,10]}} {{pick::[1,2,3,4,5,6,7,8,9,10]}}';
    const [a, b] = run(picks).split(' ');
    expect(a).toBe(b);
    expect(run(picks, { source: { seed: 'request-2' } })).toBe(run(picks));
  });

  it('rolls XdY, dY or Y, and 1d6 for {{roll}} with no argument', () => {
    const rolls = (text: string) => Array.from({ length: 40 }, (_, i) => Number(run(text, { source: { seed: `r${i}` } })));
    const within = (all: number[], low: number, high: number) => all.every((n) => Number.isInteger(n) && n >= low && n <= high) && new Set(all).size > 1;
    expect(within(rolls('{{roll}}'), 1, 6)).toBe(true);
    expect(within(rolls('{{roll::20}}'), 1, 20)).toBe(true);
    expect(within(rolls('{{dice::3d4}}'), 3, 12)).toBe(true);
  });

  it('reads a date or time timestamp argument as seconds, in the clock time zone', () => {
    expect(run('{{date::YYYY-MM-DD HH:mm::1700000000}}', { clock: { now: 0, timeZone: 'Asia/Seoul' } })).toBe('2023-11-15 07:13');
    expect(run('{{time}} {{date}} {{unixtime}}')).toBe('5:4:3 2026-9-28 1790571843');
  });

  it('reads {{? …}} as calc with $name from the chat variables, and leaves an expression it cannot read as written', () => {
    expect(run('{{? $hp * 2 + 1}} {{calc::2 + abc}}', { variables: new Map([['hp', '4']]) })).toBe('9 {{calc::2 + abc}}');
  });

  it('indexes previous roles across same-role runs while returning raw text relative to the source', () => {
    const messages = [message('a', 'assistant', '{{char}} raw'), message('u1', 'user', 'first'), message('u2', 'user', 'second'), message('u3', 'user', 'third')];
    const previous = previousMessages(messages);
    const tags = '{{previouscharchat}}|{{lastusermessage}}';
    expect(run(tags, { messages, previous, source: { message: 0 } })).toBe('|');
    expect(run(tags, { messages, previous, source: { message: 3 } })).toBe('{{char}} raw|second');
    expect(run(tags, { messages, previous, source: { seed: 'request' } })).toBe('{{char}} raw|third');
    const edited = [...messages.slice(0, 2), message('a2', 'assistant', 'edited'), messages[3]!];
    expect(run(tags, { messages: edited, source: { message: 3 } })).toBe('edited|first');
  });

  it('numbers messages as Risu does: the greeting -1 and the message after it 0, or from 0 with no greeting', () => {
    const messages = [message('g', 'assistant', 'Hello'), message('u', 'user', 'hi'), message('a', 'assistant', 'yo')];
    const tags = '{{chatindex}} {{isfirstmsg}} {{firstmsgindex}} {{role}} {{previouscharchat}} {{previoususerchat}} {{lastmessageid}} {{previouschatlog::-1}} {{previouschatlog::0}}';
    expect(run(tags, { messages, greeting: { index: 1 }, source: { message: 2 } })).toBe('1 0 0 char Hello hi 1 Hello hi');
    expect(run('{{firstmsgindex}}', { messages, greeting: { index: 0 } })).toBe('-1');
    expect(run('{{chatindex}} {{isfirstmsg}} {{role}}', { messages, source: { message: 0 } })).toBe('-1 1 char');
    expect(run('{{chatindex}} {{isfirstmsg}} {{role}}', { messages })).toBe('-1 0 null');
    const plain = messages.slice(1);
    expect(run('{{chatindex}} {{lastmessageid}} {{previouschatlog::0}} {{previouschatlog::-1}} {{firstmsgindex}}', { messages: plain, greeting: null, source: { message: 1 } })).toBe(
      '1 1 hi Out of range {{firstmsgindex}}',
    );
  });

  it('gives history as message objects with Risu roles, or as texts with an argument', () => {
    const messages = [message('g', 'assistant', 'a'), { ...message('u', 'user', 'k'), time: 5 }];
    expect(JSON.parse(run('{{history}}', { messages })).map((each: string) => JSON.parse(each))).toEqual([{ role: 'char', data: 'a' }, { role: 'user', data: 'k', time: 5 }]);
    expect(run('{{messages::role}}', { messages })).toBe('["user: k"]');
    expect(run('{{history::text::role}}', { messages })).toBe('["user: k"]');
  });

  it("reads Risu's aliases of userhistory, charhistory, firstmsgindex, isfirstmsg, objectassert, makedict and fixnum", () => {
    const over = { messages: [message('g', 'assistant', 'Hello'), message('u', 'user', 'hi'), message('a', 'assistant', 'yo')], greeting: { index: 1 }, source: { message: 1 } };
    const aliases = '{{usermessages}}|{{charmessages}}|{{firstmessageindex}}|{{isfirstmessage}}|{{dictassert::{}::a::1}}|{{makeobject::a=1}}|{{fixnumber::3.14159::2}}';
    const primaries = '{{userhistory}}|{{charhistory}}|{{firstmsgindex}}|{{isfirstmsg}}|{{objectassert::{}::a::1}}|{{makedict::a=1}}|{{fixnum::3.14159::2}}';
    expect(run(aliases, over)).toBe(run(primaries, over));
  });

  it("lists the lorebook as Risu does: each entry a JSON string in Risu's fields, its content raw", () => {
    const entry = { name: 'Gate', keys: ['gate', 'door'], secondaryKeys: [], content: '{{user}} opens', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 3, priority: null, position: null };
    const items = JSON.parse(run('{{lorebook}}', { lore: [entry] })) as string[];
    expect(items.map((item) => JSON.parse(item))).toEqual([{ key: 'gate, door', secondkey: '', comment: 'Gate', content: '{{user}} opens', insertorder: 3, alwaysActive: false, selective: false, useRegex: false, mode: 'normal' }]);
  });

  it('leaves the greeting out of userhistory, charhistory and messageunixtimearray, as Risu does', () => {
    const messages = [message('g', 'assistant', 'hi'), { ...message('u', 'user', 'k'), time: 5 }, message('a', 'assistant', 'yo')];
    const objects = (tag: string) => JSON.parse(run(tag, { messages })).map((each: string) => JSON.parse(each));
    expect(objects('{{userhistory}}')).toEqual([{ role: 'user', data: 'k', time: 5 }]);
    expect(objects('{{charhistory}}')).toEqual([{ role: 'char', data: 'yo' }]);
    expect(run('{{messageunixtimearray}}', { messages })).toBe('["5","0"]');
    expect(run('{{messageunixtimearray}}', { messages, greeting: null })).toBe('["0","5","0"]');
  });

  it('escapes :: inside an array, and spreads an array into the arguments of the tag around it', () => {
    expect(run('{{arrayelement::{{history::text}}::0}}', { messages: [message('g', 'assistant', 'a'), message('u', 'user', 'k::v')] })).toBe('k::v');
    expect(run('{{equal::{{spread::["x","x"]}}}}')).toBe('1');
  });

  it('counts a negative arrayelement index from the end, as Risu does', () => {
    expect(run('{{arrayelement::["a","b","c"]::-1}}|{{arrayelement::["a"]::-2}}')).toBe('c|null');
  });

  it("tells which modules are on by namespace, and lists the character's pictures apart from each module's", () => {
    const assets = [{ id: 'a', name: 'own', type: 'image/png' }, { id: 'b', name: 'wall', type: 'image/png', module: 'phone' }, { id: 'c', name: 'loose', type: 'image/png', module: null }];
    expect(run('{{moduleenabled::phone}}{{moduleenabled::radio}} {{assetlist}} {{moduleassetlist::phone}}|{{moduleassetlist::radio}}', { modules: ['phone'], assets })).toBe('10 ["own"] ["wall"]|');
  });

  it('reads {{axmodel}} as the 보조 모델 beside {{model}}, and leaves both as written when the chat resolves none', () => {
    expect(run('{{model}}|{{axmodel}}')).toBe('model|aux');
    expect(run('{{model}}|{{axmodel}}', { model: null, axModel: null })).toBe('{{model}}|{{axmodel}}');
  });

  it('leaves a tag with an argument out of range as written', () => {
    expect(run('{{fixnum::1.5::200}} {{date::YYYY::soon}}')).toBe('{{fixnum::1.5::200}} {{date::YYYY::soon}}');
  });

  it('leaves a tag as written when its count would size an endless loop or a huge allocation', () => {
    const huge = '9'.repeat(309);
    const text = `{{roll::${huge}d6}} {{rollp::10001d6}} {{dice::2d${huge}}} {{cbr::1e9}} {{arrayassert::[]::1e9::x}} {{range::[0,1,0]}} {{range::[20000]}}`;
    expect(run(text)).toBe(text);
    expect(run('{{cbr::2}}{{arrayassert::[]::1::x}}')).toBe('\\n\\n["","x"]');
    expect(run('{{cnl}}{{cnewline::2}}')).toBe('\\n\\n\\n');
  });

  it('encodes and decodes with xor, crypt and u, each way round', () => {
    expect(run('{{xor::한글 ok}}|{{xordecrypt::{{xor::한글 ok}}}}|{{xordecrypt::v g=}}|{{xor}}')).toBe('EmpjFUd/35CU|한글 ok|A|');
    expect(run('{{crypt::{{crypt::비밀 😀}}}}|{{crypt::{{crypt::abc::3}}::-3}}|{{crypt::abc::1}}')).toBe('비밀 😀|abc|bcd');
    expect(run('{{u::1F600}}{{ue::41}}|{{u::zz}}|{{u::110000}}')).toBe('😀A|\0|{{u::110000}}');
  });

  it('counts with range, up or down, and filters out empty and repeated items', () => {
    expect(run('{{range::[3]}} {{range::[2,8,3]}} {{range::[3,0,-1]}} {{range::[3,1]}} {{range::[a]}}')).toBe('["0","1","2"] ["2","5"] ["3","2","1"] [] []');
    expect(run('{{filter::["a","","a",1,"1"]}} {{filter::["a","","a"]::nonempty}} {{filter::["a","","a"]::unique}}')).toBe('["a","1"] ["a","a"] ["a",""]');
  });

  it('draws ruby and an escaped code block, and gives a file its decoded text in the prompt only', () => {
    expect(run('{{ruby::漢字::かんじ}}|{{ruby::漢字}}')).toBe('<ruby>漢字<rp> (</rp><rt>かんじ</rt><rp>) </rp></ruby>|<ruby>漢字<rp> (</rp><rt></rt><rp>) </rp></ruby>');
    expect(run(`{{codeblock::js::a < b && c > "d" 'e'}}`)).toBe('<pre><code class="language-js">a &lt; b &amp;&amp; c &gt; &quot;d&quot; &#39;e&#39;</code></pre>');
    expect(run('{{file::a.txt::7ZWc6riA}}')).toBe('한글');
    expect(run('{{file::a.txt::7ZWc6riA}}', { stage: 'display' })).toBe('{{file::a.txt::7ZWc6riA}}');
  });

  it('wraps the first argument of tex, latex and katex in $$ in every stage, and leaves one with none as written', () => {
    expect(run('{{tex::x^2}}|{{latex::a::b}}|{{katex::\\sqrt x}}', { stage: 'display' })).toBe('$$x^2$$|$$a$$|$$\\sqrt x$$');
    expect(run('{{tex::x^2}}|{{tex}}')).toBe('$$x^2$$|{{tex}}');
  });

  it('removes the last word or sentence made so far on its own level, and nothing after it', () => {
    expect(run('hello world {{bkspc}} user')).toBe('hello user');
    expect(run("hello world. what's in {{erase}} what's up")).toBe("hello world. what's up");
    expect(run('One. Two? Three! {{erase}}')).toBe('One. Two?');
    expect(run('no stop {{erase}}')).toBe('');
    expect(run('keep {{upper::one two {{bkspc}}}} {{#when::1}}a b{{bkspc}}{{/when}}')).toBe('keep ONE a');
  });

  it("lists no display assets, drops inlays from the prompt, and draws the chat's inlay by its exact id after the display's CBS, a signature as nothing and a missing one as a mark", () => {
    const inlays = [{ id: '0b6f0a52-3c1e-4a8e-9d55-2f1c7b9e6a10', name: 'pic', type: 'image/png' }, { id: '5d0c2e1a-7b3f-4c9d-8e21-6a4b3c2d1e0f', name: 'sig', type: 'signature' }];
    expect(run('{{chardisplayasset}}|{{inlay::pic}}{{inlayed::pic}}{{inlayeddata::pic}}')).toBe('[]|');
    expect(run('{{inlay::pic}}', { stage: 'display' })).toBe('{{inlay::pic}}');
    expect(placeInlays('{{inlay::pic}}|{{inlayeddata::pic}}', inlays)).toBe(`<img src="inlay:${inlays[0]!.id}"/>|<div class="risu-inlay-image"><img src="inlay:${inlays[0]!.id}"/></div>\n`);
    expect(placeInlays('[{{inlayeddata::sig}}]{{inlayed::pics}}', inlays)).toBe('[]<span data-inlay-missing></span>');
  });

  it("keeps the app's own pictures out of a bot's display regex for the model's <img src=\"name\">, self-closed as Risu writes them", () => {
    const inlays = [{ id: '0b6f0a52-3c1e-4a8e-9d55-2f1c7b9e6a10', name: 'pic', type: 'image/png' }];
    const assets = [{ id: '5d0c2e1a-7b3f-4c9d-8e21-6a4b3c2d1e0f', name: 'cat', type: 'image/png' }];
    const wrap = new Scripts([{ name: 'w', find: '<img src="(.*?)">', replace: '<b>$1</b>', stage: 'display', flags: '<no_end_nl>' }], [message('m', 'assistant', '')]);
    const shown = placeInlays(wrap.apply('display', '<img src="dog"> {{img::cat}} {{inlay::pic}}', { index: 0, cbs: (text) => run(text, { stage: 'display', assets }) }).text, inlays);
    expect(shown).toBe(`<b>dog</b> <img src="asset:${assets[0]!.id}"/> <img src="inlay:${inlays[0]!.id}"/>`);
  });

  it("answers the metadata keys it knows, leaves Risu's own as written and names an unknown one as an error", () => {
    expect(run('{{metadata::MaxContext}} {{metadata::modelname}} {{metadata::modelinternalid}} {{metadata::imateapot}}', { model: { id: 'm1', maxContext: 8000, prefill: null } })).toBe('8000 m1 m1 🫖');
    expect(run('{{metadata::language}} {{iserror::{{metadata::nope}}}} {{metadata::nope}}')).toBe('{{metadata::language}} 1 Error: nope is not a valid metadata key.');
  });

  it("reads the pressed element's risu-id as {{triggerid}}, and null outside a press", () => {
    expect(run('[{{trigger_id}}]', { triggerId: 'door' })).toBe('[door]');
    expect(run('[{{triggerid}}]')).toBe('[null]');
  });

  it('sets a default on a missing, empty or null variable only, and adds to a value that is not a number from 0', () => {
    const variables = new Map([['unset', 'null'], ['blank', ''], ['kept', 'z'], ['word', 'abc']]);
    run('{{setdefaultvar::unset::x}}{{setdefaultvar::blank::y}}{{setdefaultvar::kept::q}}{{addvar::word::2}}', { ...inMessage, variables });
    expect(Object.fromEntries(variables)).toEqual({ unset: 'x', blank: 'y', kept: 'z', word: '2' });
  });

  it('reads an unset variable as an empty array and as 0 in calc, and a missing element as null', () => {
    expect(run('{{arraylength::{{getvar::bag}}}} {{arraypush::{{getvar::bag}}::a}} {{? {{getvar::n}}+1}} {{#when::{{getvar::n}}::is::null}}unset{{/when}}')).toBe('0 ["a"] 1 unset');
    expect(run('{{dictelement::{"a":1}::b}} {{element::{"a":[0]}::a::0}} {{element::{"a":[0]}::a::1}}')).toBe('null 0 null');
    expect(run('{{objectelement::{"a":1}::a}}')).toBe('1');
  });

  it('counts a value that is no number, an unset variable among them, as 0 in sum, min, max and average', () => {
    expect(run('{{sum::{{getvar::a1}}::2}} {{min::x::3}} {{max::x::-3}} {{average::x::4}}')).toBe('2 0 0 2');
  });

  it("gives Risu's long escape names the character of their short form", () => {
    const long = '{{displayescapedbracketopen}}{{debc}}{{deabo}}{{displayescapedanglebracketclose}}{{dec}}{{displayescapedsemicolon}}{{displayescapedcurlybracketopen}}{{ddecbc}}';
    expect(unescapeCbs(run(long))).toBe('()<>:;{}}');
    expect(run(long)).toBe(run('{{(}}{{)}}{{<}}{{>}}{{:}}{{;}}{{decbo}}{{bc}}'));
  });
});

describe('steps', () => {
  const traced = (text: string, over: Partial<CbsContext> = {}) => {
    const trace: CbsTrace = { steps: [], omitted: 0 };
    evaluate(text, context(over), trace);
    return trace.steps.map(({ at, end, headEnd, ...step }) => ({ written: text.slice(at, end), ...(headEnd !== undefined && { head: text.slice(at, headEnd) }), ...step }));
  };

  it('lists each tag and block where it is written, outer first, with what it gave and why it held', () => {
    const text = '<user>: {{#when::{{getvar::a}}::>=::50}}yes{{:else}}no{{/when}}{{nope}}{{bkspc}}';
    expect(traced(text, { variables: new Map([['a', '30']]) })).toEqual([
      { written: '<user>', depth: 0, result: 'jin' },
      { written: '{{#when::{{getvar::a}}::>=::50}}yes{{:else}}no{{/when}}', head: '{{#when::{{getvar::a}}::>=::50}}', depth: 0, result: 'no', condition: ['30', '>=', '50'], held: false },
      { written: '{{getvar::a}}', depth: 1, result: '30', variable: 'a' },
      { written: '{{nope}}', depth: 0, result: '{{nope}}', kept: 'unknown' },
      { written: '{{bkspc}}', depth: 0, result: '', erased: true },
    ]);
  });

  it('gives each step a {{return}} leaves through the returned value', () => {
    expect(traced('{{#when::1}}{{return::hi}}{{/when}}tail').map(({ written, result }) => [written, result])).toEqual([
      ['{{#when::1}}{{return::hi}}{{/when}}', 'hi'],
      ['{{return::hi}}', 'hi'],
    ]);
  });

  it("places a called function's body where it was defined, one level inside the call", () => {
    const text = '{{#func f}}{{user}}{{/func}}{{call::f}}';
    expect(traced(text).map(({ written, depth }) => [written, depth])).toEqual([
      ['{{#func f}}{{user}}{{/func}}', 0],
      ['{{call::f}}', 0],
      ['{{user}}', 1],
    ]);
  });
});

it('marks a capped trace result before callers unescape it', () => {
  const trace: CbsTrace = { steps: [], omitted: 0 };
  const text = 'x'.repeat(1001);
  expect(evaluate('{{getvar::long}}', context({ variables: new Map([['long', text]]) }), trace)).toBe(text);
  expect(trace.steps[0]).toMatchObject({ result: text.slice(0, 1000), truncated: true });
});
