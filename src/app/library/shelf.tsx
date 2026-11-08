import { MessageSquare } from 'lucide-react';
import type { ChatSummary } from '../../model/chat';
import { daysLeft, type CharacterShelf, type Shelf } from '../../model/library';
import { aliased } from '../common/alias';
import { NO_CHARACTER } from '../common/words';
import { ago } from '../common/time';
import { Avatar } from '../ui';

export const shelfName = ({ character }: Shelf<ChatSummary>) => (character ? aliased(character.card.name, character.alias) : NO_CHARACTER);

export const NO_CHATS = '채팅이 없어요';

// What removing a character takes with it, the noun 삭제했어요 or 삭제해요 takes.
export const withChats = (shelf: CharacterShelf<ChatSummary>) => (shelf.chats.length ? `캐릭터와 채팅 ${shelf.chats.length}개` : '캐릭터');

export function ShelfFace({ shelf, size }: { shelf: Shelf<ChatSummary>; size?: 'sm' | 'md' | 'rail' | 'lg' }) {
  return shelf.character ? <Avatar face={shelf.character.card.name} image={shelf.face} size={size} /> : <Avatar face={MessageSquare} size={size} />;
}

export function cardNote(shelf: CharacterShelf<ChatSummary>): string {
  const latest = shelf.chats[0];
  return latest?.at ? `${ago(latest.at)} · 채팅 ${shelf.chats.length}개` : NO_CHATS;
}

// Past its time it goes when the app next opens.
export function timeLeft(deleted: { deleted?: number }): string {
  const days = daysLeft(deleted, Date.now());
  return days > 0 ? `${days}일 남음` : '곧 삭제';
}

export function binCardNote(shelf: CharacterShelf<ChatSummary>): string {
  return timeLeft(shelf.character) + (shelf.chats.length ? ` · 채팅 ${shelf.chats.length}개` : '');
}
