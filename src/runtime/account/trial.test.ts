import { expect, it } from 'vitest';
import { openRouterModels } from '../../connectors/openrouter';
import { isFree } from '../../connectors/pricing';
import { talkableModels } from './trial';

const row = (id: string, prompt: string, completion: string, output = ['text']) => ({ id, name: id, architecture: { input_modalities: ['text'], output_modalities: output }, pricing: { prompt, completion } });

it("leads with the models the catalog prices at nothing, whatever their names, in the catalog's order", () => {
  // OpenRouter's own rows, 2026-11-19: a free one's prices are "0", a router's "-1"; a free music model answers no chat.
  const models = openRouterModels({ data: [row('maker/paid', '0.000003', '0.000015'), row('maker/first:free', '0', '0'), row('openrouter/auto', '-1', '-1'), row('maker/unnamed', '0', '0'), row('maker/song', '0', '0', ['audio'])] })!;
  expect(talkableModels(models).map(({ id }) => [id, isFree(models.find((model) => model.id === id)!)])).toEqual([['maker/first:free', true], ['maker/unnamed', true], ['maker/paid', false], ['openrouter/auto', false]]);
});
