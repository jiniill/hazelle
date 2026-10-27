import type { ModelsDevList, Rates } from './models-dev';
import type { Cost, DiscountRates, Model, Usage } from './types';

// A price the provider's own model list states, in USD per million tokens; none without both its input and output rate.
export function statedPrice(input: number | null, output: number | null, cacheRead: number | null, cacheWrite: number | null): Rates | undefined {
  return input === null || output === null ? undefined : { input, output, cacheRead, cacheWrite, tiers: [] };
}

// Provider catalog values win. Match models.dev ids exactly, then case-insensitively, never fuzzily.
export function joinModelsDev(models: Model[], list: ModelsDevList | null): Model[] {
  if (!list?.fetchedAt) return models;
  const exact = new Map(Object.entries(list.models));
  const folded = new Map([...exact].map(([id, listed]) => [id.toLowerCase(), listed]));
  return models.map((model) => {
    const listed = exact.get(model.id) ?? folded.get(model.id.toLowerCase());
    if (!listed) return model;
    return { ...model, input: model.input ?? listed.input, output: model.output ?? listed.output, ...(!model.price && listed.price && { price: listed.price }) };
  });
}

// The tier is picked by every input token, cached ones included. Without the input or output count there is no cost; a
// cache count the reply did not send counts as none.
export function priceCost(price: Rates, usage: Usage | null, unit: Cost['unit']): Cost | null {
  if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
  const input = usage.inputTokens;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteInputTokens ?? 0;
  const fresh = input - cached - written;
  if (fresh < 0) return null;
  const rates = price.tiers.findLast((tier) => input > tier.above) ?? price;
  // A cache rate the list leaves out bills the token as plain input: earlier OpenAI models have no cache write price.
  const dollars = (fresh * rates.input + cached * (rates.cacheRead ?? rates.input) + written * (rates.cacheWrite ?? rates.input) + usage.outputTokens * rates.output) / 1_000_000;
  return { unit, amount: inUnit(dollars, unit), source: 'price-list' };
}

export const inUnit = (dollars: number, unit: Cost['unit']) => (unit === 'credit' ? dollars * 100 : dollars);

// A price as a discount lane bills it (ConnectionType discount). A cache rate the list leaves out stays out, so priceCost
// still bills it as plain input, at the input rate discounted.
export function discounted(price: Rates, rates: DiscountRates): Rates {
  const scale = <R extends Omit<Rates, 'tiers'>>(each: R): R => ({
    ...each,
    input: each.input * rates.input,
    output: each.output * rates.output,
    cacheRead: each.cacheRead === null ? null : each.cacheRead * rates.cacheRead,
    cacheWrite: each.cacheWrite === null ? null : each.cacheWrite * rates.cacheWrite,
  });
  return { ...scale(price), tiers: price.tiers.map(scale) };
}
