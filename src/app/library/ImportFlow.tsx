import { importTool, undoToolImport } from '../../runtime/tools/store';
import { useToast } from '../toast';
import { Check, FileText, MessageSquare, MessageSquarePlus, Package, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EXPANSION, METADATA_BYTES } from '../../engine/import/inflate';
import { PRESET_EXTENSIONS } from '../../engine/import/preset';
import { mergeUnsupported, type ImportFailure } from '../../engine/import/types';
import { characterTexts, live } from '../../model/library';
import { EMPTY_SETTINGS } from '../../model/settings';
import { importCardFile } from '../../runtime/card-file';
import { setDeleted } from '../../runtime/characters';
import { importChat } from '../../runtime/chat-log';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import { ImportWorker } from '../../runtime/import/client';
import { ImportReadError, ImportStuck, type ChatsRead } from '../../runtime/import/protocol';
import { importModule, pairWithPrompts, replaceModules, sameNamespace, setModuleAt, setModuleDeleted, type ModulePlace } from '../../runtime/modules';
import { fillPictures, importRisuChats, risuMatch } from '../../runtime/move';
import { addRisuPersona, removePersona } from '../../runtime/personas';
import { ofSort, removePrompt, savePreset } from '../../runtime/prompts';
import type { ObjectStore } from '../../runtime/store';
import { aliased } from '../common/alias';
import { describeFailure } from '../common/failure';
import { ImportContext } from '../common/importing';
import { sizeText } from '../common/size';
import { useSearch } from '../common/useSearch';
import { BIN, moduleName, NO_CHARACTER, promptName } from '../common/words';
import { useFiles, useLibrary, useSettings, useStore } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Route } from '../shell/routes';
import { Avatar, Button, Callout, ChipButton, ConfirmDialog, Dialog, DropOverlay, Empty, Menu, MenuItem, pickFiles, Progress, Row, Section, Stack, Text, useFileDrop, type ProgressStep } from '../ui';
import { characterOutcome, chatOutcome, moduleOutcome, personaOutcome, promptOutcome, quoted, toolOutcome, type ImportOutcome } from './importOutcome';
import { missedLines, chatMissed, moveMissed } from './missed';
import { MoveDialog } from './MoveDialog';
import { MoveFlow } from './MoveFlow';
import { stepOf } from './saving';

const PRESETS = PRESET_EXTENSIONS.join(',');
const ACCEPT = `.png,.charx,.jpg,.jpeg,.json,.risum,.bin,.js,${PRESETS}`;
const OPENS: { kind: Exclude<ImportOutcome['kind'], 'character'>; icon: LucideIcon; label: string; route: (id: string) => Route }[] = [
  { kind: 'chat', icon: MessageSquare, label: '열기', route: (id) => ({ kind: 'chat', id }) },
  { kind: 'module', icon: Package, label: '모듈 보기', route: (id) => ({ kind: 'module', id, pane: null }) },
  { kind: 'prompt', icon: FileText, label: '프롬프트 보기', route: (id) => ({ kind: 'prompt', id, pane: null }) },
  { kind: 'persona', icon: UserRound, label: '페르소나 보기', route: (id) => ({ kind: 'persona', id }) },
];

type Filled = { kind: 'filled'; file: string; name: string; kept: number; missed: string[] };
type Result = ImportOutcome | Filled | { kind: 'failed'; file: string; failure: string };
// fill: whether to bring only a card's pictures to the character Risu's move brought under its name. character: which
// character a file of chats goes to, null for 캐릭터 없이; name is the one the file was with, when it says. cancel, the
// dialog closed while asking, ends the batch: neither answer, since X is not 새 캐릭터로 가져오기 or 캐릭터 없이. replace:
// whether a module takes over from the older versions of its namespace, named olds.
type Ask = ({ kind: 'fill'; name: string; answer: (fill: boolean) => void } | { kind: 'character'; file: string; name: string | null; fallback: string | null; answer: (character: string | null) => void } | { kind: 'replace'; name: string; olds: string[]; answer: (replace: boolean) => void }) & { cancel: () => void };
// Where a file of chats goes: a character's id, null for 캐릭터 없이, undefined where the way in names none.
type Target = string | null | undefined;
type State = { busy: { file: string; steps: ProgressStep[] } | null; results: Result[]; ask: Ask | null };
// 되돌리기 for what one file brought. Its closure holds ids, never the parsed file, which would stay alive with it.
type Undo = { message: string; run: () => Promise<ApiResult<unknown> | ApiFailure> };

