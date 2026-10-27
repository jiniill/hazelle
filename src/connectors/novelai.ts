import { unzipSync } from 'fflate';
import { bareModel } from './chat-completions';
import { CONNECTOR_MODELS } from './models-dev';
import { ConnectorError, type ConnectionType, type Costs, type Meter, type Model, type PictureRequest } from './types';
import { count, isRecord } from './values';

const drawing = (id: string, name: string): Model => ({ ...bareModel(id), name, input: ['text'], output: ['image'] });

// Per model as NAIWeaver's NaiCaps and NaiModelDefaults state it (nai_model.dart), read from NovelAI's own frontend.
// V4.5 places characters only on a 5×5 grid and takes at most 6 of them; V5 places them freely.
type Body = { paramsVersion: number; scale: number; maxCharacters: number; grid: boolean; v5: boolean };
const V5: Body = { paramsVersion: 4, scale: 7, maxCharacters: 32, grid: false, v5: true };
const V45: Body = { paramsVersion: 3, scale: 5, maxCharacters: 6, grid: true, v5: false };
const BODIES: Partial<Record<string, Body>> = { 'nai-diffusion-5-full': V5, 'nai-diffusion-5-curated': V5, 'nai-diffusion-4-5-full': V45, 'nai-diffusion-4-5-curated': V45 };

const MODELS: Model[] = CONNECTOR_MODELS.novelai.map(({ id, name }) => drawing(id, name));

// NovelAI's own list for V4.5 and V5, as NAIWeaver's NaiModel.samplers states it (nai_model.dart).
const SAMPLERS = [
  { id: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { id: 'k_euler', label: 'Euler' },
  { id: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { id: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { id: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { id: 'k_dpmpp_sde', label: 'DPM++ SDE' },
];

// The default and the most an Opus picture takes free.
const FREE_STEPS = 28;
const stepsOf = (picture: PictureRequest) => picture.steps ?? FREE_STEPS;

const onGrid = (value: number) => (Math.min(Math.floor(value * 5), 4) * 2 + 1) / 10;
const thousandths = (value: number) => Math.round(value * 1000) / 1000;

// Samples stay at 1: past it, an Opus picture costs Anlas.
function generateBody(picture: PictureRequest): Record<string, unknown> {
  const { model, prompt, negative, characters, width, height, seed } = picture;
  const body = BODIES[model.id];
  if (!body) throw new ConnectorError('unknown-model');
  const sampler = picture.sampler ?? SAMPLERS[0]!.id;
  if (!SAMPLERS.some(({ id }) => id === sampler)) throw new ConnectorError('unknown-sampler');
  if (characters.length > body.maxCharacters) throw new ConnectorError('too-many-characters');
  const place = body.grid ? onGrid : thousandths;
  const centers = characters.map(({ center }) => [{ x: place(center.x), y: place(center.y) }]);
  return {
    input: prompt,
    model: model.id,
    action: 'generate',
    parameters: {
      params_version: body.paramsVersion,
      width,
      height,
      scale: picture.scale ?? body.scale,
      sampler,
      steps: stepsOf(picture),
      seed,
      n_samples: 1,
      noise_schedule: 'karras',
      // V4.5 keeps the SMEA keys, always false: true is a 500 on every V4+ model. V5 drops them.
      ...(!body.v5 && { sm: false, sm_dyn: false }),
      dynamic_thresholding: false,
      cfg_rescale: picture.rescale ?? 0,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      uc: negative,
      v4_prompt: {
        caption: { base_caption: prompt, char_captions: characters.map((character, index) => ({ char_caption: character.prompt, centers: centers[index] })) },
        use_coords: characters.length > 0,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negative, char_captions: characters.map((character, index) => ({ char_caption: character.negative, centers: centers[index] })) },
      },
    },
  };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The answer is a ZIP holding one PNG. Anything else, a refusal's JSON among them, holds no picture.
function pictureIn(body: Uint8Array<ArrayBuffer>) {
  let entries: Uint8Array[];
  try {
    entries = Object.values(unzipSync(body));
  } catch {
    return null;
  }
  const png = entries.find((entry) => PNG.every((byte, index) => entry[index] === byte));
  return png ? { bytes: png.slice(), type: 'image/png' } : null;
}

const TIERS = ['Paper', 'Tablet', 'Scroll', 'Opus'];

// Field names as NAIWeaver's NaiSubscription and NaiUsage read them (nai_model.dart) and its V5 research measured with
// a real key. usage, the V5 allowance, comes only on Opus; it refills a percent at a time, so it names no reset.
function meters(payload: unknown): Meter[] | null {
  if (!isRecord(payload)) return null;
  const found: Meter[] = [];
  const usage = isRecord(payload.usage) ? payload.usage : null;
  if (usage && typeof usage.percent === 'number') {
    found.push({ kind: 'left', label: 'V5 무료 사용량', unit: 'percent', amount: usage.isNegative === true ? 0 : Math.min(Math.max(usage.percent, 0), 100), limit: 100, resets: null });
  }
  const steps = isRecord(payload.trainingStepsLeft) ? payload.trainingStepsLeft : null;
  const fixed = count(steps?.fixedTrainingStepsLeft);
  const purchased = count(steps?.purchasedTrainingSteps);
  if (fixed !== null && purchased !== null) found.push({ kind: 'left', label: 'Anlas', unit: 'credit', amount: fixed + purchased, limit: null, resets: null });
  return found;
}

const plan = (payload: unknown) => (isRecord(payload) && payload.active === true && typeof payload.tier === 'number' ? (TIERS[payload.tier] ?? null) : null);

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

const subscription = (secret: string) => ({ url: 'https://image.novelai.net/user/subscription', method: 'GET' as const, headers: bearer(secret), body: null });

// Free Opus pictures require <=1,048,576 pixels and <=28 steps, plus known remaining V5 allowance.
// Check plan first: changing size cannot make a non-Opus picture free.
function costs(payload: unknown, picture: PictureRequest): Costs | null {
  const { model, width, height } = picture;
  if (!isRecord(payload) || typeof payload.tier !== 'number') return 'unknown';
  if (payload.active !== true || payload.tier !== 3) return 'plan';
  if (width * height > 1_048_576) return 'size';
  if (stepsOf(picture) > FREE_STEPS) return 'steps';
  if (!BODIES[model.id]?.v5) return null;
  const usage = isRecord(payload.usage) ? payload.usage : null;
  if (!usage || typeof usage.percent !== 'number') return 'unknown';
  return usage.isNegative !== true && usage.percent > 0 ? null : 'allowance';
}

export const novelai: ConnectionType = {
  browser: {},
  id: 'novelai',
  label: 'NovelAI',
  group: 'maker',
  description: 'NovelAI로 삽화를 그려요.',
  keyPage: 'https://docs.novelai.net/en/text/usersettings/account',
  detect: { key: /^pst-/, host: 'image.novelai.net' },
  models: MODELS,
  // The only check that a pasted key works: there is no model list to ask. api.novelai.net refuses this path now.
  meters: [{ request: subscription, parse: meters, plan }],
  draws: {
    samplers: SAMPLERS,
    request: (picture) => ({ url: 'https://image.novelai.net/ai/generate-image', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(generateBody(picture)) }),
    authHeaders: bearer,
    parse: (body) => Promise.resolve(pictureIn(body)),
    free: { request: subscription, costs },
  },
};
