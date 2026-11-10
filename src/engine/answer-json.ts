// What every task that answers in one JSON object is told; the object's shape follows it.
export const ONE_OBJECT = 'Answer with only one JSON object, with no code fence and nothing before or after it, in this shape:';

export const isText = (value: unknown): value is string => typeof value === 'string';

// A task model's JSON answer, read as given or from inside one code fence, which models add though asked not to.
export function answerJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text.trim());
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : text.trim()) };
  } catch {
    return { ok: false };
  }
}
