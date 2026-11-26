// Server work the operator announced: its start, and about how many minutes the server is away from then.
export type ServerWork = { at: number; minutes: number };
export const MAX_WORK_MINUTES = 24 * 60;
export const workEnd = (work: ServerWork) => work.at + work.minutes * 60_000;
// Announced and not yet called off or done: from its start, a server that does not answer is away for it.
export const underWay = (work: ServerWork | null, now: number): work is ServerWork => work !== null && now >= work.at;

// On every API answer, none said too, so an open page learns of work announced, called off or done without a reload.
export const WORK_HEADER = 'x-hazelle-work';
const NONE = 'none';
export const workHeader = (work: ServerWork | null) => (work ? `${work.at} ${work.minutes}` : NONE);
export function readWorkHeader(said: string): ServerWork | null {
  if (said === NONE) return null;
  const [at, minutes] = said.split(' ').map(Number);
  return { at: at!, minutes: minutes! };
}