const ASK_TITLES: Record<Ask['kind'], string> = { fill: '이미지만 가져올까요?', character: '어느 캐릭터에 넣을까요?', replace: '이전 버전과 바꿀까요?' };

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '가져올 수 없는 파일 형식이에요.',
  encrypted: '암호화된 캐릭터 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요.',
};

// Keyed by the failure details of engine/import/tool, of a chat file, of a preset (PresetFailure), of a persona PNG
// (engine/import/persona) and of the size limits (engine/import/inflate TooLarge); a detail missing here reads as
// 파일을 읽지 못했어요.
const DETAIL_FAILURE: Record<string, string> = {
  'other-version': '이전 버전에서 만든 채팅 파일이라 가져올 수 없어요.',
  'not-preset': 'Risu 파일이지만 프리셋 파일이 아니에요.',
  'decrypt-failed': '프리셋을 열지 못했어요. 파일이 깨졌을 수 있어요.',
  'no-template': '프롬프트 템플릿을 쓰지 않는 프리셋은 가져올 수 없어요. Risu에서 템플릿을 켜고 다시 내보내 주세요.',
  'tool-too-large': '도구 파일 용량이 너무 커요.',
  'tool-encoding': 'UTF-8 형식의 텍스트 파일이 아니에요.',
  'tool-api': '헤이젤 도구 파일이 아니에요. 파일 맨 위에 //@api 1이 있어야 해요.',
  'tool-identity': '//@name과 //@author가 꼭 있어야 하고, 글자와 숫자, _ . - 기호만 쓸 수 있어요.',
  'tool-setting': '설정 줄을 읽지 못했어요.',
  'tool-menu': '메뉴 줄을 읽지 못했어요.',
  'tool-action': '메시지 동작 줄을 읽지 못했어요.',
  'tool-composer': '입력창 줄을 읽지 못했어요.',
  'tool-uses': '//@uses에는 model, embed, memory만 쓸 수 있어요.',
  'tool-unknown': '알 수 없는 줄이에요.',
  'persona-unreadable': 'Risu 페르소나 PNG 파일이지만 내용을 읽지 못했어요.',
  'persona-incomplete': '이름이나 설명이 빠진 페르소나라 가져올 수 없어요.',
  'expands-too-far': `압축을 풀면 파일 크기의 ${EXPANSION}배가 넘어서 가져올 수 없어요.`,
  'entry-too-large': `이미지를 뺀 내용이 ${sizeText(METADATA_BYTES)}를 넘어서 가져올 수 없어요.`,
};

class ImportCancelled extends Error {}

const unsaved = (file: string, failure: ApiFailure): Result => ({ kind: 'failed', file, failure: `저장하지 못했어요. ${describeFailure(failure)}` });

// An import is undone as its kind is deleted, to 휴지통; a module that replaced older versions brings them back.
const undoCharacter = (store: ObjectStore, id: string, name: string): Undo => ({ message: `'${name}' 캐릭터를 가져왔어요.`, run: () => setDeleted(store, id, Date.now()) });
const undoModule = (store: ObjectStore, id: string, name: string, replaced: string[]): Undo => ({
  message: `'${moduleName(name)}' 모듈을 가져왔어요.`,
  run: async () => {
    const done = await Promise.all([setModuleDeleted(store, id, Date.now()), ...replaced.map((old) => setModuleDeleted(store, old, null))]);
    return done.find((result) => !result.ok) ?? done[0]!;
  },
});
const undoPrompt = (store: ObjectStore, id: string, name: string, made: string | null): Undo => ({
  message: `'${promptName(name)}' 프롬프트를 가져왔어요.`,
  run: async () => {
    const done = await Promise.all([removePrompt(store, id), ...(made === null ? [] : [setModuleDeleted(store, made, Date.now())])]);
    return done.find((result) => !result.ok) ?? done[0]!;
  },
});
const undoPersona = (store: ObjectStore, id: string, name: string): Undo => ({ message: `'${name}' 페르소나를 가져왔어요.`, run: () => removePersona(store, id) });

async function undoAll(undos: Undo[]): Promise<{ ok: true } | ApiFailure> {
  const done = await Promise.all(undos.map(({ run }) => run()));
  return done.find((result): result is ApiFailure => !result.ok) ?? { ok: true };
}

function describeImportFailure({ kind, detail, line }: ImportFailure): string {
  const known = detail && DETAIL_FAILURE[detail];
  if (!known) return FAILURE[kind];
  return line ? `${known} ${line}` : known;
}

