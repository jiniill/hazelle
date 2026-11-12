import { useEffect } from 'react';
import { live } from '../../model/library';
import { aliased } from '../common/alias';
import { NO_CHARACTER, SEE } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { navigate, useRoute } from './router';

// A reply outlives the chat screen it was asked from (Talk): one that ends while its chat is not the one open is said,
// with the way back to it. A chat deleted meanwhile says nothing.
export function Arrivals() {
  const { cues, store, read } = useSession();
  const toast = useToast();
  const route = useRoute();
  const open = route.kind === 'chat' ? route.id : null;
  useEffect(() => cues.subscribe((moment, chat) => {
    if (chat === open || (moment !== 'reply-received' && moment !== 'reply-failed')) return;
    const stored = live(store.get('chat', chat));
    if (!stored) return;
    const character = stored.value.character === null ? null : live(store.get('character', stored.value.character));
    const name = character ? aliased(character.value.card.name, character.value.alias) : read.summary(chat).snapshot()?.title ?? NO_CHARACTER;
    const action = { label: SEE, onClick: () => navigate({ kind: 'chat', id: chat }) };
    if (moment === 'reply-received') toast.show(`${name} 응답이 도착했어요`, { action });
    else toast.error(`${name} 응답이 실패했어요`, { action });
  }), [cues, open]);
  return null;
}
