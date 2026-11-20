import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import openRouterKey from '../../connectors/fixtures/openrouter-key.json';
import { openRouter, openRouterModels } from '../../connectors/openrouter';
import { isFree } from '../../connectors/pricing';
import { png, stubPage } from '../testing';
import { connectTrial, freeAllowance, openTrial, talkableModels } from './trial';

afterEach(() => vi.unstubAllGlobals());

const row = (id: string, prompt: string, completion: string, output = ['text']) => ({ id, name: id, architecture: { input_modalities: ['text'], output_modalities: output }, pricing: { prompt, completion } });

it("leads with the models the catalog prices at nothing, whatever their names, in the catalog's order", () => {
  // OpenRouter's own rows, 2026-11-19: a free one's prices are "0", a router's "-1"; a free music model answers no chat.
  const models = openRouterModels({ data: [row('maker/paid', '0.000003', '0.000015'), row('maker/first:free', '0', '0'), row('openrouter/auto', '-1', '-1'), row('maker/unnamed', '0', '0'), row('maker/song', '0', '0', ['audio'])] })!;
  expect(talkableModels(models).map(({ id }) => [id, isFree(models.find((model) => model.id === id)!)])).toEqual([['maker/first:free', true], ['maker/unnamed', true], ['maker/paid', false], ['openrouter/auto', false]]);
});

it('reads what the free models may still ask from the page, straight from OpenRouter, and nothing when that read fails', async () => {
  vi.stubGlobal('window', new EventTarget());
  stubPage('hidden');
  const asked: string[] = [];
  let reachable = true;
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    if (url === 'https://openrouter.ai/api/v1/key') {
      if (!reachable) throw new TypeError('Failed to fetch');
      return Response.json(openRouterKey);
    }
    if (url.startsWith('https://openrouter.ai/')) return Response.json({ data: [row('maker/first:free', '0', '0')] });
    return new Response(null, { status: 404 });
  });
  const leaving = new AbortController();
  const opened = await openTrial(leaving.signal, false, { name: '아린', description: '', greeting: '', picture: async () => png() });
  if (!opened.ok) throw new Error(opened.error);
  try {
    const connected = await connectTrial(opened.data, openRouter, 'sk-or-v1-x', leaving.signal);
    if (!connected.ok) throw new Error(connected.failure.kind);
    expect(await freeAllowance(opened.data, connected.id, false)).toEqual({ kind: 'left', label: '무료 모델 요청', unit: 'requests', amount: 38, limit: 50, resets: 'daily', free: true });
    expect(asked).toContain('https://openrouter.ai/api/v1/key');
    reachable = false;
    expect(await freeAllowance(opened.data, connected.id, true)).toBeNull();
  } finally {
    leaving.abort();
    opened.data.close();
  }
});
