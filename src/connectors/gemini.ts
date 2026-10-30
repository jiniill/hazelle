import { failedTerminal } from './errors';
import type { Reasoning } from './settings';
import { bareModel, embedUsage } from './chat-completions';
import type { ChatMessage, Codec, EmbedPurpose, InputPicture, Model, Phase, StreamFacts, Terminal, ToolCall, ToolResult } from './types';
import { packPdf, pdfData } from './gemini-pdf';
import { count, isRecord, list, vector } from './values';

// The Gemini API (generateContent), checked against ai.google.dev/api on 2026-10-04.

const LEVELS = ['minimal', 'low', 'medium', 'high'];

// A 설정 묶음 outlives its model, so a stored level the model refuses (see reasoning under carries) is carried to what
// it takes: minimal to low, which is what Google does itself, and on 2.5 any level to dynamic.
const NO_MINIMAL = /^gemini-(?:3\.1-pro|3\.[78]|4)/;
const NO_LEVEL = /^gemini-2\./;
function thinkingLevel(level: string, model: Model) {
  if (NO_LEVEL.test(model.id)) return { thinkingBudget: -1 };
  return { thinkingLevel: level === 'minimal' && NO_MINIMAL.test(model.id) ? 'low' : level };
}

// Gemini 3 uses thinkingLevel; 2.5 uses thinkingBudget (0 off, -1 dynamic); 3.1 Pro refuses off.
// Ask includeThoughts only for configured reasoning or catalog-confirmed thinkers; others may reject it.
function thinkingConfig(reasoning: Reasoning | undefined, model: Model) {
  switch (reasoning?.kind) {
    case undefined:
      return model.reasoning ? { thinkingConfig: { includeThoughts: true } } : {};
    case 'off':
      return { thinkingConfig: { thinkingBudget: 0 } };
    case 'budget':
      return { thinkingConfig: { thinkingBudget: reasoning.tokens, includeThoughts: true } };
    case 'level':
      return { thinkingConfig: { ...thinkingLevel(reasoning.level, model), includeThoughts: true } };
    case 'adaptive':
      return { thinkingConfig: { ...(reasoning.level === null ? { thinkingBudget: -1 } : thinkingLevel(reasoning.level, model)), includeThoughts: true } };
  }
}

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string }; mediaResolution?: { level: 'MEDIA_RESOLUTION_LOW' } }
  | { functionCall: { id: string; name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { id: string; name: string; response: { output: string } } };

const media = ({ type, data }: InputPicture): Part => ({ inlineData: { mimeType: type, data } });

// A PDF page's picture is what bills, and its text layer reads the same at the lowest resolution; set on the part, so
// the pictures beside it keep theirs.
const pdfPart = (transcript: string): Part => ({ inlineData: { mimeType: 'application/pdf', data: pdfData(transcript) }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } });

// Unreadable arguments go back as {}: the caller has already answered that call as unreadable.
function args(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// A signature goes back on the very part it came on (only the first of parallel calls has one); Gemini 3 refuses a
// call loop without it.
const call = ({ id, name, arguments: text, echo }: ToolCall): Part => ({ functionCall: { id, name, args: args(text) }, ...(typeof echo === 'string' && { thoughtSignature: echo }) });
const answer = ({ id, name, text }: ToolResult): Part => ({ functionResponse: { id, name, response: { output: text } } });

function parts({ content, document: packed, pictures = [], calls = [], results = [] }: ChatMessage): Part[] {
  const bare = content === '' && (pictures.length || calls.length || results.length);
  return [...results.map(answer), ...(packed === undefined ? [] : [pdfPart(packed)]), ...pictures.map(media), ...(bare ? [] : [{ text: content }]), ...calls.map(call)];
}

function contents(messages: ChatMessage[]) {
  const turns: { role: 'user' | 'model'; parts: Part[] }[] = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = turns.at(-1);
    if (last?.role === role) last.parts.push(...parts(message));
    else turns.push({ role, parts: parts(message) });
  }
  return turns;
}

// STOP and MAX_TOKENS end a reply that stands; every other reason is the provider refusing it, after any text it sent.
const STANDING = new Set(['STOP', 'MAX_TOKENS']);

