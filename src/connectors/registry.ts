import { anthropic } from './anthropic';
import { anthropicMessages } from './anthropic-messages';
import { chatCompletions } from './chat-completions';
import { chutes } from './chutes';
import { cerebras } from './cerebras';
import { copilot } from './copilot';
import { deepinfra } from './deepinfra';
import { deepseek } from './deepseek';
import { destination } from './destination';
import { readExtra, withExtra } from './extra';
import { featherless } from './featherless';
import { friendli } from './friendli';
import { gemini } from './gemini';
import { google } from './google';
import { groq } from './groq';
import { mistral } from './mistral';
import { moonshot } from './moonshot';
import { nanogpt } from './nanogpt';
import { novelai } from './novelai';
import { ollama } from './ollama';
import { openai } from './openai';
import { openRouter } from './openrouter';
import { perplexity } from './perplexity';
import { responses } from './responses';
import { surplus } from './surplus';
import { fit, settingsSchema, type Cache, type Carries, type ModelSettings, type SettingsSchema } from './settings';
import { together } from './together';
import { upstage } from './upstage';
import { vercel } from './vercel';
import { vertex } from './vertex';
import { voyage } from './voyage';
import { xai } from './xai';
import { MODELS_DEV_LISTS } from './models-dev';
import { priceCost } from './pricing';
import { carriesPictures, ConnectorError, seesPictures, type Batches, type CacheWay, type ChatMessage, type ChatRequest, type Codec, type Connection, type ConnectionType, type Cost, type EmbedPurpose, type Endpoint, type HttpRequest, type Model, type Usage } from './types';

// Adding a provider means adding its connection type here. Nothing else names one. The order is the screen's, 주요 too.
export const CONNECTION_TYPES: readonly ConnectionType[] = [
  openRouter,
  vercel,
  ollama,
  perplexity,
  groq,
  together,
  cerebras,
  deepinfra,
  nanogpt,
  surplus,
  chutes,
  featherless,
  friendli,
  openai,
  anthropic,
  google,
  vertex,
  xai,
  deepseek,
  mistral,
  moonshot,
  upstage,
  voyage,
  novelai,
  copilot,
];

export const GENERIC = 'generic';

// Keyed by any string: a stored connection or model snapshot may name a protocol that only a newer
// version of the app speaks.
const CODECS: Partial<Record<string, Codec>> = { 'chat-completions': chatCompletions, 'anthropic-messages': anthropicMessages, gemini, responses };

export type Route = { type: ConnectionType | null; endpoint: Endpoint; codec: Codec };
// The evaluation worker needs the resolved endpoint and provider policy, never credentials or a model catalog.
export type WireRoute = { provider: string | null; endpoint: Endpoint };
export const wireRoute = ({ type, endpoint }: Route): WireRoute => ({ provider: type?.id ?? null, endpoint });
export function requestRoute({ provider, endpoint }: WireRoute): Route {
  const type = provider === null ? null : CONNECTION_TYPES.find(({ id }) => id === provider)!;
  return { type, endpoint, codec: CODECS[endpoint.protocol]! };
}

export type Resolved = Route | { type: ConnectionType; endpoint: null; codec: null; models: Model[] };

// null for a type this version does not know, such as one saved by a newer version of the app, or for a secret its type
// cannot read, which only a key being added can be: a connection is saved once its model list loaded.
export function resolveConnection(connection: Connection): Resolved | null {
  if (connection.type === GENERIC) {
    const codec = connection.protocol && CODECS[connection.protocol];
    if (!connection.baseUrl || !connection.protocol || !codec) return null;
    return { type: null, endpoint: { baseUrl: connection.baseUrl, protocol: connection.protocol }, codec };
  }
  const type = CONNECTION_TYPES.find((candidate) => candidate.id === connection.type);
  if (!type) return null;
  if (type.endpointFor) {
    const endpoint = type.endpointFor(connection.accounts[0]!.secret);
    return endpoint && { type, endpoint, codec: CODECS[endpoint.protocol]! };
  }
  return type.endpoint ? { type, endpoint: type.endpoint, codec: CODECS[type.endpoint.protocol]! } : { type, endpoint: null, codec: null, models: type.models };
}

const typeForHost = (hostname: string) => CONNECTION_TYPES.find((type) => type.detect?.host === hostname);

export function resolveModel(resolved: Resolved, model: Model): Route {
  if (resolved.codec === null) throw new ConnectorError('image-only');
  const protocol = model.protocol ?? resolved.endpoint.protocol;
  if (protocol === resolved.endpoint.protocol) return resolved;
  const baseUrl = protocol !== 'unsupported' && resolved.type?.routes?.[protocol];
  const codec = CODECS[protocol];
  if (protocol === 'unsupported' || !baseUrl || !codec) throw new ConnectorError('unsupported-protocol');
  return { type: resolved.type, endpoint: { baseUrl, protocol }, codec };
}

