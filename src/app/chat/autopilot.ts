import type { Rates } from '../../connectors/models-dev';
import { priceCost } from '../../connectors/pricing';
import type { Cost } from '../../connectors/types';
import { shown, type Message } from '../../model/chat';
import type { TurnFailure } from '../../runtime/chat/turn';
import { describeFailedReply, describeTurnFailure } from '../common/failure';

export const parseMessages = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

// Each message as one call of the next request's input and the last reply's length: what the context grows by over
// the run is left out, as the panel's ⓘ says. null where the reply's length or the model's price is not known.
export type Estimate = { input: number; output: number | null; cost: Cost | null };

export function estimateRun(count: number, input: number, reply: number | null, price: Rates | undefined, unit: Cost['unit']): Estimate {
  const each = price && reply !== null ? priceCost(price, { inputTokens: input, outputTokens: reply, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningTokens: null }, unit) : null;
  return { input: input * count, output: reply === null ? null : reply * count, cost: each && { ...each, amount: each.amount * count } };
}

export type Step = { kind: 'answered' } | { kind: 'stopped' } | { kind: 'failed'; why: string };

// reply: the assistant message the send saved, absent when none came (the bot's Lua ended the turn, or it stopped
// before the request).
export function stepOf(failure: TurnFailure | null, reply: Message | undefined, aborted: boolean): Step {
  if (failure) return { kind: 'failed', why: describeTurnFailure(failure) };
  const receipt = reply && shown(reply).receipt;
  if (receipt?.state === 'failed') return { kind: 'failed', why: describeFailedReply(receipt.error) };
  if (aborted || receipt?.cut === 'stopped') return { kind: 'stopped' };
  return receipt ? { kind: 'answered' } : { kind: 'failed', why: '응답을 받지 못했어요.' };
}

// sent: the messages that went out, the stopped one's included. unbranched: the new version was not saved, so nothing
// was sent.
export type RunEnd = { kind: 'done'; sent: number } | { kind: 'stopped'; sent: number } | { kind: 'failed'; at: number; text: string; why: string } | { kind: 'unbranched'; why: string };

export async function runMessages(messages: string[], send: (text: string, at: number) => Promise<Step>, signal: AbortSignal): Promise<RunEnd> {
  for (const [at, text] of messages.entries()) {
    if (signal.aborted) return { kind: 'stopped', sent: at };
    const step = await send(text, at);
    if (step.kind === 'failed') return { kind: 'failed', at, text, why: step.why };
    if (step.kind === 'stopped') return { kind: 'stopped', sent: at + 1 };
  }
  return { kind: 'done', sent: messages.length };
}
