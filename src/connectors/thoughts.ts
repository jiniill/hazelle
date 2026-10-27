import type { Phase } from './types';

// The thinking blocks a model or proxy may write inside its text instead of as reasoning, matched in any case. An
// opener ending in > may carry attributes before it, which are ignored.
const BLOCKS = [
  { open: '<think>', close: '</think>' },
  { open: '<thinking>', close: '</thinking>' },
  { open: '<thought>', close: '</thought>' },
  { open: '<thoughts>', close: '</thoughts>' },
  { open: '<reasoning>', close: '</reasoning>' },
  { open: '<cot>', close: '</cot>' },
  { open: '<antThinking>', close: '</antThinking>' },
  { open: '<reflection>', close: '</reflection>' },
  { open: '◁think▷', close: '◁/think▷' },
] as const;

// Ruling (2026-10-04): attributes are at most this long, and count into the longest tag, the most text ever held back
// while a tag may still be forming. A longer opener is plain text.
const ATTRIBUTES = 64;
const LONGEST = Math.max(...BLOCKS.map(({ open }) => open.length)) + ATTRIBUTES + 1;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (open: string) => (open.endsWith('>') ? open.slice(0, -1) : null);
const OPENER = new RegExp(BLOCKS.map(({ open }) => `(${named(open) === null ? escape(open) : `${escape(named(open)!)}(?:\\s[^<>]{0,${ATTRIBUTES}})?>`})`).join('|'), 'i');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function opening(tail: string) {
  return BLOCKS.some(({ open }) => {
    const name = named(open);
    if (tail.length < open.length && same(tail, open.slice(0, tail.length))) return true;
    if (name === null || !same(tail.slice(0, name.length), name)) return false;
    const attributes = tail.slice(name.length);
    return attributes.length <= ATTRIBUTES + 1 && /^\s[^<>]*$/.test(attributes);
  });
}

// Where the possible start of a tag begins, or the text's length when none may be forming.
function heldFrom(text: string) {
  const starts = [text.lastIndexOf('<'), text.lastIndexOf('◁')].filter((at) => at >= 0 && text.length - at <= LONGEST).sort((a, b) => a - b);
  return starts.find((at) => opening(text.slice(at))) ?? text.length;
}

// Trim reasoning blocks and separate them by blank lines; hold leading whitespace until a block closes.
// takeBack retracts trailing reasoning now recognized as answer text, which follows again as content.
export function thoughts(onText: (phase: Phase, text: string) => void, takeBack: (chars: number) => void) {
  const emit = (phase: Phase, text: string) => void (text && onText(phase, text));
  let held = '';
  let block: { close: RegExp; closer: string; raw: string; written: number; trailing: string } | null = null;
  let spoke = false;
  let leading = '';
  let closed = 0;
  let reasoned = false;

  const say = (text: string) => {
    if (spoke) return emit('text', text);
    const all = leading + text;
    const visible = all.search(/\S/);
    if (visible === -1) return void (leading = all);
    spoke = true;
    leading = '';
    emit('text', closed > 0 ? all.slice(visible) : all);
  };

  const think = (text: string) => {
    const open = block!;
    open.raw += text;
    let all = open.trailing + text;
    if (open.written === 0) all = all.trimStart();
    const cut = all.search(/\s*$/);
    open.trailing = all.slice(cut);
    if (cut === 0) return;
    const visible = (open.written === 0 && reasoned ? '\n\n' : '') + all.slice(0, cut);
    open.written += visible.length;
    reasoned = true;
    emit('reasoning', visible);
  };

  const scan = () => {
    for (;;) {
      if (block) {
        const found = block.close.exec(held);
        if (!found) {
          let keep = Math.min(held.length, block.closer.length - 1);
          while (keep > 0 && !same(held.slice(-keep), block.closer.slice(0, keep))) keep -= 1;
          think(held.slice(0, held.length - keep));
          held = held.slice(held.length - keep);
          return;
        }
        think(held.slice(0, found.index));
        held = held.slice(found.index + found[0].length);
        block = null;
        closed += 1;
        continue;
      }
      const found = OPENER.exec(held);
      if (!found) {
        const from = heldFrom(held);
        say(held.slice(0, from));
        held = held.slice(from);
        return;
      }
      say(held.slice(0, found.index));
      const { close } = BLOCKS[found.slice(1).findIndex((group) => group !== undefined)]!;
      block = { close: new RegExp(escape(close), 'i'), closer: close, raw: (spoke ? '' : leading) + found[0], written: 0, trailing: '' };
      if (!spoke) leading = '';
      held = held.slice(found.index + found[0].length);
    }
  };

  return {
    push(phase: Phase, text: string) {
      if (phase === 'reasoning') {
        reasoned = true;
        return emit('reasoning', text);
      }
      held += text;
      scan();
    },
    // User ruling (2026-10-04): a block still open when the model finished its answer was written as content, and goes
    // back to the text. One cut or failed keeps what it wrote as reasoning, since the model never got to close it.
    end(finished: boolean) {
      if (block && finished) {
        const { raw, written } = block;
        block = null;
        if (written > 0) takeBack(written);
        say(raw + held);
      } else if (block) {
        think(held);
      } else {
        say(held);
      }
      held = '';
      if (!spoke && closed === 0 && leading) emit('text', leading);
    },
  };
}

export function splitThoughts(text: string): { text: string; reasoning: string } {
  const parts = { text: '', reasoning: '' };
  const scanner = thoughts(
    (phase, chunk) => (parts[phase] += chunk),
    (chars) => (parts.reasoning = parts.reasoning.slice(0, parts.reasoning.length - chars)),
  );
  scanner.push('text', text);
  scanner.end(true);
  return parts;
}