// Where a module dropped or picked on this route is turned on first (design §6.5): a character's page, editor or chat,
// a conversation prompt's editor, a persona's page, or 설정 › 모듈 for 항상. A file of chats that names no character goes to the character found here too.
function placeOf(store: ObjectStore, route: Route): ModulePlace | null {
  switch (route.kind) {
    case 'shelf':
    case 'new-chat':
      return route.character === null ? null : { kind: 'character', id: route.character };
    case 'edit':
      return { kind: 'character', id: route.character };
    case 'chat': {
      const character = store.get('chat', route.id)?.value.character ?? null;
      return character === null ? null : { kind: 'character', id: character };
    }
    case 'prompt': {
      const prompt = live(store.get('prompt', route.id));
      return prompt && ofSort(prompt, 'conversation') ? { kind: 'prompt', prompt } : null;
    }
    case 'persona':
      return live(store.get('persona', route.id)) ? { kind: 'persona', id: route.id } : null;
    case 'modules':
    case 'module':
    case 'tool-page':
      return { kind: 'always' };
    default:
      return null;
  }
}

// Risu backups (.bin) go to MoveFlow together, and a card named like a character brought from Risu may only fill that
// character's pictures. Every way in asks once per account for the RisuAI-only notice first: Risu cards carry no such
// mark (their license field is Creative Commons only), so the notice cannot be shown per card.
export function ImportProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const route = useRoute();
  const noticed = useSettings().importNotice === true;
  const [notice, setNotice] = useState<(() => void) | null>(null);
  const readers = useRef(new Set<ImportWorker>());
  const mounted = useRef(true);
  const [state, setState] = useState<State | null>(null);
  const [moving, setMoving] = useState<{ files: File[]; aside: number } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const reader of readers.current) reader.close();
      readers.current.clear();
    };
  }, []);

  // A file of chats goes where the way in named, else to the character it was with when that one is here. When that
  // one is gone, the user picks, with a character of the same name picked first. A file that names none goes to the
  // route's character, else where the user picks.
  async function saveChats(file: string, read: ChatsRead, target: Target, place: ModulePlace | null, choose: (name: string | null, fallback: string | null) => Promise<string | null>): Promise<Result> {
    const named = 'chat' in read ? read.chat.character : null;
    const routed = place?.kind === 'character' && live(store.get('character', place.id)) ? place.id : null;
    const character =
      target !== undefined ? target : named === null ? (routed ?? (await choose(null, null))) : live(store.get('character', named.id)) ? named.id : await choose(named.name, routed);
    const shown = character === null ? null : store.get('character', character)!.value;
    const name = shown && aliased(shown.card.name, shown.alias);
    if ('chat' in read) {
      const saved = await importChat({ store, files }, read.chat, character);
      return saved.ok ? chatOutcome(file, [saved.data.id], name, chatMissed(saved.data.dropped)) : unsaved(file, saved);
    }
    const saved = await importRisuChats(store, character, read.risuChats);
    return saved.ok ? chatOutcome(file, saved.data, name, moveMissed(read.missed)) : unsaved(file, saved);
  }

  // offer: its 되돌리기. A new tool offers none: importTool refuses its identity again while the binned one is kept.
  async function save(file: File, place: ModulePlace | null, target: Target, progress: (step: ProgressStep) => void, ask: (name: string) => Promise<boolean>, choose: (name: string | null, fallback: string | null) => Promise<string | null>, replace: (name: string, olds: string[]) => Promise<boolean>, offer: (undo: Undo) => void): Promise<Result> {
    const reader = new ImportWorker();
    readers.current.add(reader);
    try {
      const parsed = await reader.card(file);
      if (!parsed.ok) return { kind: 'failed', file: file.name, failure: describeImportFailure(parsed.failure) };
      if ('chat' in parsed || 'risuChats' in parsed) return await saveChats(file.name, parsed, target, place, choose);
      if ('tool' in parsed) {
        const saved = await importTool(store, files, parsed.tool);
        if (!saved.ok) return unsaved(file.name, saved);
        const previous = saved.data.previous;
        const placed = !previous && place && (await setModuleAt(store, place, saved.data.id, true));
        const outcome = toolOutcome(file.name, parsed.tool.manifest, saved.data, { at: place?.kind ?? null, failure: placed && !placed.ok ? describeFailure(placed) : null });
        if (previous) offer({ message: outcome.holds, run: () => undoToolImport(store, saved.data.id, previous) });
        return outcome;
      }
      if ('preset' in parsed) {
        const saved = await savePreset(store, parsed.preset);
        if (!saved.ok) return unsaved(file.name, saved);
        offer(undoPrompt(store, saved.data.id, parsed.preset.prompt.name, saved.data.made));
        const modules = saved.data.paired.map((id) => moduleName(store.get('module', id)!.value.name));
        return promptOutcome(file.name, parsed.preset, saved.data.id, modules, saved.data.waiting);
      }
      if ('module' in parsed) {
        const { namespace } = parsed.module;
        const versions = namespace === null ? [] : sameNamespace(store, namespace);
        const olds = versions.length > 0 && (await replace(moduleName(parsed.module.name), versions.map(({ value }) => moduleName(value.name)))) ? versions : [];
        const saved = await importModule(store, files, parsed.module, (step) => progress(stepOf(step)));
        if (!saved.ok) return unsaved(file.name, saved);
        offer(undoModule(store, saved.data.id, parsed.module.name, olds.map(({ id }) => id)));
        const placed = place && (await setModuleAt(store, place, saved.data.id, true));
        const failure = placed && !placed.ok ? describeFailure(placed) : null;
        // After the placement, which appends: replacing puts it where the older version was in that list too.
        const replaced = olds.length > 0 ? await replaceModules(store, saved.data.id, olds.map(({ id }) => id)) : null;
        const replacing = replaced && { names: olds.map(({ value }) => moduleName(value.name)), places: replaced.ok ? replaced.data : 0, failure: replaced.ok ? null : describeFailure(replaced) };
        const paired = await pairWithPrompts(store, saved.data.id, parsed.module);
        const pairing = paired.ok ? { prompts: paired.data.map((prompt) => promptName(prompt.value.name)), failure: null } : { prompts: [], failure: describeFailure(paired) };
        return moduleOutcome(file.name, parsed.module, saved.data.id, saved.data.unsupported, { at: place?.kind ?? null, failure }, pairing, replacing);
      }
      if ('persona' in parsed) {
        const saved = await addRisuPersona(store, parsed.persona, await parsed.persona.picture());
        if (!saved.ok) return unsaved(file.name, saved);
        offer(undoPersona(store, saved.data.id, aliased(parsed.persona.name, parsed.persona.alias)));
        return personaOutcome(file.name, saved.data);
      }
      const { name } = parsed.card.card;
      const match = parsed.card.assets.length > 0 ? risuMatch(store, name) : null;
      if (match !== null && (await ask(name))) {
        progress(stepOf({ kind: 'picture' }));
        const filled = await fillPictures(store, files, { kind: 'asset', parent: match }, parsed.card.assets);
        if (!filled.ok) return unsaved(file.name, filled);
        return { kind: 'filled', file: file.name, name, kept: filled.data.kept.length, missed: missedLines(mergeUnsupported(parsed.card.report.unsupported, filled.data.unsupported)) };
      }
      const saved = await importCardFile(store, files, parsed.card, (step) => progress(stepOf(step)));
      if (!saved.ok) return unsaved(file.name, saved);
      offer(undoCharacter(store, saved.data.id, name));
      return characterOutcome(file.name, parsed.card, saved.data);
    } catch (error) {
      if (!(error instanceof ImportReadError)) throw error;
      return { kind: 'failed', file: file.name, failure: error instanceof ImportStuck ? '파일을 읽다가 멈춰서 그만뒀어요. 파일이 깨졌을 수 있어요.' : '파일을 읽지 못했어요. 다시 가져와 주세요.' };
    } finally {
      reader.close();
      readers.current.delete(reader);
    }
  }

  async function take(files: File[], target: Target): Promise<Result[]> {
    if (files.length === 0 || state?.busy || moving) return [];
    const backups = files.filter((file) => file.name.toLowerCase().endsWith('.bin'));
    if (backups.length > 0) {
      setMoving({ files: backups, aside: files.length - backups.length });
      return [];
    }
    const place = placeOf(store, route);
    const results: Result[] = [];
    const undos: Undo[] = [];
    for (const file of files) {
      if (!mounted.current) return results;
      setState({ busy: { file: file.name, steps: [] }, results, ask: null });
      const progress = (step: ProgressStep) => setState({ busy: { file: file.name, steps: [step] }, results, ask: null });
      const cancel = (reject: (error: Error) => void) => () => reject(new ImportCancelled());
      const ask = (name: string) => new Promise<boolean>((answer, reject) => setState({ busy: { file: file.name, steps: [] }, results, ask: { kind: 'fill', name, answer, cancel: cancel(reject) } }));
      const choose = (name: string | null, fallback: string | null) =>
        new Promise<string | null>((answer, reject) => setState({ busy: { file: file.name, steps: [] }, results, ask: { kind: 'character', file: file.name, name, fallback, answer, cancel: cancel(reject) } }));
      const replace = (name: string, olds: string[]) => new Promise<boolean>((answer, reject) => setState({ busy: { file: file.name, steps: [] }, results, ask: { kind: 'replace', name, olds, answer, cancel: cancel(reject) } }));
      try {
        results.push(await save(file, place, target, progress, ask, choose, replace, (undo) => undos.push(undo)));
      } catch (error) {
        if (!(error instanceof ImportCancelled)) throw error;
        break;
      }
    }
    if (undos.length === 1) toast.undoable(undos[0]!.message, undos[0]!.run);
    else if (undos.length > 1) toast.undoable(`${undos.length}개를 가져왔어요.`, () => undoAll(undos));
    setState(results.length > 0 ? { busy: null, results, ask: null } : null);
    return results;
  }

  // then runs inside the confirming press, so a file picker it opens still counts as the user's own.
  function asked(then: () => void) {
    if (noticed) then();
    else setNotice(() => then);
  }

  function open(to: Target, accept = ACCEPT) {
    asked(() => pickFiles(accept, true, (picked) => void take(picked, to)));
  }

  const dragging = useFileDrop((dropped) => asked(() => void take(dropped, undefined)));

  const idsOf = (kind: ImportOutcome['kind']) => state?.results.flatMap((result) => (result.kind === kind ? [result.id] : [])) ?? [];
  const done = idsOf('character');
  const go = (to: Route) => {
    setState(null);
    navigate(to);
  };
  const answered = (ask: { answer: (yes: boolean) => void }) => (yes: boolean) => {
    setState(state && { ...state, ask: null });
    ask.answer(yes);
  };
  const came = state?.results.some((result) => result.kind !== 'failed') ?? false;
  const title = state?.ask ? ASK_TITLES[state.ask.kind] : state?.busy ? '가져오는 중' : came ? '가져왔어요' : '가져오지 못했어요';
  return (
    <ImportContext.Provider
      value={{
        pick: () => open(undefined),
        pickChats: open,
        pickPrompts: () => open(undefined, PRESETS),
        pickPersonas: () => open(undefined, '.png'),
        move: () => asked(() => setAsking(true)),
        bring: (file) => new Promise((done) => asked(() => void take([file], undefined).then((results) => done(results.some((result) => result.kind === 'character'))))),
      }}
    >
      {children}
      {notice && (
        <ConfirmDialog
          title="가져오기 전에 확인해 주세요"
          confirm="확인했어요"
          icon={Check}
          onConfirm={() => {
            setNotice(null);
            void store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, importNotice: true }));
            notice();
          }}
          onClose={() => setNotice(null)}
        >
          제작자가 RisuAI에서만 쓰도록 배포한 봇은 가져오지 마세요.
        </ConfirmDialog>
      )}
      {dragging && <DropOverlay>여기에 파일을 놓으면 봇, 모듈, 프롬프트, 페르소나, 채팅이나 Risu 백업을 가져와요</DropOverlay>}
      {asking && (
        <MoveDialog
          onRead={(files) => {
            setAsking(false);
            setMoving({ files, aside: 0 });
          }}
          onClose={() => setAsking(false)}
        />
      )}
      {moving && <MoveFlow files={moving.files} aside={moving.aside} onClose={() => setMoving(null)} />}
      {state && (
        <Dialog title={title} onClose={() => (state.ask ? state.ask.cancel() : state.busy || setState(null))}>
          <Stack>
            {state.results.map((result, index) =>
              result.kind === 'failed' ? <Failed key={index} file={result.file} failure={result.failure} /> : result.kind === 'filled' ? <FilledSummary key={index} result={result} /> : <Summary key={index} result={result} />,
            )}
            {state.ask?.kind === 'fill' ? (
              <Question title={state.ask.name} help="기존 캐릭터의 대화와 설정은 그대로 두고 이미지만 이 카드에서 가져와요." text="Risu에서 가져온 같은 이름의 캐릭터가 이미 있어요." no="새 캐릭터로 가져오기" yes="이미지만 가져오기" onAnswer={answered(state.ask)} />
            ) : state.ask?.kind === 'replace' ? (
              <Question title={state.ask.name} help={`바꾸면 이전 버전이 켜져 있던 곳에 새 버전을 켜고, 이전 버전은 ${BIN}으로 옮겨요.`} text={`이전 버전 ${quoted(state.ask.olds)} 모듈이 있어요.`} no="따로 두기" yes="바꾸기" onAnswer={answered(state.ask)} />
            ) : state.ask ? <CharacterChoice key={state.ask.file} ask={state.ask} onAnswer={() => setState({ ...state, ask: null })} /> : state.busy && <><Text variant="note">{state.busy.file}</Text><Progress steps={state.busy.steps} /></>}
            {!state.busy && done.length === 1 && (
              <Button
                icon={MessageSquarePlus}
                onClick={() => go({ kind: 'new-chat', character: done[0]! })}
              >
                채팅 시작
              </Button>
            )}
            {!state.busy && OPENS.map(({ kind, icon, label, route }) => {
              const ids = idsOf(kind);
              return ids.length === 1 && ids[0] !== null && (
                <Button key={kind} variant={done.length === 1 ? 'secondary' : 'primary'} icon={icon} onClick={() => go(route(ids[0]!))}>
                  {label}
                </Button>
              );
            })}
          </Stack>
        </Dialog>
      )}
    </ImportContext.Provider>
  );
}

