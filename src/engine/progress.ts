import type { AutoUnit } from '../contracts/auto-diagnosis';

// Workers use this to bound each synchronous unit, not the whole pass, with their watchdogs.
// Call between script/import-controlled units (a message's stage, each regex script over it), naming the unit about to
// begin by its kind, places and size, never by what it reads; outside evaluation/import workers it is a no-op.
type Sign = (kind: AutoUnit['kind'], message: number | null, script: number | null, chars: number | null, stage: AutoUnit['stage']) => void;
let listener: Sign = () => {};

export const progressed = (kind: AutoUnit['kind'], message: number | null = null, script: number | null = null, chars: number | null = null, stage: AutoUnit['stage'] = null) => listener(kind, message, script, chars, stage);

export function onProgress(next: Sign) {
  listener = next;
}
