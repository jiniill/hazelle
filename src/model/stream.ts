import type { CallCalibration } from './token-calibration';
import type { Receipt, Writes } from './chat';
import type { Source } from './memory';

// Keep until the result is saved so reloads/devices can resume. result identifies an already-saved outcome.
// Memory print fingerprints the rendered source at call time, not at resume time.
// key is private for server calls; batch identifies a provider batch resumed through the relay.
export type Stream = ({ key: JsonWebKey } | { batch: string }) & {
  call: Pick<Receipt, 'connection' | 'source' | 'model' | 'modelName' | 'entry'>;
  calibration: CallCalibration;
  at: number;
  result: string;
  for:
    // follows: as a message's (model/chat Entry), absent on a call begun before it.
    | { kind: 'reply'; message: string | null; replaces: string | null; follows?: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes }
    // spans: what the tokens in the translation's source stand for (engine/protect); absent on a call begun before it existed, or with none.
    | { kind: 'translation'; version: string; spans?: string[] }
    | { kind: 'input'; typed: string; language: string; follows?: string | null; spans?: string[] }
    | { kind: 'note'; character: string }
    // chapter: the records a chapter call summarizes again; absent for a records call.
    | { kind: 'memory'; sources: Source[]; print: string; chapter?: string[] };
};
