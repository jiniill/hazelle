import { chatCompletions, dataUrl, openAiEmbeds, promptCacheKey } from './chat-completions';
import { failedTerminal } from './errors';
import type { Reasoning } from './settings';
import { carriesPictures, type ChatMessage, type Codec, type Phase, type StreamFacts } from './types';
import { count, isRecord, list } from './values';

// OpenAI's Responses API. 'none' turns reasoning off on the models that allow it.
function reasoningField(reasoning: Reasoning | undefined) {
  if (reasoning?.kind === 'level') return { reasoning: { effort: reasoning.level } };
  if (reasoning?.kind === 'off') return { reasoning: { effort: 'none' } };
  return {};
}

// A reply that stopped early says why in incomplete_details; a finished one has only its status.
function ended(response: Record<string, unknown>, facts: StreamFacts) {
  const details = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  const reason = typeof details.reason === 'string' ? details.reason : response.status;
  if (typeof reason === 'string') facts.finishReason = reason;
  if (typeof response.service_tier === 'string') facts.tier = response.service_tier;
  if (isRecord(response.usage)) Object.assign(facts.rawUsage, response.usage);
}

const messageItem = (message: ChatMessage) => {
  const { role, content, pictures = [] } = message;
  if (!carriesPictures(message)) return { role, content };
  return { role, content: [...pictures.map((picture) => ({ type: 'input_image', image_url: dataUrl(picture) })), ...(content === '' ? [] : [{ type: 'input_text', text: content }])] };
};

// A call goes back without its item id (fc_…): with store false the provider holds no such item, and a reasoning model
// refuses an id'd call that comes without its reasoning item. The reasoning item itself is only advice, so it is not echoed.
const inputItems = (message: ChatMessage) => {
  const { calls = [], results = [] } = message;
  const said = (calls.length === 0 && results.length === 0) || message.content !== '' || carriesPictures(message);
  return [
    ...results.map((result) => ({ type: 'function_call_output', call_id: result.id, output: result.text })),
    ...(said ? [messageItem(message)] : []),
    ...calls.map((call) => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments })),
  ];
};

function texts(parts: unknown, type: string): string[] {
  return list(parts).flatMap((part) => (isRecord(part) && part.type === type && typeof part.text === 'string' ? [part.text] : []));
}

