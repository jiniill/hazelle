import { useSyncExternalStore } from 'react';
import { draftKey } from '../../runtime/device/drafts';
import { useSession } from '../session';

// key: where the chat's unsent text is kept now, a new chat's under its character until it is saved.
export function useDraft(chat: string | null, character: string | null) {
  const { drafts } = useSession();
  const key = draftKey(chat, character);
  const text = useSyncExternalStore(drafts.subscribe, () => drafts.text(key));
  return { key, text, set: (next: string) => drafts.set(key, next) };
}
