import { blockHead, conditionSteps, isRawBlock, separatorOf, whenArgs } from '../../engine/cbs/evaluate';
import { parse, type Node, type Tag } from '../../engine/cbs/parse';
import { normalize, TOGGLE_GLOBAL } from '../../engine/cbs/tags';

type ToggleUse = { key: string; at: number };

// Find literal keys using evaluator syntax: toggle predicates, first tis/tisnot key and getglobalvar toggle_KEY.
// Computed nested-tag keys and raw-block bodies are deliberately not rewritten.
export function toggleUses(text: string): ToggleUse[] {
  const uses: ToggleUse[] = [];
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.kind === 'tag') {
        global(node, uses);
        visit(node.parts);
      } else if (node.kind === 'legacy') {
        visit(node.parts);
      } else {
        const written = source(node.head);
        const head = blockHead(written.content)!;
        if (head.name === 'when') when(written, head.rest, uses);
        visit(node.head.parts);
        if (!isRawBlock(head.name)) visit(node.body);
        visit(node.close.parts);
      }
    }
  };
  visit(parse(text));
  return uses;
}

export function renameToggle(text: string, from: string, to: string): string {
  return toggleUses(text)
    .filter((use) => use.key === from)
    .sort((a, b) => b.at - a.at)
    .reduce((result, use) => result.slice(0, use.at) + to + result.slice(use.at + from.length), text);
}

// Stands for a nested tag, once for each character of its source, so a place in the content is a place in the text.
// A noncharacter, which no key holds: an argument with one in it is computed.
const NESTED = '﷐';
type Written = { content: string; start: number };

function source(tag: Tag): Written {
  return { content: tag.parts.map((part) => (typeof part === 'string' ? part : NESTED.repeat(part.end - part.at))).join(''), start: tag.at + 2 };
}

function note(key: string, at: number, uses: ToggleUse[]) {
  if (!key.includes(NESTED)) uses.push({ key, at });
}

function global(tag: Tag, uses: ToggleUse[]) {
  const { content, start } = source(tag);
  const sep = separatorOf(content);
  if (!sep) return;
  const [name, argument] = content.split(sep);
  if (normalize(name!) !== 'getglobalvar' || !argument?.startsWith(TOGGLE_GLOBAL)) return;
  note(argument.slice(TOGGLE_GLOBAL.length), start + name!.length + sep.length + TOGGLE_GLOBAL.length, uses);
}

// rest: the #when head after its name, as blockHead gives it.
function when({ content, start }: Written, rest: string, uses: ToggleUse[]) {
  const sep = separatorOf(rest);
  if (!sep) return;
  const { modes, condition } = whenArgs(rest);
  const first = start + content.length - rest.length + sep.length;
  const at = (index: number) => [...modes, ...condition.slice(0, index)].reduce((place, arg) => place + arg.length + sep.length, first);
  const use = (index: number) => note(condition[index]!, at(index), uses);
  // Only the first step's operand is the key as written; a later one is an operator's result.
  conditionSteps(condition).steps.forEach(({ op, left }, step) => {
    if (op === 'toggle' && step === 0) use(condition.length - 1);
    if (op === 'tis' || op === 'tisnot') use(left!);
  });
}
