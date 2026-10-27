import { describe, expect, it } from 'vitest';
import copilotModels from './fixtures/copilot-models.json';
import openRouterModels from './fixtures/openrouter-models.json';
import vercelModels from './fixtures/vercel-models.json';
import { bareModel } from './chat-completions';
import { cacheView, chatRequest, modelSettings, parseCatalog, resolveConnection, resolveModel, type Route } from './registry';
import { readExtra } from './extra';
import { fit, leastReasoning, type ModelSettings } from './settings';
import type { ChatMessage, Connection, Model } from './types';

const connection = (type: string, extra: Partial<Connection> = {}): Connection => ({ type, label: type, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [], ...extra });
const generic = connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions' });
const bare = bareModel('m');

function listed(type: string, payload: unknown, id: string): Model {
  return parseCatalog(resolveConnection(connection(type)) as Route, payload)!.find((model) => model.id === id)!;
}

function body(on: Connection, model: Model, settings: ModelSettings) {
  const route = resolveModel(resolveConnection(on)!, model);
  const messages = [
    { role: 'system' as const, content: '짧게 답해.' },
    { role: 'user' as const, content: '안녕' },
  ];
  return JSON.parse(chatRequest(route, { model, messages, settings }).body!) as Record<string, unknown>;
}

describe('what a model takes', () => {
  it('reads OpenRouter’s parameter list and reasoning controls', () => {
    const schema = modelSettings(connection('openrouter'), listed('openrouter', openRouterModels, 'anthropic/claude-opus-5.5'))!;
    expect(schema.numbers).toMatchObject({
      maxOutput: { accepted: true, min: 1, max: 128_000, whole: true },
      temperature: { accepted: true, min: 0, max: 2 },
      topP: { accepted: false },
      seed: { accepted: false },
    });
    expect(schema.stop).toBe(true);
    // Its catalog does not say whether a budget works; adaptive thinking has no field in this format.
    expect(schema.reasoning).toMatchObject({ off: false, level: true, levels: ['max', 'xhigh', 'high', 'medium', 'low'], budget: { accepted: null }, adaptive: false });
  });

  it('reads Vercel’s, where a model without reasoning takes none of its controls', () => {
    const fable = modelSettings(connection('vercel'), listed('vercel', vercelModels, 'anthropic/claude-fable-5'))!;
    expect(fable.numbers.temperature.accepted).toBe(false);
    expect(fable.reasoning).toMatchObject({ off: true, level: true, budget: { accepted: true, min: 1, max: null }, adaptive: false });
    const qwen = modelSettings(connection('vercel'), listed('vercel', vercelModels, 'alibaba/qwen3-coder'))!;
    expect(qwen.numbers.temperature.accepted).toBe(true);
    expect(qwen.reasoning).toMatchObject({ off: false, level: false, budget: { accepted: false }, adaptive: false });
  });

  it('leaves sampling unknown where the catalog does not list it, and false where the protocol cannot carry it', () => {
    const claude = modelSettings(connection('copilot'), listed('copilot', copilotModels, 'claude-opus-4.6'))!;
    expect(claude.numbers).toMatchObject({
      maxOutput: { accepted: true, max: 64000 },
      temperature: { accepted: null, min: 0, max: 1 },
      frequencyPenalty: { accepted: false },
    });
    expect(claude.reasoning).toMatchObject({ level: null, levels: ['low', 'medium', 'high', 'xhigh', 'max'], budget: { accepted: true, min: 1024, max: 32000 }, adaptive: true });
    const mini = modelSettings(connection('copilot'), listed('copilot', copilotModels, 'gpt-5-mini'))!;
    expect(mini.reasoning).toMatchObject({ level: true, levels: ['low', 'medium', 'high'], budget: { accepted: false }, adaptive: false });
    expect(modelSettings(connection('copilot'), listed('copilot', copilotModels, 'realtime-only'))).toBeNull();
  });

  it('knows nothing of a model on a connection the user described, beyond what its protocol cannot carry', () => {
    const schema = modelSettings(generic, bare)!;
    expect(Object.values(schema.numbers).map((rule) => rule.accepted)).toEqual(Array(9).fill(null));
    expect(schema).toMatchObject({ stop: null, reasoning: { off: null, level: null, budget: { accepted: false }, adaptive: false }, prefill: null });
    const anthropic = modelSettings(connection('generic', { baseUrl: 'https://api.example.com/v1', protocol: 'anthropic-messages' }), bare)!;
    expect(anthropic.numbers).toMatchObject({ maxOutput: { accepted: true }, temperature: { accepted: null }, seed: { accepted: false } });
  });
});

