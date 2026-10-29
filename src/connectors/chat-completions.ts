import { failedTerminal } from './errors';
import type { Cache, NumberSetting, Reasoning, Setting } from './settings';
import { ephemeral, wireMessage } from './anthropic-messages';
import { carriesPictures, type CacheMark, type ChatMessage, type Codec, type Embeds, type InputPicture, type Model, type Phase, type StreamFacts, type ToolCall, type ToolDef, type Usage } from './types';
import { count, isRecord, list, modelEntries, vector } from './values';

// max_tokens, not max_completion_tokens: compatible servers take it.
// OpenRouter/Vercel supported_parameters use these same field names.
const FIELDS: Record<NumberSetting | 'stop', string> = {
  maxOutput: 'max_tokens',
  temperature: 'temperature',
  topP: 'top_p',
  topK: 'top_k',
  frequencyPenalty: 'frequency_penalty',
  presencePenalty: 'presence_penalty',
  repetitionPenalty: 'repetition_penalty',
  minP: 'min_p',
  seed: 'seed',
  stop: 'stop',
};
const CARRIED = Object.keys(FIELDS) as (keyof typeof FIELDS)[];

export const bareModel = (id: string): Model => ({
  id,
  name: id,
  input: null,
  output: null,
  contextLength: null,
  maxOutput: null,
  reasoning: null,
  tools: null,
  protocol: null,
  takes: { settings: null, reasoning: null },
});

export function listedSettings(names: unknown[]): Setting[] {
  const settings: Setting[] = CARRIED.filter((setting) => names.includes(FIELDS[setting]));
  if (names.includes('verbosity')) settings.push('verbosity');
  return names.includes('reasoning') || names.includes('reasoning_effort') ? [...settings, 'reasoning'] : settings;
}

// Hash model + prefix through the first cache point, not the moving last point.
// Include pictures only when present so text-only keys stay unchanged.
export function promptCacheKey(model: Model, messages: ChatMessage[]): { prompt_cache_key?: string } {
  const first = messages.findIndex((message) => message.cache);
  if (first === -1) return {};
  const prefix = messages.slice(0, first + 1).map((message) => [message.role, message.content, ...(carriesPictures(message) ? [message.pictures] : [])]);
  let hash = 2166136261;
  for (const character of JSON.stringify([model.id, prefix])) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return { prompt_cache_key: `hazelle-${(hash >>> 0).toString(16)}` };
}

export const dataUrl = ({ type, data }: InputPicture) => `data:${type};base64,${data}`;
const imagePart = (picture: InputPicture) => ({ type: 'image_url', image_url: { url: dataUrl(picture) } });

const plain = (message: ChatMessage) => wireMessage(message, undefined, imagePart);

function wired(message: ChatMessage, cache: Cache | undefined, mark: CacheMark | null) {
  if (!cache || !mark || mark.kind === 'key') return plain(message);
  if (mark.kind === 'part') return wireMessage(message, cache, imagePart);
  return message.cache ? { ...plain(message), [mark.field]: ephemeral(cache) } : plain(message);
}

const wireCall = ({ id, name, arguments: text }: ToolCall) => ({ id, type: 'function', function: { name, arguments: text } });

// Results are messages of their own, ahead of the user's text, which goes only when there is some.
function wireMessages(messages: ChatMessage[], cache: Cache | undefined, mark: CacheMark | null) {
  return messages.flatMap((message): object[] => {
    const built = wired(message, cache, mark);
    if (message.calls?.length) {
      const echo = message.calls[0]!.echo;
      return [{ ...built, ...(message.content === '' && { content: null }), tool_calls: message.calls.map(wireCall), ...(isRecord(echo) && Object.fromEntries(REASONING.flatMap((field) => (typeof echo[field] === 'string' ? [[field, echo[field]]] : [])))) }];
    }
    if (!message.results?.length) return [built];
    const results = message.results.map(({ id, text }) => ({ role: 'tool', tool_call_id: id, content: text }));
    return message.content === '' && !carriesPictures(message) ? results : [...results, built];
  });
}

