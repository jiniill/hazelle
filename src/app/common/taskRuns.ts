import type { Route } from '../../runtime/assignment';

// What a task runs on, or why it cannot in its own feature's words: what its model row says under it.
export type TaskRuns = { route: Route } | { why: string };

export const taskRuns = <F extends { kind: string }>(writer: { route: Route } | F, describe: (failure: F) => string): TaskRuns => ('kind' in writer ? { why: describe(writer) } : writer);