describe('생각 줄이기', () => {
  it('asks for the least thinking a model is known to take, whatever order its catalog lists levels in', () => {
  const schema = modelSettings(connection('openrouter'), listed('openrouter', openRouterModels, 'anthropic/claude-opus-5.5'))!;
  expect(leastReasoning(schema)).toEqual({ kind: 'level', level: 'low' });
  expect(leastReasoning({ ...schema, reasoning: { ...schema.reasoning, off: true } })).toEqual({ kind: 'off' });
  expect(leastReasoning({ ...schema, reasoning: { ...schema.reasoning, level: false, budget: { accepted: true, min: 1024, max: null, whole: true } } })).toEqual({ kind: 'budget', tokens: 1024 });
  expect(leastReasoning({ ...schema, reasoning: { ...schema.reasoning, level: false } })).toBeNull();
  });

  it('asks a model its catalog is silent on for the least level its whole format takes, and leaves the level alone where the format names none', () => {
    expect(leastReasoning(modelSettings(connection('google'), bare)!)).toEqual({ kind: 'level', level: 'low' });
    expect(leastReasoning(modelSettings(generic, bare)!)).toBeNull();
  });
});

describe('what a request carries', () => {
  it('sends set values in the chat format’s own fields, and nothing for what is unset', () => {
    const settings: ModelSettings = { temperature: 0.8, topK: 40, seed: 7, stop: ['\n\n'], reasoning: { kind: 'level', level: 'high' }, systemAsUser: true, context: 100_000 };
    expect(body(generic, bare, settings)).toEqual({
      model: 'm',
      messages: [
        { role: 'user', content: '짧게 답해.' },
        { role: 'user', content: '안녕' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.8,
      top_k: 40,
      seed: 7,
      stop: ['\n\n'],
      reasoning_effort: 'high',
    });
    expect(body(generic, bare, { reasoning: { kind: 'off' } })).toMatchObject({ reasoning_effort: 'none' });
  });

  it('asks a gateway for a reasoning budget in its own field', () => {
    expect(body(connection('openrouter'), bare, { reasoning: { kind: 'budget', tokens: 2000 } })).toMatchObject({ reasoning: { max_tokens: 2000 } });
  });

  it('carries the user’s Risu preset to a Claude model on Copilot as the Messages format asks', () => {
    const claude = listed('copilot', copilotModels, 'claude-opus-4.6');
    const preset: ModelSettings = { maxOutput: 6000, temperature: 1, context: 200_000, reasoning: { kind: 'adaptive', level: 'high' }, systemAsUser: true };
    expect(body(connection('copilot'), claude, preset)).toEqual({
      model: 'claude-opus-4.6',
      max_tokens: 6000,
      messages: [
        { role: 'user', content: '짧게 답해.' },
        { role: 'user', content: '안녕' },
      ],
      temperature: 1,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      stream: true,
    });
    expect(body(connection('copilot'), claude, { reasoning: { kind: 'budget', tokens: 4096 } })).toMatchObject({ max_tokens: 64000, thinking: { type: 'enabled', budget_tokens: 4096 } });
  });

  it('sends verbosity and the service tier only in the formats that carry them', () => {
    const claude = listed('copilot', copilotModels, 'claude-opus-4.6');
    const chosen: ModelSettings = { verbosity: 'low', serviceTier: 'standard_only' };
    expect(body(generic, bare, chosen)).toMatchObject({ verbosity: 'low' });
    expect(body(generic, bare, chosen)).not.toHaveProperty('service_tier');
    expect(fit(modelSettings(generic, bare)!, chosen).changes).toEqual([{ setting: 'serviceTier', change: 'left-out' }]);
    expect(body(connection('copilot'), claude, chosen)).toMatchObject({ service_tier: 'standard_only' });
    expect(body(connection('copilot'), claude, chosen)).not.toHaveProperty('verbosity');
    expect(modelSettings(connection('copilot'), claude)).toMatchObject({ verbosity: false, serviceTier: null });
  });

  it('leaves out what the model does not take and brings a value past its bounds within them, and names each', () => {
    const claude = listed('copilot', copilotModels, 'claude-opus-4.6');
    const fitted: ModelSettings = { frequencyPenalty: 0.5, temperature: 1.5, context: 10_000_000, reasoning: { kind: 'budget', tokens: 50_000 } };
    expect(fit(modelSettings(connection('copilot'), claude)!, fitted).changes).toEqual([
      { setting: 'temperature', change: 'capped', to: 1 },
      { setting: 'frequencyPenalty', change: 'left-out' },
      { setting: 'context', change: 'capped', to: claude.contextLength },
      { setting: 'reasoning', change: 'capped', to: 32_000 },
    ]);
    const sent = body(connection('copilot'), claude, fitted);
    expect(sent).toMatchObject({ temperature: 1, thinking: { type: 'enabled', budget_tokens: 32_000 } });
    expect(sent).not.toHaveProperty('frequency_penalty');
  });
});

describe('cache points', () => {
  const claude: Model = { ...bare, id: 'claude-opus-5-5', maxOutput: 64_000 };
  const marked: ChatMessage[] = [
    { role: 'system', content: 'Rules.', cache: true },
    { role: 'system', content: 'Lore.' },
    { role: 'user', content: 'Hi.', cache: true },
    { role: 'assistant', content: 'Hello.' },
  ];
  const sent = (on: Connection, settings: ModelSettings, messages = marked) =>
    JSON.parse(chatRequest(resolveModel(resolveConnection(on)!, claude), { model: claude, messages, settings }).body!) as Record<string, unknown>;

  it('splits the Messages format’s system after a point and marks the message, and sends neither the mark nor a split without caching', () => {
    expect(sent(connection('anthropic'), { cache: '1h' })).toMatchObject({
      system: [
        { type: 'text', text: 'Rules.', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: '\n\nLore.' },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hi.', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
        { role: 'assistant', content: 'Hello.' },
      ],
    });
    const off = sent(connection('anthropic'), {});
    expect(off).toMatchObject({ system: 'Rules.\n\nLore.', messages: [{ role: 'user', content: 'Hi.' }, { role: 'assistant', content: 'Hello.' }] });
    expect(JSON.stringify(off)).not.toMatch(/cache/);
  });

  it('marks OpenRouter’s text parts, and leaves caching out on a connection the user described', () => {
    expect(sent(connection('openrouter'), { cache: '5m' }).messages).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'Rules.', cache_control: { type: 'ephemeral' } }] },
      { role: 'system', content: 'Lore.' },
      { role: 'user', content: [{ type: 'text', text: 'Hi.', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: 'Hello.' },
    ]);
    expect(fit(modelSettings(generic, claude)!, { cache: '5m' }).changes).toEqual([{ setting: 'cache', change: 'left-out' }]);
    expect(JSON.stringify(sent(generic, { cache: '5m' }))).not.toMatch(/cache/);
  });

  it('marks Copilot’s chat completions as its catalog’s vendor asks, unconfirmed either way', () => {
    const copilot = connection('copilot');
    const request = (model: Model) => JSON.parse(chatRequest(resolveModel(resolveConnection(copilot)!, model), { model, messages: marked, settings: { cache: '5m' } }).body!) as Record<string, unknown>;
    const gemini = listed('copilot', copilotModels, 'gemini-3-pro');
    expect(request(gemini).messages).toEqual([
      { role: 'system', content: 'Rules.', copilot_cache_control: { type: 'ephemeral' } },
      { role: 'system', content: 'Lore.' },
      { role: 'user', content: 'Hi.', copilot_cache_control: { type: 'ephemeral' } },
      { role: 'assistant', content: 'Hello.' },
    ]);
    expect(modelSettings(copilot, gemini)!.cache).toBeNull();

    const gpt = listed('copilot', copilotModels, 'gpt-4.1');
    const keyed = request(gpt);
    expect(keyed).toMatchObject({ prompt_cache_key: expect.stringMatching(/^hazelle-/) });
    expect(JSON.stringify(keyed.messages)).not.toMatch(/cache/);
    // A key marks no point, so the view forecasts nothing.
    const route = resolveModel(resolveConnection(copilot)!, gpt);
    const view = cacheView(route, { model: gpt, messages: marked, settings: { cache: '5m' } });
    expect(view.cache).toBeNull();
    expect(view.messages.some((message) => message.cache)).toBe(false);

    const unnamed: Model = { ...gemini, vendor: undefined };
    expect(request(unnamed).messages).toEqual(request(gemini).messages);
  });

  it('keeps the first three points and the last when there are more than four', () => {
    const many = Array.from({ length: 6 }, (_, index): ChatMessage => ({ role: index % 2 ? 'assistant' : 'user', content: `${index}`, cache: true }));
    const points = (sent(connection('anthropic'), { cache: '5m' }, many).messages as { content: unknown }[]).map(({ content }) => typeof content !== 'string');
    expect(points).toEqual([true, true, true, false, false, true]);
  });
});