function Summary({ result }: { result: ImportOutcome }) {
  return (
    <Section level={3} title={result.title}>
      <Text>{result.holds}</Text>
      {[result.replaced, result.placed, result.paired].map((line, index) => line && (line.failed ? <Callout key={index} tone="warn">{line.text}</Callout> : <Text key={index}>{line.text}</Text>))}
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
      {result.unused && <Text variant="note">{result.unused}</Text>}
    </Section>
  );
}

function CharacterChoice({ ask, onAnswer }: { ask: Extract<Ask, { kind: 'character' }>; onAnswer: () => void }) {
  const { characters } = useLibrary();
  const [picked, setPicked] = useState(() => characters.find(({ character }) => character.card.name === ask.name)?.id ?? ask.fallback);
  const search = useSearch(characters, '캐릭터 검색', ({ character }) => characterTexts(character));
  const chosen = characters.find(({ id }) => id === picked)?.character;
  const name = chosen ? aliased(chosen.card.name, chosen.alias) : NO_CHARACTER;
  return (
    <Section level={3} title={ask.name ?? ask.file}>
      <Stack gap="related">
        <Menu place="below-start" size="lg" label="캐릭터" trigger={(opener) => <ChipButton variant="field" label={name} title="캐릭터" {...opener} />}>
          {search.field}
          {search.none && <Empty variant="menu">{search.none}</Empty>}
          {!search.words && <MenuItem label={NO_CHARACTER} checked={picked === null} onClick={() => setPicked(null)} />}
          {search.found.map(({ id, character, face }) => (
            <MenuItem key={id} label={aliased(character.card.name, character.alias)} avatar={<Avatar face={character.card.name} image={face} />} checked={picked === id} onClick={() => setPicked(id)} />
          ))}
        </Menu>
        <Row kind="actions">
          <Button
            size="md"
            onClick={() => {
              onAnswer();
              ask.answer(picked);
            }}
          >
            넣기
          </Button>
        </Row>
      </Stack>
    </Section>
  );
}

function Question({ title, help, text, no, yes, onAnswer }: { title: string; help: string; text: string; no: string; yes: string; onAnswer: (yes: boolean) => void }) {
  return (
    <Section level={3} title={title} help={help}>
      <Stack gap="related">
        <Text>{text}</Text>
        <Row kind="actions">
          <Button variant="secondary" size="md" onClick={() => onAnswer(false)}>
            {no}
          </Button>
          <Button size="md" onClick={() => onAnswer(true)}>
            {yes}
          </Button>
        </Row>
      </Stack>
    </Section>
  );
}

function FilledSummary({ result }: { result: Filled }) {
  return (
    <Section level={3} title={result.name}>
      <Text>{`이미지 ${result.kept}개를 가져왔어요`}</Text>
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
    </Section>
  );
}

function Failed({ file, failure }: { file: string; failure: string }) {
  return (
    <Section level={3} title={file}>
      <Callout tone="warn">{failure}</Callout>
    </Section>
  );
}
