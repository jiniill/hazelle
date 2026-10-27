import { isRecord } from './values';

// 추가 파라미터: the user's own request body fields, stored as typed and read here at send time, so a broken line is
// kept for fixing and only left out of the request. Two forms, picked by the first character: a JSON object, or
// Risu's lines (key=value, json:: for JSON, {{none}} to remove, a dotted key reaching into an object).
export type ExtraField = { path: string[]; value: unknown } | { path: string[]; remove: true };
// line is 1-based; the JSON form has one problem at line 1. header: Risu's header:: lines, which are not sent.
export type ExtraProblem = { line: number; kind: 'unreadable' | 'header' };
export type Extra = { fields: ExtraField[]; problems: ExtraProblem[] };

const NONE = '{{none}}';

export function readExtra(text: string): Extra {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const object = parseJson(trimmed);
    return isRecord(object)
      ? { fields: Object.entries(object).map(([key, value]) => ({ path: key.split('.'), value })), problems: [] }
      : { fields: [], problems: [{ line: 1, kind: 'unreadable' }] };
  }
  const extra: Extra = { fields: [], problems: [] };
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (at < 0 || !key || !value) extra.problems.push({ line: index + 1, kind: 'unreadable' });
    else if (key.startsWith('header::')) extra.problems.push({ line: index + 1, kind: 'header' });
    else if (value === NONE) extra.fields.push({ path: key.split('.'), remove: true });
    else {
      const read = lineValue(value);
      if (read === undefined) extra.problems.push({ line: index + 1, kind: 'unreadable' });
      else extra.fields.push({ path: key.split('.'), value: read });
    }
  });
  return extra;
}

// Risu's applyAdditionalParameters value rules, in its order.
function lineValue(value: string): unknown {
  if (value.startsWith('json::')) return parseJson(value.slice('json::'.length));
  if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) return value.slice(1, -1);
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === 'null') return null;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function withExtra(body: string, fields: ExtraField[]): string {
  const object: Record<string, unknown> = JSON.parse(body);
  for (const field of fields) place(object, field.path, field);
  return JSON.stringify(object);
}

function place(object: Record<string, unknown>, [key, ...rest]: string[], field: ExtraField) {
  if (!rest.length) {
    if ('remove' in field) delete object[key!];
    else object[key!] = field.value;
    return;
  }
  if (!isRecord(object[key!])) {
    if ('remove' in field) return;
    object[key!] = {};
  }
  place(object[key!] as Record<string, unknown>, rest, field);
}
