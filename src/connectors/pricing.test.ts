import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import type { ListedModel, Rates } from './models-dev';
import { cacheSaving, joinModelsDev, priceCost, statedPrice } from './pricing';
import type { Usage } from './types';

const usage = (input: number, output: number, cached: number | null = null, written: number | null = null): Usage => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: written,
  outputTokens: output,
  reasoningTokens: null,
});

const opus: Rates = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, tiers: [] };
const tiered: Rates = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null, tiers: [{ above: 272_000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: null }] };

describe('priceCost', () => {
  it('prices fresh input, cache reads and writes, and output apart, past a tier by every input token, in credits for Copilot', () => {
    // Anthropic's input total includes both: 5 fresh + 100 read + 20 written.
    expect(priceCost(opus, usage(125, 10, 100, 20), 'usd')).toEqual({ unit: 'usd', amount: expect.closeTo((5 * 4 + 100 * 0.2 + 20 * 5 + 10 * 20) / 1e6, 12), source: 'price-list' });
    expect(priceCost(opus, usage(30, 98), 'credit')!.amount).toBeCloseTo(0.208, 6);
    expect(priceCost(tiered, usage(272_000, 0), 'usd')!.amount).toBeCloseTo((272_000 * 2.5) / 1e6, 9);
    // A cache write the list does not price bills as plain input.
    expect(priceCost(tiered, usage(272_001, 1, 1, 1), 'usd')!.amount).toBeCloseTo((271_999 * 5 + 0.5 + 5 + 22.5) / 1e6, 9);
    expect(priceCost(opus, { ...usage(30, 98), outputTokens: null }, 'usd')).toBeNull();
    expect(priceCost(opus, usage(10, 5, 20), 'usd')).toBeNull();
  });
});

describe('cacheSaving', () => {
  it('is the cost with every input token fresh less the cost as sent, a write premium against it', () => {
    expect(cacheSaving(opus, usage(125, 10, 100, 20), 'usd')!.amount).toBeCloseTo((100 * (4 - 0.2) - 20 * (5 - 4)) / 1e6, 12);
    expect(cacheSaving(opus, usage(30, 10), 'usd')!.amount).toBe(0);
    expect(cacheSaving(opus, { ...usage(30, 10), outputTokens: null }, 'usd')).toBeNull();
  });
});

describe('joinModelsDev', () => {
  const listed = (price: Rates | null): ListedModel => ({ price, input: ['text', 'image'], output: ['text'], tools: true, reasoning: [{ type: 'toggle' }, { type: 'budget_tokens', min: 0, max: 24576 }] });

  it('keeps a price the model list states, matches exactly and then ignoring case, and never by likeness', () => {
    const stated = { ...bareModel('deepseek-ai/DeepSeek-V4'), price: statedPrice(1, 2, null, null) };
    const list = { fetchedAt: 7, models: { 'deepseek-ai/DeepSeek-V4': listed({ ...opus, input: 9 }), 'moonshotai/kimi-k3': listed(opus), 'gpt-5.4': listed(opus) } };
    const joined = joinModelsDev([stated, bareModel('moonshotai/Kimi-K3'), bareModel('gpt-5.4-mini')], list);
    expect(joined.map((model) => model.price)).toEqual([{ input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] }, opus, undefined]);
    expect(joinModelsDev([bareModel('gpt-5.4')], { fetchedAt: null, models: {} })[0]!.price).toBeUndefined();
  });

  it('fills inputs, outputs, tool support and reasoning controls the model list leaves unknown, keeps those it states, and leaves a model models.dev does not know unknown', () => {
    const list = { fetchedAt: 7, models: { 'gemini-2.5-flash': listed(null), 'gpt-5.4': listed(opus) } };
    const effort = { off: true, levels: ['low'], budget: null, adaptive: null };
    const joined = joinModelsDev([bareModel('gemini-2.5-flash'), { ...bareModel('gpt-5.4'), input: ['text'], tools: false, takes: { settings: null, reasoning: effort } }, bareModel('gemini-9')], list);
    expect(joined.map(({ input, output, price, tools, takes }) => ({ input, output, price, tools, reasoning: takes.reasoning }))).toEqual([
      { input: ['text', 'image'], output: ['text'], price: undefined, tools: true, reasoning: { off: true, levels: [], budget: { min: 0, max: 24576 }, adaptive: null } },
      { input: ['text'], output: ['text'], price: { ...opus }, tools: false, reasoning: effort },
      { input: null, output: null, price: undefined, tools: null, reasoning: null },
    ]);
  });
});