const wireTool = ({ name, description, parameters }: ToolDef) => ({ type: 'function', function: { name, description, parameters } });

// OpenAI's reasoning_effort, which OpenRouter and Vercel take too; 'none' turns reasoning off.
function effort(reasoning: Reasoning | undefined) {
  if (reasoning?.kind === 'level') return { reasoning_effort: reasoning.level };
  if (reasoning?.kind === 'off') return { reasoning_effort: 'none' };
  return {};
}

// reasoning_content (DeepSeek and others), reasoning (OpenRouter) and reasoning_text (Copilot's Claude and Gemini)
// are the spellings of reasoning text in a delta or a message; a provider sends one of them.
const REASONING = ['reasoning_content', 'reasoning', 'reasoning_text'];

// The reply's reasoning so far, under the field it came in. DeepSeek refuses a tool loop whose assistant turn lost its
// reasoning_content, so the first call echoes it back. It is shared by reference: reasoning read after that call
// lands in its echo too.
const reasoned = new WeakMap<StreamFacts, Record<string, string>>();

function reason(part: Record<string, unknown>, facts: StreamFacts, append: (phase: Phase, text: string) => void) {
  const field = REASONING.find((name) => typeof part[name] === 'string' && part[name]);
  if (field === undefined) return;
  const text = part[field] as string;
  append('reasoning', text);
  const kept = reasoned.get(facts) ?? {};
  kept[field] = (kept[field] ?? '') + text;
  reasoned.set(facts, kept);
  const first = facts.calls[0];
  if (first) first.echo ??= kept;
}

// A streamed part names its call by index; one without an index is read as a whole call of its own.
function readCall(part: unknown, facts: StreamFacts, position?: number) {
  if (!isRecord(part)) return;
  const at = position ?? (typeof part.index === 'number' ? part.index : facts.calls.length);
  const named = isRecord(part.function) ? part.function : {};
  let call = facts.calls.find((known) => known.at === at);
  if (!call) {
    const kept = facts.calls.length ? undefined : reasoned.get(facts);
    call = { at, id: typeof part.id === 'string' && part.id ? part.id : `call_${at}`, name: '', arguments: '', ...(kept && { echo: kept }) };
    facts.calls.push(call);
  }
  if (typeof named.name === 'string') call.name ||= named.name;
  if (typeof named.arguments === 'string') call.arguments += named.arguments;
}

// An embedding writes nothing, so its output is a measured zero: a price-list cost can be worked out from the input.
export const embedUsage = (inputTokens: number | null): Usage => ({ inputTokens, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 0, reasoningTokens: null });

// OpenAI's /embeddings, which the responses format shares. Voyage states only total_tokens, which for an embedding is all
// input.
export const openAiEmbeds: Embeds = {
  perRequest: null,
  request: (endpoint, model, texts, _as, fields) => ({
    url: `${endpoint.baseUrl}/embeddings`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.id, input: texts, ...fields }),
  }),
  parse(payload, expected) {
    if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length !== expected) return null;
    const vectors: number[][] = [];
    for (const item of payload.data) {
      if (!isRecord(item) || !vector(item.embedding) || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0 || item.index >= expected || vectors[item.index]) return null;
      vectors[item.index] = item.embedding;
    }
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return { vectors, usage: embedUsage(count(usage.prompt_tokens) ?? count(usage.total_tokens)), raw: usage };
  },
};

