import { calc } from '../cbs/math';
import { dict, json, truthy } from '../cbs/tags';
import type { CallType, Comparison, Operand } from '../import/blocks';
import { UNSET, type ModelMessage, type ScriptUnit } from '../script-api';
import { ranked } from './similar';
import { add, cbs as evaluated, read, write, type Acting, type Working } from './state';

export type Blocks = Omit<Extract<ScriptUnit, { kind: 'blocks' }>, 'id' | 'off'>;
const numbers = (left: string, right: string) => !Number.isNaN(Number(left)) && !Number.isNaN(Number(right));
const same = (left: string, right: string) => (numbers(left, right) ? Number(left) === Number(right) : left === right);
const holds = (list: string, item: string) => {
  const parsed = json(list);
  return Array.isArray(parsed) && parsed.includes(item);
};

// Trigger conditions compare equality as text; v2 branches compare numerically when both texts are numbers.
const COMPARE: Record<Comparison['operator'], (source: string, target: string, equality: Comparison['equality']) => boolean> = {
  equal: (source, target, equality) => equality === 'numeric' ? same(source, target) : source === target,
  unequal: (source, target, equality) => equality === 'numeric' ? !same(source, target) : source !== target,
  greater: (source, target) => Number(source) > Number(target),
  less: (source, target) => Number(source) < Number(target),
  'at-least': (source, target) => Number(source) >= Number(target),
  'at-most': (source, target) => Number(source) <= Number(target),
  truthy,
  unset: (source) => source === UNSET,
  in: (source, target) => holds(target, source),
  contains: (source, target) => holds(source, target),
  'not-in': (source, target) => !holds(target, source),
  'not-contains': (source, target) => !holds(source, target),
  near: (source, target) => numbers(source, target) ? Math.abs(Number(source) - Number(target)) < 0.0001 : source.toLowerCase().replaceAll(' ', '') === target.toLowerCase().replaceAll(' ', ''),
  'same-truth': (source, target) => target === 'true' ? truthy(source) : target === 'false' ? !truthy(source) : source === target,
};
const compare = ({ operator, equality }: Comparison, source: string, target: string) => COMPARE[operator](source, target, equality);
const ARITHMETIC = {
  add: (had: number, by: number) => had + by,
  subtract: (had: number, by: number) => had - by,
  multiply: (had: number, by: number) => had * by,
  divide: (had: number, by: number) => had / by,
  remainder: (had: number, by: number) => had % by,
};

// A loop that ran this often is stopped as a runaway; every hundred turns it lets the worker answer its heartbeat.
const LOOP_TURNS = 100_000;

const array = (value: string) => {
  const held = json(value);
  return Array.isArray(held) ? held : null;
};
const item = (value: unknown) => (value === undefined || value === null ? UNSET : typeof value === 'string' ? value : JSON.stringify(value));
const place = (value: string) => {
  const at = Number(value);
  return Number.isInteger(at) && at >= 0 ? at : null;
};
// $n, $& and $$ in a regex effect's result, from a match and its groups; '' for a group the match lacks or no match.
const fill = (result: string, found: string[] | null) => result.replace(/\$(\d+|&|\$)/g, (_, group: string) => (group === '$' ? '$' : (found?.[group === '&' ? 0 : Number(group)] ?? '')));

function replaced(source: string, pattern: string, result: string, replacement: string, flags: string): string {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return source;
  }
  // A result of one bare group puts the replacement in that group's place within the match; $0 replaces the match.
  const target = /^\$(\d+)$/.exec(result);
  return source.replace(regex, (match: string, ...rest: unknown[]) => {
    const groups = rest.slice(0, typeof rest.at(-1) === 'object' ? -3 : -2) as (string | undefined)[];
    if (target) {
      const group = Number(target[1]);
      if (group === 0) return replacement;
      const text = groups[group - 1];
      if (text) return match.replace(text, replacement);
    }
    return fill(result, [match, ...groups.map((group) => group ?? '')]);
  });
}

