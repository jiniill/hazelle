import type { CacheCause, CacheComparison, CacheDiagnosis, CacheLore, CacheRender } from '../model/cache';
import { cacheDiff } from './cache-diff';
import type { CbsTrace } from './cbs/evaluate';
import { unescapeCbs } from './cbs/escape';
import { renderAfter, type Assembled } from './pipeline';
import { progressed } from './progress';
import { renderChat, type ChatScope } from './render';

const loreState = (prompt: Assembled, id: string): CacheLore | null => {
  const fired = prompt.lore?.find((entry) => entry.id === id);
  if (fired) return { fired: true, why: fired.why };
  const silent = prompt.silent?.find((entry) => entry.id === id);
  return silent ? { fired: false, why: silent.why } : null;
};

// Literal separators must identify one split, not merely an edit-distance alignment of repeated output.
export function cacheTags(before: string, after: string, source: string, trace: CbsTrace): Extract<CacheCause, { kind: 'tag' }>[] {
  if (trace.omitted || trace.steps.some((step) => step.erased || step.truncated)) return [];
  const steps = trace.steps.filter((step) => step.depth === 0);
  if (!steps.length) return [];
  const literals: string[] = [];
  let end = 0;
  for (const step of steps) {
    if (step.at < end) return [];
    literals.push(unescapeCbs(source.slice(end, step.at)));
    end = step.end;
  }
  literals.push(unescapeCbs(source.slice(end)));
  literals[0] = literals[0]!.trimStart();
  literals[literals.length - 1] = literals.at(-1)!.trimEnd();
  const rendered = steps.map((step, at) => literals[at]! + step.result).join('') + literals.at(-1)!;
  if (rendered !== after || !before.startsWith(literals[0]!) || !before.endsWith(literals.at(-1)!)) return [];
  const values: string[] = [];
  let at = literals[0]!.length;
  for (let index = 0; index < steps.length; index++) {
    const literal = literals[index + 1]!;
    const last = index === steps.length - 1;
    const next = last ? before.length - literal.length : literal ? before.indexOf(literal, at) : -1;
    if (next < at || (!last && before.indexOf(literal, next + 1) !== -1)) return [];
    values.push(before.slice(at, next));
    at = next + literal.length;
  }
  return steps.flatMap((step, index) => values[index] === step.result ? [] : [{ kind: 'tag', tag: source.slice(step.at, step.headEnd ?? step.end), before: values[index]!, after: step.result }]);
}

function tags(scope: ChatScope, variables: () => ReadonlyMap<string, string>, old: CacheRender[] | undefined, next: CacheRender[] | undefined, before: string, after: string): Extract<CacheCause, { kind: 'tag' }>[] {
  if (before === after || !old || !next) return [];
  const changed = next.flatMap((piece) => {
    const was = old.find(({ place }) => place === piece.place);
    return was && was.text === piece.text && was.rendered !== piece.rendered ? [{ was, piece }] : [];
  });
  // The changed renders must account for the whole difference: with their old output put back, the old text returns.
  // Anything else that changed the part (a script, 토큰 절약) leaves it unproven.
  if (!changed.length || changed.reduce((text, { was, piece }) => text.replace(piece.rendered, () => was.rendered), after) !== before) return [];
  return changed.flatMap(({ was, piece }) => {
    const trace: CbsTrace = { steps: [], omitted: 0 };
    const cast = piece.cast === undefined ? null : scope.cast.find(({ id }) => id === piece.cast);
    if (piece.cast !== undefined && !cast) return [];
    const rendered = renderAfter(cast ? { ...scope, card: cast.card } : scope, piece.text, { seed: piece.seed }, null, trace, variables());
    if (typeof rendered !== 'string' || rendered.trim() !== piece.rendered) return [];
    return cacheTags(was.rendered, piece.rendered, piece.text, trace);
  });
}

export function cacheDiagnosis({ forecast, before, after }: CacheComparison, scope: ChatScope): CacheDiagnosis {
  const rows = [
    ...forecast.parts.flatMap((part, at) => part.change === null ? [] : [{ kind: part.change, from: part.from, role: part.role, before: part.before, after: at }]),
    ...forecast.removed.map((part) => ({ kind: 'removed' as const, from: part.from, role: part.role, before: part.before, after: null })),
  ].sort((a, b) => (a.after ?? a.before!) - (b.after ?? b.before!) || (a.kind === 'removed' ? -1 : b.kind === 'removed' ? 1 : 0));
  let variables: ReadonlyMap<string, string> | undefined;
  const readVariables = () => variables ??= renderChat('prompt', scope).variables;
  const parts = rows.map((row): CacheDiagnosis['parts'][number] => {
    progressed();
    const oldWire = row.before === null ? null : before?.wire?.[row.before];
    const nextWire = row.after === null ? null : after.wire[row.after];
    const oldPart = oldWire ? before?.prompt?.parts[oldWire.index] : undefined;
    const nextPart = nextWire ? after.prompt.parts[nextWire.index] : undefined;
    const oldText = row.before === null ? '' : oldWire?.content;
    const nextText = row.after === null ? '' : nextWire?.content;
    const known = before?.wire !== undefined && oldText !== undefined && nextText !== undefined;
    const causes: CacheCause[] = known ? tags(scope, readVariables, oldPart?.cbs, nextPart?.cbs, oldText, nextText) : [];
    const { from } = row;
    if ((from.kind === 'lore' || from.kind === 'depth') && from.id && before?.prompt) {
      const entries = new Map([[from.id, from.name]]);
      for (const entry of [...(before.prompt.lore ?? []), ...(after.prompt.lore ?? [])]) if (entry.fate.kind === 'merged' && entry.fate.into === from.id) entries.set(entry.id, entry.name);
      for (const [id, name] of entries) {
        const old = loreState(before.prompt, id);
        const next = loreState(after.prompt, id);
        if ((old?.fired ?? false) !== (next?.fired ?? false)) causes.push({ kind: 'lore', id, name, before: old, after: next });
      }
    }
    if (row.kind === 'moved' && row.before !== null && row.after !== null) causes.push({ kind: 'moved', before: row.before, after: row.after, depth: from.kind === 'depth' ? from.depth : null });
    if (row.kind === 'changed' && from.kind === 'block' && oldPart?.source !== undefined && nextPart?.source !== undefined && oldPart.source !== nextPart.source) {
      if (from.slot === 'chat' && oldPart.origin === nextPart.origin) causes.push({ kind: 'edited' });
      if (from.slot === 'memory') causes.push({ kind: 'memory' });
    }
    if (!causes.length && known) causes.push({ kind: 'unknown' });
    return { ...row, diff: known ? cacheDiff(oldText, nextText) : null, causes };
  });
  return { parts, missing: parts.filter(({ diff }) => diff === null).length };
}
