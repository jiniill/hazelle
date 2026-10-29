// Prices come from models.dev's database, never from a table typed in here or a pricing page read (user, 2026-10-04).
// The server reads this module too (eslint/boundaries.js), so it stays data and types only.

// Provider ids for models.dev. Missing providers inherit no capabilities/prices beyond their own catalog.
// credit bills each $0.01 as one AI credit (Copilot).
export const MODELS_DEV_LISTS: Readonly<Partial<Record<string, { list: string; credit?: true }>>> = {
  openrouter: { list: 'openrouter' },
  vercel: { list: 'vercel' },
  ollama: { list: 'ollama-cloud' },
  perplexity: { list: 'perplexity' },
  groq: { list: 'groq' },
  together: { list: 'togetherai' },
  cerebras: { list: 'cerebras' },
  deepinfra: { list: 'deepinfra' },
  nanogpt: { list: 'nano-gpt' },
  openai: { list: 'openai' },
  anthropic: { list: 'anthropic' },
  google: { list: 'google' },
  vertex: { list: 'google-vertex' },
  xai: { list: 'xai' },
  deepseek: { list: 'deepseek' },
  mistral: { list: 'mistral' },
  moonshot: { list: 'moonshotai' },
  upstage: { list: 'upstage' },
  friendli: { list: 'friendli' },
  chutes: { list: 'chutes' },
  copilot: { list: 'github-copilot', credit: true },
};

// Provider-owned static catalogs also name pulse models; first entry is the default.
export const CONNECTOR_MODELS = {
  novelai: [
    { id: 'nai-diffusion-5-full', name: 'NovelAI Diffusion V5 Full' },
    { id: 'nai-diffusion-5-curated', name: 'NovelAI Diffusion V5 Curated' },
    { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-5-curated', name: 'NovelAI Diffusion V4.5 Curated' },
  ],
  voyage: ['voyage-4-lite', 'voyage-4', 'voyage-4-large'].map((id) => ({ id, name: id })),
} as const satisfies Record<string, readonly { id: string; name: string }[]>;

// models.dev's words for what a model takes and gives, as the app's Modality names them; any other word is dropped.
export const MODELS_DEV_MODALITIES = { text: 'text', image: 'image', audio: 'audio', video: 'video', pdf: 'file' } as const;
// 'embedding' comes from a model's type: models.dev writes an embedding model's output as text.
export type ListedModality = (typeof MODELS_DEV_MODALITIES)[keyof typeof MODELS_DEV_MODALITIES] | 'embedding';

// A tier's rates replace the base ones once the request's input tokens exceed above. Tiers ascend by above.
export type PriceTier = { above: number; input: number; output: number; cacheRead: number | null; cacheWrite: number | null };

// USD per million tokens. A null cache rate is one the list does not state.
export type Rates = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null; tiers: PriceTier[] };

// price: null where models.dev cannot price the model whole. input, output, tools: null where it does not say.
export type ListedModel = { price: Rates | null; input: ListedModality[] | null; output: ListedModality[] | null; tools: boolean | null };

// GET /api/models-dev?provider=<list>. fetchedAt is null, and models empty, until the server's first fetch has landed.
export type ModelsDevList = { fetchedAt: number | null; models: Record<string, ListedModel> };

// GET /api/models-dev/table: every list's models, 도구 › 비용 계산기's table. name: null where models.dev gives none.
export type TableModel = { list: string; model: string; name: string | null; price: Rates | null };
export type PriceTable = { fetchedAt: number | null; models: TableModel[] };
