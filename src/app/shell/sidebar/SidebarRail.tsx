import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { ACTS } from '../../common/acts';
import { PLACES } from '../../common/places';
import { ShelfFace, shelfName } from '../../library/shelf';
import { SHORTCUTS } from '../../shortcuts';
import { useStanding } from '../../session';
import { FaceButton, IconButton, Rail, titled, Viewport } from '../../ui';
import { navigate } from '../router';
import { AddMenu } from './AddMenu';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';
import { toolsEntry } from '../tools/ToolsNav';

type Props = {
  shelves: Shelf<ChatSummary>[];
  current: Shelf<ChatSummary> | undefined;
  home: boolean;
  search: boolean;
  board: boolean;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  fold: { open: boolean; onToggle: () => void } | undefined;
};

// On wide screens these places live only here; the list page shows them on phones.
export function SidebarRail({ shelves, current, home, search, board, typing, onEnter, fold }: Props) {
  const { unreadBoard } = useStanding();
  return (
    <Rail
      fold={fold}
      actions={
        <>
          <IconButton {...PLACES.gallery} framed current={home} onClick={() => navigate(HOME)} />
          <IconButton {...PLACES.search} title={titled(PLACES.search.label, SHORTCUTS.search.keys)} framed current={search} onClick={() => navigate({ kind: 'search', query: '' })} />
          <AddMenu trigger={(opener) => <IconButton icon={ACTS.create.icon} label={ACTS.create.label} framed {...opener} />} />
        </>
      }
      places={
        <>
          <IconButton {...PLACES.board} framed current={board} count={unreadBoard} onClick={() => navigate({ kind: 'board', operator: false })} />
          <IconButton {...PLACES.tools} framed onClick={() => navigate(toolsEntry(true))} />
          <IconButton {...PLACES.settings} framed onClick={() => navigate(settingsEntry(true))} />
        </>
      }
    >
      <Viewport keys={shelves.map((shelf) => shelf.id ?? 'none')} variant="rail" current={current && (current.id ?? 'none')}>{(index) => {
        const shelf = shelves[index]!;
        return (
        <FaceButton key={shelf.id ?? 'none'} label={shelfName(shelf)} current={shelf === current} dot={typing(shelf)} onClick={() => onEnter(shelf)}>
          <ShelfFace shelf={shelf} size="rail" />
        </FaceButton>
        );
      }}</Viewport>
    </Rail>
  );
}
