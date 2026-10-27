import { FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { chatPrompt, isDefaultPrompt, ofSort, type PromptChoice } from '../../runtime/prompts';
import { useSearch } from '../common/useSearch';
import { byLastUse, byPromptName, groupPrompts, promptFolder } from '../common/promptCopies';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FolderPath } from '../common/folders/FolderParts';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { defaultMark, DELETED_PROMPT, follows, promptName } from '../common/words';
import { useSession, useSettings, usePrompts } from '../session';
import { useToast } from '../toast';
import { Button, ChipButton, Dialog, Empty, hasFinePointer, Icon, List, ListItem, Row } from '../ui';
import type { ChatSettingsActions } from './useChatSettings';

const NO_PROMPT = '유틸리티 봇처럼';

// Without its own choice it follows the default live, and a deleted one shows as missing, never as another prompt.
// out: a 캐릭터 없이 chat that keeps the prompt out (model/chat keepsPromptOut).
export function ChatPromptPicker({ prompt, out, open, onOpen }: { prompt: PromptChoice; out: boolean; open: boolean; onOpen: () => void }) {
  const label = out ? NO_PROMPT : prompt.kind === 'prompt' ? prompt.prompt.value.name : prompt.own ? DELETED_PROMPT : '기본 프롬프트 없음';
  return (
    <ChipButton
      label={label}
      title="이 채팅의 프롬프트"
      leading={<Icon icon={FileText} size="sm" />}
      tone={prompt.kind === 'missing' && !out ? 'warn' : 'plain'}
      phone="icon"
      popup="dialog"
      expanded={open}
      ref={null}
      onClick={onOpen}
    />
  );
}

// Mounted only while open, so each opening starts with an empty search, in the folder of the chat's own prompt. A touch
// screen gets no focused search, whose keyboard would cover the list. plain: a 캐릭터 없이 chat, which lists 유틸리티 봇처럼
// first; out: that row is its choice.
type DialogProps = { prompt: PromptChoice; plain: boolean; out: boolean; onChoose: ChatSettingsActions['setPrompt']; onKeepOut: ChatSettingsActions['keepPromptOut']; onEdit: (id: string | null) => void; onClose: () => void };
export function PromptDialog({ prompt, plain, out, onChoose, onKeepOut, onEdit, onClose }: DialogProps) {
  const { store } = useSession();
  const all = usePrompts();
  const prompts = useMemo(() => all.filter((each) => ofSort(each, 'conversation')), [all]);
  const uses = usePromptUse();
  const settings = useSettings();
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hasFinePointer()) field.current?.focus();
  }, []);
  const fallback = chatPrompt(store, {});
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const own = !out && prompt.own && prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const search = useSearch(prompts.toSorted(byPromptName), '프롬프트 검색', (item) => [promptName(item.value.name)], { ref: field, onEnter: (first) => choose(first.id) });
  const index = useFolderIndex('prompt', grouped.top, promptFolder);
  const [place, setPlace] = useState(() => (own !== null && prompt.kind === 'prompt' ? promptFolder(prompt.prompt) : null));
  const at = placeIn(index, place, search.words !== '');

  function choose(value: string | null) {
    onClose();
    void onChoose(value).then((saved) => saved.ok || toast.failed(saved));
  }
  function keepOut() {
    onClose();
    void onKeepOut().then((saved) => saved.ok || toast.failed(saved));
  }
  function open(id: string | null) {
    onClose();
    onEdit(id);
  }

  // A picker shows every copy under its original, since the one to pick is often a copy.
  const row = (item: Stored<'prompt'>, nested: boolean): ReactNode => (
    <ListItem
      key={item.id}
      title={promptName(item.value.name)}
      badge={defaultMark(isDefaultPrompt(settings, item), item.value.name)}
      note={[!nested && search.words ? whereIs(index, promptFolder(item)) : undefined, promptUseWords(uses.get(item.id) ?? EMPTY_USE)].filter(Boolean).join(' · ')}
      selected={item.id === own}
      onClick={() => choose(item.id)}
    >
      {nested && grouped.copies.get(item.id)?.map((copy) => row(copy, true))}
    </ListItem>
  );

  const footer = (
    <Row kind="actions">
      {prompt.kind === 'prompt' && (
        <Button variant="link" onClick={() => open(prompt.prompt.id)}>
          이 프롬프트 편집
        </Button>
      )}
      <Button variant="link" onClick={() => open(null)}>
        프롬프트 관리
      </Button>
    </Row>
  );
  return (
    <Dialog title="이 채팅의 프롬프트" onClose={onClose} toolbar={search.field || undefined} footer={footer}>
      {index.folders.length > 0 && !search.words && <FolderPath kind="prompt" path={at.path} onGo={setPlace} />}
      {search.none && <Empty>{search.none}</Empty>}
      <List label="프롬프트">
        {plain && !search.words && !at.here && <ListItem title={NO_PROMPT} selected={out} onClick={keepOut} />}
        {!search.words && !at.here && <ListItem title={follows('기본 프롬프트')} description={fallback.kind === 'prompt' ? fallback.prompt.value.name : '기본 프롬프트 없음'} selected={!out && !prompt.own} onClick={() => choose(null)} />}
        {at.folders.map((folder) => (
          <ListItem key={folder.id} folder title={folder.value.name} note={folderNote('prompt', index.byFolder.get(folder.id)!)} onClick={() => setPlace(folder.id)} />
        ))}
        {search.words ? search.found.map((item) => row(item, false)) : at.placed(grouped.top).toSorted(byLastUse(uses, grouped.copies)).map((item) => row(item, true))}
      </List>
    </Dialog>
  );
}
