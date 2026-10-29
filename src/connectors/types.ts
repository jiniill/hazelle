import type { Rates } from './models-dev';
import type { Accepts, Carries, ModelSettings, Pdf, Takes } from './settings';

export type Protocol = 'chat-completions' | 'anthropic-messages' | 'gemini' | 'responses';

// Refused before any network call. The code names the reason; the UI words it.
export class ConnectorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Endpoint = { baseUrl: string; protocol: Protocol };

export type Connection = {
  type: string;
  label: string;
  // Only generic connections set these; built-in types own their endpoint.
  baseUrl: string | null;
  protocol: Protocol | null;
  // Non-pools hold one account and no turns; pools always have turns.
  accounts: Account[];
  turns: Turns | null;
  // Catalog snapshots keep pickers and requests independent of a catalog fetch.
  starred: Starred[];
  // Absent follows the account; 0 disables retries. A model's profile can override this (retriesOf).
  retries?: number;
};

// name: who signed in, shown only on 연결; the label stays the type's own. A pasted key names no one.
export type Account = { id: string; secret: string; name?: string };

// Groups rotate monthly on local day 1–28; each account belongs to exactly one, in pick order.
// anchor identifies the group at the stored cycle (model/turns cycleOf).
export type Turns = { day: number; groups: Group[]; anchor: { group: string; cycle: number } };
export type Group = { id: string; name: string; accounts: string[] };

export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null };

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file' | 'embedding';

// null means neither the catalog nor models.dev says. It is shown as unknown, never as "no".
export type Model = {
  id: string;
  name: string;
  input: Modality[] | null;
  output: Modality[] | null;
  contextLength: number | null;
  maxOutput: number | null;
  reasoning: boolean | null;
  tools: boolean | null;
  // null means the connection's own. 'unsupported' means only formats this app does not speak yet, so a request is
  // refused before sending.
  protocol: Protocol | 'unsupported' | null;
  // Catalogs that say nothing about request settings keep the Takes fields null.
  takes: Takes;
  // Absent when neither the model list nor models.dev prices it.
  price?: Rates;
  // The maker as the provider's model list names it (Copilot's vendor); absent where the list names none.
  vendor?: string;
};

// Preserved on catalog refresh; excluded from snapshots.
type Own = {
  // Absent in Starred uses the default profile.
  profile: string;
  // Only additional copies have their own key: `#` followed by an id.
  entry: string;
  label: string;
  // Used only when catalog inputs are unknown (seesPictures).
  pictures: true;
};
const OWN: (keyof Own)[] = ['profile', 'entry', 'label', 'pictures'];
export type Starred = Model & Partial<Own>;

export const ownOf = (model: Starred): Partial<Own> => Object.fromEntries(OWN.flatMap((field) => (model[field] === undefined ? [] : [[field, model[field]]])));
export const snapshotOf = (model: Starred): Model => Object.fromEntries(Object.entries(model).filter(([field]) => !(OWN as readonly string[]).includes(field))) as Model;

// The first entry uses the model id; copies use their own key. Existing ModelRefs keep naming the first entry.
export const entryKey = (model: Pick<Starred, 'id' | 'entry'>) => model.entry ?? model.id;
export const entryName = (model: Pick<Starred, 'name' | 'label'>) => model.label ?? model.name;
export const entryOf = (connection: Pick<Connection, 'starred'>, key: string) => connection.starred.find((model) => entryKey(model) === key);
export const entriesOf = (connection: Pick<Connection, 'starred'>, id: string) => connection.starred.filter((model) => model.id === id);
export const entryTerms = (model: Starred) => [entryName(model), model.name, model.id];

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  // Picture-only messages omit text on the wire.
  content: string;
  // Cache through this message, only when enabled; codecs translate this marker, never send it verbatim.
  cache?: true;
  // Set only by Codec.pack; sent as a file ahead of pictures.
  document?: string;
  // Refused before sending unless seesPictures accepts the model; encoded by the codec.
  pictures?: InputPicture[];
  // Row ids, not bytes, cross the worker and scripts. runtime/pictures resolves them before codecs run.
  inlays?: string[];
  // Assistant only: the tools the model called in this turn.
  calls?: ToolCall[];
  // User only: the answers to the calls of the assistant message before it, ahead of any content. A user turn, as
  // Messages and Gemini take them; chat-completions and Responses send them as items of their own.
  results?: ToolResult[];
};
// parameters: a JSON Schema object.
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
// arguments: the JSON text as the model sent it, unparsed, so unreadable arguments are answered as such. echo: what the
// format needs sent back with the call, read and written by the same codec alone (Gemini's thoughtSignature, the
// thinking blocks Messages put before it); the caller passes it on untouched.
export type ToolCall = { id: string; name: string; arguments: string; echo?: unknown };
// name: Gemini answers a call by its name, not its id.
export type ToolResult = { id: string; name: string; text: string };
// type: the media type; data: the bytes as base64.
export type InputPicture = { type: string; data: string };
export const seesPictures = (model: Pick<Starred, 'input' | 'pictures'>) => (model.input === null ? model.pictures === true : model.input.includes('image'));
export const carriesPictures = (message: ChatMessage) => (message.pictures?.length ?? 0) > 0;
export type ChatRequest = { model: Model; messages: ChatMessage[]; settings: ModelSettings; tools?: ToolDef[] };

