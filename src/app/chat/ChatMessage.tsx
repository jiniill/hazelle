import { Bookmark, Bot, Info, Languages, Pin, PinOff, SquarePen } from 'lucide-react';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { resolveAssets, type PictureUrl } from '../../engine/assets';
import { storyHtml } from '../../engine/display';
import { firstLine, handEdited, shown, translationOutdated, type Message } from '../../model/chat';
import { placeMark, translatedMarks, withoutMarks } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import { runs } from '../../runtime/illustrate';
import { ACTS } from '../common/acts';
import { MASCOT_PICTURES } from '../common/mascots';
import { BOOKMARK } from '../common/words';
import { describeFailedReply, describeTranslateFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { withParticle } from '../common/particles';
import { toolLine, usageFacts, usageLine, writtenSoFar } from '../common/receipt';
import { useTokens } from '../common/useTokens';
import { timeOfDay } from '../common/time';
import { agentsWaiting, DISCOUNT_STOPPING, DISCOUNT_WAITING, polishingNow, PRE_READ_RETRYING, PRE_READ_WAITING, RETRYING, toolWaiting } from '../common/words';
import type { Reading } from '../../runtime/talk';
import type { Preparing } from '../../runtime/turn-steps';
import { useAssetUrl } from '../session';
import { SHORTCUTS, titled } from '../shortcuts';
import { MASCOTS } from '../../model/mascot';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, Marker, MascotRemark, Menu, MenuHeading, MenuItem, MoreMenu, pressed, SelectionButton, Story, StoryMessage, Switcher, Text, Usage, useMenuOpener, useWide, Waiting, type MenuHandle } from '../ui';
import { useNow } from './ChatCache';
import { ChatPicture } from './ChatPicture';
import { linesOf, markPart, PART_MARK, partOf } from './editPart';
import { picturePlaces } from './picturePlaces';
import type { ChatActions } from './useChat';
import type { EditPart } from './useMessageEdit';
import type { MessageRow } from './messageRow';
import { rowEqual, sameParts } from './rowPart';
import { seenText } from './search';
import { useReveal } from './useReveal';
import { useSelectedPart } from './useSelectedPart';
import { withOriginal } from './withOriginal';

const preparingNote = (preparing: Exclude<Preparing, { step: 'tools' }>) => (preparing.step === 'agents' ? agentsWaiting(preparing) : preparing.retrying ? PRE_READ_RETRYING : PRE_READ_WAITING);

type Props = { row: MessageRow; modelMenu: MenuHandle; actions: ChatActions };

// A card's blank greeting, which starts the chat with no first message.
const NO_GREETING = '첫 메시지 없이';

const NO_PERSONA = '페르소나 없음';

const WRITING = '쓰는 중';

const CUT = { length: '잘림', 'no-terminal': '끊김', stopped: '중단됨', refused: '차단됨' } as const;
const MARK = { length: 'length', 'no-terminal': 'length', stopped: 'stopped', refused: 'refused' } as const;

