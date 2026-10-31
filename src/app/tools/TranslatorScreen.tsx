import { entryName } from '../../connectors/types';
import { ArrowRight, ChevronDown, ChevronUp, Eraser, Languages, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { translateOnTool, setToolLanguage, setToolNote, toolTranslatorOf, type TranslatorFailure } from '../../runtime/translate';
import { ACTS } from '../common/acts';
import { describeTranslateFailure } from '../common/failure';
import { LanguageMenu } from '../common/IntoLanguage';
import { TranslatorNoteField } from '../common/TranslatorNoteField';
import { count } from '../common/typedNumber';
import { useCopy } from '../common/useCopy';
import { inSettings, MODEL_ROLES, noteLines, opens, STOP, TOOL_PAGES, TRANSLATOR_NOTE } from '../common/words';
import { useConnections, useSession, useSettings } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { SHORTCUTS } from '../shortcuts';
import { useToast } from '../toast';
import { Button, Callout, ChipButton, formatKeys, Icon, Menu, MenuHeading, MenuItem, NavBar, pressed, Screen, TranslateDesk } from '../ui';


// text: what came before a stop or a failure, kept in view.
type Run =
  | { kind: 'idle' }
  | { kind: 'running'; text: string }
  | { kind: 'done'; text: string; cut: boolean }
  | { kind: 'stopped'; text: string }
  | { kind: 'failed'; text: string; failure: TranslatorFailure };

const characters = (text: string) => (text ? `${count(text.length)}자` : '');

export function TranslatorScreen({ back }: { back: Back | null }) {
  const session = useSession();
  const { store } = session;
  const settings = useSettings();
  // toolTranslatorOf reads these too.
  useConnections();
  const copy = useCopy();
  const language = settings.toolLanguage ?? 'Korean';
  const toast = useToast();
  const [source, setSource] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [noteOpen, setNoteOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const translator = toolTranslatorOf(store);
  const running = run.kind === 'running';
  const ready = translator.ok && source.trim() !== '' && !running;
  const lines = noteLines(settings.toolNote);

  async function start() {
    if (!ready) return;
    const controller = new AbortController();
    abort.current = controller;
    let last = '';
    setRun({ kind: 'running', text: '' });
    const made = await translateOnTool(session, source, language, controller.signal, (text) => {
      last = text;
      setRun({ kind: 'running', text });
    });
    abort.current = null;
    if (made.ok) setRun({ kind: 'done', text: made.translation.text, cut: made.translation.receipt?.state === 'cut' });
    else if (made.failure.kind === 'stopped') setRun(last ? { kind: 'stopped', text: last } : { kind: 'idle' });
    else setRun({ kind: 'failed', text: last, failure: made.failure });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!pressed(event, SHORTCUTS.translate.keys)) return;
    event.preventDefault();
    void start();
  }

  const text = run.kind === 'idle' ? '' : run.text;
  const resultNote =
    run.kind === 'running' ? '번역 중…' : run.kind === 'done' ? [characters(run.text), run.cut && '길이 한도로 잘림'].filter(Boolean).join(' · ') : run.kind === 'stopped' ? `${characters(run.text)} · 번역 중단됨` : '';

  return (
    <Screen width="page" fill top={<NavBar title={TOOL_PAGES.translator} {...backBar(back)} />}>
      <TranslateDesk
        tools={
          <>
            <Menu
              label={MODEL_ROLES.aux}
              trigger={(opener) => (
                <ChipButton
                  label={translator.ok ? entryName(translator.with.route.model) : `${MODEL_ROLES.aux} 없음`}
                  title={MODEL_ROLES.aux}
                  tone={translator.ok ? 'plain' : 'warn'}
                  leading={<Icon icon={Languages} size="sm" />}
                  {...opener}
                />
              )}
            >
              <MenuHeading>{translator.ok ? `${inSettings('models')}의 ${MODEL_ROLES.aux}로 번역해요.` : describeTranslateFailure(translator.failure)}</MenuHeading>
              <MenuItem label={opens(inSettings('models'))} onClick={() => navigate({ kind: 'models' })} />
              <MenuHeading>여기서 번역한 내용은 저장되지 않아요.</MenuHeading>
            </Menu>
            <Icon icon={ArrowRight} size="sm" />
            <LanguageMenu label="번역할 언어" value={language} opens="down" onPick={(name) => void setToolLanguage(store, name).then((result) => result.ok || toast.failed(result))} />
          </>
        }
        aside={
          <Button variant="ghost" size="sm" icon={noteOpen ? ChevronUp : ChevronDown} expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>
            {lines > 0 ? `${TRANSLATOR_NOTE} · ${lines}줄` : TRANSLATOR_NOTE}
          </Button>
        }
        below={noteOpen && <TranslatorNoteField saveKey="tool-note" stored={settings.toolNote} write={(note) => setToolNote(store, note)} help="번역기에서 번역할 때만 써요. 채팅 번역에는 쓰지 않아요." />}
        source={{
          label: '원문',
          value: source,
          placeholder: `번역할 텍스트를 붙여 넣고 ${formatKeys(SHORTCUTS.translate.keys)}로 번역해요.`,
          readOnly: running,
          onChange: setSource,
          onKeyDown,
          foot: {
            note: characters(source),
            actions: (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Eraser}
                  disabled={running || (!source && !text)}
                  onClick={() => {
                    setSource('');
                    setRun({ kind: 'idle' });
                  }}
                >
                  비우기
                </Button>
                {running ? (
                  <Button variant="secondary" size="sm" icon={Square} onClick={() => abort.current?.abort()}>
                    {STOP}
                  </Button>
                ) : (
                  <Button size="sm" icon={ArrowRight} disabled={!ready} onClick={() => void start()}>
                    번역하기
                  </Button>
                )}
              </>
            ),
          },
        }}
        result={{
          label: '번역 결과',
          text,
          placeholder: running ? '응답 기다리는 중…' : '',
          busy: running,
          notice: run.kind === 'failed' && <Callout tone="warn">{`번역하지 못했어요. ${describeTranslateFailure(run.failure)}`}</Callout>,
          foot: {
            note: resultNote,
            actions: (
              <Button variant="ghost" size="sm" icon={ACTS.copy.icon} disabled={!text || running} onClick={() => copy(text)}>
                {ACTS.copy.label}
              </Button>
            ),
          },
        }}
      />
    </Screen>
  );
}
