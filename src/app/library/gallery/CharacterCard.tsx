import { Link2, SquarePen } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { selfHost } from '../../../runtime/installation';
import { ACTS, exportOf } from '../../common/acts';
import { ACCOUNT_ONLY, RISU_CHAT_FILE, SHARE } from '../../common/words';
import { aliased } from '../../common/alias';
import { OrderItems, type Ordering } from '../../common/folders/FolderParts';
import { useAccount } from '../../session';
import { navigate } from '../../shell/router';
import { enterShelf } from '../../shell/routes';
import { FaceCard, MenuItem, MoreMenu, useMenuHandle, useMenuOpener, useWide } from '../../ui';
import { binCardNote, cardNote } from '../shelf';
import { BinnedItems } from './BinnedRow';
import { binnedCharacter, type CharacterActions } from '../useCharacterActions';

type Props = {
  shelf: CharacterShelf<ChatSummary>;
  binned: boolean;
  busy: string | null;
  // null while not picking.
  picked: boolean | null;
  onPick: () => void;
  actions: CharacterActions;
  onPurge: () => void;
  // The folder path, shown before the note where cards from every folder stand together.
  where?: string;
  // The card drags onto a folder, and beside other cards where it has an order.
  drag?: boolean;
  order?: Ordering;
  // 순서 바꾸기 is on: the card moves by its handle and opens nothing.
  arranging?: boolean;
};

export function CharacterCard({ shelf, binned, busy, picked, onPick, actions, onPurge, where, drag = false, order, arranging = false }: Props) {
  const wide = useWide();
  const name = aliased(shelf.character.card.name, shelf.character.alias);
  const handle = useMenuHandle();
  const card = useMenuOpener(handle);
  const shows = picked === null && busy === null && !arranging;
  const menu = (
    <MoreMenu handle={handle} of={name}>
      {binned ? (
        <BinnedItems item={binnedCharacter(shelf)} actions={actions} onPurge={onPurge} />
      ) : (
        <>
          <MenuItem icon={SquarePen} label="편집" onClick={() => navigate({ kind: 'edit', character: shelf.id })} />
          {order && <OrderItems order={order} />}
          <CharacterActionItems shelf={shelf} actions={actions} />
        </>
      )}
    </MoreMenu>
  );
  const press = arranging ? { onClick: () => {} } : picked !== null ? { onClick: onPick } : binned ? (shows ? card : { onClick: () => {} }) : { onClick: () => navigate(enterShelf(shelf, wide)) };
  return (
    <FaceCard
      image={shelf.face}
      name={name}
      note={busy ?? (binned ? binCardNote(shelf) : where ? `${where} · ${cardNote(shelf)}` : cardNote(shelf))}
      selected={picked}
      menu={shows ? menu : undefined}
      drag={drag ? shelf.id : undefined}
      onPlace={drag || arranging ? order?.onPlace : undefined}
      arrange={arranging && order ? { key: shelf.id, label: `${name} 순서 바꾸기` } : undefined}
      {...press}
    />
  );
}

export function CharacterActionItems({ shelf, actions, disabled, onRemoved }: { shelf: CharacterShelf<ChatSummary>; actions: CharacterActions; disabled?: boolean; onRemoved?: () => void }) {
  // A share link lives on the server, which holds nothing of a guest's (design §6.14). A self-host has none: its
  // characters travel as files.
  const { guest } = useAccount();
  return (
    <>
      <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} disabled={disabled} onClick={() => void actions.copy(shelf)} />
      <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} disabled={disabled} onClick={() => actions.exportFile(shelf)} />
      <MenuItem icon={ACTS.export.icon} label={exportOf(RISU_CHAT_FILE)} disabled={disabled} onClick={() => actions.exportChats(shelf)} />
      {!selfHost() && <MenuItem icon={Link2} label={SHARE.act} description={guest ? ACCOUNT_ONLY : undefined} disabled={disabled || Boolean(guest)} onClick={() => actions.share(shelf)} />}
      <MenuItem
        icon={ACTS.remove.icon}
        label={ACTS.remove.label}
        tone="warn"
        disabled={disabled}
        onClick={() => void actions.remove(shelf).then((removed) => removed && onRemoved?.())}
      />
    </>
  );
}