const readCall = (item: Record<string, unknown>, at: number) => ({
  id: typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_${at}`,
  name: typeof item.name === 'string' ? item.name : '',
  arguments: typeof item.arguments === 'string' ? item.arguments : '',
  at,
});

function readItem(item: unknown, at: number, facts: StreamFacts, append: (phase: Phase, text: string) => void) {
  if (!isRecord(item)) return;
  if (item.type === 'function_call') facts.calls.push(readCall(item, at));
  if (item.type === 'reasoning') {
    const reasoning = [...texts(item.summary, 'summary_text'), ...texts(item.content, 'reasoning_text')].join('\n\n');
    if (reasoning) append('reasoning', reasoning);
  }
  if (item.type === 'message') {
    for (const text of texts(item.content, 'output_text')) append('text', text);
    for (const part of list(item.content)) if (isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string') facts.refusal = (facts.refusal ?? '') + part.refusal;
  }
}

export const responses: Codec = {
  // The format has no model list of its own; its providers serve the standard one.
  authHeaders: chatCompletions.authHeaders,
  listModels: chatCompletions.listModels,
  parseModels: chatCompletions.parseModels,

  inlineSystem: null,

  // It has no stop sequences, penalties, top_k or seed. max_output_tokens below 16 is refused.
  carries: {
    numbers: { maxOutput: { min: 16, max: null }, temperature: { min: 0, max: 2 }, topP: { min: 0, max: 1 } },
    reasoning: { off: true, levels: ['minimal', 'low', 'medium', 'high', 'xhigh'], least: null, budget: null, adaptive: false },
    stop: false,
    verbosity: true,
    serviceTier: false,
  },

  // prompt_cache_key is the format's own field, but a server that speaks it is not bound to read it.
  cache: { mark: { kind: 'key' }, accepted: null },

  chat: (endpoint, { model, messages, settings, tools }, fields) => ({
    url: `${endpoint.baseUrl}/responses`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      input: messages.flatMap(inputItems),
      // Left out, strict becomes the format's default: it rewrites the schema so every parameter is required.
      ...(tools ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters, strict: false })) } : {}),
      ...(settings.maxOutput === undefined ? {} : { max_output_tokens: settings.maxOutput }),
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      ...(settings.topP === undefined ? {} : { top_p: settings.topP }),
      ...reasoningField(settings.reasoning),
      ...(settings.verbosity === undefined ? {} : { text: { verbosity: settings.verbosity } }),
      ...(settings.cache ? promptCacheKey(model, messages) : {}),
      // The reply is kept in the chat here, not on the provider's side.
      store: false,
      ...fields,
      stream: settings.streaming !== false,
    }),
  }),

  read(event, facts, append) {
    if (!isRecord(event)) return;
    const response = isRecord(event.response) ? event.response : null;
    if (typeof response?.id === 'string' && response.id) facts.id ??= response.id;
    switch (event.type) {
      // Keyed by output_index, which every event of a call carries.
      case 'response.output_item.added':
        if (isRecord(event.item) && event.item.type === 'function_call' && typeof event.output_index === 'number') facts.calls.push(readCall(event.item, event.output_index));
        break;
      case 'response.function_call_arguments.delta': {
        const call = facts.calls.find(({ at }) => at === event.output_index);
        if (call && typeof event.delta === 'string') call.arguments += event.delta;
        break;
      }
      case 'response.output_text.delta':
        if (typeof event.delta === 'string') append('text', event.delta);
        break;
      case 'response.refusal.delta':
        if (typeof event.delta === 'string') facts.refusal = (facts.refusal ?? '') + event.delta;
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (typeof event.delta === 'string') append('reasoning', event.delta);
        break;
      // A summary comes in parts, each a paragraph of its own.
      case 'response.reasoning_summary_part.added':
        if (typeof event.summary_index === 'number' && event.summary_index > 0) append('reasoning', '\n\n');
        break;
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed':
        if (response) ended(response, facts);
    }
  },

  // An incomplete reply ended as the stream should; its reason (finishReason) says whether it was cut.
  terminal(event) {
    if (!isRecord(event)) return null;
    if (event.type === 'response.completed' || event.type === 'response.incomplete') return { state: 'completed' };
    if (event.type === 'response.failed') return failedTerminal(isRecord(event.response) ? event.response.error : null);
    if (event.type === 'error') return failedTerminal(event);
    return null;
  },

  whole(payload, facts, append) {
    if (!isRecord(payload)) return null;
    if (payload.object !== 'response') return isRecord(payload.error) ? failedTerminal(payload.error) : null;
    if (payload.status === 'failed') return failedTerminal(payload.error);
    if (typeof payload.id === 'string' && payload.id) facts.id = payload.id;
    list(payload.output).forEach((item, at) => readItem(item, at, facts, append));
    ended(payload, facts);
    return { state: 'completed' };
  },

  truncated: (finishReason) => finishReason === 'max_output_tokens',
  refused: (finishReason) => finishReason === 'content_filter',

  // Both cache reads and writes are already included in input_tokens.
  usage(raw) {
    const input = isRecord(raw.input_tokens_details) ? raw.input_tokens_details : {};
    const output = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : {};
    return {
      inputTokens: count(raw.input_tokens),
      cachedInputTokens: count(input.cached_tokens),
      cacheWriteInputTokens: count(input.cache_write_tokens),
      outputTokens: count(raw.output_tokens),
      reasoningTokens: count(output.reasoning_tokens),
    };
  },
  embeds: openAiEmbeds,
};
