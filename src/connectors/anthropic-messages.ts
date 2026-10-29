import { failedTerminal } from './errors';
import type { Cache, Reasoning } from './settings';
import { carriesPictures, ConnectorError, type ChatMessage, type Codec, type InputPicture, type Modality, type StreamFacts, type ToolCall, type ToolResult } from './types';
import { count, isRecord, list, modelEntries, nameOf } from './values';

export const VERSION = { 'anthropic-version': '2023-06-01' };

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

const supported = (entry: unknown) => (isRecord(entry) && typeof entry.supported === 'boolean' ? entry.supported : null);

// A level alone sets effort and leaves thinking to the model's default, which is off on some models
// (Opus 4.7, 4.8) and adaptive on others (Opus 5 on); adaptive asks for thinking outright. From Opus 4.7 on, thinking
// comes back as empty text unless display asks for its summary; display changes what is shown, not what is billed.
// Copilot takes it: VS Code's Copilot Chat sends the same (microsoft/vscode, extensions/copilot/src/platform/endpoint/
// node/messagesApi.ts); not yet seen on a live Copilot call here.
function reasoningFields(reasoning: Reasoning | undefined) {
  switch (reasoning?.kind) {
    case undefined:
      return {};
    case 'off':
      return { thinking: { type: 'disabled' } };
    case 'budget':
      return { thinking: { type: 'enabled', budget_tokens: reasoning.tokens } };
    case 'level':
      return { output_config: { effort: reasoning.level } };
    case 'adaptive':
      return { thinking: { type: 'adaptive', display: 'summarized' }, ...(reasoning.level === null ? {} : { output_config: { effort: reasoning.level } }) };
  }
}

// Five minutes is the default and goes unnamed.
export const ephemeral = (cache: Cache) => ({ type: 'ephemeral', ...(cache === '1h' ? { ttl: '1h' } : {}) });
const cacheControl = (cache: Cache) => ({ cache_control: ephemeral(cache) });

const imageBlock = ({ type, data }: InputPicture) => ({ type: 'image', source: { type: 'base64', media_type: type, data } });

// Cache the carrying text block after pictures, never a separate mark. OpenRouter uses the same text block.
export function wireMessage(message: ChatMessage, cache: Cache | undefined, picture: (picture: InputPicture) => object) {
  const marked = message.cache && cache;
  if (!marked && !carriesPictures(message)) return { role: message.role, content: message.content };
  const mark = marked ? cacheControl(cache) : {};
  const pictures = (message.pictures ?? []).map(picture);
  // Pictures with no text send no text block, which Anthropic refuses empty; the cache point is then the last picture.
  if (message.content === '' && pictures.length) return { role: message.role, content: pictures.with(-1, { ...pictures.at(-1), ...mark }) };
  return { role: message.role, content: [...pictures, { type: 'text', text: message.content, ...mark }] };
}

// The API takes only an object here; arguments that are not one were already answered as unreadable.
function inputOf(text: string) {
  try {
    const input: unknown = JSON.parse(text);
    return isRecord(input) ? input : {};
  } catch {
    return {};
  }
}

const toolUse = ({ id, name, arguments: text }: ToolCall) => ({ type: 'tool_use', id, name, input: inputOf(text) });
const toolResult = ({ id, text }: ToolResult) => ({ type: 'tool_result', tool_use_id: id, content: text });
// A call made under another format carries that format's echo, which this API would refuse.
const echoOf = (call: ToolCall) => list(call.echo).filter((block): block is Record<string, unknown> => isRecord(block) && (block.type === 'thinking' || block.type === 'redacted_thinking'));

// Thinking blocks go back unchanged and in order, each run ahead of the call it came before; the first run also leads
// the text, since a turn under budget thinking must start with one. Thinking blocks take no cache mark.
function toolTurn(message: ChatMessage, cache: Cache | undefined) {
  const [first, ...later] = message.calls ?? [];
  const text = message.content === '' ? [] : [{ type: 'text', text: message.content }];
  const blocks: object[] = [
    ...(message.results ?? []).map(toolResult),
    ...(first ? echoOf(first) : []),
    ...(message.pictures ?? []).map(imageBlock),
    ...text,
    ...(first ? [toolUse(first), ...later.flatMap((call) => [...echoOf(call), toolUse(call)])] : []),
  ];
  return { role: message.role, content: message.cache && cache ? blocks.with(-1, { ...blocks.at(-1), ...cacheControl(cache) }) : blocks };
}

