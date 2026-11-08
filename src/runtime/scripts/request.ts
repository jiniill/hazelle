import type { ChatMessage } from '../../connectors/types';
import { isRecord } from '../../connectors/values';
import type { Assembled } from '../../engine/pipeline';
import type { Event, Outcome } from '../../engine/script-api';

// A request message with origin, the id of the chat message it renders (Assembled parts).
type Sent = { message: ChatMessage; origin?: string };
export const sentOf = ({ messages, parts }: Pick<Assembled, 'messages' | 'parts'>): Sent[] => messages.map((message, at) => {
  const { origin } = parts[at]!;
  return origin === undefined ? { message } : { message, origin };
});

// editRequest reads each message's origin as Risu's memo.
export const requestEvent = (sent: Sent[]): Event => ({ kind: 'edit', stage: 'editRequest', value: sent.map(({ message, origin }) => origin === undefined ? message : { ...message, memo: origin }), meta: {} });

// An answered message names its origin under key (the Lua's memo, a tool's message); keeping one it was given keeps
// that message's pictures, which neither reads as text. One that is no message is left out.
export function sentBack(sent: Sent[], answered: unknown[], key: 'memo' | 'message'): Sent[] {
  const origins = new Map<string, string[] | undefined>(sent.flatMap(({ message, origin }) => origin === undefined ? [] : [[origin, message.inlays]]));
  return answered.flatMap((message): Sent[] => {
    if (!isRecord(message) || typeof message.content !== 'string' || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant')) return [];
    const origin = typeof message[key] === 'string' && origins.has(message[key]) ? message[key] : undefined;
    const kept = origin === undefined ? undefined : origins.get(origin);
    return [{ message: { role: message.role, content: message.content, ...(message.cache === true && { cache: true }), ...(kept && { inlays: kept }) }, ...(origin !== undefined && { origin }) }];
  });
}

// A listener's answer that is no list of messages leaves the request as it was built.
export const requestAnswer = (outcome: Outcome, sent: Sent[]): Sent[] => !outcome.handled || !Array.isArray(outcome.value) ? sent : sentBack(sent, outcome.value, 'memo');

export const toolRequest = (sent: Sent[]): Hazelle.RequestMessage[] => sent.map(({ message: { role, content, cache }, origin }) => ({ role, content, ...(origin !== undefined && { message: origin }), ...(cache && { cache }) }));
