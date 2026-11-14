import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { ACTS } from '../common/acts';
import { deletedChat, FORGET_ORIGIN, LINEAGE } from '../common/words';
import { ago } from '../common/time';
import { usePersisted } from '../common/usePersisted';
import { useLibrary } from '../session';
import { navigate } from '../shell/router';
import { ChoiceGroup, Divider, Lineage, LineageList, MenuItem, MoreMenu, SidePanel, useWide, type LineageHead, type Sprout, type Stem } from '../ui';
import { ChatNameDialog, useChatEdits } from './ChatEdits';
import { countChats, family, type Child, type Member } from './lineage';
import { carryPanel } from './panels';

type Props = { current: string; shelf: CharacterShelf<ChatSummary> | null; onClose: () => void };

type View = 'map' | 'list';
// wide: the panel expanded over the page; narrow: beside the page or covering it.
type Mode = 'wide' | 'narrow';
const VIEWS: { value: View; label: string }[] = [
  { value: 'map', label: '지도' },
  { value: 'list', label: '목록' },
];
// The map wants the room of 넓게 보기; narrower, the list.
const DEFAULT_VIEW: Record<Mode, View> = { wide: 'map', narrow: 'list' };
const MODES: Mode[] = ['wide', 'narrow'];
const isView = (value: unknown): value is View => VIEWS.some((view) => view.value === value);

// The reader's own choice in each mode, kept apart: one who prefers the list even wide keeps it.
function parseViews(stored: string): Partial<Record<Mode, View>> {
  const parsed: unknown = JSON.parse(stored);
  const views: Partial<Record<Mode, View>> = {};
  if (typeof parsed !== 'object' || parsed === null) return views;
  for (const mode of MODES) {
    const view: unknown = (parsed as Record<string, unknown>)[mode];
    if (isView(view)) views[mode] = view;
  }
  return views;
}

// The stems the map draws, and the member each stands for, by its key.
function stemsOf(root: Member, current: string): { root: Stem; members: Map<string, Member> } {
  const members = new Map<string, Member>();
  const stem = (member: Member): Stem => {
    const key = member.kind === 'chat' ? member.chat.id : `ghost:${member.id}`;
    members.set(key, member);
    return { key, length: member.kind === 'chat' ? member.chat.count ?? 0 : 0, current: member.kind === 'chat' && member.chat.id === current, ghost: member.kind === 'ghost', children: member.children.map(sprout) };
  };
  const sprout = (child: Child): Sprout => ({ kind: child.kind, at: child.at, stem: stem(child.member) });
  return { root: stem(root), members };
}

export function useFamily(current: string, shelf: CharacterShelf<ChatSummary> | null): Member {
  const { none } = useLibrary();
  const { chats } = shelf ?? none;
  return useMemo(() => family(chats, current), [chats, current]);
}

export function ChatLineage({ current, shelf, onClose }: Props) {
  const tree = useFamily(current, shelf);
  const edits = useChatEdits();
  const wide = useWide();
  const [naming, setNaming] = useState<ChatSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const mode: Mode = expanded ? 'wide' : 'narrow';
  const [views, chooseView] = usePersisted('risu-alpha:lineage-view', parseViews, {});
  const view = views[mode] ?? DEFAULT_VIEW[mode];
  const [preview, setPreview] = usePersisted('risu-alpha:lineage-preview', (stored) => stored === 'true', true, String);
  const count = useMemo(() => countChats(tree), [tree]);
  const { root, members } = useMemo(() => stemsOf(tree, current), [tree, current]);
  // Beside the story the map stays open in the chat it opens; covering it, the chat takes its place.
  function open(id: string) {
    if (wide) carryPanel(id, { kind: 'lineage' });
    navigate({ kind: 'chat', id });
  }
  const head = (stem: Stem): LineageHead => {
    const member = members.get(stem.key)!;
    if (member.kind === 'ghost') return { title: deletedChat(member.name) };
    const { chat } = member;
    return {
      title: chat.title,
      note: [chat.count === null ? null : `${chat.count}개`, chat.at === null ? null : ago(chat.at)].filter((part) => part !== null).join(' · '),
      preview: chat.preview ?? undefined,
      starred: chat.chat.starred && ACTS.star.label,
      control: (
        <MoreMenu of={`'${chat.title}'`}>
          <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming(chat)} />
          <MenuItem icon={ACTS.star.icon} label={ACTS.star.label} checked={chat.chat.starred ?? false} multiple onClick={() => edits.star(chat)} />
          <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void edits.duplicate(chat)} />
          {chat.chat.origin && <MenuItem label={FORGET_ORIGIN} onClick={() => edits.forgetOrigin(chat.id)} />}
          <Divider variant="menu" />
          <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => edits.drop([{ id: chat.id, title: chat.title, character: chat.chat.character }])} />
        </MoreMenu>
      ),
      onClick: () => open(chat.id),
    };
  };
  // The chat route opens at a message only with a search term, so a pill opens its origin whole.
  const onPill = (parent: Stem) => {
    const member = members.get(parent.key)!;
    if (member.kind === 'chat') open(member.chat.id);
  };
  const Family = view === 'map' ? Lineage : LineageList;
  return (
    <SidePanel
      title={LINEAGE}
      description={`채팅 ${count}개`}
      expandable
      onExpand={setExpanded}
      fill
      actions={
        <>
          <ChoiceGroup label="보기" layout="fit" options={VIEWS} value={view} onChange={(next) => chooseView({ ...views, [mode]: next })} />
          <MoreMenu of={LINEAGE}>
            <MenuItem label="미리보기" checked={preview} multiple onClick={() => setPreview(!preview)} />
          </MoreMenu>
        </>
      }
      onClose={onClose}
    >
      {/* Widened or narrowed, the family is laid out afresh, so the scroll to the open chat starts over. */}
      <Family key={mode} root={root} label={LINEAGE} head={head} preview={preview} onPill={onPill} />
      {naming && (
        <ChatNameDialog
          title={naming.title}
          origin={naming.chat.origin !== undefined}
          onSave={(name) => {
            edits.rename(naming.id, name);
            setNaming(null);
          }}
          onClose={() => setNaming(null)}
        />
      )}
    </SidePanel>
  );
}
