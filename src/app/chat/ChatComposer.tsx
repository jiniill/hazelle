import { useRef, type KeyboardEvent } from 'react';
import type { GapCause } from '../../contracts/auto-diagnosis';
import { refOf } from '../../connectors/assignment';
import type { DraftAttachment } from '../../runtime/drafts';
import { leavingCauses } from '../../runtime/memory-view';
import type { Blocked } from '../../runtime/turn-context';
import { describeTurnFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { ACTS } from '../common/acts';
import { ANSWER, NO_PICTURES, UNKNOWN_PICTURES } from '../common/words';
import type { PromptDoor } from '../common/TaskPrompt';
import { navigate } from '../shell/router';
import { keysOf, SHORTCUTS, titled, typing, useShortcut } from '../shortcuts';
import { useDisplay } from '../display';
import { useRemembering, useSettings } from '../session';
import { imports, useImport } from '../common/importing';
import { Attachments, type Attached, Callout, Composer, DropOverlay, Hint, pressed, pressedKey, SendButton, SendNote, useFileDrop, useMenuOpener } from '../ui';
import { ChatAsk } from './ChatAsk';
import { ChatAttach } from './ChatAttach';
import { ChatCache } from './ChatCache';
import { ChatComposerTools } from './ChatComposerTools';
import { ChatIllustrate } from './ChatIllustrate';
import { ChatNote } from './ChatNote';
import { ChatPinnedToggles } from './ChatPinnedToggles';
import { ChatPersonaPicker } from './ChatPersonaPicker';
import { ChatTranslate } from './ChatTranslate';
import { promptEditor } from './panels';
import type { OpenChat } from './useChat';

// Shown by what leavingCauses finds: the first cause's words, every cause's sentence.
const LEAVING: Record<GapCause, { words: string; why: string }> = {
  working: { words: '기억 정리 중', why: '장기 기억을 정리하는 중이에요.' },
  failed: { words: '기억 정리 실패', why: '장기 기억 정리가 실패해서 멈췄어요. 눌러서 다시 시도할 수 있어요.' },
  tool: { words: '플러그인 응답 전', why: '장기 기억을 맡은 플러그인이 아직 응답하지 않아서 보내기 전에는 정확한 수를 알 수 없어요.' },
  off: { words: '장기 기억 꺼짐', why: '컨텍스트 한도에 맞추느라 오래된 메시지가 빠지는데, 장기 기억이 꺼져 있어요.' },
  'no-slot': { words: '프롬프트에 기억 없음', why: '기록은 있지만 프롬프트에 장기 기억 블록이 없거나 토글로 꺼져 있어서 보내지 않아요.' },
  stale: { words: '원문 바뀜', why: '원문 메시지가 수정되거나 삭제된 기록은 다시 만들 때까지 보내지 않아요.' },
  over: { words: '기록 한도 넘음', why: '기록이 이 요청의 한도를 넘어서 오래된 기록부터 빠져요. 컨텍스트 길이가 짧은 모델이면 한도도 줄어요.' },
  forgotten: { words: '기록 삭제됨', why: '삭제한 기록의 메시지는 요청에도 기억에도 없어요.' },
  'no-room': { words: '컨텍스트 부족', why: '컨텍스트 한도에 맞추느라 오래된 메시지가 빠지는데, 아직 장기 기억에 없어요.' },
  unknown: { words: '기억에 없음', why: '오래된 메시지가 요청에서 빠지는데, 장기 기억에도 없어요.' },
};
const UNSEEN = '이미지는 제외하고 텍스트만 보내며, 이미지만 있는 메시지는 보내지 않아요.';

function LeavingNote({ count, causes, onOpen }: { count: number; causes: GapCause[]; onOpen: (() => void) | undefined }) {
  return <SendNote label={`메시지 ${count}개`} title="요청에서 제외될 메시지" warning={{ words: LEAVING[causes[0]!].words, why: causes.map((cause) => LEAVING[cause].why).join(' ') }} onClick={onOpen} />;
}

type Chip = 'model' | 'prompt' | 'persona' | 'profile';
const FIX = {
  'no-model': { label: '모델 선택', chip: 'model' },
  'model-gone': { label: '모델 선택', chip: 'model' },
  'image-only': { label: '모델 선택', chip: 'model' },
  'prompt-missing': { label: '프롬프트 선택', chip: 'prompt' },
  'persona-missing': { label: '페르소나 선택', chip: 'persona' },
  'profile-missing': { label: '모델 설정 선택', chip: 'profile' },
} as const satisfies Record<Blocked['kind'], { label: string; chip: Chip }>;

const attachedItem = (each: DraftAttachment): Attached =>
  each.kind === 'picture'
    ? { kind: 'picture', key: each.name, url: each.url, label: '이미지', state: each.state.kind }
    : { kind: 'file', key: each.value.name, label: each.value.title, detail: `${each.value.text.split('\n').length.toLocaleString()}줄`, state: 'saved' };

// folded: ChatScreen's, which the frame's footer measures by, so the two never disagree.
export function ChatComposer({ chat, folded }: { chat: OpenChat; folded: boolean }) {
  const { draft, attachments, messages, last, answerable, busy, problem, skippable, stuck, translate, sendLanguage, modelMenu, shelf, route, actions } = chat;
  // A model whose own 모델 설정 is gone picks another on its page; a missing default is set in 설정 › 모델.
  const profilePage = problem?.kind === 'profile-missing' && problem.own && !('kind' in route) ? { kind: 'model' as const, ...refOf(route.connection.id, route.model) } : { kind: 'models' as const };
  const chips: Record<Chip, { onClick: () => void }> = {
    model: useMenuOpener(modelMenu),
    prompt: { onClick: () => actions.openDialog('prompt') },
    persona: { onClick: () => actions.openDialog('persona') },
    profile: { onClick: () => navigate(profilePage) },
  };
  const input = useRef<HTMLTextAreaElement>(null);
  const remembering = useRemembering();
  const indexing = chat.features.memory && chat.id !== null ? remembering.indexing.get(chat.id) : undefined;
  const { enterSends } = useDisplay().display;
  const { cacheNoteHidden } = useSettings();
  const sendKeys = keysOf('send', enterSends);
  const typed = draft.text.trim() !== '' || attachments.draft.length > 0;
  const unseen = chat.sendNotes.unseen + (attachments.sees === false ? attachments.draft.filter(({ kind }) => kind === 'picture').length : 0);
  const { drop } = useImport();
  // A chat takes pictures and text files dropped on it; a file the app imports (a card, a module, a plugin's .js) goes
  // to the import, as it does on every other screen.
  const dragging = useFileDrop((files) => {
    const imported = files.filter((file) => !file.type.startsWith('image/') && imports(file.name));
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
  const editPrompt = (door: PromptDoor) => actions.side(promptEditor(door));

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
          봇 스크립트가 끝나지 않아서 정규식을 껐어요.
          <Hint label="정규식 꺼짐">캐릭터나 모듈의 정규식, 또는 로어북 키워드 중 하나가 원인이에요.</Hint>
        </Callout>
      )}
      <ChatAsk id={chat.id} onTyped={() => input.current?.focus()} />
      <Composer
        inputRef={input}
        compact={folded}
        value={draft.text}
        readOnly={chat.toolInput !== null}
        enterKeyHint={enterSends ? 'send' : 'enter'}
        onChange={draft.set}
        onKeyDown={onKey}
        placeholder={translate.input ? `${withParticle(sendLanguage, '으로/로')} 번역해서 보내요` : '메시지'}
        attachments={<Attachments items={attachments.draft.map(attachedItem)} onRemove={actions.detach} />}
        onFiles={actions.attach}
        tools={
          <>
            <ChatAttach sees={attachments.sees} moved={attachments.moved} onAttach={actions.attach} onMoved={actions.sendMoved} />
            <ChatPersonaPicker persona={chat.persona} open={chat.dialog === 'persona'} onOpen={() => actions.openDialog('persona')} />
            <ChatNote id={chat.id} note={chat.note} prompt={chat.prompt} onSave={actions.setNote} />
            {chat.features.translate && <ChatTranslate
              translate={translate}
              translation={chat.translation}
              card={chat.card}
              note={shelf?.character.translatorNote}
              onChange={actions.setTranslate}
              onOwnChange={actions.setOwnTranslate}
              onEditPrompt={editPrompt}
              onEditCharacter={shelf ? () => actions.side({ kind: 'character', id: shelf.id, part: 'instructions' }) : undefined}
            />}
            {chat.features.illustrate && <ChatIllustrate id={chat.id} illustrate={chat.illustrate} note={chat.illustrateNote} card={chat.card} onChange={actions.setIllustrate} onOwnChange={actions.setOwnIllustrate} onSaveNote={actions.setIllustrateNote} sceneWriter={chat.sceneWriter} onEditPrompt={editPrompt} />}
            <ChatComposerTools tools={chat.composerTools} running={chat.toolInput} onRun={actions.toolInput} onStop={actions.stopToolInput} onOpen={actions.tool} />
            <ChatPinnedToggles toggles={chat.toggles} onFlip={actions.flip} />
          </>
        }
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