// A missing count stays null. Filling it with 0 would read as a measured zero and shrink totals.
export type Usage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

// price-list is an estimate: catalog prices can lag behind the provider's.
export type Cost = { unit: 'usd' | 'credit'; amount: number; source: 'reported' | 'price-list' };

// Units are never summed together.
export type Meter =
  | { kind: 'left'; label: string; unit: MeterUnit; amount: number; limit: number | null; resets: MeterReset | null }
  | { kind: 'spent'; label: string; unit: MeterUnit; amount: number };

// concurrency: units a provider's plan lets requests hold at once (Featherless), not a count of requests. percent: a
// share of an allowance the provider states only as a share (NovelAI's usage limit), out of a limit of 100.
export type MeterUnit = 'usd' | 'credit' | 'requests' | 'tokens' | 'concurrency' | 'percent';
export type MeterReset = 'daily' | 'weekly' | 'monthly' | { at: number };

export type MeterRequest = { request(secret: string): HttpRequest; parse(payload: unknown): Meter[] | null; plan?(payload: unknown): string | null };

export type Phase = 'text' | 'reasoning';

// tier: the service tier the reply says served it; null where it names none.
// calls: the tool calls read so far; at is the codec's own key for a call's later chunks (an index, an item id).
export type StreamFacts = { rawUsage: Record<string, unknown>; finishReason: string | null; id: string | null; tier: string | null; calls: (ToolCall & { at: number | string })[] };

export type Terminal = { state: 'completed' } | { state: 'failed'; error: string; code?: string };

// Cache encoding: text-block cache_control, a provider-specific message field, or prompt_cache_key.
// A key routes prefix caching but marks no point.
export type CacheMark = { kind: 'part' } | { kind: 'message'; field: string } | { kind: 'key' };
// accepted null: whether the model reads it is not known; it is sent all the same.
export type CacheWay = { mark: CacheMark; accepted: Accepts };

// A connection type never re-implements a wire format; it adds to one through its own hooks.
export type Codec = {
  authHeaders(secret: string): Record<string, string>;
  // Build before fetching credentials; add authentication only after the build succeeds.
  listModels(endpoint: Endpoint): HttpRequest;
  // null when the payload is not a model list at all, which is not the same as an empty one.
  parseModels(payload: unknown): Model[] | null;
  carries: Omit<Carries, 'cache' | 'discount' | 'pdf'>;
  // null for a format with no cache mark of its own; a connection type may state one (ConnectionType cachePoints).
  cache: CacheWay | null;
  // The wire sends every system message ahead of the others (Messages' system field), so a provider's cache reads them
  // first, whatever their place in the prompt.
  // Where the API takes system text only before the conversation (one system field), a system message after the first
  // other message stays in place as a user message after this prefix, RisuAI's own for the API; null where system
  // messages are sent in place.
  inlineSystem: string | null;
  // Runs after cache points are assigned, before chat builds the request.
  pack?(messages: ChatMessage[], pdf: Pdf): ChatMessage[];
  // fields override the format's body; mark is the route's cache encoding.
  chat(endpoint: Endpoint, request: ChatRequest, fields: Record<string, unknown>, mark: CacheMark | null): HttpRequest;
  read(event: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): void;
  terminal(event: unknown): Terminal | null;
  // null when the payload is not this format's reply at all.
  whole(payload: unknown, facts: StreamFacts, append: (phase: Phase, text: string) => void): Terminal | null;
  truncated(finishReason: string): boolean;
  // The provider ended the reply by refusing it (a safety filter, most often), with or without text before it.
  refused(finishReason: string): boolean;
  usage(raw: Record<string, unknown>): Usage;
  embeds: Embeds | null;
};