describe('PDF로 보내기', () => {
  it('is offered on Gemini where the catalog lists file input or says nothing, and left out elsewhere', () => {
    const google = connection('google');
    expect(modelSettings(google, { ...bare, input: ['text', 'file'] })!.pdf).toBe(true);
    expect(modelSettings(google, bare)!.pdf).toBeNull();
    expect(fit(modelSettings(google, { ...bare, input: ['text'] })!, { pdf: { keep: 'system', recent: 20 } }).changes).toEqual([{ setting: 'pdf', change: 'left-out' }]);
    expect(modelSettings(generic, bare)!.pdf).toBe(false);
  });
});

describe('할인 받기', () => {
  it('asks OpenAI for flex only when switched on, and is not offered where the type has no lane', () => {
    expect(body(connection('openai'), bare, { discount: true, maxOutput: 100 })).toMatchObject({ service_tier: 'flex' });
    expect(body(connection('openai'), bare, {})).not.toHaveProperty('service_tier');
    expect(modelSettings(connection('openai'), bare)!.discount).toBeNull();
    expect(modelSettings(generic, bare)!.discount).toBe(false);
    expect(body(generic, bare, { discount: true })).not.toHaveProperty('service_tier');
    expect(fit(modelSettings(generic, bare)!, { discount: true }).changes).toEqual([{ setting: 'discount', change: 'left-out' }]);
  });
});

