// Workers use this to bound each synchronous unit, not the whole pass, with their watchdogs.
// Call between script/import-controlled units; outside evaluation/import workers it is a no-op.
let listener = () => {};

export const progressed = () => listener();

export function onProgress(next: () => void) {
  listener = next;
}