export type EmbedPurpose = 'query' | 'document';

// Format support alone is insufficient: ConnectionType.embeds decides provider support.
export type Embeds = {
  // Maximum texts per request; null sends the whole call at once.
  perRequest: number | null;
  // Omit as if unsupported by the format; provider fields override the body (embedPurpose).
  request(endpoint: Endpoint, model: Model, texts: string[], as: EmbedPurpose | null, fields: Record<string, unknown>): HttpRequest;
  // One vector per input, in order; null for an invalid reply. Provider cost hooks read raw usage.
  parse(payload: unknown, count: number): { vectors: number[][]; usage: Usage; raw: Record<string, unknown> } | null;
};

// Absent hooks inherit the codec. Static models replace fetching; image-only types have no chat endpoint.
// endpointFor reads a non-pool secret (e.g. Vertex project), returning null for an invalid key.
export type ConnectionType = TypeHooks &
  (
    | { endpoint: Endpoint; endpointFor?: never; models?: Model[] }
    | { endpoint?: never; endpointFor: (secret: string) => Endpoint | null; models?: never }
    | { endpoint?: never; endpointFor?: never; models: Model[] }
  );

export type KeyParts = {
  label: string;
  fields: { id: string; label: string; lines?: number; placeholder: string; help?: string }[];
  join: (values: Record<string, string>) => string;
};

type TypeHooks = {
  browser: false | { headers?: Record<string, string> };
  id: string;
  label: string;
  group: 'gateway' | 'maker' | 'subscription';
  // Listed again under 주요 on 연결 추가, ahead of the groups (user, 2026-10-04).
  major?: true;
  description: string;
  keyPage?: string;
  // Multiline/file secrets may also expose folded parts; join returns empty until required parts are filled.
  keyForm?: { label: string; lines: number; placeholder: string; accept: string; parts?: KeyParts };
  routes?: Partial<Record<Protocol, string>>;
  // Absent for a type the user connects by signing in: there is no key to paste.
  detect?: { key: RegExp | null; host: string };
  signIn?: SignIn;
  // One connection may hold several signed-in accounts; the core picks one per reply, by its group's turn and by the
  // allowance its meters leave.
  pool?: true;
  exchange?: { request(secret: string): Promise<HttpRequest>; parse(payload: unknown): Token | null };
  headers?: (credential: string) => Record<string, string>;
  // The model list at an address of the provider's own, in place of the codec's (Vertex AI lists models outside a project).
  listModels?: (endpoint: Endpoint) => HttpRequest;
  parseModels?: (payload: unknown) => Model[] | null;
  // Reasoning by a token budget, in a field of the provider's own where its codec has none. Its
  // parseModels says which models take one.
  reasoningBudget?: (tokens: number) => Record<string, unknown>;
  // Laid over the headers of a chat request that carries pictures, and only of one: Copilot's vision flag.
  pictureHeaders?: Record<string, string>;
  // How its endpoint takes a cache point, per model, where the format has no mark of its own (chat completions).
  cachePoints?: (model: Model) => CacheWay;
  cost?: (reply: { facts: StreamFacts; usage: Usage | null; model: Model }) => Cost | null;
  // 할인 받기: the lane a 설정 묶음's discount switch takes; without one the switch is not offered. No pool type has one,
  // so a batch waited for after a reload is asked about with the connection's one account.
  discount?: Discount;
  // Asked with the stored credential, all at once. They are also the check that a pasted key works, where the model
  // list is public (OpenRouter's is): a key every one of them refuses is not saved.
  meters?: MeterRequest[];
  // The provider's own usage page, linked beside the figures, or alone where it reports none (Ollama Cloud).
  usagePage?: string;
  // A cost the provider books only after the reply, looked up by the reply's id. Until it is booked
  // the lookup answers 404.
  settle?: { request(secret: string, id: string): HttpRequest; parse(payload: unknown): Cost | null };
  draws?: Draws;
  // In place of its codec's (Vertex AI). null: the type serves no embeddings, or its codec's embeddings were not verified
  // against it (design §4, docs research/embeddings-spike.md).
  embeds?: Embeds | null;
  // An embedding call's purpose in a field of the provider's own, where its format has none (Voyage's input_type).
  embedPurpose?: (as: EmbedPurpose | null) => Record<string, unknown>;
};

