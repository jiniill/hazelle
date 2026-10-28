import { useEffect, useRef, useState } from 'react';
import { pictureRef } from '../../engine/assets';
import type { ChatItem } from '../../model/chat';
import { assetDataUrls } from '../../runtime/assets';
import { chatFile } from '../../runtime/chat-file';
import { exportRisuChat } from '../../runtime/risu-export';
import type { Shown } from '../../runtime/talk';
import type { TranslatorFailure } from '../../runtime/translate';
import { ACTS } from '../common/acts';
import { download, fileNamed } from '../common/download';
import { describeTranslateFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { withParticle } from '../common/particles';
import { sizeText } from '../common/size';
import { useCopyHtml } from '../common/useCopy';
import { ARCA_LOG, CHAT_FILE, EXPORT, RISU_CHAT_FILE, RISU_LOSES, risuLeftOut, STOP } from '../common/words';
import { useDisplay } from '../display';
import { useFiles, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Dialog, Hint, LogExport, NumberInput, Progress, Row, SettingRow, snapshotPage, Stack, Switch, Text, type LogRow } from '../ui';
import { logDraft, resolveLog, untranslated, type LogChoices, type LogText } from './exportLog';
import type { OpenChat } from './useChat';

// A chat up to SHORT messages goes whole by default; a longer one from its last LATEST.
const SHORT = 100;
const LATEST = 50;

const FORMS = [{ value: 'log', label: ARCA_LOG }, { value: 'file', label: CHAT_FILE }, { value: 'risu', label: RISU_CHAT_FILE }] as const;
type Form = (typeof FORMS)[number]['value'];
const TEXTS: { value: LogText; label: string }[] = [{ value: 'translation', label: '번역' }, { value: 'original', label: '원문' }, { value: 'both', label: '둘 다' }];

type Drawing = { key: string; title: string; sub: string | null; css: string; rows: LogRow[]; missing: number };
type Prepared = { html: string; size: string; missing: number; rules: number };

type Props = Pick<OpenChat, 'messages' | 'view' | 'placed' | 'pictures' | 'flipped' | 'busy'> & {
  item: ChatItem;
  bot: boolean;
  characterName: string | null;
  names: OpenChat['names'];
  replyLanguage: string;
  // Saves the translation to the chat, as the message's own 번역 tool does. Absent while 번역's 기능 is off, which offers
  // no translating here either.
  onTranslate?: (message: Shown) => Promise<TranslatorFailure | null>;
  onClose: () => void;
};

export function ChatExport({ item, messages, view, placed, pictures, flipped, busy, bot, characterName, names, replyLanguage, onTranslate, onClose }: Props) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const { reading, display } = useDisplay();
  const copyHtml = useCopyHtml();
  const [form, setForm] = useState<Form>('log');
  const [choices, setChoices] = useState<LogChoices>(() => ({ pictures: !display.hidePictures, hideMe: false, text: 'translation', from: messages.length > SHORT ? messages.length - LATEST + 1 : 1, to: messages.length }));
  const [range, setRange] = useState({ from: String(choices.from), to: String(choices.to) });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const waiting = busy ? '응답 중' : view.pass ? '채팅을 불러오는 중' : null;
  const translated = messages.some((message) => message.versions.some((version) => version.translation));
  const change = (next: Partial<LogChoices>) => setChoices({ ...choices, ...next });
  const missing = choices.text === 'original' || waiting ? [] : untranslated(messages, view, choices);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [unbatched, setUnbatched] = useState<TranslatorFailure | null>(null);
  // A batch ends with its dialog, after the message being translated.
  const stopping = useRef(false);
  useEffect(
    () => () => {
      stopping.current = true;
    },
    [],
  );

  // One at a time, so each reads the ones before it as translated; the first failure ends it, since the next ones
  // would mostly fail the same way.
  async function translateMissing(translate: (message: Shown) => Promise<TranslatorFailure | null>) {
    const queue = missing;
    stopping.current = false;
    setUnbatched(null);
    setBatch({ done: 0, total: queue.length });
    try {
      for (const [at, message] of queue.entries()) {
        if (stopping.current) break;
        const failure = await translate(message);
        if (failure) {
          setUnbatched(failure);
          break;
        }
        setBatch({ done: at + 1, total: queue.length });
      }
    } finally {
      setBatch(null);
    }
  }

  useEffect(() => {
    setPrepared(null);
    setDrawing(null);
    if (form !== 'log' || waiting) return;
    let live = true;
    const draft = logDraft(messages, view, { placed, pictures }, flipped, bot, names, choices);
    const read = choices.pictures ? assetDataUrls(store, files, draft.pictures.values()) : Promise.resolve({ urls: new Map<string, string>(), missing: draft.pictures.size });
    void read.then(({ urls, missing }) => {
      if (live) setDrawing({ key: crypto.randomUUID(), title: item.title, sub: characterName, ...resolveLog(draft, (kind, id) => urls.get(pictureRef(kind, id))), missing });
    });
    return () => {
      live = false;
    };
  }, [form, choices, messages, view, placed, pictures, flipped, waiting]);

  async function saveFile() {
    if (form === 'file') {
      const made = await chatFile({ store, files }, item.id);
      return made.ok ? download(fileNamed(item.title, '채팅', 'json'), new Blob([made.data], { type: 'application/json' })) : toast.failed(made, '채팅 파일을 만들지 못했어요.');
    }
    if (form === 'risu') {
      const made = await exportRisuChat({ store }, item.id);
      if (!made.ok) return toast.failed(made, `${RISU_CHAT_FILE}을 만들지 못했어요.`);
      download(fileNamed(`${item.title}_chat`, '채팅', 'json'), new Blob([made.data.text], { type: 'application/json' }));
      const left = risuLeftOut(made.data.left);
      return left && toast.show(`${RISU_CHAT_FILE}을 내보냈어요.`, { detail: left });
    }
    const page = snapshotPage(item.title, prepared!.html, getComputedStyle(document.body).backgroundColor);
    download(fileNamed(item.title, '채팅', 'html'), new Blob([page], { type: 'text/html' }));
  }

  // A typed number is taken once it lies in the chat; anything else waits, marked.
  function typeRange(edge: 'from' | 'to', text: string) {
    setRange({ ...range, [edge]: text });
    const next = { ...choices, [edge]: Number(text) };
    if (Number.isInteger(next[edge]) && next.from >= 1 && next.from <= next.to && next.to <= messages.length) setChoices(next);
  }
  const typed = (edge: 'from' | 'to') => Number(range[edge]) === choices[edge];

  const ready = form !== 'log' || prepared !== null;
  return (
    <Dialog
      title={EXPORT}
      onClose={onClose}
      actions={
        <>
          {form === 'log' && (
            <Button variant="secondary" icon={ACTS.copy.icon} disabled={!ready} onClick={() => copyHtml(prepared!.html)}>
              {ACTS.copy.label}
            </Button>
          )}
          <Button icon={ACTS.export.icon} disabled={!ready} onClick={() => void saveFile()}>
            {ACTS.export.label}
          </Button>
        </>
      }
    >
      <Stack gap="related">
        <ChoiceGroup layout="segmented" label="형식" options={[...FORMS]} value={form} onChange={setForm} />
        {form === 'risu' && (
          <Row kind="toolbar">
            <Text variant="note">제외할 항목</Text>
            <Hint label={RISU_CHAT_FILE}>{RISU_LOSES}</Hint>
          </Row>
        )}
        {form === 'log' && (
          <>
            <SettingRow label="처음" control={<NumberInput label="처음" unit="번째" value={range.from} invalid={!typed('from')} onChange={(text) => typeRange('from', text)} />} />
            <SettingRow label="끝" note={`메시지 ${messages.length}개`} control={<NumberInput label="끝" unit="번째" value={range.to} invalid={!typed('to')} onChange={(text) => typeRange('to', text)} />} />
            {translated && <SettingRow label="메시지" control={<ChoiceGroup layout="segmented" label="메시지" options={TEXTS} value={choices.text} onChange={(text) => change({ text })} />} />}
            {onTranslate && (batch || missing.length > 0) && (
              <SettingRow
                label="번역되지 않은 메시지"
                note={batch ? `${batch.done}/${batch.total}개 번역함` : `${missing.length}개`}
                control={
                  batch ? (
                    <Button variant="secondary" size="sm" onClick={() => (stopping.current = true)}>
                      {STOP}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => void translateMissing(onTranslate)}>
                      {`${withParticle(languageLabel(replyLanguage), '으로/로')} 번역`}
                    </Button>
                  )
                }
              />
            )}
            {unbatched && <Callout tone="warn">{`번역하지 못했어요. ${describeTranslateFailure(unbatched)}`}</Callout>}
            <SettingRow label="이미지 포함" control={<Switch label="이미지 포함" checked={choices.pictures} onChange={(pictures) => change({ pictures })} />} />
            <SettingRow label="내 이름 가리기" control={<Switch label="내 이름 가리기" checked={choices.hideMe} onChange={(hideMe) => change({ hideMe })} />} />
            {waiting ? (
              <Text variant="note">{waiting}</Text>
            ) : prepared ? (
              <>
                <Text variant="note">{`크기 ${prepared.size}`}</Text>
                {(prepared.missing > 0 || prepared.rules > 0) && (
                  <Callout tone="warn">
                    {prepared.missing > 0 && `이미지 ${prepared.missing}개는 빠져요. `}
                    {prepared.rules > 0 && (
                      <>
                        {`아카라이브에서 지원하지 않는 스타일 ${prepared.rules}개는 빠져요.`}
                        <Hint label="제외할 스타일">마우스를 올렸을 때의 효과나 애니메이션, 화면 크기별 스타일, 글꼴 같은 것들이에요.</Hint>
                      </>
                    )}
                  </Callout>
                )}
              </>
            ) : (
              <Progress steps={[{ label: '준비하는 중' }]} />
            )}
          </>
        )}
      </Stack>
      {drawing && (
        <LogExport
          key={drawing.key}
          title={drawing.title}
          sub={drawing.sub}
          css={drawing.css}
          rows={drawing.rows}
          reading={reading}
          onDrawn={({ html, rules }) => {
            setPrepared({ html, size: sizeText(new Blob([html]).size), rules, missing: drawing.missing });
            setDrawing(null);
          }}
        />
      )}
    </Dialog>
  );
}