function split(source: string, delimiter: string, regex: boolean): string[] {
  if (!regex) return source.split(delimiter);
  const literal = /^\/(.+)\/([a-z]*)$/.exec(delimiter);
  try {
    return source.split(literal ? new RegExp(literal[1]!, literal[2]) : new RegExp(delimiter));
  } catch {
    return [source];
  }
}

// A prompt written as ChatML, its messages each opened by <|im_start|> and a role; null for any other text.
function chatML(prompt: string): ModelMessage[] | null {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('<|im_start|>')) return null;
  return trimmed.split('<|im_start|>').filter(Boolean).map((part) => {
    const role = /^(system|user|assistant)(?:<\|im_sep\|>|[ \n])/.exec(part);
    const content = (role ? part.slice(role[0].length) : part).trim();
    return { role: (role?.[1] ?? 'user') as ModelMessage['role'], content: content.endsWith('<|im_end|>') ? content.slice(0, -'<|im_end|>'.length) : content };
  });
}

// Risu's exists condition and quick search: the last depth messages joined by spaces, all of them for depth 0 as in
// Risu, none for no depth.
function searched(messages: Working[], wanted: string, depth: number | null, match: string | null): boolean {
  const recent = depth === null ? '' : messages.slice(-depth).map((message) => message.data).join(' ');
  return match === 'strict' ? recent.split(' ').includes(wanted) : match === 'loose' ? recent.toLowerCase().includes(wanted.toLowerCase()) : match !== 'regex' || new RegExp(wanted).test(recent);
}

type Call = { run: Acting; get(name: string): string; put(name: string, value: string): void; name: string; option: string };

const listIn = (call: Call) => array(call.get(call.name)) ?? [];
const keepList = (call: Call, list: unknown[]) => call.put(call.name, JSON.stringify(list));
const dictIn = (call: Call) => dict(call.get(call.name));
const keepDict = (call: Call, held: Record<string, unknown>) => call.put(call.name, JSON.stringify(held));
const taken = (call: Call, take: (list: unknown[]) => unknown) => {
  const list = listIn(call);
  const value = take(list);
  keepList(call, list);
  return item(value);
};

// Number the trigger's own pack lore, including leading folders; evaluate content CBS as the prompt does.
function lorebook({ run }: Call): { name: string; content: () => string }[] {
  const { scope } = run.snapshot;
  const folders = (scope.loreFolders[run.owner.id] ?? []).map((name) => ({ name, content: () => '' }));
  const entries = scope.lore.filter(({ parent }) => parent === run.owner.id).map(({ value }) => ({ name: value.name, content: () => evaluated(run, value.content) }));
  return [...folders, ...entries];
}

