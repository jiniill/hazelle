import type { ChatMessage, ToolDef, ToolResult } from '../connectors/types';
import { isRecord } from '../connectors/values';
import { gather, type GenerateInput, type Reply } from './generate';

// A tool the model may call. args: the call's arguments read as a JSON object; a call that names no offered tool or
// whose arguments do not read so never reaches run. before: what the model wrote since the last call that ran.
export type Tool = { def: ToolDef; run: (args: Record<string, unknown>, before: string) => Promise<string> };
// One round's model call, made by the caller with its own call record, receipt and ledger row, on its messages
// followed by exchange. tools is absent when none are offered. A result without an answer ends the loop as it is.
export type Send<T> = (exchange: ChatMessage[], tools: ToolDef[] | undefined, onText: GenerateInput['onText']) => Promise<T>;
type Sent = { answer: Reply };
export type Round<R> = R & { text: string; results: ToolResult[] };
// answered: the last round called nothing. failed: its call failed. exhausted: it still called on the last round allowed.
export type Looped<R> = { kind: 'answered' | 'stopped' | 'failed' | 'exhausted'; rounds: Round<R>[] };

function argsOf(text: string): Record<string, unknown> | null {
  try {
    const read: unknown = JSON.parse(text);
    return isRecord(read) ? read : null;
  } catch {
    return null;
  }
}

// The one loop of "the model calls, each call runs, the results go back, the model goes on". onText hears every round.
export async function toolLoop<T extends Sent | { kind: string }>({ tools, rounds: limit, signal, onText }: { tools: Tool[]; rounds: number; signal: AbortSignal; onText: GenerateInput['onText'] }, send: Send<T>): Promise<Looped<Extract<T, Sent>> | Exclude<T, Sent>> {
  type R = Extract<T, Sent>;
  const offered = tools.length ? tools.map(({ def }) => def) : undefined;
  const exchange: ChatMessage[] = [];
  const rounds: Round<R>[] = [];
  while (!signal.aborted) {
    const text = gather();
    const sent = await send(exchange.slice(), offered, (phase, chunk) => (text.add(phase, chunk), onText(phase, chunk)));
    if (!('answer' in sent)) return sent as Exclude<T, Sent>;
    const round: Round<R> = { ...(sent as R), text: text.value(), results: [] };
    rounds.push(round);
    const { answer } = sent;
    if (answer.cut === 'stopped') return { kind: 'stopped', rounds };
    if (answer.state === 'failed') return { kind: 'failed', rounds };
    if (!offered || !answer.calls.length) return { kind: 'answered', rounds };
    if (rounds.length >= limit) return { kind: 'exhausted', rounds };
    let before = round.text;
    for (const call of answer.calls) {
      const tool = tools.find(({ def }) => def.name === call.name);
      const args = tool && argsOf(call.arguments);
      let result = 'Not run: there is no such tool.';
      if (tool && !args) result = 'Not run: the arguments are not a JSON object.';
      else if (tool && args) {
        result = await tool.run(args, before);
        before = '';
      }
      if (signal.aborted) return { kind: 'stopped', rounds };
      round.results.push({ id: call.id, name: call.name, text: result });
    }
    exchange.push({ role: 'assistant', content: round.text, calls: answer.calls }, { role: 'user', content: '', results: round.results });
  }
  return { kind: 'stopped', rounds };
}
