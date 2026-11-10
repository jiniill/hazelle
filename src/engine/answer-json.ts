// What every task that answers in one JSON object is told; the object's shape follows it.
export const ONE_OBJECT = 'Answer with only one JSON object, with no code fence and nothing before or after it, in this shape:';

export const isText = (value: unknown): value is string => typeof value === 'string';

// A task model's JSON answer: its outermost object ({ to the last }) or array ([ to the last ]), the one that opens
// first unless only the other parses. Models add a code fence or words around it though asked not to, and the words
// may hold a bracket of their own; nothing else is read.
export function answerJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const spans = [['{', '}'], ['[', ']']].map(([open, close]) => [text.indexOf(open!), text.lastIndexOf(close!)] as const).filter(([start]) => start >= 0).sort(([a], [b]) => a - b);
  for (const [start, end] of spans) {
    try {
      return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
    } catch {
      continue;
    }
  }
  return { ok: false };
}
