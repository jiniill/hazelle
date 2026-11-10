// What every task that answers in one JSON object is told; the object's shape follows it.
export const ONE_OBJECT = 'Answer with only one JSON object, with no code fence and nothing before or after it, in this shape:';

export const isText = (value: unknown): value is string => typeof value === 'string';

// A task model's JSON answer: from its first { or [, whichever comes first, to the last closer of that kind. Models
// add a code fence or words around it though asked not to; nothing else is read.
export function answerJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const start = text.search(/[{[]/);
  if (start < 0) return { ok: false };
  const end = text.lastIndexOf(text[start] === '{' ? '}' : ']');
  try {
    return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
  } catch {
    return { ok: false };
  }
}
