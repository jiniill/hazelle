import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { ACTS } from '../common/acts';
import { ago } from '../common/time';
import { useLibrary } from '../session';
import { navigate } from '../shell/router';
import { Divider, ItemRow, Lineage, MenuItem, MoreMenu, SidePanel, useWide, type Sprout, type Stem } from '../ui';
import { ChatNameDialog, useChatEdits } from './ChatEdits';
import { family, type Child, type Member } from './lineage';
import { carryPanel } from './panels';

export const LINEAGE = '분기 지도';
export const FORGET_ORIGIN = '분기 표시 삭제';

type Props = { current: string; shelf: CharacterShelf<ChatSummary> | null; onClose: () => void };

const sproutLabel = ({ kind, at }: Child) => (kind === 'copy' ? '사본' : at === null ? '분기 · 갈라진 메시지를 몰라요' : `${at}번째 메시지에서 분기`);

// The stems the map draws, and the member each stands for, by its key.
function stemsOf(root: Member, current: string): { root: Stem; members: Map<string, Member> } {
  const members = new Map<string, Member>();
  const stem = (member: Member): Stem => {
    const key = member.kind === 'chat' ? member.chat.id : `ghost:${member.id}`;
    members.set(key, member);
    return { key, length: member.kind === 'chat' ? member.chat.count ?? 0 : 0, current: member.kind === 'chat' && member.chat.id === current, ghost: member.kind === 'ghost', children: member.children.map(sprout) };
  };
  const sprout = (child: Child): Sprout => ({ kind: child.kind, at: child.at, label: sproutLabel(child), stem: stem(child.member) });
  return { root: stem(root), members };
}

export function ChatLineage({ current, shelf, onClose }: Props) {
  const { none } = useLibrary();
  const { chats } = shelf ?? none;
  const edits = useChatEdits();
  const wide = useWide();
  const [naming, setNaming] = useState<ChatSummary | null>(null);
  const { root, members } = useMemo(() => stemsOf(family(chats, current), current), [chats, current]);
  // Beside the story the map stays open in the chat it opens; covering it, the chat takes its place.
  function open(id: string) {
    if (wide) carryPanel(id, { kind: 'lineage' });
    navigate({ kind: 'chat', id });
  }
  const head = (stem: Stem) => {
    const member = members.get(stem.key)!;
    if (member.kind === 'ghost') return <ItemRow title={`삭제된 채팅 '${member.name}'`} time="" typing={false} preview="" tone="muted" />;
    const { chat } = member;
    return (
      <ItemRow
        title={chat.title}
        time=""
        typing={false}
        preview={[chat.count === null ? null : `메시지 ${chat.count}개`, chat.at === null ? null : ago(chat.at)].filter((part) => part !== null).join(' · ')}
        current={chat.id === current}
        control={
          <MoreMenu of="채팅">
            <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming(chat)} />
            <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void edits.duplicate(chat)} />
            {chat.chat.origin && <MenuItem label={FORGET_ORIGIN} onClick={() => edits.forgetOrigin(chat.id)} />}
            <Divider variant="menu" />
            <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => edits.drop([{ id: chat.id, title: chat.title, character: chat.chat.character }])} />
          </MoreMenu>
        }
        onClick={() => open(chat.id)}
      />
    );
  };
  // The chat route opens at a message only with a search term, so a sprout's mark opens its origin whole.
  const onSprout = (parent: Stem) => {
    const member = members.get(parent.key)!;
    if (member.kind === 'chat') open(member.chat.id);
  };
  return (
    <SidePanel title={LINEAGE} expandable onClose={onClose}>
      <Lineage root={root} label={LINEAGE} head={head} onSprout={onSprout} />
      {naming && (
        <ChatNameDialog
          title={naming.title}
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
