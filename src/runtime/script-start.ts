import type { ChatScope } from '../engine/render';
import type { Event, Outcome } from '../engine/script-api';
import type { Writes } from '../model/chat';

export type StartStage = 'onInput' | 'editInput' | 'onStart';
type StartSteps<F> = {
  // The turn's scope as it now stands, the message being sent last.
  scope(): ChatScope;
  run(event: Event, scope: ChatScope): Promise<{ outcome: Outcome; changed: boolean }>;
  // The tools' sending, after the Lua's editInput.
  input(text: string, scope: ChatScope): Promise<{ value: string; writes: Writes }>;
  // The chat changed under the turn; answer: once the message being sent is saved.
  changed(answer: boolean): Promise<F | null>;
  send(text: string, before: Writes): Promise<F | null>;
  aborted(): boolean;
};
// stage: null when the turn was stopped from outside before onStart. writes: onStart's, which stand after the last
// message; what onInput and editInput wrote went with the message sent.
type StartEnd = { kind: 'stopped'; stage: StartStage | null; writes: Writes } | { kind: 'started'; writes: Writes };

// Canonical send/rehearsal order: onInput → editInput → save message → onStart.
// Stops retain writes/message up to that stage and skip everything after it (design §6.8).
export async function startStages<F>(said: string | null, steps: StartSteps<F>): Promise<F | StartEnd> {
  if (said !== null) {
    const history = (): ChatScope => ({ ...steps.scope(), messages: steps.scope().messages.slice(0, -1) });
    const input = await steps.run({ kind: 'input' }, history());
    let { stop, writes: before } = input.outcome;
    let stage: StartStage = 'onInput';
    let text = said;
    if (!stop) {
      if (input.changed) {
        const failed = await steps.changed(false);
        if (failed) return failed;
      }
      const edited = await steps.run({ kind: 'edit', stage: 'editInput', value: text, meta: { index: -1 } }, { ...history(), pending: before });
      before = [...before, ...edited.outcome.writes];
      if (typeof edited.outcome.value === 'string') text = edited.outcome.value;
      stop = edited.outcome.stop;
      stage = 'editInput';
      if (!stop) {
        const tooled = await steps.input(text, { ...history(), pending: before });
        text = tooled.value;
        before = [...before, ...tooled.writes];
      }
    }
    const failed = await steps.send(text, before);
    if (failed) return failed;
    if (stop) return { kind: 'stopped', stage, writes: [] };
    const moved = await steps.changed(true);
    if (moved) return moved;
  }
  if (steps.aborted()) return { kind: 'stopped', stage: null, writes: [] };
  const start = await steps.run({ kind: 'start' }, steps.scope());
  if (start.outcome.stop) return { kind: 'stopped', stage: 'onStart', writes: start.outcome.writes };
  if (start.changed) {
    const failed = await steps.changed(said !== null);
    if (failed) return failed;
  }
  return { kind: 'started', writes: start.outcome.writes };
}

