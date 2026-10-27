// 보호 패턴 (design §6.3): spans of a translation's source the model never sees, each sent as a token and put back
// in the answer.

export type ProtectInvalid = { kind: 'protect-invalid'; pattern: string };

// Protect code/comments/styles/scripts/media and bracketed asset tokens (translate-instructions).
// Never mask whole HTML blocks: status content must remain translatable; pinned boxes are already excluded.
const BUILT_IN: readonly RegExp[] = [
  /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gmu,
  /<!--[\s\S]*?-->/gu,
  /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
  /<\/?(?:img|audio|video|source|iframe|sprite)\b[^>]*>/giu,
  /[[{]{1,2}[^\]}\n]*?(?:🖼|\b(?:img|image|asset|sprite))[^\]}\n]*[\]}]{1,2}/giu,
];

export const compileRule = (source: string): RegExp | null => {
  try {
    return new RegExp(source, 'gu');
  } catch {
    return null;
  }
};

export function protectRules(sources: readonly string[]): RegExp[] | ProtectInvalid {
  const rules: RegExp[] = [];
  for (const source of sources) {
    const rule = compileRule(source);
    if (!rule) return { kind: 'protect-invalid', pattern: source };
    rules.push(rule);
  }
  return rules;
}

const token = (n: number) => `⟦${n}⟧`;

// Matches resolve by position: the earliest start wins, the longer of two at one start, and a match reaching into a
// span already taken is dropped. Tokens count from 1 in the order of the text.
export function protect(text: string, rules: readonly RegExp[]): { masked: string; spans: string[] } {
  const found = [...BUILT_IN, ...rules]
    .flatMap((rule) => [...text.matchAll(rule)].filter((match) => match[0] !== '').map((match) => ({ start: match.index, end: match.index + match[0].length })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: string[] = [];
  let masked = '';
  let at = 0;
  for (const { start, end } of found) {
    if (start < at) continue;
    spans.push(text.slice(start, end));
    masked += text.slice(at, start) + token(spans.length);
    at = end;
  }
  return { masked: masked + text.slice(at), spans };
}

// missing: how many spans no token brought back. A token that comes twice is put back each time.
export function restore(text: string, spans: readonly string[]): { text: string; missing: number } {
  const back = new Set<number>();
  const restored = text.replace(/⟦(\d+)⟧/gu, (whole, n: string) => {
    const span = spans[Number(n) - 1];
    if (span === undefined) return whole;
    back.add(Number(n));
    return span;
  });
  return { text: restored, missing: spans.length - back.size };
}