// A string answer is written to the effect's output variable; undefined writes none.
const CALLS: Record<CallType, (call: Call, ...inputs: string[]) => string | undefined | Promise<string | undefined>> = {
  v2ConcatString: (_, first = '', second = '') => first + second,
  v2ReplaceString: (_, source = '', pattern = '', result = '', replacement = '', flags = '') => replaced(source, pattern, result, replacement, flags),
  v2Calculate: (call, expression = '') => {
    const value = calc(expression, (token) => Number(call.get(token.slice(1))) || 0);
    return value === null ? UNSET : String(value);
  },
  v2Random: (_, min, max) => {
    const [low, high] = [Number(min), Number(max)];
    return Number.isNaN(low) || Number.isNaN(high) ? UNSET : String(Math.floor(Math.random() * (high - low + 1) + low));
  },
  v2GetCharAt: (_, source = '', at = '') => [...source][Number(at)] ?? UNSET,
  v2GetCharCount: (_, source = '') => String([...source].length),
  v2ToLowerCase: (_, source = '') => source.toLowerCase(),
  v2ToUpperCase: (_, source = '') => source.toUpperCase(),
  v2SetCharAt: (_, source = '', at = '', value = '') => {
    const index = place(at);
    if (index === null) return source;
    const chars = [...source];
    chars[index] = value;
    return Array.from(chars, (char) => char ?? '').join('');
  },
  v2SplitString: (call, source = '', delimiter = '') => JSON.stringify(split(source, delimiter, call.option === 'regex')),
  v2ExtractRegex: (_, value = '', pattern = '', flags = '', result = '') => fill(result, new RegExp(pattern, flags).exec(value)),
  v2RegexTest: (_, value = '', pattern = '', flags = '') => {
    try {
      return new RegExp(pattern, flags).test(value) ? '1' : '0';
    } catch {
      return '0';
    }
  },
  v2JoinArrayVar: (_, source = '', delimiter = '') => (array(source) ?? []).map(item).join(delimiter),
  v2GetDictVar: (_, source = '', key = '') => {
    const held = dict(source);
    return item(Object.hasOwn(held, key) ? held[key] : undefined);
  },
  v2HasDictKey: (_, source = '', key = '') => (Object.hasOwn(dict(source), key) ? '1' : '0'),
  v2GetDictSize: (_, source = '') => String(Object.keys(dict(source)).length),
  v2GetDictKeys: (_, source = '') => JSON.stringify(Object.keys(dict(source))),
  v2GetDictValues: (_, source = '') => JSON.stringify(Object.values(dict(source))),
  v2MakeArrayVar: (call) => void call.put(call.name, '[]'),
  v2GetArrayVarLength: (call) => String(listIn(call).length),
  v2GetArrayVar: (call, at = '') => item(listIn(call)[Number(at)]),
  v2SetArrayVar: (call, at = '', value = '') => {
    const index = place(at);
    if (index === null) return;
    const list = listIn(call);
    list[index] = value;
    keepList(call, list);
  },
  v2PushArrayVar: (call, value = '') => void keepList(call, [...listIn(call), value]),
  v2PopArrayVar: (call) => taken(call, (list) => list.pop()),
  v2ShiftArrayVar: (call) => taken(call, (list) => list.shift()),
  v2UnshiftArrayVar: (call, value = '') => void keepList(call, [value, ...listIn(call)]),
  v2SpliceArrayVar: (call, start = '', value = '') => {
    const list = listIn(call);
    list.splice(Number(start) || 0, 0, value);
    keepList(call, list);
  },
  v2SliceArrayVar: (call, start = '', end = '') => JSON.stringify(listIn(call).slice(Number(start) || 0, end === '' || Number.isNaN(Number(end)) ? undefined : Number(end))),
  v2GetIndexOfValueInArrayVar: (call, value = '') => String(listIn(call).map(item).indexOf(value)),
  v2RemoveIndexFromArrayVar: (call, at = '') => {
    const index = place(at);
    const list = listIn(call);
    if (index !== null) list.splice(index, 1);
    keepList(call, list);
  },
  v2MakeDictVar: (call) => void call.put(call.name, '{}'),
  v2ClearDict: (call) => void call.put(call.name, '{}'),
  v2SetDictVar: (call, key = '', value = '') => void keepDict(call, { ...dictIn(call), [key]: value }),
  v2DeleteDictKey: (call, key = '') => {
    const held = dictIn(call);
    delete held[key];
    keepDict(call, held);
  },
  v2GetLastMessage: ({ run }) => run.messages.at(-1)?.data ?? UNSET,
  v2GetLastUserMessage: ({ run }) => run.messages.findLast((message) => message.role === 'user')?.data ?? UNSET,
  v2GetLastCharMessage: ({ run }) => run.messages.findLast((message) => message.role === 'char')?.data ?? UNSET,
  v2GetMessageAtIndex: ({ run }, at = '') => run.messages[Number(at)]?.data ?? UNSET,
  v2GetMessageCount: ({ run }) => String(run.messages.length),
  v2GetFirstMessage: ({ run }) => (run.snapshot.scope.greeting ? run.snapshot.scope.messages[0]!.text : UNSET),
  v2QuickSearchChat: ({ run, option }, value = '', depth = '') => (Number.isNaN(Number(depth)) ? '0' : searched(run.messages, value, Number(depth), option) ? '1' : '0'),
  v2GetCharacterDesc: ({ run }) => run.snapshot.character.description,
  v2GetPersonaDesc: ({ run }) => run.snapshot.persona.description,
  v2GetAuthorNote: ({ run }) => run.snapshot.note,
  v2GetLorebook: (call, name) => lorebook(call).find((entry) => entry.name === name)?.content() ?? UNSET,
  v2GetLorebookByName: (call, name = '') => {
    const regex = new RegExp(name, 'i');
    return JSON.stringify(lorebook(call).flatMap((entry, index) => (regex.test(entry.name) ? [index] : [])));
  },
  v2GetLorebookByIndex: (call, at = '') => lorebook(call)[Number(at)]?.content() ?? UNSET,
  v2GetLorebookIndexViaName: (call, name) => String(lorebook(call).findIndex((entry) => entry.name === name)),
  v2GetAllLorebooks: (call) => JSON.stringify(lorebook(call).map((entry) => entry.content())),
  v2GetLorebookCount: (call) => String(lorebook(call).length),
  v2ShowAlert: ({ run }, value = '') => void run.host.say('normal', value, run.owner),
  v2GetAlertInput: async ({ run }, display = '') => (await run.host.ask({ kind: 'input', text: display }, run.owner)) ?? '',
  v2GetAlertSelect: async ({ run }, display = '', options = '') => (await run.host.ask({ kind: 'select', ...(display && { text: display }), options: options.split('|') }, run.owner)) ?? '',
  v2RunLLM: async ({ run, option }, prompt = '') => {
    const answer = await run.host.model(option === 'submodel' ? 'aux' : 'main', chatML(prompt) ?? [{ role: 'user', content: prompt }], run.owner);
    return answer.success ? answer.result : UNSET;
  },
  v2CheckSimilarity: async ({ run }, source = '', values = '') => (await ranked(run, source, values.split('§')))?.join('§') ?? UNSET,
  v2Tokenize: async ({ run }, value = '') => String(await run.host.tokens(value)),
  v2Wait: (_, seconds) => new Promise((resolve) => setTimeout(() => resolve(undefined), Math.max(0, Number(seconds) || 0) * 1000)),
};