const wire = (message: ChatMessage, cache: Cache | undefined) => (message.calls?.length || message.results?.length ? toolTurn(message, cache) : wireMessage(message, cache, imageBlock));

type Thought = { type: string; thinking?: string; signature?: string };
// read sees one event at a time: a reply's thinking blocks wait here for the call they come before.
const held = new WeakMap<StreamFacts, Map<number, Thought>>();
function heldOf(facts: StreamFacts) {
  let thoughts = held.get(facts);
  if (!thoughts) held.set(facts, (thoughts = new Map()));
  return thoughts;
}

function called(facts: StreamFacts, block: Record<string, unknown>, at: number, text: string) {
  const thoughts = heldOf(facts);
  facts.calls.push({ id: typeof block.id === 'string' ? block.id : `call-${at}`, name: typeof block.name === 'string' ? block.name : '', arguments: text, at, ...(thoughts.size > 0 && { echo: [...thoughts.values()] }) });
  thoughts.clear();
}

// Cache-point splitting must preserve the exact blank-line-joined system text.
function systemField(system: ChatMessage[], cache: Cache | undefined) {
  if (!system.length) return {};
  if (!cache || !system.some((message) => message.cache)) return { system: system.map((message) => message.content).join('\n\n') };
  const blocks: { type: 'text'; text: string }[] = [];
  let run: string[] = [];
  system.forEach((message, index) => {
    run.push(message.content);
    if (!message.cache && index < system.length - 1) return;
    blocks.push({ type: 'text', text: `${blocks.length ? '\n\n' : ''}${run.join('\n\n')}`, ...(message.cache ? cacheControl(cache) : {}) });
    run = [];
  });
  return { system: blocks };
}