export type Discount = {
  // Multiply prices only when the lane served the call, never merely because it was requested.
  rates: DiscountRates;
  // null means the catalog does not say.
  accepted: Accepts;
} & (
  | {
    lane: 'tier';
    // Override the request body and headers.
    fields?: Record<string, unknown>;
    headers?: Record<string, string>;
    // Must match the reply's StreamFacts.tier to apply rates.
    served: string;
    // Only capacity refusals specific to this lane, not failures a regular call would also meet.
    busy: (status: number, code: string | null) => boolean;
  }
  // One request per batch; an answer from it qualifies for rates.
  | { lane: 'batch'; batches: Batches }
);
export type DiscountRates = Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', number>;

// Build unauthenticated, then registry withCredential authenticates. submit takes an unstreamed codec request.
// key pairs requests/results; submitted/ended return null for foreign payloads, answer for a missing result key.
export type Batches = {
  submit(endpoint: Endpoint, model: Model, request: HttpRequest, key: string): HttpRequest;
  submitted(payload: unknown): string | null;
  check(endpoint: Endpoint, batch: string): HttpRequest;
  ended(payload: unknown): boolean | null;
  results(endpoint: Endpoint, batch: string): HttpRequest;
  answer(body: string, key: string): BatchAnswer | null;
  cancel(endpoint: Endpoint, batch: string): HttpRequest;
};

// reply: the codec's whole reply (Codec whole). canceled: stopped before the model answered it; expired: the provider's
// window ran out first. Neither is billed.
export type BatchAnswer = { kind: 'reply'; payload: unknown } | { kind: 'failed'; detail: string } | { kind: 'canceled' } | { kind: 'expired' };

// center uses 0–1 coordinates from top left. Connectors without placement merge character tags into the main prompt.
// Null generation controls use connector-held model defaults.
export type PictureRequest = {
  model: Model;
  prompt: string;
  negative: string;
  characters: { prompt: string; negative: string; center: { x: number; y: number } }[];
  width: number;
  height: number;
  seed: number;
  steps: number | null;
  scale: number | null;
  rescale: number | null;
  sampler: string | null;
};

export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };

// Image-output hook: build without credentials, then add authHeaders; parse null means no picture in the body.
export type Draws = {
  // The samplers a request may name, the default first.
  samplers: readonly { id: string; label: string }[];
  request(picture: PictureRequest): HttpRequest;
  authHeaders(secret: string): Record<string, string>;
  parse(body: Uint8Array<ArrayBuffer>, contentType: string | null): Promise<Picture | null>;
  // Check cost with stored credentials before every draw. Only known-free pictures bypass user consent;
  // without this hook every picture requires consent.
  free?: { request(secret: string): HttpRequest; costs(payload: unknown, picture: PictureRequest): Costs | null };
};

// plan: no free pictures on the plan. size, steps: the picture is past the free band. allowance: the free allowance
// is used up. unknown: the connection cannot say.
export type Costs = 'plan' | 'size' | 'steps' | 'allowance' | 'unknown';

export type Token = { value: string; expiresAt: number };

// OAuth device authorization (RFC 8628): the token that comes back is an account's secret. account names who
// signed in, so two accounts of one type can be told apart.
export type SignIn = {
  site: string;
  codeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  headers: Record<string, string>;
  account: { request(secret: string): HttpRequest; parse(payload: unknown): string | null };
};
