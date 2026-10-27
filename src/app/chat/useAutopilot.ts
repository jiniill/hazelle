import { useEffect, useRef, useState } from 'react';
import { costUnit, resolveConnection } from '../../connectors/registry';
import { fold, handEdited, shown, type Message } from '../../model/chat';
import { copyVersion } from '../../runtime/message-acts';
import type { Session } from '../../runtime/session';
import { autoContinue } from '../../runtime/turn';
import { describeFailure, describeTurnFailure } from '../common/failure';
import { useSession } from '../session';
import { estimateRun, parseMessages, runMessages, stepOf, type Estimate, type RunEnd, type Step } from './autopilot';
import type { OpenChat } from './useChat';

// By chat, for the page's life: closing the panel or leaving the chat keeps the list.
const lists = new Map<string, string>();

export type Autopilot = ReturnType<typeof useAutopilot>;

// priced: the model's price is known; an estimate without it, or without a reply's length, has no cost.
export type Outlook = { kind: 'pending' } | { kind: 'unknown' } | { kind: 'unsendable'; why: string } | ({ kind: 'estimate'; priced: boolean } & Estimate);

// The chat's next turn to end, the run's stop, or waiting no longer holding before a turn began.
const nextTurn = ({ store, talk }: Pick<Session, 'store' | 'talk'>, chat: string, signal: AbortSignal, waiting: () => boolean) =>
  new Promise<void>((done) => {
    let began = false;
    const check = () => {
      if (talk.snapshot(chat)) began = true;
      else if (began || !waiting()) finish();
    };
    const leaveTalk = talk.subscribe(check);
    const leaveStore = store.subscribe(check);
    function finish() {
      leaveTalk();
      leaveStore();
      signal.removeEventListener('abort', finish);
      done();
    }
    if (signal.aborted) return finish();
    signal.addEventListener('abort', finish);
    check();
  });

// Wait for the saved-hook continuation before the next send or it would lose its turn.
// Only unedited still-last replies auto-continue; onOutput edits/additions end this wait.
function continues(reply: Message, last: Message | undefined) {
  const version = shown(reply);
  return last?.id === reply.id && !handEdited(version) && version.receipt !== null && autoContinue({ text: version.text, receipt: version.receipt });
}

export function useAutopilot(chat: OpenChat) {
  const session = useSession();
  const { store, talk } = session;
  const { id } = chat;
  const [text, setText] = useState(() => (id && lists.get(id)) || '');
  const [running, setRunning] = useState<{ at: number; total: number; text: string } | null>(null);
  const [end, setEnd] = useState<RunEnd | null>(null);
  const abort = useRef<AbortController | null>(null);
  const say = useRef(chat.actions.say);
  say.current = chat.actions.say;
  // Leaving the chat sends nothing more; the reply under way ends as any reply does when its chat is left.
  useEffect(() => () => abort.current?.abort(), []);
  const messages = parseMessages(text);

  function write(next: string) {
    setText(next);
    if (id) lists.set(id, next);
  }

  async function sendOne(chat: string, message: string, signal: AbortSignal): Promise<Step> {
    const folded = () => fold(store.children('entry', chat));
    const before = new Set(folded().map(({ id }) => id));
    const failure = await say.current(message);
    // A reply's save lands in the store before its turn ends, while the chat's read model may still be refolding.
    const replyIn = (messages: Message[]) => messages.find((each) => !before.has(each.id) && each.role === 'assistant' && shown(each).receipt !== null);
    const waiting = () => {
      const now = folded();
      const reply = replyIn(now);
      return reply !== undefined && continues(reply, now.at(-1));
    };
    if (!failure && waiting()) await nextTurn(session, chat, signal, waiting);
    return stepOf(failure, replyIn(folded()), signal.aborted);
  }

  // Run each message through the screen send, never a private turn path, so all translation/scripts/tools/memory apply.
  // New version only; stop at first stopped/failed message, honor 멈추기 and show cost estimate first (user, 2026-10-17).
  async function run(chat: string, list: string[], signal: AbortSignal): Promise<RunEnd> {
    // A chat with no message has no story to keep.
    const last = fold(store.children('entry', chat)).at(-1);
    if (last) {
      const copied = await copyVersion(session, chat, last);
      if (!copied.ok) return { kind: 'unbranched', why: describeFailure(copied) };
    }
    return runMessages(list, (message, at) => {
      setRunning({ at, total: list.length, text: message });
      return sendOne(chat, message, signal);
    }, signal);
  }

  async function start() {
    if (!id || running || chat.busy || !messages.length) return;
    const controller = new AbortController();
    abort.current = controller;
    setEnd(null);
    setRunning({ at: 0, total: messages.length, text: messages[0]! });
    const ended = await run(id, messages, controller.signal);
    abort.current = null;
    setRunning(null);
    setEnd(ended);
  }

  function stop() {
    abort.current?.abort();
    talk.stop(chat.id!);
  }

  return { text, messages, outlook: outlookOf(messages.length, chat), running, end, write, start, stop };
}

function outlookOf(count: number, { sendNotes: { sending }, messages }: OpenChat): Outlook {
  if (sending === undefined) return { kind: 'pending' };
  if (sending === null) return { kind: 'unknown' };
  if (!('turn' in sending)) return { kind: 'unsendable', why: describeTurnFailure(sending) };
  const { connection, model } = sending.turn.route;
  const input = sending.prompt.parts.reduce((sum, { tokens }) => sum + tokens, 0);
  const reply = messages.findLast((message) => message.role === 'assistant' && shown(message).receipt !== null);
  const output = reply ? (shown(reply).receipt!.usage?.outputTokens ?? null) : null;
  return { kind: 'estimate', priced: model.price !== undefined, ...estimateRun(count, input, output, model.price, costUnit(resolveConnection(connection.value)?.type ?? null)) };
}
