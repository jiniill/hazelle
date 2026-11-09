import { useEffect, useState, type ReactNode } from 'react';
import { live } from '../../model/library';
import type { SideAt } from '../chat/ChatScreen';
import { PackToggles } from '../common/PackToggles';
import { moduleName } from '../common/words';
import { CharacterEditor } from '../library/CharacterEditor';
import { PromptEditor } from '../prompts/PromptEditor';
import { PromptList } from '../prompts/PromptList';
import { useCharacter, useStored } from '../session';
import { Button, Row, SidePanel, type NavBarProps } from '../ui';
import { navigate } from './router';

type Props<K extends SideAt['open']['kind']> = Omit<SideAt, 'open'> & { open: Extract<SideAt['open'], { kind: K }> };
const panel =
  (title: string, onClose: () => void) =>
  // The head is one line at the chat header's height, so a list's actions stand at the top of its body.
  ({ head: { actions, ...head }, body, open: page }: { head: NavBarProps; body: ReactNode; open?: string }) => (
    <SidePanel title={title} nav={head} page={page} expandable onClose={onClose}>
      {actions}
      {body}
    </SidePanel>
  );

// Each editor is keyed by its id and saves as it unmounts, so going back to the list or closing the panel saves what
// was typed.
export function ChatSide(props: SideAt) {
  const { open } = props;
  if (open.kind === 'character') return <CharacterSide key={open.id} {...props} open={open} />;
  if (open.kind === 'module') return <ModuleSide {...props} open={open} />;
  return <PromptSide {...props} open={open} />;
}

function CharacterSide({ open, onOpen, onClose }: Props<'character'>) {
  // The chat is gone from the page with its character, so the character is there while this is.
  const shelf = useCharacter(open.id)!;
  // The panel's own: a chat's panels name no script.
  const [script, setScript] = useState<string | null>(null);
  return <CharacterEditor shelf={shelf} layout="drill" part={open.part} onPart={(part) => onOpen({ ...open, part, fromToggles: undefined })} script={script} onScript={setScript} partBack={open.fromToggles && { label: '채팅 토글', onBack: () => onOpen({ kind: 'toggles' }) }} frame={panel('캐릭터', onClose)} />;
}

// A module deleted elsewhere while open goes back to the 토글 panel, which no longer lists it.
function ModuleSide({ open, onOpen, onClose }: Props<'module'>) {
  const stored = live(useStored('module', open.id));
  const toToggles = () => onOpen({ kind: 'toggles' });
  useEffect(() => {
    if (!stored) onOpen({ kind: 'toggles' });
  }, [stored, onOpen]);
  if (!stored) return null;
  const toModule = (
    <Row kind="actions">
      <Button variant="link" size="xs" onClick={() => navigate({ kind: 'module', id: stored.id, pane: null })}>
        모듈 열기
      </Button>
    </Row>
  );
  return panel('모듈', onClose)({ head: { title: moduleName(stored.value.name), onBack: toToggles, backLabel: '채팅 토글' }, body: <>{toModule}<PackToggles owner={{ kind: 'module', id: stored.id }} lines={stored.value.toggles} /></>, open: 'toggles' });
}

function PromptSide({ open, inUse, onOpen, onClose }: Props<'prompts'>) {
  const stored = live(useStored('prompt', open.id));
  // Kept while a prompt is open, so 프롬프트 목록 goes back to the folder it was opened from.
  const [place, setPlace] = useState<string | null>(null);
  const toList = () => onOpen({ kind: 'prompts', id: null, pane: null });
  if (!stored) return <PromptList onPick={(id) => onOpen({ kind: 'prompts', id, pane: null })} inUse={inUse ?? undefined} place={place} onGo={setPlace} frame={panel('프롬프트', onClose)} />;
  return (
    <PromptEditor
      key={stored.id}
      stored={stored}
      layout="drill"
      at={open}
      onAt={(at) => onOpen({ kind: 'prompts', id: stored.id, ...at })}
      paneBack={open.fromToggles && { label: '채팅 토글', onBack: () => onOpen({ kind: 'toggles' }) }}
      backLabel="프롬프트 목록"
      onBack={toList}
      onOpen={(id) => onOpen({ kind: 'prompts', id, pane: null })}
      onErased={toList}
      frame={panel('프롬프트', onClose)}
    />
  );
}