// Missing effects are no-ops recorded in run.missing. Evaluate operands/conditions at execution time.
// call dispatches triggers by name, regardless of their event.
export async function runBlocks(trigger: Blocks, run: Acting, call: (name: string) => Promise<void>): Promise<void> {
  const cbs = (value: string) => evaluated(run, value);
  let locals: { name: string; indent: number; value: string }[] = [];
  const local = (name: string) => locals.findLast((each) => each.name === name);
  const get = (name: string) => local(name)?.value ?? read(run, name);
  const put = (name: string, value: string) => {
    const held = local(name);
    if (held) held.value = value;
    else write(run, name, value);
  };
  const operand = (value: Operand) => (value.kind === 'variable' ? get(cbs(value.name)) : cbs(value.text));
  for (const condition of trigger.conditions) {
    if (condition.kind === 'exists') {
      if (!searched(run.messages, cbs(condition.value), condition.depth, condition.match)) return;
    } else if (condition.kind === 'compare' || condition.kind === 'probe') {
      // Conditions evaluate the variable's value as CBS, not its name; effect operands do the opposite.
      const { source } = condition;
      const value = cbs(source.kind === 'variable' ? read(run, source.name) : source.kind === 'length' ? String(run.messages.length) : source.text);
      if (condition.kind === 'compare' && !compare(condition.comparison, value, cbs(condition.value))) return;
    }
  }
  const effects = trigger.effects;
  // Each running loop's turns so far and how many it takes, by its place.
  const loops = new Map<number, { turn: number; turns: number }>();
  let turns = 0;
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index]!;
    switch (effect.kind) {
      case 'noop': break;
      case 'set': {
        const value = operand(effect.value);
        const name = cbs(effect.name);
        const made = effect.operator === 'set' ? value : effect.operator === null ? undefined : ARITHMETIC[effect.operator](Number(get(name)) || 0, Number(value));
        if (made !== undefined) put(name, String(made));
        break;
      }
      case 'local': {
        const value = operand(effect.value);
        const name = cbs(effect.name);
        const held = locals.findLast((each) => each.name === name && each.indent <= effect.indent);
        if (held) held.value = value;
        else locals.push({ name, indent: effect.indent, value });
        break;
      }
      case 'if': {
        const source = operand(effect.source);
        if (!effect.comparison || !compare(effect.comparison, source, operand(effect.target))) index = effect.otherwise - 1;
        break;
      }
      case 'else': index = effect.next - 1; break;
      case 'loop': {
        const times = effect.times ? Math.floor(Number(operand(effect.times))) : Infinity;
        if (times >= 1) loops.set(index, { turn: 1, turns: times });
        else index = effect.end;
        break;
      }
      case 'repeat': {
        locals = locals.filter((each) => each.indent < effect.indent);
        const loop = loops.get(effect.loop);
        if (!loop || loop.turn >= loop.turns) {
          loops.delete(effect.loop);
          break;
        }
        if (++turns > LOOP_TURNS) throw new Error(`a loop ran ${LOOP_TURNS} times and was stopped`);
        if (turns % 100 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        loop.turn++;
        index = effect.loop;
        break;
      }
      // To the end of the loop's body, which then does not repeat it.
      case 'break': loops.delete(effect.loop); index = effect.end - 1; break;
      case 'close': locals = locals.filter((each) => each.indent < effect.indent); break;
      case 'add': {
        const value = operand(effect.value);
        if (effect.role !== null) add(run, effect.role, value);
        break;
      }
      case 'modify': {
        const message = run.messages[Number(operand(effect.index))];
        const value = operand(effect.value);
        if (message) message.data = value;
        break;
      }
      case 'cut': {
        const start = Number(operand(effect.start));
        const end = Number(operand(effect.end));
        run.messages = run.messages.slice(Number.isNaN(start) ? 0 : start, Number.isNaN(end) ? undefined : end);
        break;
      }
      case 'command': {
        // Only /cut is implemented (ping-pong start triggers). Preserve intended edits rather than Risu's stale-chat overwrite.
        // a-b keeps a slice; -N keeps the first N; a lone index removes that message.
        const [name = '', argument = ''] = operand(effect.value).trim().split(/\s+/, 2);
        if (name !== '/cut') { run.missing.add(`command ${name}`); break; }
        if (argument.includes('-')) {
          const [start, end] = argument.split('-').map(Number);
          run.messages = run.messages.slice(Number.isNaN(start) ? 0 : start, Number.isNaN(end) ? undefined : end);
        } else {
          const index = Number(argument);
          if (!Number.isNaN(index)) run.messages.splice(index, 1);
        }
        break;
      }
      case 'alert': {
        const value = cbs(effect.value);
        const kind = effect.tone;
        if (kind === 'normal' || kind === 'error') run.host.say(kind, value, run.owner);
        else if (kind === 'input') put(cbs(effect.input), (await run.host.ask({ kind, text: value }, run.owner)) ?? '');
        else if (kind === 'select') put(cbs(effect.input), (await run.host.ask({ kind, options: value.split('§') }, run.owner)) ?? '');
        break;
      }
      case 'stop': run.stop = true; break;
      case 'end': index = effects.length; break;
      case 'extract': put(effect.input, fill(effect.result, new RegExp(effect.regex, effect.flags).exec(cbs(effect.value)))); break;
      case 'trigger': await call(operand(effect.name)); break;
      case 'reload': run.reload = true; break;
      case 'call': {
        const inputs = effect.inputs.map(operand);
        const answer = await CALLS[effect.type]({ run, get, put, name: effect.name && cbs(effect.name), option: effect.option }, ...inputs);
        if (answer !== undefined && effect.output) put(cbs(effect.output), answer);
        break;
      }
      case 'opaque': run.missing.add(effect.type); break;
    }
  }
}
