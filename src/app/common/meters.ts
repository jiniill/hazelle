import type { LeftMeter, MeterReset, MeterUnit } from '../../connectors/types';
import { creditAmount, usd } from './money';
import { monthDay } from './time';
import { count } from './typedNumber';

const RESETS: Record<Exclude<MeterReset, { at: number }>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };
export const meterReset = (resets: MeterReset) => (typeof resets === 'string' ? RESETS[resets] : `${monthDay(resets.at)} 초기화`);

const plain = (value: number) => (value >= 10 ? count(Math.round(value)) : creditAmount(value));
const UNITS: Record<Exclude<MeterUnit, 'usd'>, string> = { credit: ' 크레딧', requests: '회', tokens: ' 토큰', concurrency: '', percent: '%' };
export const meterFigure = (unit: MeterUnit, value: number) => (unit === 'usd' ? usd(value) : `${plain(value)}${UNITS[unit]}`);
export const meterAmount = (unit: MeterUnit, value: number) => (unit === 'usd' || unit === 'percent' ? meterFigure(unit, value) : plain(value));

export const meterLabel = (meter: LeftMeter) => (meter.resets ? `${meter.label} · ${meterReset(meter.resets)}` : meter.label);

export function meterLeft(meter: LeftMeter) {
  const left = meterAmount(meter.unit, meter.amount);
  if (meter.limit === null) return { amount: left, of: '남음' };
  return { amount: left, of: meter.unit === 'percent' ? '남음' : `/ ${meterFigure(meter.unit, meter.limit)} 남음`, share: (meter.limit - meter.amount) / meter.limit };
}
