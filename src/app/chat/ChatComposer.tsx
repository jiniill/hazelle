import { useRef, type KeyboardEvent } from 'react';
import type { GapCause } from '../../contracts/auto-diagnosis';
import { refOf } from '../../connectors/assignment';
import { importable } from '../../engine/import/extensions';
import { toolId } from '../../model/tool';
import type { DraftAttachment } from '../../runtime/device/drafts';
import { leavingCauses } from '../../runtime/tasks/memory-view';
import type { Blocked } from '../../runtime/chat/turn-context';
import { describeTurnFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { ACTS } from '../common/acts';
import { count } from '../common/typedNumber';
import { ANSWER, NO_PICTURES, UNKNOWN_PICTURES, PICK_MODEL, MESSAGE_FIELD, REGEX_OFF } from '../common/words';
import { LEAVING } from './memory';
import type { PromptDoor } from '../common/TaskPrompt';
import { navigate } from '../shell/router';
import { SHORTCUTS, typing, useSendKeys, useShortcut } from '../shortcuts';
import { useDisplay } from '../display';
import { useRemembering, useSettings, useTools } from '../session';
import { useImport } from '../common/importing';
import { Attachments, type Attached, Callout, Composer, DropOverlay, Hint, pressed, pressedKey, SendButton, SendNote, titled, useAside, useFileDrop, useMenuOpener } from '../ui';
import { ChatAsk } from './ChatAsk';
import { attachTool } from './ChatAttach';
import { ChatCache } from './ChatCache';
import { ChatModel } from './ChatModel';
import { composerTool } from './ChatComposerTools';
import { illustrateTool } from './ChatIllustrate';
import { speechTool } from './ChatSpeech';
import { noteTool } from './ChatNote';
import { ChatPinnedToggles, PinnedTogglesLayout } from './ChatPinnedToggles';
import { personaTool } from './ChatPersonaPicker';
import { ChatToolMore, ChatToolRow, type RowTool } from './ChatToolRow';
import { translateTool } from './ChatTranslate';
import { toolIsOn } from './toolMenu';
import { promptEditor } from './panels';
import type { OpenChat } from './useChat';
import type { ComposerFold } from './useComposerFold';

const UNSEEN = '이미지는 제외하고 텍스트만 보내며, 이미지만 있는 메시지는 보내지 않아요.';

function LeavingNote({ count, causes, onOpen }: { count: number; causes: GapCause[]; onOpen: (() => void) | undefined }) {
  return <SendNote label={`메시지 ${count}개`} title="요청에서 제외될 메시지" warning={{ words: LEAVING[causes[0]!].words, why: causes.map((cause) => LEAVING[cause].why).join(' ') }} onClick={onOpen} />;
}

type Chip = 'model' | 'prompt' | 'persona' | 'profile';
const FIX = {
  'no-model': { label: PICK_MODEL, chip: 'model' },
  'model-gone': { label: PICK_MODEL, chip: 'model' },
  'image-only': { label: PICK_MODEL, chip: 'model' },
  'prompt-missing': { label: '프롬프트 선택', chip: 'prompt' },
  'persona-missing': { label: '페르소나 선택', chip: 'persona' },
  'profile-missing': { label: '모델 설정 선택', chip: 'profile' },
} as const satisfies Record<Blocked['kind'], { label: string; chip: Chip }>;

const attachedItem = (each: DraftAttachment): Attached =>
  each.kind === 'picture'
    ? { kind: 'picture', key: each.name, url: each.url, label: '이미지', state: each.state.kind }
    : { kind: 'file', key: each.value.name, label: each.value.title, detail: `${count(each.value.text.split('\n').length)}줄`, state: 'saved' };

// fold: ChatScreen's, which the frame's footer measures by, so the two never disagree.
export function ChatComposer({ chat, fold }: { chat: OpenChat; fold: ComposerFold }) {
  const { draft, attachments, messages, last, answerable, busy, problem, skippable, stuck, translate, sendLanguage, modelMenu, shelf, route, actions } = chat;
  // A model whose own 모델 설정 is gone picks another on its page; a missing default is set in 설정 › 모델.
  const profilePage = problem?.kind === 'profile-missing' && problem.own && !('kind' in route) ? { kind: 'model' as const, ...refOf(route.connection.id, route.model) } : { kind: 'models' as const };
  const chips: Record<Chip, { onClick: () => void }> = {
    model: useMenuOpener(modelMenu),
    prompt: { onClick: () => actions.openDialog('prompt') },
    persona: { onClick: () => actions.openDialog('persona') },
    profile: { onClick: () => navigate(profilePage) },
  };
  const editPrompt = (door: PromptDoor) => actions.side(promptEditor(door));
  const storedTools = useTools();
  const aside = useAside();
  const rowTools: RowTool[] = [
    attachTool({ sees: attachments.sees, moved: attachments.moved, onAttach: actions.attach, onMoved: actions.sendMoved }),
    personaTool({ persona: chat.persona, open: chat.dialog === 'persona', onOpen: () => actions.openDialog('persona') }),
    noteTool({ id: chat.id, note: chat.note, prompt: chat.prompt, onSave: actions.setNote }),
    ...(chat.features.translate ? [translateTool({
      translate,
      translation: chat.translation,
      card: chat.card,
      note: shelf?.character.translatorNote,
      onChange: actions.setTranslate,
      onOwnChange: actions.setOwnTranslate,
      onEditPrompt: editPrompt,
      onEditCharacter: shelf ? () => actions.side({ kind: 'character', id: shelf.id, part: 'instructions' }) : undefined,
    })] : []),
    ...(chat.features.illustrate ? [illustrateTool({ id: chat.id, illustrate: chat.illustrate, note: chat.illustrateNote, card: chat.card, holder: chat.illustrateHolderName, onChange: actions.setIllustrate, onOwnChange: actions.setOwnIllustrate, onSaveNote: actions.setIllustrateNote, sceneWriter: chat.sceneWriter, onEditPrompt: editPrompt })] : []),
    ...(chat.features.speech ? [speechTool({ speech: chat.speech, card: chat.card, onChange: actions.setSpeech, onOwnChange: actions.setOwnSpeech })] : []),
    ...chat.composerTools.map((tool) => composerTool({
      tool,
      running: chat.toolInput,
      on: toolIsOn(tool, storedTools.find(({ id }) => id === toolId(tool.module))?.value.settings ?? {}),
      onRun: actions.toolInput,
      onStop: actions.stopToolInput,
      onOpen: actions.tool,
    })),
  ];
  const input = useRef<HTMLTextAreaElement>(null);
  const remembering = useRemembering();
  const indexing = chat.features.memory && chat.id !== null ? remembering.indexing.get(chat.id) : undefined;
  const { enterSends } = useDisplay().display;
  const { cacheNoteHidden } = useSettings();
  const sendKeys = useSendKeys();
  const typed = draft.text.trim() !== '' || attachments.draft.length > 0;
  const unseen = chat.sendNotes.unseen + (attachments.sees === false ? attachments.draft.filter(({ kind }) => kind === 'picture').length : 0);
  const { drop } = useImport();
  // A chat takes pictures and text files dropped on it; a file the app imports (a card, a module, a plugin's .js) goes
  // to the import, as it does on every other screen.
  const dragging = useFileDrop((files) => {
    const imported = files.filter((file) => !file.type.startsWith('image/') && importable(file.name));
    const attached = files.filter((file) => !imported.includes(file));
    if (attached.length) actions.attach(attached);
    if (imported.length) drop(imported);
  }, 'screen');
  // Moving through the story works where no text is typed: outside a text field, or in this one while it is empty.
  const free = (event?: globalThis.KeyboardEvent) => !typing(event) || (event!.target === input.current && draft.text === '');
  useShortcut('storyStep', (event) => {
    if (!free(event)) return false;
    actions.step(event?.key === 'ArrowDown' ? 'down' : 'up');
  });
  useShortcut('storyEnds', (event) => {
    if (!free(event)) return false;
    actions.toEnd(event?.key === 'End' ? 'down' : 'up');
  });

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pressed(event, sendKeys)) {
      event.preventDefault();
      void actions.send();
      return;
    }
    if (busy && pressed(event, SHORTCUTS.stop.keys)) {
      event.preventDefault();
      actions.stop();
      return;
    }
    if (draft.text !== '' || busy) return;
    const step = pressedKey(event, SHORTCUTS.swipe.keys);
    if (pressed(event, SHORTCUTS.editLast.keys)) {
      const mine = messages.findLast((message) => message.role === 'user');
      if (mine) {
        event.preventDefault();
        actions.edit(mine, null);
      }
    } else if (step !== -1 && last?.role === 'assistant') {
      event.preventDefault();
      actions.swipe(last, step === 0 ? -1 : 1);
    }
  }

  return (
    <>
      {problem && (
        <Callout tone="warn" action={{ label: FIX[problem.kind].label, onClick: chips[FIX[problem.kind].chip].onClick }}>
          {describeTurnFailure(problem)}
        </Callout>
      )}
      {skippable && (
        <Callout tone="warn" action={{ label: skippable.failure.kind === 'agent' ? '에이전트 없이 보내기' : '토큰 절약 없이 보내기', onClick: actions.sendSkipping }}>
          {describeTurnFailure(skippable.failure)}
        </Callout>
      )}
      {stuck && (
        <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: actions.retryRegex }}>
          {`${REGEX_OFF}.`}
          <Hint label="정규식 꺼짐">캐릭터나 모듈의 정규식, 또는 로어북 키워드 중 하나가 원인이에요.</Hint>
        </Callout>
      )}
      <ChatAsk id={chat.id} onTyped={() => input.current?.focus()} />
      <Composer
        inputRef={input}
        compact={fold.folded}
        onOpen={fold.open}
        value={draft.text}
        readOnly={chat.toolInput !== null}
        enterKeyHint={enterSends ? 'send' : 'enter'}
        onChange={draft.set}
        onKeyDown={onKey}
        placeholder={translate.input ? `${withParticle(sendLanguage, '으로/로')} 번역해서 보내요` : MESSAGE_FIELD}
        attachments={<Attachments items={attachments.draft.map(attachedItem)} onRemove={actions.detach} />}
        onFiles={actions.attach}
        tools={<ChatToolRow tools={rowTools} after={<ChatPinnedToggles toggles={chat.toggles} onFlip={actions.flip} />} />}
        more={<ChatToolMore tools={rowTools} foot={<PinnedTogglesLayout toggles={chat.toggles} />} />}
        aside={aside && <ChatModel chat={chat} opens="above-end" />}
        actions={
          <>
            {!busy && chat.sendNotes.leaving && chat.id !== null && chat.sendNotes.sending && 'turn' in chat.sendNotes.sending ? <LeavingNote count={chat.sendNotes.leaving} causes={leavingCauses(chat.sendNotes.sending.prompt, chat.id, remembering)} onOpen={chat.features.memory ? () => actions.memory(null) : undefined} /> : null}
            {!busy && unseen > 0 && <SendNote label={`이미지 ${unseen}개`} title="전송되지 않는 이미지" warning={{ words: '보내지 않음', why: `${attachments.sees === null ? UNKNOWN_PICTURES : NO_PICTURES} ${UNSEEN}` }} />}
            {indexing && <SendNote label={`기억 검색 준비 ${indexing.done}/${indexing.total}`} title="장기 기억 검색 준비" onClick={() => actions.memory(null)} />}
            {!busy && !cacheNoteHidden && <ChatCache cache={chat.sendNotes.cache} onOpen={() => chat.actions.openInspect('cache')} />}
            <SendButton
              streaming={busy}
              disabled={!busy && ((!typed && !answerable) || chat.toolInput !== null)}
              title={busy ? titled(SHORTCUTS.stop.label, SHORTCUTS.stop.keys) : titled(typed ? SHORTCUTS.send.label : ANSWER, sendKeys)}
              onClick={() => (busy ? actions.stop() : void actions.send())}
            />
          </>
        }
      />
      {dragging && <DropOverlay>이미지와 텍스트 파일은 메시지에 넣어요</DropOverlay>}
    </>
  );
}
