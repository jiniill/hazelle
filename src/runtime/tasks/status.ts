import { parseStatus } from '../../engine/status';
import { fold, statusChanges } from '../../model/chat';
import { live } from '../../model/library';
import { statusAfter, type StatusDefinition } from '../../model/status';
import { statusOf } from '../chat/chat-context';
import type { Written } from '../chat/chat-log';
import type { ObjectStore } from '../store/store';

// 상태 (design §6.1): who writes a chat's state changes. Here the conversation model's own block; the model that
// writes after the reply follows.

type Reader = Pick<ObjectStore, 'get' | 'children' | 'scopeState'>;

// The chat's definitions the conversation model writes at its reply's end.
function askedWith(store: Reader, chat: string): StatusDefinition[] {
  const stored = live(store.get('chat', chat));
  return stored ? statusOf(store, stored.value).filter(({ writer }) => writer === 'with') : [];
}

// Whether the chat's replies end with a block that is cut: one being written is then shown without it.
export const cutsStatus = (store: Reader, chat: string) => askedWith(store, chat).length > 0;

// The reply as it is handed on to the bot's scripts and the save: its block cut from its text and read against the
// state its model was told. A chat that asks for none keeps its text whole, since a bot may draw a block of its own.
// A reply that did not end whole has its block cut and writes nothing; one that ended with no block to read is kept
// as missed, never guessed. A continuation carries what the version it continues wrote, which its model was told.
export function cutStatus(store: Reader, chat: string, reply: Written): Written {
  const asked = askedWith(store, chat);
  if (!asked.length) return reply;
  const of = asked.map(({ id }) => id);
  const messages = fold(store.children('entry', chat));
  const at = reply.message === null ? -1 : messages.findIndex(({ id }) => id === reply.message);
  const continued = reply.receipt.continues && at !== -1 ? messages[at]!.versions.find(({ id }) => id === reply.replaces) : undefined;
  const carried = (continued?.status ?? []).flatMap(({ changes }) => changes).filter(({ definition }) => of.includes(definition));
  const told = statusAfter(asked, [...statusChanges(at === -1 ? messages : messages.slice(0, at)), ...carried]);
  const read = parseStatus(reply.text, asked, told, () => crypto.randomUUID());
  if (reply.receipt.state !== 'done') return { ...reply, text: read.text };
  return { ...reply, text: read.text, status: { of, changes: [...carried, ...read.changes], receipt: null, at: reply.at, ...(read.unread.length > 0 && { unread: read.unread }), ...(!read.found && { missed: true as const }) } };
}