export const anthropicMessages: Codec = {
  authHeaders: (secret) => ({ 'x-api-key': secret }),

  listModels: (endpoint) => ({ url: `${endpoint.baseUrl}/models?limit=1000`, method: 'GET', headers: VERSION, body: null }),

  inlineSystem: 'System: ',

  // Models API omits tool/sampling/off controls. Zero limits mean unknown, not zero capacity.
  parseModels(payload) {
    return (
      modelEntries(payload)?.map((raw) => {
        const capabilities = isRecord(raw.capabilities) ? raw.capabilities : null;
        const input: Modality[] | null = capabilities
          ? ['text', ...(supported(capabilities.image_input) ? (['image'] as const) : []), ...(supported(capabilities.pdf_input) ? (['file'] as const) : [])]
          : null;
        const thinking = isRecord(capabilities?.thinking) ? capabilities.thinking : null;
        const types = isRecord(thinking?.types) ? thinking.types : {};
        const effort = isRecord(capabilities?.effort) ? capabilities.effort : null;
        const budget = supported(types.enabled);
        return {
          id: raw.id,
          name: nameOf(raw, 'display_name'),
          input,
          output: ['text'],
          contextLength: count(raw.max_input_tokens) || null,
          maxOutput: count(raw.max_tokens) || null,
          reasoning: supported(thinking),
          tools: null,
          protocol: null,
          takes: {
            settings: null,
            reasoning: capabilities ? {
              off: null,
              levels: effort && (effort.supported === false ? [] : LEVELS.filter((level) => supported(effort[level]))),
              budget: budget === null ? null : budget && { min: null, max: null },
              adaptive: supported(types.adaptive),
            } : null,
          },
        };
      }) ?? null
    );
  },

  carries: {
    numbers: { maxOutput: { min: 1, max: null, always: true }, temperature: { min: 0, max: 1 }, topP: { min: 0, max: 1 }, topK: { min: 0, max: null } },
    reasoning: { off: true, levels: LEVELS, least: null, budget: { min: 1024, max: null }, adaptive: true },
    stop: true,
    verbosity: false,
    serviceTier: true,
  },

  cache: { mark: { kind: 'part' }, accepted: true },

  // The Messages API requires max_tokens. With no setting and no catalog limit there is no truthful
  // number to send, so the request is refused instead of guessed.
  chat(endpoint, { model, messages, settings, tools }, fields) {
    const limit = settings.maxOutput ?? model.maxOutput;
    if (limit === null) throw new ConnectorError('max-tokens-unknown');
    return {
      url: `${endpoint.baseUrl}/messages`,
      method: 'POST',
      headers: { ...VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        max_tokens: limit,
        ...systemField(
          messages.filter((message) => message.role === 'system'),
          settings.cache,
        ),
        messages: messages.filter((message) => message.role !== 'system').map((message) => wire(message, settings.cache)),
        ...(tools ? { tools: tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })) } : {}),
        ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
        ...(settings.topP === undefined ? {} : { top_p: settings.topP }),
        ...(settings.topK === undefined ? {} : { top_k: settings.topK }),
        ...(settings.stop === undefined ? {} : { stop_sequences: settings.stop }),
        ...reasoningFields(settings.reasoning),
        ...(settings.serviceTier === undefined ? {} : { service_tier: settings.serviceTier }),
        ...fields,
        stream: settings.streaming !== false,
      }),
    };
  },

  read(event, facts, append) {
    if (!isRecord(event)) return;
    if (event.type === 'message_start' && isRecord(event.message)) {
      if (typeof event.message.id === 'string') facts.id ??= event.message.id;
      if (isRecord(event.message.usage)) Object.assign(facts.rawUsage, event.message.usage);
    } else if (event.type === 'content_block_start' && isRecord(event.content_block)) {
      const block = event.content_block;
      const at = Number(event.index);
      if (block.type === 'text' && typeof block.text === 'string') append('text', block.text);
      if (block.type === 'thinking' && typeof block.thinking === 'string') append('reasoning', block.thinking);
      if (block.type === 'thinking' || block.type === 'redacted_thinking') heldOf(facts).set(at, { ...block } as Thought);
      // The start block's input is a placeholder; the deltas carry the whole of it.
      if (block.type === 'tool_use') called(facts, block, at, '');
    } else if (event.type === 'content_block_delta' && isRecord(event.delta)) {
      const delta = event.delta;
      const at = Number(event.index);
      const thought = heldOf(facts).get(at);
      if (delta.type === 'text_delta' && typeof delta.text === 'string') append('text', delta.text);
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        append('reasoning', delta.thinking);
        if (thought) thought.thinking = (thought.thinking ?? '') + delta.thinking;
      }
      if (delta.type === 'signature_delta' && typeof delta.signature === 'string' && thought) thought.signature = (thought.signature ?? '') + delta.signature;
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const call = facts.calls.find((call) => call.at === at);
        if (call) call.arguments += delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      const call = facts.calls.find((call) => call.at === Number(event.index));
      // A tool that takes nothing may stream no input at all, and its start block said {}.
      if (call?.arguments === '') call.arguments = '{}';
    } else if (event.type === 'message_delta') {
      if (isRecord(event.delta) && typeof event.delta.stop_reason === 'string') facts.finishReason = event.delta.stop_reason;
      if (isRecord(event.usage)) Object.assign(facts.rawUsage, event.usage);
    }
  },

  terminal(event) {
    if (!isRecord(event)) return null;
    if (event.type === 'message_stop') return { state: 'completed' };
    if (event.type === 'error') return failedTerminal(event.error);
    return null;
  },

  whole(payload, facts, append) {
    const failed = anthropicMessages.terminal(payload);
    if (failed) return failed;
    if (!isRecord(payload) || payload.type !== 'message' || !Array.isArray(payload.content)) return null;
    if (typeof payload.id === 'string') facts.id = payload.id;
    for (const [at, block] of payload.content.entries()) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') append('text', block.text);
      if (block.type === 'thinking' && typeof block.thinking === 'string') append('reasoning', block.thinking);
      if (block.type === 'thinking' || block.type === 'redacted_thinking') heldOf(facts).set(at, block as Thought);
      if (block.type === 'tool_use') called(facts, block, at, isRecord(block.input) ? JSON.stringify(block.input) : '');
    }
    if (typeof payload.stop_reason === 'string') facts.finishReason = payload.stop_reason;
    if (isRecord(payload.usage)) Object.assign(facts.rawUsage, payload.usage);
    return { state: 'completed' };
  },

  truncated: (finishReason) => finishReason === 'max_tokens',
  refused: (finishReason) => finishReason === 'refusal',

  // input_tokens counts only the uncached part; cache reads and writes are added to get what was sent.
  usage(raw) {
    const uncached = count(raw.input_tokens);
    const cachedInputTokens = count(raw.cache_read_input_tokens);
    const cacheWriteInputTokens = count(raw.cache_creation_input_tokens);
    return {
      inputTokens: uncached === null ? null : uncached + (cachedInputTokens ?? 0) + (cacheWriteInputTokens ?? 0),
      cachedInputTokens,
      cacheWriteInputTokens,
      outputTokens: count(raw.output_tokens),
      reasoningTokens: null,
    };
  },
  embeds: null,
};