export const catalogRequest = ({ type, codec, endpoint }: Route): HttpRequest => (type?.listModels ?? codec.listModels)(endpoint);

export function parseCatalog({ type, codec }: Route, payload: unknown): Model[] | null {
  return (type?.parseModels ?? codec.parseModels)(payload);
}

export const costUnit = (type: ConnectionType | null): Cost['unit'] => (type && MODELS_DEV_LISTS[type.id]?.credit ? 'credit' : 'usd');

// Explicit null disables embeddings; only undefined inherits the codec's.
export const embedsOf = ({ type, codec }: Route) => (type?.embeds !== undefined ? type.embeds : codec.embeds);

// The route a model's embeddings take; null where the connection serves none in the model's format.
export function embedRoute(connection: Connection, model: Model): Route | null {
  const resolved = resolveConnection(connection);
  if (!resolved?.codec) return null;
  try {
    const route = resolveModel(resolved, model);
    return embedsOf(route) ? route : null;
  } catch (error) {
    if (error instanceof ConnectorError) return null;
    throw error;
  }
}

// One request for each perRequest texts, in order; count: the texts its answer holds.
export function embedRequests(route: Route, model: Model, texts: string[], as: EmbedPurpose | null): { request: HttpRequest; count: number }[] {
  const embeds = embedsOf(route)!;
  const size = embeds.perRequest ?? texts.length;
  const fields = route.type?.embedPurpose?.(as) ?? {};
  const requests = [];
  for (let from = 0; from < texts.length; from += size) {
    const part = texts.slice(from, from + size);
    requests.push({ request: embeds.request(route.endpoint, model, part, as, fields), count: part.length });
  }
  return requests;
}

// null for a body that is not the format's embedding answer for this many texts.
export function embedAnswer(route: Route, model: Model, payload: unknown, count: number): { vectors: number[][]; usage: Usage; cost: Cost | null } | null {
  const parsed = embedsOf(route)!.parse(payload, count);
  if (!parsed) return null;
  const { vectors, usage, raw } = parsed;
  const cost = route.type?.cost?.({ facts: { rawUsage: raw, finishReason: null, id: null, tier: null, calls: [] }, usage, model }) ?? (model.price ? priceCost(model.price, usage, costUnit(route.type)) : null);
  return { vectors, usage, cost };
}

const cacheWay = ({ type, codec }: Route, model: Model): CacheWay | null => codec.cache ?? type?.cachePoints?.(model) ?? null;

function carries(route: Route, model: Model): Carries {
  const { reasoning } = route.codec.carries;
  const way = cacheWay(route, model);
  return {
    ...route.codec.carries,
    reasoning: reasoning.budget || !route.type?.reasoningBudget ? reasoning : { ...reasoning, budget: { min: null, max: null } },
    // accepted null is unknown, not refused.
    cache: way ? way.accepted : false,
    discount: route.type?.discount ? route.type.discount.accepted : false,
    pdf: route.codec.pack !== undefined,
  };
}

// null for a model this version cannot call at all.
export function modelSettings(connection: Connection, model: Model): SettingsSchema | null {
  const resolved = resolveConnection(connection);
  if (!resolved) return null;
  try {
    return settingsSchema(carries(resolveModel(resolved, model), model), model);
  } catch (error) {
    if (error instanceof ConnectorError) return null;
    throw error;
  }
}

// settings is the 묶음's as stored; the 모델 설정 screen names each change with the same fit().
// chatRequest writes it and cacheView reads it, so a forecast compares what is sent.
export function sending(route: Route, { model, messages, settings: stored, tools }: ChatRequest): ChatRequest {
  const { settings } = fit(settingsSchema(carries(route, model), model), stored);
  const roled = settings.systemAsUser ? messages.map((message) => (message.role === 'system' ? { ...message, role: 'user' as const } : message)) : inlined(route.codec.inlineSystem, messages);
  const placed = cachePoints(roled, settings.cache !== undefined);
  return { model, messages: settings.pdf && route.codec.pack ? route.codec.pack(placed, settings.pdf) : placed, settings, ...(tools?.length && { tools }) };
}

// Only the system messages before the conversation go to the API's system field, so none is sent ahead of where the
// prompt put it (design §4.4).
function inlined(prefix: string | null, messages: ChatMessage[]): ChatMessage[] {
  const start = messages.findIndex(({ role }) => role !== 'system');
  if (prefix === null || start === -1) return messages;
  return messages.map((message, index) => (index > start && message.role === 'system' ? { ...message, role: 'user', content: prefix + message.content } : message));
}

