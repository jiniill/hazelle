import type { Model } from './types';

export const NUMBERS = ['maxOutput', 'temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'minP', 'seed'] as const;
export type NumberSetting = (typeof NUMBERS)[number];
export type Setting = NumberSetting | 'stop' | 'reasoning' | 'verbosity' | 'serviceTier';

export const WHOLE = new Set<NumberSetting>(['maxOutput', 'topK', 'seed']);

export type Reasoning =
  | { kind: 'off' }
  | { kind: 'level'; level: string }
  | { kind: 'budget'; tokens: number }
  | { kind: 'adaptive'; level: string | null };

// Absent fields use provider defaults. context caps the prompt locally and is never sent.
export type ModelSettings = { [S in NumberSetting]?: number } & {
  context?: number;
  stop?: string[];
  reasoning?: Reasoning;
  systemAsUser?: true;
  // Every model takes it, so fit() never leaves it out.
  streaming?: false;
  cache?: Cache;
  verbosity?: Verbosity;
  serviceTier?: ServiceTier;
  // 할인 받기 (design §6.7): the connection type's discount lane (ConnectionType discount), where it has one.
  discount?: true;
  // PDF로 보내기: sending() packs the earlier conversation through its codec's pack (Gemini: connectors/gemini-pdf).
  pdf?: Pdf;
  // Profile retry override (runtime/connections retriesOf); never send it to the provider.
  retries?: number;
  // 추가 파라미터 as the user typed it; connectors/extra reads it when sending.
  extra?: string;
};
export type Cache = '5m' | '1h';
// keep: what stays out of the PDF: the leading system prompt (system), that and the latest recent percent of the
// messages after it (recent), or nothing (none).
export type PdfKeep = 'recent' | 'system' | 'none';
export type Pdf = { keep: PdfKeep; recent: number };
export const VERBOSITY = ['low', 'medium', 'high'] as const;
export type Verbosity = (typeof VERBOSITY)[number];
// Anthropic's service_tier: auto may use the account's Priority Tier capacity; standard_only never does.
export const SERVICE_TIERS = ['auto', 'standard_only'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export type Bounds = { min: number | null; max: number | null };

// Absent catalog settings are unsupported; a null list/control is unknown, not unsupported.
export type Takes = { settings: Setting[] | null; reasoning: ReasoningTakes | null };
export type ReasoningTakes = { off: boolean | null; levels: string[] | null; budget: Bounds | false | null; adaptive: boolean | null };

// Format support is an upper bound, never a promise of model support.
// always means unconditionally sent; least is null when supported levels differ across models.
export type Carries = {
  numbers: { [S in NumberSetting]?: Bounds & { always?: true } };
  reasoning: { off: boolean; levels: string[]; least: string | null; budget: Bounds | null; adaptive: boolean };
  stop: boolean;
  verbosity: boolean;
  serviceTier: boolean;
  // Whether the route can mark cache points: true where every model on it takes them, null where some may not.
  cache: Accepts;
  // The connection type's discount lane, false where it has none.
  discount: Accepts;
  pdf: boolean;
};

// Unknown remains settable/sendable and is shown as unknown; reject only known false.
export type Accepts = boolean | null;
export type Rule = Bounds & { accepted: Accepts; whole: boolean };

// context is the catalog's context length, which the prompt's own limit never goes past.
export type SettingsSchema = {
  numbers: Record<NumberSetting, Rule>;
  context: Rule;
  stop: Accepts;
  // least: the least level the model is known to take, from its catalog, else its format's; null where neither says.
  reasoning: { off: Accepts; level: Accepts; levels: string[]; least: string | null; budget: Rule; adaptive: Accepts };
  prefill: Accepts;
  cache: Accepts;
  verbosity: Accepts;
  serviceTier: Accepts;
  discount: Accepts;
  pdf: Accepts;
};

// Effort names from least to most. Catalogs list them in either order (OpenRouter's Claude: max first).
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Prefer known off, then least level, then smallest budget; null when unknown.
// Never infer off from a zero budget on models that reject it.
export function leastReasoning({ reasoning }: SettingsSchema): Reasoning | null {
  if (reasoning.off === true) return { kind: 'off' };
  if (reasoning.level !== false && reasoning.least) return { kind: 'level', level: reasoning.least };
  if (reasoning.budget.accepted === true && reasoning.budget.min !== null) return { kind: 'budget', tokens: reasoning.budget.min };
  return null;
}

// left-out: the model does not take it, or not the level named. capped: brought within the model's bounds, to that value.
export type Change = { setting: Setting | 'context' | 'cache' | 'discount' | 'pdf'; change: 'left-out' } | { setting: NumberSetting | 'context' | 'reasoning'; change: 'capped'; to: number };
export type Fitted = { settings: ModelSettings; changes: Change[] };

// Catalogs list 'none' among the effort levels of a model whose reasoning can be turned off; here that
// is the off control, not a level.
export function effortLevels(values: unknown): { levels: string[]; none: boolean } | null {
  if (!Array.isArray(values)) return null;
  const named = values.filter((value): value is string => typeof value === 'string' && value !== '');
  return { levels: named.filter((level) => level !== 'none'), none: named.includes('none') };
}

// Intersect protocol capacity with catalog support; an undescribed model control stays unknown.
// E.g. Messages carries temperature, but some Anthropic models reject it.
export function settingsSchema(carries: Carries, model: Model): SettingsSchema {
  const listed = model.takes.settings;
  const facts = model.takes.reasoning;
  const takes = (setting: Setting): Accepts => (listed === null ? null : listed.includes(setting));
  const numbers = Object.fromEntries(
    NUMBERS.map((name): [NumberSetting, Rule] => {
      const bounds = carries.numbers[name];
      const accepted = !bounds ? false : bounds.always ? true : takes(name);
      const max = name === 'maxOutput' ? model.maxOutput : (bounds?.max ?? null);
      return [name, { accepted, min: bounds?.min ?? null, max, whole: WHOLE.has(name) }];
    }),
  ) as Record<NumberSetting, Rule>;

  const reasoning = takes('reasoning');
  const control = (carried: boolean, fact: boolean | null | undefined): Accepts => (!carried || reasoning === false ? false : (fact ?? null));
  const levels = facts?.levels ?? null;
  const budget = facts?.budget ?? null;
  const stated = budget || null;
  const carriedBudget = carries.reasoning.budget;
  return {
    numbers,
    context: { accepted: true, min: 1, max: model.contextLength, whole: true },
    stop: carries.stop ? takes('stop') : false,
    reasoning: {
      off: control(carries.reasoning.off, facts?.off),
      level: control(true, levels && levels.length > 0),
      levels: levels ?? carries.reasoning.levels,
      least: levels ? (EFFORT_ORDER.find((name) => levels.includes(name)) ?? null) : carries.reasoning.least,
      budget: {
        accepted: control(carriedBudget !== null, budget === null ? null : budget !== false),
        // A budget counts tokens, so none is below one where neither the protocol nor the catalog says.
        min: stated?.min ?? carriedBudget?.min ?? 1,
        max: stated?.max ?? carriedBudget?.max ?? null,
        whole: true,
      },
      adaptive: control(carries.reasoning.adaptive, facts?.adaptive),
    },
    // Catalogs checked 2026-09-28 do not state prefill; Messages alone cannot promise it (Anthropic 4.6+ refuses).
    // Only provider-specific per-model evidence may fill it.
    prefill: null,
    // No catalog lists it, so it is the format's word, or the connection type's.
    cache: carries.cache,
    verbosity: carries.verbosity ? takes('verbosity') : false,
    serviceTier: carries.serviceTier ? takes('serviceTier') : false,
    discount: carries.discount,
    // models.dev lists a PDF reader's input as file; a catalog silent on input leaves it unknown.
    pdf: carries.pdf ? (model.input === null ? null : model.input.includes('file')) : false,
  };
}

const within = (value: number, rule: Bounds) => Math.min(Math.max(value, rule.min ?? value), rule.max ?? value);

// Unknown is sent as it is.
export function fit(schema: SettingsSchema, settings: ModelSettings): Fitted {
  const sent: ModelSettings = { ...settings };
  const changes: Change[] = [];
  const leave = (setting: Extract<Change, { change: 'left-out' }>['setting']) => {
    delete sent[setting];
    changes.push({ setting, change: 'left-out' });
  };
  const cap = (setting: NumberSetting | 'context', value: number, rule: Bounds) => {
    const to = within(value, rule);
    if (to === value) return;
    sent[setting] = to;
    changes.push({ setting, change: 'capped', to });
  };
  for (const name of NUMBERS) {
    const value = settings[name];
    if (value === undefined) continue;
    if (schema.numbers[name].accepted === false) leave(name);
    else cap(name, value, schema.numbers[name]);
  }
  if (settings.context !== undefined) cap('context', settings.context, schema.context);
  if (settings.stop && schema.stop === false) leave('stop');
  if (settings.cache && schema.cache === false) leave('cache');
  if (settings.verbosity && schema.verbosity === false) leave('verbosity');
  if (settings.serviceTier && schema.serviceTier === false) leave('serviceTier');
  if (settings.discount && schema.discount === false) leave('discount');
  if (settings.pdf && schema.pdf === false) leave('pdf');
  const { reasoning } = settings;
  if (reasoning?.kind === 'budget' && schema.reasoning.budget.accepted !== false) {
    const tokens = within(reasoning.tokens, schema.reasoning.budget);
    if (tokens !== reasoning.tokens) {
      sent.reasoning = { kind: 'budget', tokens };
      changes.push({ setting: 'reasoning', change: 'capped', to: tokens });
    }
  } else if (reasoning && refused(schema.reasoning, reasoning)) {
    leave('reasoning');
  }
  return { settings: sent, changes };
}

function refused(rules: SettingsSchema['reasoning'], reasoning: Reasoning): boolean {
  const unnamed = (level: string | null) => level !== null && (rules.level === false || !rules.levels.includes(level));
  switch (reasoning.kind) {
    case 'off':
      return rules.off === false;
    case 'level':
      return unnamed(reasoning.level);
    case 'budget':
      return rules.budget.accepted === false;
    case 'adaptive':
      return rules.adaptive === false || unnamed(reasoning.level);
  }
}
