import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelsDevList, PriceTable } from '../connectors/models-dev';
import modelsDev from './fixtures/models-dev.json';
import { VISITOR_HEADER } from '../contracts/http';
import { tokenBucket } from './limits';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => Response.json(modelsDev));
});
afterAll(() => t.dispose());

it('stores the listed providers models.dev prices, inputs and outputs and tool support, pricing only what it can price whole, on the first ask', async () => {
  const { cookie } = await t.signUp('jin');
  const read = async (list: string) => (await (await t.get(`models-dev?provider=${list}`, cookie)).json()) as ModelsDevList;

  expect(await read('github-copilot')).toEqual({ fetchedAt: null, models: {} });
  await t.settle();
  const copilot = await read('github-copilot');
  expect(copilot.fetchedAt).toEqual(expect.any(Number));
  expect(copilot.models).toEqual({
    'gpt-5.4': {
      price: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null, tiers: [{ above: 272000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: null }] },
      input: ['text', 'image', 'file'],
      output: ['text'],
      tools: true,
    },
    'claude-opus-4.7': { price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tiers: [] }, input: ['text', 'image', 'file'], output: ['text'], tools: true },
  });
  // A tier by anything but context size, and a model without a cost, cost 알 수 없음; a word the app has no name for is dropped.
  expect((await read('deepinfra')).models['by-time']).toEqual({ price: null, input: ['text', 'file'], output: ['text'], tools: true });
  expect((await read('groq')).models).toEqual({
    'whisper-large-v3': { price: null, input: ['audio'], output: ['text'], tools: false },
    'priced-only': { price: { input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] }, input: null, output: null, tools: null },
    'embed-text': { price: { input: 0.15, output: 0, cacheRead: null, cacheWrite: null, tiers: [] }, input: ['text'], output: ['embedding'], tools: null },
  });
  expect((await t.get('models-dev?provider=poe', cookie)).status).toBe(400);
  expect(await t.env.db.prepare("SELECT name FROM models_dev WHERE list = 'github-copilot' AND model = 'gpt-5.4'").first('name')).toBe('GPT-5.4');
});

it("serves every listed provider's models, named and unpriced ones too, on one table", async () => {
  const table = (await (await t.get('models-dev/table')).json()) as PriceTable;
  expect(table.fetchedAt).toEqual(expect.any(Number));
  expect(table.models).toContainEqual({ list: 'github-copilot', model: 'claude-opus-4.7', name: expect.any(String), price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tiers: [] } });
  expect(table.models).toContainEqual(expect.objectContaining({ list: 'groq', model: 'whisper-large-v3', price: null }));
  expect(table.models.some(({ list }) => list === 'poe')).toBe(false);
});


it('serves the same cached price list to guests, behind the public per-visitor limiter', async () => {
  const previous = t.env.limits.visitors.reads;
  t.env.limits.visitors.reads = tokenBucket(1);
  try {
    const first = await t.get('models-dev?provider=groq', undefined, { [VISITOR_HEADER]: 'guest-one' });
    expect(first.status).toBe(200);
    expect((await first.json() as ModelsDevList).models).toHaveProperty('priced-only');
    expect((await t.get('models-dev?provider=groq', undefined, { [VISITOR_HEADER]: 'guest-one' })).status).toBe(429);
    const cached = await t.get('models-dev?provider=groq', undefined, { [VISITOR_HEADER]: 'guest-two', 'if-none-match': first.headers.get('etag')! });
    expect(cached.status).toBe(304);
  } finally {
    t.env.limits.visitors.reads = previous;
  }
});