export const ChatMessage = memo(function ChatMessage(props: Props) {
  const { row, modelMenu, actions } = props;
  const { message, text: original, decor: decoration, opening, last, busy, branching, usageShown } = row.story.value;
  const { translatingText, untranslated, canTranslate, awaited, flipped, showOriginal } = row.translation.value;
  const { placed, pictures, drawing, canIllustrate, pictureSizes } = row.illustration.value;
  const { remark, fresh } = row.mascot.value;
  const { badges, toolActions } = row.tools.value;
  const { hosted, offered } = row.status.value;
  const { polishing, agents } = row.agents.value;
  const { character, me, modelName } = row.speakers.value;
  const { editing, replyNext } = row.edit.value;
  const { bookmarked } = row.bookmark.value;
  const { found, marked, term } = row.search.value;
  const otherModel = useMenuOpener(modelMenu);
  const wide = useWide();
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const translation = version.translation ?? null;
  // A message sent translated keeps what the user typed as its translation; another translation offers a new one.
  const sentTranslated = translation?.sentIn !== undefined;
  // 다듬기 전 답 보기 of a reply its post agents rewrote: the text as the model wrote it, as it is stored.
  const hasRaw = version.raw !== undefined && version.raw !== version.text;
  const [rawShown, setRawShown] = useState(false);
  const raw = hasRaw && rawShown;
  const text = seenText(original, version, translatingText, flipped);
  const pending = !translatingText && (awaited || translatingText === '');
  const reveal = useReveal(version.id, text, live && !message.whole);
  const places = picturePlaces(drawing, pictures, version.text);
  const paragraphs = new Set(places.flatMap(({ paragraph }) => (paragraph === null ? [] : [paragraph])));
  // A translation never goes through the display, so it takes its marks here, by the displayed paragraphs.
  const originalShown = text === original;
  const translatedText = !paragraphs.size ? reveal.text : originalShown ? withoutMarks(placed ?? original, paragraphs) : translatedMarks(text, placed ?? original, paragraphs);
  // A message sent translated keeps 보낸 메시지 보기 only. Not left off while editing a part: findPart's lines are this text's.
  const both = showOriginal && translation !== null && !sentTranslated && translatingText === null && !originalShown;
  const storyText = useMemo(() => (both ? withOriginal(translatedText, original) : translatedText), [both, translatedText, original]);
  const part = editing?.part ?? null;
  const drawnText = part ? markPart(storyText, part.shown) : storyText;
  const url = useAssetUrl([row, drawnText, raw]);
  const decor = useMemo(() => ({ ...decoration, url }), [decoration, url]);
  const html = useMemo(() => shownHtml(drawnText, decor), [drawnText, decor.bot, decor.url]);
  const story = useRef<HTMLDivElement>(null);
  const running = drawing !== null && runs(drawing);
  const illustrations = places.map((place) => ({
    mark: place.paragraph === null ? null : placeMark(place.paragraph),
    node: <ChatPicture key={place.paragraph ?? 'run'} place={place} message={message} running={running} draws={canIllustrate} sizes={pictureSizes} onDraw={actions.draw} onDismiss={actions.dismissIllustration} onReshape={actions.reshape} onDrop={actions.dropPicture} />,
  }));
  const failed = receipt?.state === 'failed';
  const empty = original === '';
  // An edited reply is the user's text now; its cut no longer applies.
  const cut = !live && !handEdited(version) && receipt?.state === 'cut' ? receipt.cut : null;

  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pressed(event, SHORTCUTS.cancelEdit.keys)) {
      event.preventDefault();
      actions.cancelEdit();
    } else if (pressed(event, SHORTCUTS.saveEdit.keys)) {
      event.preventDefault();
      actions.saveEdit(message, false);
    }
  };

  const findPart = (pieces: string[]) => {
    const side: EditPart['side'] = translation && !flipped ? 'translation' : 'text';
    const source = side === 'text' ? version.text : translation!.text;
    const found = partOf(source, pieces);
    const drawn = found && partOf(storyText, linesOf(source, found).split('\n'));
    return found && drawn ? { ...found, side, shown: drawn } : null;
  };
  const selected = useSelectedPart(story, findPart, editing === null && !live && !message.unstored && !opening && !failed && !empty);

  let body = null;
  if (editing !== null && !part) {
    body = (
      <EditBox
        value={editing.text}
        onChange={(text) => actions.changeEdit({ text })}
        second={
          editing.translation === null
            ? undefined
            : sentTranslated
              ? { firstLabel: '보낸 메시지', label: '원문', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
              : { firstLabel: '원문', label: '번역', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
        }
        onKeyDown={editKeys}
      />
    );
  } else if (live && empty) {
    const { preparing } = message;
    const waiting = message.stopping ? DISCOUNT_STOPPING : message.batch ? DISCOUNT_WAITING : message.retrying ? RETRYING : preparing && preparing.step !== 'tools' ? preparingNote(preparing) : null;
    const note = version.reasoning ? '추론 중' : '기다리는 중';
    body = waiting ? <Waiting note={waiting} /> : preparing?.step === 'tools' ? <Elapsed note={toolWaiting(preparing.running)} since={preparing.since} /> : message.reading ? <Elapsed note={note} since={message.reading.at} /> : <Waiting note={note} />;
  } else if (failed) {
    body = (
      <>
        {/* Text that came before the failure (a connection lost midway, a continuation that failed) is saved, and stays shown. */}
        {!empty && <Story html={shownHtml(original, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />}
        <Failure
          title="응답 실패"
          actions={
            <>
              <Button size="sm" disabled={busy} onClick={() => actions.retry(message)}>
                {ACTS.retry.label}
              </Button>
              {!empty && !receipt.continues && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.continue(message)}>
                  이어 쓰기
                </Button>
              )}
              <Button variant="secondary" size="sm" {...otherModel}>
                다른 모델로
              </Button>
            </>
          }
        >
          {describeFailedReply(receipt.error)}
        </Failure>
      </>
    );
  } else if (opening && !version.text.trim()) {
    body = <Text variant="note">{`${NO_GREETING} 시작해요.`}</Text>;
  } else if (!empty || hosted.length > 0) {
    const box = ({ id, html }: MessageRow['status']['value']['hosted'][number]) => <Story key={id} html={shownHtml(html, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} ref={actions.watch(id)} />;
    body = (
      <>
        {hosted.filter(({ at }) => at === 'top').map(box)}
        {/* A message may be all box: a status window's script took every word of it. */}
        {raw ? (
          <Story html={shownHtml(version.raw!, decor)} css={decor.css} buttons="inert" />
        ) : !empty && (
          <Story
            html={html}
            css={decor.css}
            buttons={decor.buttons}
            onPress={actions.press}
            term={term}
            tone={pending ? 'faded' : 'plain'}
            cursor={live || reveal.revealing || (translatingText !== null && !flipped)}
            illustrations={illustrations}
            inlays={part ? [{ mark: PART_MARK, node: <EditBox value={part.value} onChange={actions.changePart} onKeyDown={editKeys} /> }] : undefined}
            ref={story}
          />
        )}
        {hosted.filter(({ at }) => at === 'bottom').map(box)}
      </>
    );
  }

  // What the message translates is shown as it comes, so a flip to the original ends.
  const translateHere = () => {
    if (flipped) actions.flipTranslation(message);
    void actions.translate(message);
  };
  const again = { label: '다시 번역', disabled: translatingText !== null, onClick: translateHere };
  const translationMark =
    pending ? (
      <Marker reason="translation" label="번역 기다리는 중" />
    ) : untranslated ? (
      <Marker reason="translation" label={`번역하지 못했어요. ${describeTranslateFailure(untranslated)}`} action={canTranslate ? again : undefined} />
    ) : translatingText === null && !flipped && translation?.receipt?.state === 'cut' ? (
      <Marker reason="translation" label="번역 잘림" action={canTranslate ? again : undefined} />
    ) : translatingText === null && !sentTranslated && translationOutdated(version) ? (
      <Marker reason="translation" label="원문 수정됨" action={canTranslate ? again : undefined} />
    ) : null;
  const translateTool = translation ? (
    !both && <IconButton icon={Languages} size="sm" label={sentTranslated ? '보낸 메시지 보기' : '원문 보기'} pressed={flipped} onClick={() => actions.flipTranslation(message)} />
  ) : (
    canTranslate && !empty && !failed && <IconButton icon={Languages} size="sm" label="번역" disabled={translatingText !== null} onClick={translateHere} />
  );
  const translateAgain = canTranslate && translation && !sentTranslated && <MenuItem label="다시 번역" disabled={translatingText !== null} onClick={translateHere} />;
  // The language it went out in, not the setting now.
  const mark = !translation || editing !== null ? undefined : sentTranslated ? `${withParticle(languageLabel(translation.sentIn!), '으로/로')} 보냄` : flipped ? '원문' : '번역';

  const count = message.versions.length;
  // No call writes a greeting: its versions go round.
  const greeting = opening || version.greeting !== undefined;
  // Only then would 다시 생성 use notes again (runtime/agents preAgents).
  const noted = !mine && !greeting && message.versions.some(({ receipt }) => receipt?.agents?.some(({ stage }) => stage === 'pre'));
  const nextLabel = message.selected === count - 1 && !greeting ? '다시 생성' : '다음';
  const [back, forward] = SHORTCUTS.swipe.keys;
  const switcher = !mine && count > 1 && editing === null && (
    <Switcher
      count={`${message.selected + 1} / ${count}`}
      prev={{ label: '이전', title: titled('이전', [back]), disabled: busy, onClick: () => actions.swipe(message, -1) }}
      next={{ label: nextLabel, title: titled(nextLabel, [forward]), disabled: busy, onClick: () => actions.swipe(message, 1) }}
      pick={{ versions: message.versions.map((each) => firstLine(each.translation?.text ?? each.text) || NO_GREETING), selected: message.selected, disabled: busy, onPick: (index) => actions.pick(message, index) }}
    />
  );
  const after = (
    <>
      {selected && <SelectionButton icon={SquarePen} label="수정" at={selected.end} onPress={() => actions.edit(message, selected.part)} />}
      {editing === null && translationMark}
      {editing === null && receipt?.toolsRefused && <Marker reason="tool" label="이 모델은 모델 도구를 지원하지 않아서 도구 없이 응답했어요." />}
      {editing === null && receipt && toolLine(receipt) && <Marker reason="tool" label={toolLine(receipt)!} />}
      {drawing?.writing && <Marker reason="illustration" label="장면 구성 중" />}
      {polishing && <Marker reason="agent" label={polishingNow(polishing)} />}
      {raw && <Marker reason="agent" label="다듬기 전 응답" action={{ label: '다듬기 전으로 복원', disabled: busy, onClick: () => actions.restoreRaw(message) }} />}
      {cut && (
        <Marker
          reason={MARK[cut]}
          label={cut === 'stopped' && empty ? '응답 전 중단됨' : CUT[cut]}
          action={
            !empty
              ? { label: '이어 쓰기', disabled: busy, onClick: () => actions.continue(message) }
              : cut === 'stopped'
                ? { label: ACTS.retry.label, disabled: busy, onClick: () => actions.retry(message) }
                : undefined
          }
        />
      )}
      {!wide && switcher}
    </>
  );

  const [only] = offered;
  const statusTool =
    offered.length === 1 ? (
      <IconButton
        icon={only!.marked ? PinOff : Pin}
        size="sm"
        label={`${only!.marked ? '상태창 지정 해제' : '상태창으로 지정'} · ${only!.name}`}
        onClick={() => actions.markStatus(only!, !only!.marked)}
      />
    ) : offered.length > 1 ? (
      <Menu place="below-end" label="상태창으로 지정" trigger={(opener) => <IconButton icon={Pin} size="sm" label="상태창으로 지정" {...opener} />}>
        <MenuHeading>상태창으로 지정할 블록</MenuHeading>
        {offered.map((script) => (
          <MenuItem key={script.id} label={script.name} checked={script.marked} onClick={() => actions.markStatus(script, !script.marked)} />
        ))}
      </Menu>
    ) : null;

  // A part edit offers no 저장하고 다시 생성: its ruling (design.md Part edit, 2026-10-16) is 취소 · 저장.
  const tools = live || message.unstored ? undefined : editing !== null ? (
    <>
      <Button variant="ghost" size="sm" onClick={actions.cancelEdit}>
        취소
      </Button>
      {replyNext && !part && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.saveEdit(message, true)}>
          저장하고 다시 생성
        </Button>
      )}
      <Button size="sm" onClick={() => actions.saveEdit(message, false)}>
        저장
      </Button>
    </>
  ) : opening ? (
    <>
      {wide && switcher}
      {translateTool}
      {!empty && <IconButton icon={ACTS.copy.icon} size="sm" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {statusTool}
      {translateAgain && (
        <MoreMenu of="메시지" place="end">
          {translateAgain}
        </MoreMenu>
      )}
    </>
  ) : (
    <>
      {remark && <Remark remark={remark} fresh={fresh} onSeen={() => actions.seeRemark(remark.id)} />}
      {/* Keep desktop switcher with floating tools; phones lack room. Place it after the transient remark so version changes cannot move it under the pointer (user, 2026-10-23). */}
      {wide && switcher}
      {!mine && !greeting && !failed && !busy && <IconButton icon={ACTS.regenerate.icon} size="sm" label={ACTS.regenerate.label} onClick={() => actions.regenerate(message)} />}
      {!mine && failed && !busy && <IconButton icon={ACTS.retry.icon} size="sm" label={ACTS.retry.label} onClick={() => actions.retry(message)} />}
      {translateTool}
      {!failed && <IconButton icon={SquarePen} size="sm" label="수정" onClick={() => actions.edit(message, selected?.part ?? null)} />}
      {!empty && <IconButton icon={ACTS.copy.icon} size="sm" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {bookmarked && <IconButton icon={Bookmark} size="sm" label={BOOKMARK} pressed onClick={() => actions.bookmark(message.id)} />}
      {!failed ? (
        <MoreMenu of="메시지" place="end">
          {translateAgain}
          {canIllustrate && !mine && !empty && (
            <MenuItem label="삽화" disabled={running} onClick={() => actions.draw(message.id, version.id)} />
          )}
          <MenuItem label={BOOKMARK} checked={bookmarked} multiple onClick={() => actions.bookmark(message.id)} />
          <MenuItem label="여기서 분기" disabled={branching} onClick={() => void actions.branch(message)} />
          {hasRaw && <MenuItem label="다듬기 전 응답 보기" checked={rawShown} multiple onClick={() => setRawShown(!rawShown)} />}
          {agents.post && !mine && !greeting && !empty && !polishing && !version.retouched && <MenuItem label="다시 다듬기" disabled={busy} onClick={() => actions.polishAgain(message)} />}
          {agents.pre && noted && <MenuItem label="노트부터 다시 생성" disabled={busy} onClick={() => actions.regenerateFresh(message)} />}
          {!mine && <MenuItem label="응답 정보" onClick={() => actions.info(message.id)} />}
          {offered.length > 0 && <MenuHeading>상태창으로 지정</MenuHeading>}
          {offered.map((script) => (
            <MenuItem key={script.id} label={script.name} checked={script.marked} multiple onClick={() => actions.markStatus(script, !script.marked)} />
          ))}
          {toolActions.map((tool) => [
            <MenuHeading key={tool.module}>{tool.name}</MenuHeading>,
            ...tool.items.map((item) => <MenuItem key={`${tool.module}:${item.id}`} label={item.label} onClick={() => actions.toolAction(tool.module, item.id, message.id)} />),
          ])}
        </MoreMenu>
      ) : (
        !mine && <IconButton icon={Info} size="sm" label="응답 정보" onClick={() => actions.info(message.id)} />
      )}
      <Divider variant="tools" />
      {last ? (
        <IconButton icon={ACTS.remove.icon} size="sm" label={ACTS.remove.label} onClick={() => actions.remove(message)} />
      ) : (
        <Menu place="end" label="메시지 삭제" trigger={(opener) => <IconButton icon={ACTS.remove.icon} size="sm" label={ACTS.remove.label} {...opener} />}>
          <MenuItem label="이 메시지만 삭제" tone="warn" onClick={() => actions.remove(message)} />
          <MenuItem label="여기부터 끝까지 삭제" tone="warn" onClick={() => actions.removeFrom(message)} />
        </Menu>
      )}
    </>
  );

  return (
    <StoryMessage
      avatar={mine ? <Avatar face={me?.name ?? '?'} image={me?.image} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={speaker(message, character, me, modelName)}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      mark={mark}
      badges={badges}
      after={after}
      tools={tools}
      id={message.id}
      found={found}
      marked={marked}
      writing={live || reveal.revealing}
    >
      {body}
      {/* The wait's line goes on under the text as it comes, the same clock, and 사용량 표시's capsule takes its place once the receipt lands. */}
      {live && !empty && message.reading && (usageShown ? <Writing reading={message.reading} text={version.text} reasoning={version.reasoning ?? ''} /> : <Elapsed note={WRITING} since={message.reading.at} />)}
      {usageShown && receipt && !live && !failed && editing === null && (
        <Usage {...usageLine(receipt)} facts={usageFacts(receipt)} more={{ label: '자세히', onClick: () => actions.info(message.id) }} />
      )}
    </StoryMessage>
  );
}, rowEqual<Props>({ actions: Object.is, modelMenu: Object.is, row: sameParts }));

function Remark({ remark, fresh, onSeen }: { remark: Stored<'remark'>; fresh: boolean; onSeen: () => void }) {
  const { mascot, expression, line } = remark.value;
  const pictures = MASCOT_PICTURES[mascot];
  return <MascotRemark face={pictures.face} picture={pictures.expressions[expression]} name={MASCOTS[mascot].name} line={line} fresh={fresh} onSeen={onSeen} />;
}

// since: when the wait began, which a page left and come back to still counts from. written: what the reply wrote so far.
function Elapsed({ note, since, written }: { note: string; since: number; written?: string | null }) {
  const now = useNow(Infinity);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <Waiting note={`${note} · ${written ? `${written} · ` : ''}${seconds}초`} />;
}

// 사용량 표시 on, the line also says what this call wrote so far.
function Writing({ reading, text, reasoning }: { reading: Reading; text: string; reasoning: string }) {
  const written = useTokens([text.slice(reading.text), reasoning.slice(reading.reasoning)]);
  return <Elapsed note={WRITING} since={reading.at} written={writtenSoFar(written)} />;
}

export const speaker = (message: Message, character: { name: string } | null, me: { name: string } | null, modelName: string | null) =>
  message.role === 'user' ? (me?.name ?? NO_PERSONA) : (character?.name ?? shown(message).receipt?.modelName ?? modelName ?? '모델');

// Without the bot's style, only the chat's own pictures show: its inlays, whose markup alone the plain display keeps.
export const shownHtml = (text: string, { bot, url }: { bot: boolean; url: PictureUrl }) => resolveAssets(storyHtml(text, bot), bot ? url : (kind, id) => (kind === 'inlay' ? url(kind, id) : undefined));
