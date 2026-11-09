import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { framePage } from '../common/frame';
import { backBar, openPart } from '../shell/router';
import type { Back, CharacterPart } from '../shell/routes';
import { useWide } from '../ui';
import { CharacterEditor } from './CharacterEditor';

type At = { part?: CharacterPart; script?: string };

// at: what the address has open, nothing on a character's own page beside its chats.
export function CharacterEditScreen({ shelf, at, back }: { shelf: CharacterShelf<ChatSummary>; at: At; back: Back | null }) {
  const wide = useWide();
  const open = (next: At) => openPart({ kind: 'edit', character: shelf.id, ...next }, wide);
  // A part's own 뒤로, back to the list of parts, comes before the page's.
  return (
    <CharacterEditor
      shelf={shelf}
      layout={wide ? 'split' : 'drill'}
      part={at.part ?? null}
      onPart={(next) => open(next ? { part: next } : {})}
      script={at.script ?? null}
      onScript={(next) => open({ part: 'scripts', ...(next && { script: next }) })}
      frame={(parts) => framePage({ ...parts, head: { ...backBar(back), ...parts.head } })}
    />
  );
}