// Retry transient refusals, never bad credentials or requests (design §6.7).
export const RETRYABLE: readonly number[] = [408, 429, 500, 502, 503, 504, 520, 522, 524, 529];
export const RETRIES = 2;

export function laneBusy(route: Route, request: ChatRequest, status: number, code: string | null): boolean {
  const lane = route.type?.discount;
  return lane?.lane === 'tier' && sending(route, request).settings.discount === true && lane.busy(status, code);
}

export function batchLane(route: Route, request: ChatRequest): Batches | null {
  const lane = route.type?.discount;
  return lane?.lane === 'batch' && sending(route, request).settings.discount ? lane.batches : null;
}

// Refused here, not in sending, which cacheView shares: a forecast never refuses.
export function chatRequest(route: Route, request: ChatRequest): HttpRequest {
  const sent = sending(route, request);
  const pictures = sent.messages.some(carriesPictures);
  if (pictures && !seesPictures(sent.model)) throw new ConnectorError('no-picture-input');
  // Only a catalog's own no; most say nothing, and those are sent.
  if (sent.tools && sent.model.tools === false) throw new ConnectorError('tools-unsupported');
  const codec = codecRequest(route, sent);
  // Last, over the codec's, the discount lane's and the output limit's fields: the user's own field wins.
  const built = sent.settings.extra && codec.body ? { ...codec, body: withExtra(codec.body, readExtra(sent.settings.extra).fields) } : codec;
  return pictures && route.type?.pictureHeaders ? { ...built, headers: { ...built.headers, ...route.type.pictureHeaders } } : built;
}

function codecRequest(route: Route, sent: ChatRequest): HttpRequest {
  const { reasoning, discount } = sent.settings;
  const lane = discount ? route.type?.discount : undefined;
  const tier = lane?.lane === 'tier' ? lane : null;
  const fields = {
    ...(reasoning?.kind === 'budget' && !route.codec.carries.reasoning.budget && route.type?.reasoningBudget ? route.type.reasoningBudget(reasoning.tokens) : {}),
    ...tier?.fields,
  };
  const mark = cacheWay(route, sent.model)?.mark ?? null;
  const built = route.codec.chat(route.endpoint, sent, fields, mark);
  return tier?.headers ? { ...built, headers: { ...built.headers, ...tier.headers } } : built;
}

// cache is how long the points keep it, null when none is sent. Reasoning is there because changing it drops the cached
// messages. facts: how the provider reads the points, null where they are not known.
export type CacheView = { model: string; reasoning: ModelSettings['reasoning']; cache: Cache | null; messages: (ChatMessage & { index: number })[]; facts: CacheFacts | null };

// minimum: the fewest prompt tokens up to a point that the model caches; a point short of it caches nothing, null where
// the model's is not known. lookback: how many blocks before a point the provider looks for an earlier cache entry.
export type CacheFacts = { minimum: number | null; lookback: number };

// Anthropic's prompt caching reference (2026-10). The id names family and version as claude-opus-4-5-20251101,
// anthropic/claude-opus-4.5 (OpenRouter) or claude-sonnet-4.5 (Copilot); Haiku 3.5's as claude-3-5-haiku.
const CLAUDE_MINIMUMS: Record<string, number> = {
  ...Object.fromEntries(['opus 5.5', 'opus 5.0', 'fable 5.0', 'fable 5.1', 'mythos 5.0', 'mythos 5.1', 'sonnet 5.5', 'haiku 5.5'].map((name) => [name, 512])),
  ...Object.fromEntries(['opus 4.8', 'sonnet 5.0', 'sonnet 4.6', 'sonnet 4.5', 'opus 4.1', 'opus 4.0', 'sonnet 4.0'].map((name) => [name, 1024])),
  ...Object.fromEntries(['opus 4.7', 'haiku 3.5'].map((name) => [name, 2048])),
  ...Object.fromEntries(['opus 4.6', 'opus 4.5', 'haiku 4.5'].map((name) => [name, 4096])),
};
const CLAUDE_LOOKBACK = 20;

// Only a Claude model's points are read as Anthropic reads them; any other model's are not known.
export function claudeCacheFacts(model: string): CacheFacts | null {
  if (!/claude/i.test(model)) return null;
  const named = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[.-](\d)(?!\d))?/i.exec(model);
  const old = /claude-(\d)[.-](\d)-(haiku|sonnet|opus)/i.exec(model);
  const name = named ? `${named[1]!.toLowerCase()} ${named[2]}.${named[3] ?? 0}` : old ? `${old[3]!.toLowerCase()} ${old[1]}.${old[2]}` : null;
  return { minimum: (name === null ? null : CLAUDE_MINIMUMS[name]) ?? null, lookback: CLAUDE_LOOKBACK };
}

