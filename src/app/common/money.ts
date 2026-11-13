import type { Rates } from '../../connectors/models-dev';
import { inUnit } from '../../connectors/pricing';
import type { Cost } from '../../connectors/types';

// Below a dollar, significant digits instead, so a reply that cost $0.0042 does not read as $0.00.
export function usd(amount: number): string {
  const small = amount > 0 && amount < 1 ? { minimumSignificantDigits: 2, maximumSignificantDigits: 3 } : {};
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...small }).format(amount);
}

// Copilot's AI credits (1 credit = $0.01), to two decimals, or two significant digits below one.
export function creditAmount(amount: number): string {
  const digits = amount > 0 && amount < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('ko-KR', digits).format(amount);
}

const credits = (amount: number) => `${creditAmount(amount)} 크레딧`;

// A sum in its own unit; units are never added together.
export const money = (unit: 'usd' | 'credit', amount: number) => (unit === 'usd' ? usd(amount) : credits(amount));

// A list rate, per million tokens, in its own unit.
export const perMillion = (rate: number, unit: Cost['unit']) => money(unit, inUnit(rate, unit));
export const priceLine = (price: Pick<Rates, 'input' | 'output'> | null, unit: Cost['unit']) => (price ? `입력 ${perMillion(price.input, unit)} · 출력 ${perMillion(price.output, unit)}` : '가격 없음');