export const chatCompletions: Codec = {
  authHeaders: (secret): Record<string, string> => (secret ? { authorization: `Bearer ${secret}` } : {}),

  listModels: (endpoint) => ({ url: `${endpoint.baseUrl}/models`, method: 'GET', headers: {}, body: null }),

  inlineSystem: null,

  // The standard list names models and nothing else, so every capability stays unknown.
  parseModels: (payload) => modelEntries(payload)?.map(({ id }) => bareModel(id)) ?? null,

  // top_k, min_p and repetition_penalty are not OpenAI's, but vLLM and OpenRouter take them.
  carries: {
    numbers: {
      maxOutput: { min: 1, max: null },
      temperature: { min: 0, max: 2 },
      topP: { min: 0, max: 1 },
      topK: { min: 0, max: null },
      frequencyPenalty: { min: -2, max: 2 },
      presencePenalty: { min: -2, max: 2 },
      repetitionPenalty: { min: 0, max: 2 },
      minP: { min: 0, max: 1 },
      seed: { min: null, max: null },
    },
    reasoning: { off: true, levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], least: null, budget: null, adaptive: false },
    stop: true,
    verbosity: true,
    serviceTier: false,
  },

  // The standard has no cache points; a connection type whose provider takes them says how (cachePoints).
  cache: null,

  chat: (endpoint, { model, messages, settings, tools }, fields, mark) => ({
    url: `${endpoint.baseUrl}/chat/completions`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      messages: wireMessages(messages, settings.cache, mark),
      ...(tools && { tools: tools.map(wireTool) }),
      // OpenAI refuses stream_options on a request that does not stream.
      ...(settings.streaming === false ? { stream: false } : { stream: true, stream_options: { include_usage: true } }),
      ...Object.fromEntries(CARRIED.filter((setting) => settings[setting] !== undefined).map((setting) => [FIELDS[setting], settings[setting]])),
      ...effort(settings.reasoning),
      ...(settings.verbosity === undefined ? {} : { verbosity: settings.verbosity }),
      ...(mark?.kind === 'key' && settings.cache ? promptCacheKey(model, messages) : {}),
      ...fields,
    }),
  }),

  read(event, facts, append) {
    if (!isRecord(event)) return;
    if (typeof event.id === 'string' && event.id) facts.id ??= event.id;
    if (typeof event.service_tier === 'string') facts.tier = event.service_tier;
    for (const choice of list(event.choices)) {
      if (!isRecord(choice)) continue;
      const delta = isRecord(choice.delta) ? choice.delta : {};
      reason(delta, facts, append);
      if (typeof delta.content === 'string') append('text', delta.content);
      for (const part of list(delta.tool_calls)) readCall(part, facts);
      if (typeof choice.finish_reason === 'string') facts.finishReason = choice.finish_reason;
    }
    if (isRecord(event.usage)) Object.assign(facts.rawUsage, event.usage);
  },

  terminal(event) {
    if (event === '[DONE]') return { state: 'completed' };
    if (isRecord(event) && event.error !== undefined && event.error !== null) return failedTerminal(event.error);
    return null;
  },

  whole(payload, facts, append) {
    const failed = chatCompletions.terminal(payload);
    if (failed) return failed;
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
    if (typeof payload.id === 'string' && payload.id) facts.id = payload.id;
    if (typeof payload.service_tier === 'string') facts.tier = payload.service_tier;
    const [choice] = payload.choices;
    if (isRecord(choice)) {
      const message = isRecord(choice.message) ? choice.message : {};
      reason(message, facts, append);
      if (typeof message.content === 'string') append('text', message.content);
      list(message.tool_calls).forEach((part, position) => readCall(part, facts, position));
      if (typeof choice.finish_reason === 'string') facts.finishReason = choice.finish_reason;
    }
    if (isRecord(payload.usage)) Object.assign(facts.rawUsage, payload.usage);
    return { state: 'completed' };
  },

  truncated: (finishReason) => finishReason === 'length',
  refused: (finishReason) => finishReason === 'content_filter',

  usage(raw) {
    const prompt = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
    const completion = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
    return {
      inputTokens: count(raw.prompt_tokens),
      cachedInputTokens: count(prompt.cached_tokens),
      cacheWriteInputTokens: count(prompt.cache_write_tokens),
      outputTokens: count(raw.completion_tokens),
      reasoningTokens: count(completion.reasoning_tokens),
    };
  },
  embeds: openAiEmbeds,
};