// A blocked prompt has no candidate at all: nothing came, so it is a failure, not a refused reply.
function blockedPrompt(event: Record<string, unknown>): string | null {
  const feedback = isRecord(event.promptFeedback) ? event.promptFeedback : {};
  return typeof feedback.blockReason === 'string' ? feedback.blockReason : null;
}

function read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void) {
  if (!isRecord(event)) return;
  if (typeof event.responseId === 'string' && event.responseId) facts.id ??= event.responseId;
  const [candidate] = list(event.candidates);
  if (isRecord(candidate)) {
    const content = isRecord(candidate.content) ? candidate.content : {};
    for (const part of list(content.parts)) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string') append(part.thought === true ? 'reasoning' : 'text', part.text);
      // Calls arrive whole, one part each, so at is the call's position and no later chunk extends one.
      if (isRecord(part.functionCall) && typeof part.functionCall.name === 'string') {
        const at = facts.calls.length;
        const { id, name, args } = part.functionCall;
        facts.calls.push({ id: typeof id === 'string' && id ? id : `call_${at}`, name, arguments: JSON.stringify(args ?? {}), ...(typeof part.thoughtSignature === 'string' && { echo: part.thoughtSignature }), at });
      }
    }
    if (typeof candidate.finishReason === 'string') facts.finishReason = candidate.finishReason;
  }
  if (isRecord(event.usageMetadata)) {
    Object.assign(facts.rawUsage, event.usageMetadata);
    if (typeof event.usageMetadata.trafficType === 'string') facts.tier = event.usageMetadata.trafficType;
  }
}

// The stream has no end marker: it closes after the chunk that names finishReason.
function terminal(event: unknown): Terminal | null {
  if (!isRecord(event)) return null;
  if (event.error !== undefined && event.error !== null) return failedTerminal(event.error);
  const blocked = blockedPrompt(event);
  return blocked === null ? null : { state: 'failed', error: blocked };
}

