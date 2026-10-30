import { sumCosts } from '../../connectors/pricing';
import type { Cost, Usage } from '../../connectors/types';
import { toolShown } from '../../engine/script-api';
import { calls, type Receipt } from '../../model/chat';
import type { UsagePart } from '../ui';
import { money } from './money';
import { count } from './typedNumber';
import { UNKNOWN } from './words';

// A fact the provider did not report reads as unknown, never as zero.
export const seconds = (ms: number | null) => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(1)}초`);
export const tokens = (value: number | null) => (value === null ? UNKNOWN : count(value));

// A cost the app worked out from a price is an estimate, and says so.
export function cost(value: Cost | 'pending' | null): string {
  if (value === null) return UNKNOWN;
  if (value === 'pending') return '확인하는 중…';
  const amount = money(value.unit, value.amount);
  return value.source === 'reported' ? amount : `약 ${amount}`;
}

const CUT = { length: '길이 한도', stopped: '직접 중단', 'no-terminal': '중간에 끊김', refused: '제공자가 차단' } as const;

export function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '종료 사유', value: '실패', tone: 'warn' };
  if (receipt.cut === 'refused') return { label: '종료 사유', value: receipt.finishReason ? `${CUT.refused} (${receipt.finishReason})` : CUT.refused, tone: 'warn' };
  if (receipt.cut) return { label: '종료 사유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '종료 사유', value: '정상 종료' };
}

// A reply that came in one piece, as from a provider that does not stream, has no speed to measure.
const MEASURABLE_MS = 250;

export const streaming = ({ firstTextMs, totalMs }: Receipt) => (firstTextMs === null || totalMs - firstTextMs < MEASURABLE_MS ? null : totalMs - firstTextMs);

export const speed = (outputTokens: number | null, streamingMs: number | null) => (outputTokens === null || streamingMs === null ? UNKNOWN : `${Math.round(outputTokens / (streamingMs / 1000))} tok/s`);

// The share of the input read from the provider's cache; null where the provider does not say what it read.
export function cacheShare(usage: Usage | null): number | null {
  const input = usage?.inputTokens ?? null;
  const read = usage?.cachedInputTokens ?? null;
  return input === null || read === null || input === 0 ? null : Math.round((read / input) * 100);
}

// The plugin tools a reply's model called, one quiet line: each name and the first words of what it answered.
export function toolLine(receipt: Receipt): string | null {
  const called = calls(receipt).flatMap(({ tools = [] }) => tools);
  if (called.length === 0) return null;
  return called.map(({ name, result }) => `${toolShown(name)} → ${result === null ? '실행하지 못함' : clipped(result)}`).join(' · ');
}
const clipped = (text: string) => {
  const line = text.trim().split('\n')[0]!;
  return line.length > 30 ? `${line.slice(0, 30)}…` : line;
};

// 사용량 표시: the line under a reply, led by its cost, and the facts it opens. Neither shows a cost the app does not
// know (the user's pick, 2026-10-24; 응답 정보 still says it); the line also leaves out an unreported cache, which the
// facts read as unknown. A cost still booking stays in both, as such.
// Both count the whole reply, every call a continued reply took (the user's pick, 2026-10-29); 응답 정보 lists each call.
// A count one call did not report leaves the sum unknown.
function whole(receipt: Receipt) {
  const all = calls(receipt);
  const sum = (values: (number | null)[]) => (values.includes(null) ? null : (values as number[]).reduce((total, value) => total + value, 0));
  const field = (key: keyof Usage) => sum(all.map(({ usage }) => usage![key]));
  const usage: Usage | null = all.some(({ usage }) => !usage) ? null : { inputTokens: field('inputTokens'), cachedInputTokens: field('cachedInputTokens'), cacheWriteInputTokens: field('cacheWriteInputTokens'), outputTokens: field('outputTokens'), reasoningTokens: field('reasoningTokens') };
  const cost = all.some(({ cost }) => cost === 'pending') ? ('pending' as const) : sumCosts(all.map(({ cost }) => cost as Cost | null));
  return { usage, cost, totalMs: sum(all.map(({ totalMs }) => totalMs))!, firstTextMs: all[0]!.firstTextMs, streamingMs: sum(all.map(streaming)) };
}

export function usageLine(receipt: Receipt): { lead: string | null; parts: UsagePart[] } {
  const { usage, cost: total, totalMs } = whole(receipt);
  const share = cacheShare(usage);
  const parts: UsagePart[] = [
    ...(usage ? [{ label: '입력', value: tokens(usage.inputTokens) }, { label: '출력', value: tokens(usage.outputTokens) }] : [{ label: '사용량', value: UNKNOWN }]),
    ...(share === null ? [] : [{ label: '캐시', value: `${share}%` }]),
    ...(total === 'pending' ? [{ label: '비용', value: cost('pending') }] : []),
    { value: seconds(totalMs) },
  ];
  return { lead: total === null || total === 'pending' ? null : cost(total), parts };
}

// 사용량 표시 while a reply is written, with no receipt yet: what this call wrote so far, counted in o200k_base and so an
// estimate for any other tokenizer; null until first counted.
export const textTokens = (written: number | 'unknown' | null) => (!written ? undefined : written === 'unknown' ? `토큰 ${UNKNOWN}` : `약 ${count(written)} 토큰`);
export const writtenSoFar = (written: number | 'unknown' | null) => (written === null ? null : `출력 ${written === 'unknown' ? UNKNOWN : `약 ${count(written)}`}`);

export function usageFacts(receipt: Receipt) {
  const { usage, cost: total, totalMs, firstTextMs, streamingMs } = whole(receipt);
  const share = cacheShare(usage);
  const reasoning = usage?.reasoningTokens ?? null;
  return [
    { label: '입력', value: tokens(usage?.inputTokens ?? null), notes: [`캐시에서 읽음 ${share === null ? UNKNOWN : `${share}%`}`] },
    { label: '출력', value: tokens(usage?.outputTokens ?? null), notes: [`추론 ${tokens(reasoning)}`] },
    ...(total === null ? [] : [{ label: '비용', value: cost(total) }]),
    { label: '걸린 시간', value: seconds(totalMs), notes: [`첫 토큰 ${seconds(firstTextMs)}`] },
    { label: '속도', value: speed(usage?.outputTokens ?? null, streamingMs) },
    { label: '모델', value: receipt.modelName, notes: [receipt.source] },
  ];
}
