import { discounted, priceCost } from './pricing';
import { costUnit, type Route } from './registry';
import { SseParser } from './sse';
import { thoughts } from './thoughts';
import type { Codec, Cost, Discount, Model, Phase, StreamFacts, Terminal, ToolCall, Usage } from './types';

// A cut or failed reply is never shown as a clean success.
export type Outcome = {
  state: 'done' | 'cut' | 'failed';
  // refused: the provider ended the reply by refusing it after text had come; refused with no text is a failure.
  cut: 'length' | 'no-terminal' | 'stopped' | 'refused' | null;
  // null on a failed reply: the model finished without a word (or a call), and no provider said why.
  error: { kind: 'provider' | 'bad-event' | 'network'; detail: string; code?: string } | null;
  inputComplete?: true;
  finishReason: string | null;
  usage: Usage | null;
  // Look up pending booked costs before model prices, or priced models never learn their actual bill.
  cost: Cost | 'pending' | null;
  replyId: string | null;
  // The discount lane that served it (model/chat Receipt discount); absent when none did.
  discount?: Discount['lane'];
  // The tool calls the reply made, in order; empty when it made none.
  calls: ToolCall[];
};

// keep applies only to character replies, never translations (user, 2026-10-04).
// Only Talk consumes takeBack; other tasks still receive the returned content as text.
export type InlineThoughts = { keep?: boolean; takeBack?: (chars: number) => void };

// Streaming and whole JSON replies must share facts/end rules; batched means a discount-batch result.
export async function decodeStream({ type, codec }: Route, model: Model, response: Response, signal: AbortSignal, onText: (phase: Phase, text: string) => void, inline: InlineThoughts = {}, batched = false): Promise<Outcome> {
  const facts: StreamFacts = { rawUsage: {}, finishReason: null, id: null, tier: null, calls: [] };
  let said = false;
  const told = (phase: Phase, text: string) => {
    if (phase === 'text' && /\S/.test(text)) said = true;
    onText(phase, text);
  };
  const scanner = inline.keep ? null : thoughts(told, inline.takeBack ?? (() => {}));
  const append = (phase: Phase, text: string) => text && (scanner ? scanner.push(phase, text) : told(phase, text));

  const unit = costUnit(type);
  const finish = (state: Outcome['state'], cut: Outcome['cut'], error: Outcome['error']): Outcome => {
    scanner?.end(state === 'done');
    const usage = Object.keys(facts.rawUsage).length ? codec.usage(facts.rawUsage) : null;
    // Priced by what the provider reports, never by the switch: a reply the lane did not serve costs the standard rate.
    const lane = type?.discount;
    const served = lane && (lane.lane === 'batch' ? batched : facts.tier === lane.served) ? lane : null;
    const price = model.price && (served ? discounted(model.price, served.rates) : model.price);
    return {
      state,
      cut,
      error,
      finishReason: facts.finishReason,
      usage,
      cost: type?.cost?.({ facts, usage, model }) ?? (type?.settle && facts.id ? 'pending' : null) ?? (price ? priceCost(price, usage, unit) : null),
      replyId: facts.id,
      ...(served && { discount: served.lane }),
      calls: facts.calls.map(({ id, name, arguments: text, echo }) => ({ id, name, arguments: text, ...(echo !== undefined && { echo }) })),
    };
  };

  const media = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  let ended: { terminal: Terminal | null } | { badEvent: string };
  try {
    ended = media === 'application/json' ? await readWhole(codec, response, facts, append) : await readEvents(codec, response, facts, append);
  } catch (error) {
    if (signal.aborted) return finish('cut', 'stopped', null);
    return finish('failed', null, { kind: 'network', detail: error instanceof Error ? error.message : String(error) });
  }

  if ('badEvent' in ended) return finish('failed', null, { kind: 'bad-event', detail: ended.badEvent });
  const { terminal } = ended;
  if (terminal?.state === 'failed') return finish('failed', null, { kind: 'provider', detail: terminal.error, ...(terminal.code && { code: terminal.code }) });
  // A stream may close without its end marker after the model already said why it stopped.
  if (!terminal && facts.finishReason === null) return finish('cut', 'no-terminal', null);
  if (facts.refusal || (facts.finishReason !== null && codec.refused(facts.finishReason))) {
    // Judged after finish, which lets the scanner say the text it held back.
    const refused = finish('cut', 'refused', null);
    return said ? refused : { ...refused, state: 'failed', cut: null, error: { kind: 'provider', detail: facts.refusal ?? facts.finishReason! } };
  }
  const outcome = facts.finishReason !== null && codec.truncated(facts.finishReason) ? finish('cut', 'length', null) : finish('done', null, null);
  // A finish reason without the codec's terminal is not authoritative input evidence.
  const answered = terminal?.state === 'completed' ? { ...outcome, inputComplete: true as const } : outcome;
  return answered.state === 'done' && !said && facts.calls.length === 0 ? { ...answered, state: 'failed' } : answered;
}

type Append = (phase: Phase, text: string) => void;

async function readWhole(codec: Codec, response: Response, facts: StreamFacts, append: Append) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { badEvent: text.slice(0, 200) };
  }
  const terminal = codec.whole(payload, facts, append);
  return terminal ? { terminal } : { badEvent: text.slice(0, 200) };
}

// A 204 carries no body: the same as a stream that closed before anything came.
async function readEvents(codec: Codec, response: Response, facts: StreamFacts, append: Append) {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body?.getReader();
  let terminal: Terminal | null = null;
  try {
    while (reader && !terminal) {
      const { done, value } = await reader.read();
      const events = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
      for (const data of events) {
        let event: unknown;
        try {
          event = data === '[DONE]' ? data : JSON.parse(data);
        } catch {
          return { badEvent: data.slice(0, 200) };
        }
        codec.read(event, facts, append);
        terminal = codec.terminal(event);
        if (terminal) break;
      }
      if (done) break;
    }
  } finally {
    // Ends the upstream call once a terminal event arrived early; harmless after the stream's own end.
    void reader?.cancel().catch(() => {});
  }
  return { terminal };
}
