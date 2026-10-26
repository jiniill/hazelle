import type { Cost, Usage } from '../../connectors/types';
import type { Receipt } from '../../model/chat';
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

export function speed(outputTokens: number | null, firstTextMs: number | null, totalMs: number): string {
  if (outputTokens === null || firstTextMs === null || totalMs - firstTextMs < MEASURABLE_MS) return UNKNOWN;
  return `${Math.round(outputTokens / ((totalMs - firstTextMs) / 1000))} tok/s`;
}

// The share of the input read from the provider's cache; null where the provider does not say what it read.
export function cacheShare(usage: Usage | null): number | null {
  const input = usage?.inputTokens ?? null;
  const read = usage?.cachedInputTokens ?? null;
  return input === null || read === null || input === 0 ? null : Math.round((read / input) * 100);
}

// 사용량 표시: the line under a reply, led by its cost, and the facts it opens. Neither shows a cost the app does not
// know (the user's pick, 2026-10-24; 응답 정보 still says it); the line also leaves out an unreported cache, which the
// facts read as unknown. A cost still booking stays in both, as such.
export function usageLine(receipt: Receipt): { lead: string | null; parts: UsagePart[] } {
  const { usage } = receipt;
  const share = cacheShare(usage);
  const parts: UsagePart[] = [
    ...(usage ? [{ label: '입력', value: tokens(usage.inputTokens) }, { label: '출력', value: tokens(usage.outputTokens) }] : [{ label: '사용량', value: UNKNOWN }]),
    ...(share === null ? [] : [{ label: '캐시', value: `${share}%` }]),
    ...(receipt.cost === 'pending' ? [{ label: '비용', value: cost('pending') }] : []),
    { value: seconds(receipt.totalMs) },
  ];
  return { lead: receipt.cost === null || receipt.cost === 'pending' ? null : cost(receipt.cost), parts };
}

// 사용량 표시 while a reply is written, with no receipt yet: what this call wrote so far, counted in o200k_base and so an
// estimate for any other tokenizer; null until first counted.
export const writtenSoFar = (written: number | 'unknown' | null) => (written === null ? null : `출력 ${written === 'unknown' ? UNKNOWN : `약 ${count(written)}`}`);

export function usageFacts(receipt: Receipt) {
  const { usage } = receipt;
  const share = cacheShare(usage);
  const reasoning = usage?.reasoningTokens ?? null;
  return [
    { label: '입력', value: tokens(usage?.inputTokens ?? null), notes: [`캐시 적중 ${share === null ? UNKNOWN : `${share}%`}`] },
    { label: '출력', value: tokens(usage?.outputTokens ?? null), notes: [`추론 ${tokens(reasoning)}`] },
    ...(receipt.cost === null ? [] : [{ label: '비용', value: cost(receipt.cost) }]),
    { label: '걸린 시간', value: seconds(receipt.totalMs), notes: [`첫 토큰 ${seconds(receipt.firstTextMs)}`] },
    { label: '속도', value: speed(usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
    { label: '모델', value: receipt.modelName, notes: [receipt.source] },
  ];
}
