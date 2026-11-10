import type { AgentFailed } from '../tasks/agents';
import type { PrereadFailure } from '../tasks/preread';
import type { TurnFailure } from './turn';

type Preparations = {
  preread: { step: 'preread'; waiting: { retrying?: true }; failure: PrereadFailure };
  agent: { step: 'agents'; waiting: { running: readonly string[]; retrying: readonly string[]; total: number }; failure: AgentFailed };
};

// retrying: a call of the step whose try failed and is sent again, by name for the agents. tools: the chat's tools
// reading the request, which cannot fail the turn, so it has no failure and no skip (running: the one at it now, since
// when).
export type Preparing = { [K in keyof Preparations]: { step: Preparations[K]['step'] } & Preparations[K]['waiting'] }[keyof Preparations] | { step: 'tools'; running: string; since: number };
export type StepFailure = { [K in keyof Preparations]: { kind: K; failure: Preparations[K]['failure'] } }[keyof Preparations];

// What a turn goes without: after a failed step, 토큰 절약 (줄이지 않고 보내기) or the pre agents (에이전트 없이 보내기);
// notes, the pre notes the message's other versions made, which it would use again (노트 새로 만들어 다시 생성).
export type Skip = Partial<Record<Preparations[keyof Preparations]['step'] | 'notes', true>>;

const steps = { preread: 'preread', agent: 'agents' } as const satisfies { [K in keyof Preparations]: Preparations[K]['step'] };

// Sound because steps holds exactly StepFailure's kinds and no other TurnFailure shares one.
const isStep = (failure: TurnFailure): failure is TurnFailure & StepFailure => Object.hasOwn(steps, failure.kind);

export function skippedStep(failure: TurnFailure, skip: Skip): { failure: StepFailure; skip: Skip } | null {
  if (!isStep(failure)) return null;
  if (failure.kind === 'preread' && failure.failure.kind === 'stopped') return null;
  return { failure, skip: { ...skip, [steps[failure.kind]]: true } };
}