const TASKS: Record<EmbedPurpose, string> = { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' };

// Gemini Embedding 2 (including preview) uses purpose prefixes, not taskType
// (ai.google.dev/gemini-api/docs/embeddings, 2026-10-20).
const PURPOSE_IN_TEXT = new Set(['gemini-embedding-2', 'gemini-embedding-2-preview']);
const PREFIXES: Record<EmbedPurpose, string> = { query: 'task: search result | query: ', document: 'title: none | text: ' };

// One text's content and purpose, as the Gemini API's batch and Vertex AI's embedContent both take them.
export function embedContent(model: Model, text: string, as: EmbedPurpose | null) {
  if (as && PURPOSE_IN_TEXT.has(model.id)) return { content: { parts: [{ text: PREFIXES[as] + text }] } };
  return { content: { parts: [{ text }] }, ...(as && { embedContentConfig: { taskType: TASKS[as] } }) };
}

export const gemini: Codec = {
  authHeaders: (secret) => ({ 'x-goog-api-key': secret }),

  // 1000 is the most one page holds; a later page (nextPageToken) is not asked for.
  listModels: (endpoint) => ({ url: `${endpoint.baseUrl}/models?pageSize=1000`, method: 'GET', headers: {}, body: null }),

  inlineSystem: 'system:',

  // Google omits default fields: absent thinking means false. Other unlisted capabilities stay unknown.
  // Supported methods distinguish embedding models from generators.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.models)) return null;
    return payload.models.flatMap((raw): Model[] => {
      if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.startsWith('models/')) return [];
      const methods = list(raw.supportedGenerationMethods);
      const chats = methods.includes('generateContent');
      const embeds = !chats && methods.includes('embedContent');
      if (!chats && !embeds) return [];
      const id = raw.name.slice('models/'.length);
      return [
        {
          ...bareModel(id),
          name: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : id,
          output: embeds ? ['embedding'] : null,
          contextLength: count(raw.inputTokenLimit) || null,
          maxOutput: count(raw.outputTokenLimit) || null,
          reasoning: raw.thinking === true,
        },
      ];
    });
  },

  carries: {
    numbers: {
      maxOutput: { min: 1, max: null },
      temperature: { min: 0, max: 2 },
      topP: { min: 0, max: 1 },
      topK: { min: 0, max: null },
      frequencyPenalty: { min: null, max: null },
      presencePenalty: { min: null, max: null },
      seed: { min: null, max: null },
    },
    // Gemini 3.7/3.8 Flash, 3.1 Pro and 4 Argon refuse minimal and every Gemini 3 takes low (Vertex AI, 2026-10-23);
    // Gemini 2.5 refuses any level.
    reasoning: { off: true, levels: LEVELS, least: 'low', budget: { min: null, max: null }, adaptive: true },
    stop: true,
    verbosity: false,
    serviceTier: false,
  },

  // Gemini caches on its own (implicit caching) or by a separately created cachedContent; it has no cache points.
  cache: null,

  pack: packPdf,

  chat(endpoint, { model, messages, settings, tools }, fields) {
    const system = messages.filter((message) => message.role === 'system');
    const config = {
      ...(settings.maxOutput === undefined ? {} : { maxOutputTokens: settings.maxOutput }),
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      ...(settings.topP === undefined ? {} : { topP: settings.topP }),
      ...(settings.topK === undefined ? {} : { topK: settings.topK }),
      ...(settings.frequencyPenalty === undefined ? {} : { frequencyPenalty: settings.frequencyPenalty }),
      ...(settings.presencePenalty === undefined ? {} : { presencePenalty: settings.presencePenalty }),
      ...(settings.seed === undefined ? {} : { seed: settings.seed }),
      ...(settings.stop === undefined ? {} : { stopSequences: settings.stop }),
      ...thinkingConfig(settings.reasoning, model),
    };
    const method = settings.streaming === false ? 'generateContent' : 'streamGenerateContent?alt=sse';
    return {
      url: `${endpoint.baseUrl}/models/${model.id}:${method}`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(system.length ? { systemInstruction: { parts: [{ text: system.map((message) => message.content).join('\n\n') }] } } : {}),
        contents: contents(messages.filter((message) => message.role !== 'system')),
        ...(Object.keys(config).length ? { generationConfig: config } : {}),
        ...(tools && { tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }] }),
        ...fields,
      }),
    };
  },

  read,

  terminal,

  whole(payload, facts, append) {
    if (!isRecord(payload)) return null;
    const failed = terminal(payload);
    if (failed) return failed;
    if (!Array.isArray(payload.candidates)) return null;
    read(payload, facts, append);
    return { state: 'completed' };
  },

  truncated: (finishReason) => finishReason === 'MAX_TOKENS',
  refused: (finishReason) => !STANDING.has(finishReason),

  // promptTokenCount already holds the cached part. candidatesTokenCount leaves thoughts out, and a count at zero is
  // left out of the JSON, so a missing thoughts count adds nothing.
  usage(raw) {
    const candidates = count(raw.candidatesTokenCount);
    const thoughts = count(raw.thoughtsTokenCount);
    return {
      inputTokens: count(raw.promptTokenCount),
      cachedInputTokens: count(raw.cachedContentTokenCount),
      cacheWriteInputTokens: null,
      outputTokens: candidates === null && thoughts === null ? null : (candidates ?? 0) + (thoughts ?? 0),
      reasoningTokens: thoughts,
    };
  },
  embeds: {
    perRequest: null,
    request: (endpoint, model, texts, as, fields) => ({
      url: `${endpoint.baseUrl}/models/${model.id}:batchEmbedContents`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({ model: `models/${model.id}`, ...embedContent(model, text, as) })),
        ...fields,
      }),
    }),
    parse(payload, expected) {
      if (!isRecord(payload) || !Array.isArray(payload.embeddings) || payload.embeddings.length !== expected) return null;
      const vectors = payload.embeddings.map((embedding) => (isRecord(embedding) && vector(embedding.values) ? embedding.values : null));
      if (vectors.some((values) => values === null)) return null;
      const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : {};
      return { vectors: vectors as number[][], usage: embedUsage(count(usage.promptTokenCount)), raw: usage };
    },
  },
};
