import { LayoutGrid, MessagesSquare, Settings, Wrench } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { ACTS } from '../../common/acts';
import { ShelfFace, shelfName } from '../../library/shelf';
import { BOARD, SETTINGS, TOOLS } from '../../common/words';
import { useStanding } from '../../session';
import { FaceButton, IconButton, Rail, Viewport } from '../../ui';
import { navigate } from '../router';
import { AddMenu } from './AddMenu';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';
import { toolsEntry } from '../tools/ToolsNav';

type Props = {
  shelves: Shelf<ChatSummary>[];
  current: Shelf<ChatSummary> | undefined;
  home: boolean;
  board: boolean;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  fold: { open: boolean; onToggle: () => void } | undefined;
};

// On wide screens these places live only here; the list page shows them on phones.
export function SidebarRail({ shelves, current, home, board, typing, onEnter, fold }: Props) {
  const { unreadBoard } = useStanding();
  return (
    <Rail
      fold={fold}
      actions={
        <>
          <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" framed current={home} onClick={() => navigate(HOME)} />
          <AddMenu trigger={(opener) => <IconButton icon={ACTS.create.icon} label={ACTS.create.label} framed {...opener} />} />
        </>
      }
      places={
        <>
          <IconButton icon={MessagesSquare} label={BOARD.title} framed current={board} count={unreadBoard} onClick={() => navigate({ kind: 'board', operator: false })} />
          <IconButton icon={Wrench} label={TOOLS} framed onClick={() => navigate(toolsEntry(true))} />
          <IconButton icon={Settings} label={SETTINGS} framed onClick={() => navigate(settingsEntry(true))} />
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