// A prompt_cache_key marks no point: the provider caches what prefix it finds, so the view holds none and the forecast
// reads prefixes, as for a codec without points.
export function cacheView(route: Route, request: ChatRequest): CacheView {
  const { settings, messages: sent } = sending(route, request);
  const marked = cacheWay(route, request.model)?.mark.kind;
  const messages = marked === 'key' ? sent.map(({ role, content }): ChatMessage => ({ role, content })) : sent;
  const facts = marked === 'part' || marked === 'message' ? claudeCacheFacts(request.model.id) : null;
  return { model: request.model.id, reasoning: settings.reasoning, cache: messages.some((message) => message.cache) ? settings.cache! : null, messages: messages.map((message, index) => ({ ...message, index })), facts };
}

// A request takes at most four cache points (Anthropic's limit, which OpenRouter passes on). Past that the last one
// stays, since the next turn meets it, and so do the first three, whose prefix changes least. None go without caching.
const MAX_POINTS = 4;
function cachePoints(messages: ChatMessage[], caching: boolean): ChatMessage[] {
  const points = messages.flatMap((message, index) => (message.cache ? [index] : []));
  const kept = new Set(caching ? [...points.slice(0, MAX_POINTS - 1), ...points.slice(-1)] : []);
  return messages.map((message, index) => {
    if (!message.cache || kept.has(index)) return message;
    const dropped = { ...message };
    delete dropped.cache;
    return dropped;
  });
}

export function withCredential({ type, codec }: Route, request: HttpRequest, credential: string): HttpRequest {
  return { ...request, headers: { ...request.headers, ...(type?.headers ?? codec.authHeaders)(credential) } };
}

export type Detection =
  | { kind: 'key'; type: ConnectionType; secret: string }
  | { kind: 'url'; type: ConnectionType }
  | { kind: 'generic-url'; baseUrl: string }
  | { kind: 'unknown-key'; secret: string };

export function detect(input: string): Detection | null {
  const text = input.trim();
  if (!text) return null;
  const baseUrl = normalizeBaseUrl(text);
  if (baseUrl) {
    const url = new URL(baseUrl);
    const type = typeForHost(url.hostname);
    if (type) return { kind: 'url', type };
    return { kind: 'generic-url', baseUrl };
  }
  // A key pattern is read before the rule that prose is no key: a service-account key is JSON, spaces and all.
  const type = CONNECTION_TYPES.find((candidate) => candidate.detect?.key?.test(text));
  if (type) return { kind: 'key', type, secret: text };
  return /\s/.test(text) ? null : { kind: 'unknown-key', secret: text };
}

export type Search =
  | { kind: 'key'; type: ConnectionType; secret: string }
  | { kind: 'types'; types: readonly ConnectionType[] }
  | { kind: 'address'; baseUrl: string }
  | { kind: 'none' };

// A pasted key or address is recognized first, because detect reads any single word as a key; only then is the text a
// name to look for. A key never shapes the result beyond its type, so it is not echoed back.
export function searchTypes(input: string): Search {
  const text = input.trim();
  if (!text) return { kind: 'types', types: CONNECTION_TYPES };
  const detection = detect(text);
  if (detection?.kind === 'key') return detection;
  if (detection?.kind === 'url') return { kind: 'types', types: [detection.type] };
  if (detection?.kind === 'generic-url') return { kind: 'address', baseUrl: detection.baseUrl };
  const needle = text.toLowerCase();
  const types = CONNECTION_TYPES.filter((type) => `${type.label} ${type.description}`.toLowerCase().includes(needle));
  return types.length ? { kind: 'types', types } : { kind: 'none' };
}

export function normalizeBaseUrl(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|messages|models)$/, '');
  return `${url.origin}${path}`;
}

// What keeps the relay from an address, said before the first try. local: the operator's HAZELLE_LOCAL_PROVIDERS as
// the session states them, which the relay reaches over plain http and at a private address.
export function addressProblem(baseUrl: string, local: readonly string[]): 'not-https' | 'local' | null {
  const url = new URL(baseUrl);
  if (local.includes(destination(url))) return null;
  return url.protocol !== 'https:' ? 'not-https' : isLocal(url.hostname) ? 'local' : null;
}

// Other LAN names cannot be recognized in advance and fail on first use.
// hostname is a URL's: an IPv6 address stands in brackets and an IPv4 one is four numbers, which is how the server
// tells an address from a name (server/ssrf.ts). A name that only starts like an address is a name.
function isLocal(hostname: string): boolean {
  if (hostname.startsWith('[')) return hostname === '[::1]' || /^\[f[cd][0-9a-f]{2}:/.test(hostname);
  if (/^\d+(\.\d+){3}$/.test(hostname)) return /^(127|10)\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^169\.254\./.test(hostname);
  return hostname === 'localhost' || /\.(localhost|local)$/.test(hostname);
}