describe('추가 파라미터', () => {
  it('writes Risu’s lines or a JSON object over the built body last, and leaves out only the lines it cannot read', () => {
    const gemini = connection('google');
    const lines = 'safetySettings=json::[{"category":"HARM_CATEGORY_JAILBREAK","threshold":"OFF"}]\ngenerationConfig.topA=0.1\nname="1"\nlogprobs=true\ngenerationConfig.maxOutputTokens={{none}}\nheader::X-Key=1\nbroken';
    const sent = body(gemini, bare, { maxOutput: 100, temperature: 0.5, extra: lines });
    expect(sent).toMatchObject({ safetySettings: [{ category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' }], generationConfig: { temperature: 0.5, topA: 0.1 }, name: '1', logprobs: true });
    expect(sent.generationConfig).not.toHaveProperty('maxOutputTokens');
    expect(readExtra(lines).problems).toEqual([{ line: 6, kind: 'header' }, { line: 7, kind: 'unreadable' }]);
    expect(body(generic, bare, { maxOutput: 100, extra: '{ "max_tokens": 200, "reasoning.effort": "low" }' })).toMatchObject({ max_tokens: 200, reasoning: { effort: 'low' } });
    expect(readExtra('{ "max_tokens": ').problems).toEqual([{ line: 1, kind: 'unreadable' }]);
  });
});
