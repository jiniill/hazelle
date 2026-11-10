export type RequestClass = 'conversation' | 'translation' | 'memory' | 'illustration' | 'likeness' | 'script' | 'mascot' | 'preread' | 'agent';

type EstimateSource = 'prior' | 'model' | 'chat' | 'drift-reset' | 'unavailable';

export type TokenEstimate = { source: EstimateSource; evidence: number; centre: number; lower: number; upper: number; cold: boolean };
export type TokenLimits = { hard: number | null; user: number | null; output: number };
export type TokenFit = {
  source: EstimateSource;
  evidence: number;
  bound: 'hard-upper' | 'hard-centre' | 'user-centre' | 'refusal' | null;
  multiplier: number | null;
  allowance: number | null;
  inputLimit: number | null;
  epsilon: 0.01;
};

export type InputMeasurement =
  | { kind: 'unavailable'; reason: 'historical' | 'preparation' | 'tokenizer' }
  | { kind: 'measured'; key: string; at: number; fingerprint: string; o200k: number; messages: number; blocks: number; pictures: number };

// A refusal is evidence about input, never a receipt or billable usage. Only an explicitly stated input count is exact.
type RefusalRetry = { measurement: InputMeasurement; actual: number | null; maximum: number | null; allowance: number; at: number };
export type CallCalibration = { refusal?: { actual: number | null; maximum: number | null }; measurement: InputMeasurement; fit: TokenFit | null; retries: RefusalRetry[]; eligible: boolean };

export type TokenProjection = {
  reportedInput: number | null;
  denominator: number | null;
  unavailable: 'historical' | 'preparation' | 'tokenizer' | null;
  ineligible: 'pictures' | 'incomplete' | 'missing-input' | 'empty' | null;
  ratio: number | null;
  source: EstimateSource;
  evidence: number;
  bound: TokenFit['bound'];
  multiplier: number | null;
  allowance: number | null;
  retries: RefusalRetry[];
};

export const unavailableCalibration = (reason: Extract<InputMeasurement, { kind: 'unavailable' }>['reason']): CallCalibration => ({ measurement: { kind: 'unavailable', reason }, fit: null, retries: [], eligible: false });
