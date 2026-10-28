import { importTool, sameTool, undoToolImport } from '../../runtime/tools/store';
import { useToast } from '../toast';
import { Check, FileText, MessageSquare, MessageSquarePlus, Package, Puzzle, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EXPANSION, METADATA_BYTES } from '../../engine/import/inflate';
import type { ImportFailure } from '../../engine/import/types';
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
import { IMPORT_ACCEPT, ImportContext } from '../common/importing';
import { PRESET_EXTENSIONS } from '../../engine/import/preset';
import { sizeText } from '../common/size';
import { useSearch } from '../common/useSearch';
import { BIN, MISSED, moduleName, NO_CHARACTER, promptName, RISU_PLUGIN, TOOL } from '../common/words';
import { useFiles, useLibrary, useSession, useSettings, useStore } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Route } from '../shell/routes';
import { Avatar, Button, Callout, Checkbox, ChipButton, ChoiceGroup, ConfirmDialog, Dialog, DropOverlay, Empty, Hint, List, ListItem, Menu, MenuItem, Outcome, pickFiles, Progress, Stack, Text, useFileDrop, type ProgressStep } from '../ui';
import { characterOutcome, characterPreview, chatOutcome, chatPreview, moduleOutcome, modulePreview, personaOutcome, personaPreview, promptOutcome, promptPreview, quoted, toolOutcome, toolPreview, type ImportKind, type ImportOutcome, type Line, type Preview } from './importOutcome';
import { chatMissed, missedLines, moveMissed } from './missed';
import { MoveDialog } from './MoveDialog';
import { MoveFlow } from './MoveFlow';
import { stepOf } from './saving';

// The preview's own 못 가져온 것: nothing is saved yet.
const WONT_COME = '가져올 수 없는 항목';
const OPENS: { kind: Exclude<ImportOutcome['kind'], 'character'>; icon: LucideIcon; label: string; route: (id: string) => Route }[] = [
  { kind: 'chat', icon: MessageSquare, label: '열기', route: (id) => ({ kind: 'chat', id }) },
  { kind: 'module', icon: Package, label: '모듈 보기', route: (id) => ({ kind: 'module', id, pane: null }) },
  { kind: 'plugin', icon: Puzzle, label: '플러그인 보기', route: (id) => ({ kind: 'plugin', id }) },
  { kind: 'prompt', icon: FileText, label: '프롬프트 보기', route: (id) => ({ kind: 'prompt', id, pane: null }) },
  { kind: 'persona', icon: UserRound, label: '페르소나 보기', route: (id) => ({ kind: 'persona', id }) },
];

// fill targets a moved character's pictures; replace selects old module versions. For chat destinations,
// picked null means 캐릭터 없이; asked requests a user choice, with name retaining the file's character name.
type Choice = { kind: 'fill'; into: string; on: boolean } | { kind: 'replace'; olds: string[]; on: boolean } | { kind: 'character'; asked: boolean; name: string | null; picked: string | null };
// Where a file of chats goes: a character's id, null for 캐릭터 없이, undefined where the way in names none.
type Target = string | null | undefined;
type Read = { file: File; preview: Preview; choice: Choice | null; ticked: boolean };
type Row = { file: File; failure: string } | Read;
type Parsed = Exclude<Awaited<ReturnType<ImportWorker['card']>>, { ok: false }>;
type Result = ImportOutcome | { kind: 'filled'; file: string; title: string; lines: Line[]; missed: string[] } | { kind: 'failed'; file: string; failure: string };
type State =
  | { kind: 'reading'; file: string }
  | { kind: 'preview'; rows: Row[]; place: ModulePlace | null }
  | { kind: 'saving'; file: string; steps: ProgressStep[] }
  | { kind: 'done'; results: Result[] };
// 되돌리기 for what one file brought. Its closure holds ids, never the parsed file, which would stay alive with it.
type Undo = { message: string; run: () => Promise<ApiResult<unknown> | ApiFailure> };

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '가져올 수 없는 파일 형식이에요.',
  encrypted: '암호화된 캐릭터 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요.',
};

// Importer detail codes not listed here use the generic unreadable-file message.
const DETAIL_FAILURE: Record<string, string> = {
  'other-version': '이전 버전에서 만든 채팅 파일이라 가져올 수 없어요.',
  'not-preset': 'Risu 파일이지만 프리셋 파일이 아니에요.',
  'decrypt-failed': '프리셋을 열지 못했어요. 파일이 깨졌을 수 있어요.',
  'no-template': '프롬프트 템플릿을 쓰지 않는 프리셋은 가져올 수 없어요. Risu에서 템플릿을 켜고 다시 내보내 주세요.',
  'tool-too-large': '플러그인 파일 용량이 너무 커요.',
  'tool-encoding': 'UTF-8 형식의 텍스트 파일이 아니에요.',
  'tool-api': '헤이젤 플러그인 파일이 아니에요. 파일 맨 위에 //@api 1이 있어야 해요.',
  'tool-identity': '//@name과 //@author가 꼭 있어야 하고, 글자와 숫자, _ . - 기호만 쓸 수 있어요.',
  'tool-setting': '설정 줄을 읽지 못했어요.',
  'tool-menu': '메뉴 줄을 읽지 못했어요.',
  'tool-action': '메시지 동작 줄을 읽지 못했어요.',
  'tool-composer': '입력창 줄을 읽지 못했어요.',
  'tool-uses': '//@uses에는 model, embed, memory만 쓸 수 있어요.',
  'tool-unknown': '알 수 없는 줄이에요.',
  'risu-old': `예전 버전의 ${RISU_PLUGIN}이라 가져올 수 없어요. API 3.0 플러그인만 쓸 수 있어요.`,
  'risu-name': '//@name이 꼭 있어야 해요.',
  'persona-unreadable': 'Risu 페르소나 PNG 파일이지만 내용을 읽지 못했어요.',
  'persona-incomplete': '이름이나 설명이 빠진 페르소나라 가져올 수 없어요.',
  'expands-too-far': `압축을 풀면 파일 크기의 ${EXPANSION}배가 넘어서 가져올 수 없어요.`,
  'entry-too-large': `이미지를 뺀 내용이 ${sizeText(METADATA_BYTES)}를 넘어서 가져올 수 없어요.`,
};


const failed = (file: string, failure: string): Result => ({ kind: 'failed', file, failure });
const unsaved = (file: string, failure: ApiFailure): Result => failed(file, `저장하지 못했어요. ${describeFailure(failure)}`);

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
// a conversation prompt's editor, a persona's page, or 설정 › 모듈 for 항상, which also reads any .charx as a module. A file of chats that names no character goes to the character found here too.
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
    case 'plugins':
    case 'plugin':
    case 'plugin-page':
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
  const { read } = useSession();
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

  // A file is read once for its preview and again to save it, so a batch never holds every archive while the user looks.
  async function reading<T extends object>(file: File, place: ModulePlace | null, use: (parsed: Parsed) => Promise<T>): Promise<T | string> {
    const reader = new ImportWorker();
    readers.current.add(reader);
    try {
      const parsed = await reader.card(file, place?.kind === 'always');
      if (!parsed.ok) return describeImportFailure(parsed.failure);
      return await use(parsed);
    } catch (error) {
      if (!(error instanceof ImportReadError)) throw error;
      return error instanceof ImportStuck ? '파일을 읽다가 멈춰서 그만뒀어요. 파일이 깨졌을 수 있어요.' : '파일을 읽지 못했어요. 다시 가져와 주세요.';
    } finally {
      reader.close();
      readers.current.delete(reader);
    }
  }

  const nameOf = (id: string | null) => {
    const shown = id === null ? null : store.get('character', id)!.value;
    return shown && aliased(shown.card.name, shown.alias);
  };

  // A file of chats goes where the way in named, else to the character it was with when that one is here, else, when
  // it names none, to the route's character. Otherwise the user picks, a character of the file's name picked first.
  function destination(chats: ChatsRead, target: Target, place: ModulePlace | null): Choice {
    const named = 'chat' in chats ? chats.chat.character : null;
    const routed = place?.kind === 'character' && live(store.get('character', place.id)) ? place.id : null;
    const fixed = (picked: string | null): Choice => ({ kind: 'character', asked: false, name: null, picked });
    if (target !== undefined) return fixed(target);
    if (named === null) return routed === null ? { kind: 'character', asked: true, name: null, picked: null } : fixed(routed);
    if (live(store.get('character', named.id))) return fixed(named.id);
    const same = read.library.snapshot().characters.find(({ character }) => character.card.name === named.name)?.id;
    return { kind: 'character', asked: true, name: named.name, picked: same ?? routed };
  }

  async function previewOf(file: File, place: ModulePlace | null, target: Target): Promise<Row> {
    const at = place?.kind ?? null;
    const row = await reading(file, place, async (parsed): Promise<Row> => {
      const shown = (preview: Preview, choice: Choice | null = null): Row => ({ file, preview, choice, ticked: true });
      if ('chat' in parsed || 'risuChats' in parsed) {
        const choice = destination(parsed, target, place);
        const count = 'chat' in parsed ? 1 : parsed.risuChats.length;
        return shown(chatPreview(file.name, count, 'chat' in parsed ? [] : moveMissed(parsed.missed), choice.kind === 'character' && !choice.asked ? nameOf(choice.picked) : undefined), choice);
      }
      if ('tool' in parsed) {
        const previous = sameTool(store, parsed.tool.manifest);
        // importTool refuses an identity whose module is in 휴지통 rather than revive it or keep a second copy.
        if (previous && !live(store.get('module', previous.parent!))) return { file, failure: `${BIN}에 같은 ${TOOL}이 있어요. 되살린 뒤에 가져와 주세요.` };
        return shown(toolPreview(parsed.tool.manifest, previous?.value ?? null, at));
      }
      if ('preset' in parsed) return shown(promptPreview(parsed.preset));
      if ('module' in parsed) {
        const { namespace } = parsed.module;
        const olds = namespace === null ? [] : sameNamespace(store, namespace).map(({ value }) => moduleName(value.name));
        return shown(modulePreview(parsed.module, at), olds.length > 0 ? { kind: 'replace', olds, on: true } : null);
      }
      if ('persona' in parsed) return shown(personaPreview(parsed.persona));
      const into = parsed.card.assets.length > 0 ? risuMatch(store, parsed.card.card.name) : null;
      return shown(characterPreview(parsed.card), into === null ? null : { kind: 'fill', into, on: false });
    });
    return typeof row === 'string' ? { file, failure: row } : row;
  }

  // offer: its 되돌리기. A new tool offers none: importTool refuses its identity again while the binned one is kept.
  async function save({ file, preview: { title }, choice }: Read, place: ModulePlace | null, progress: (step: ProgressStep) => void, offer: (undo: Undo) => void): Promise<Result> {
    const saved = await reading(file, place, async (parsed): Promise<Result> => {
      if ('chat' in parsed || 'risuChats' in parsed) {
        const character = choice?.kind === 'character' ? choice.picked : null;
        if ('chat' in parsed) {
          const saved = await importChat({ store, files }, parsed.chat, character);
          return saved.ok ? chatOutcome(file.name, [saved.data.id], nameOf(character), chatMissed(saved.data.dropped)) : unsaved(file.name, saved);
        }
        const saved = await importRisuChats(store, character, parsed.risuChats);
        return saved.ok ? chatOutcome(file.name, saved.data, nameOf(character), []) : unsaved(file.name, saved);
      }
      if ('tool' in parsed) {
        const saved = await importTool(store, files, parsed.tool);
        if (!saved.ok) return unsaved(file.name, saved);
        const { previous } = saved.data;
        const placed = !previous && place && (await setModuleAt(store, place, saved.data.id, true));
        if (previous) offer({ message: `'${parsed.tool.manifest.displayName}' ${TOOL}을 가져왔어요.`, run: () => undoToolImport(store, saved.data.id, previous) });
        return toolOutcome(file.name, title, saved.data, { at: place?.kind ?? null, failure: placed && !placed.ok ? describeFailure(placed) : null });
      }
      if ('preset' in parsed) {
        const saved = await savePreset(store, parsed.preset);
        if (!saved.ok) return unsaved(file.name, saved);
        offer(undoPrompt(store, saved.data.id, parsed.preset.prompt.name, saved.data.made));
        const modules = saved.data.paired.map((id) => moduleName(store.get('module', id)!.value.name));
        return promptOutcome(file.name, title, saved.data.id, modules, saved.data.waiting);
      }
      if ('module' in parsed) {
        const { namespace } = parsed.module;
        const olds = choice?.kind === 'replace' && choice.on && namespace !== null ? sameNamespace(store, namespace) : [];
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
        return moduleOutcome(file.name, title, saved.data.id, saved.data.unsupported, { at: place?.kind ?? null, failure }, pairing, replacing);
      }
      if ('persona' in parsed) {
        const saved = await addRisuPersona(store, parsed.persona, await parsed.persona.picture());
        if (!saved.ok) return unsaved(file.name, saved);
        offer(undoPersona(store, saved.data.id, aliased(parsed.persona.name, parsed.persona.alias)));
        return personaOutcome(file.name, title, saved.data);
      }
      if (choice?.kind === 'fill' && choice.on) {
        progress(stepOf({ kind: 'picture' }));
        const filled = await fillPictures(store, files, { kind: 'asset', parent: choice.into }, parsed.card.assets);
        if (!filled.ok) return unsaved(file.name, filled);
        return { kind: 'filled', file: file.name, title, lines: [{ text: `이미지 ${filled.data.kept.length}개를 가져왔어요.`, failed: false }], missed: missedLines(filled.data.unsupported) };
      }
      const saved = await importCardFile(store, files, parsed.card, (step) => progress(stepOf(step)));
      if (!saved.ok) return unsaved(file.name, saved);
      offer(undoCharacter(store, saved.data.id, parsed.card.card.name));
      return characterOutcome(file.name, title, saved.data);
    });
    return typeof saved === 'string' ? failed(file.name, saved) : saved;
  }

  // shown: false for a file the user has already seen, as a share link's page shows its bot.
  async function take(picked: File[], target: Target, shown = true): Promise<Result[]> {
    if (picked.length === 0 || (state !== null && state.kind !== 'done') || moving) return [];
    const backups = picked.filter((file) => file.name.toLowerCase().endsWith('.bin'));
    if (backups.length > 0) {
      setMoving({ files: backups, aside: picked.length - backups.length });
      return [];
    }
    const place = placeOf(store, route);
    const rows: Row[] = [];
    for (const file of picked) {
      if (!mounted.current) return [];
      setState({ kind: 'reading', file: file.name });
      rows.push(await previewOf(file, place, target));
    }
    if (!shown) return run(rows, place);
    setState({ kind: 'preview', rows, place });
    return [];
  }

  // A row that did not read stands among the results only when no preview showed it.
  async function run(rows: Row[], place: ModulePlace | null): Promise<Result[]> {
    const results: Result[] = [];
    const undos: Undo[] = [];
    for (const row of rows) {
      if (!mounted.current) return results;
      if ('failure' in row) {
        results.push(failed(row.file.name, row.failure));
        continue;
      }
      setState({ kind: 'saving', file: row.file.name, steps: [] });
      results.push(await save(row, place, (step) => setState({ kind: 'saving', file: row.file.name, steps: [step] }), (undo) => undos.push(undo)));
    }
    if (undos.length === 1) toast.undoable(undos[0]!.message, undos[0]!.run);
    else if (undos.length > 1) toast.undoable(`${undos.length}개를 가져왔어요.`, () => undoAll(undos));
    setState(results.length > 0 ? { kind: 'done', results } : null);
    return results;
  }

  // then runs inside the confirming press, so a file picker it opens still counts as the user's own.
  function asked(then: () => void) {
    if (noticed) then();
    else setNotice(() => then);
  }

  function open(to: Target, accept = IMPORT_ACCEPT) {
    asked(() => pickFiles(accept, true, (picked) => void take(picked, to)));
  }

  const drop = (dropped: File[]) => asked(() => void take(dropped, undefined));
  const dragging = useFileDrop(drop);

  const results = state?.kind === 'done' ? state.results : [];
  const idsOf = (kind: ImportOutcome['kind']) => results.flatMap((result) => (result.kind === kind ? [result.id] : []));
  const done = idsOf('character');
  const go = (to: Route) => {
    setState(null);
    navigate(to);
  };
  const opens = [
    ...OPENS.flatMap(({ kind, icon, label, route }) => {
      const ids = idsOf(kind);
      return ids.length === 1 && ids[0] !== null ? [
        <Button key={kind} variant={done.length === 1 ? 'secondary' : 'primary'} icon={icon} onClick={() => go(route(ids[0]!))}>
          {label}
        </Button>,
      ] : [];
    }),
    ...(done.length === 1 ? [
      <Button key="chat" icon={MessageSquarePlus} onClick={() => go({ kind: 'new-chat', character: done[0]! })}>
        채팅 시작
      </Button>,
    ] : []),
  ];
  const rows = state?.kind === 'preview' ? state.rows : [];
  const ready = rows.filter((row): row is Read => 'preview' in row);
  const ticked = ready.filter((row) => row.ticked);
  const title =
    state?.kind === 'reading' ? '파일 읽는 중'
    : state?.kind === 'saving' ? '가져오는 중'
    : state?.kind === 'preview' ? (ready.length > 0 ? '가져올까요?' : '가져오지 못했어요')
    : results.some((result) => result.kind !== 'failed') ? '가져왔어요' : '가져오지 못했어요';
  const actions =
    state?.kind === 'preview' ? (ready.length > 0 ? (
      <Button disabled={ticked.length === 0} onClick={() => void run(ticked, state.place)}>
        {ready.length > 1 ? `가져오기 ${ticked.length}개` : '가져오기'}
      </Button>
    ) : undefined)
    : opens.length > 0 ? <>{opens}</> : undefined;
  const change = (row: Read, next: Partial<Read>) => state?.kind === 'preview' && setState({ ...state, rows: state.rows.map((each) => (each === row ? { ...row, ...next } : each)) });
  return (
    <ImportContext.Provider
      value={{
        pick: () => open(undefined),
        pickChats: open,
        pickPrompts: () => open(undefined, PRESET_EXTENSIONS.join(',')),
        pickPersonas: () => open(undefined, '.png'),
        move: () => asked(() => setAsking(true)),
        bring: (file) => new Promise((done) => asked(() => void take([file], undefined, false).then((results) => done(results.some((result) => result.kind === 'character'))))),
        drop,
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
      {dragging && <DropOverlay>여기에 파일을 놓으면 가져와요</DropOverlay>}
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
        <Dialog title={title} onClose={() => (state.kind === 'preview' || state.kind === 'done') && setState(null)} actions={actions}>
          {state.kind === 'preview' ? (
            <List label="가져올 파일" box>
              {ready.map((row, index) => <PreviewRow key={index} row={row} many={ready.length > 1} onChange={(next) => change(row, next)} />)}
              {rows.flatMap((row, index) => ('failure' in row ? [<FailedRow key={`failed-${index}`} file={row.file.name} failure={row.failure} />] : []))}
            </List>
          ) : state.kind === 'done' ? (
            <List label="가져온 파일" box>
              {[...results.filter((result) => result.kind !== 'failed'), ...results.filter((result) => result.kind === 'failed')].map((result, index) =>
                result.kind === 'failed' ? <FailedRow key={index} file={result.file} failure={result.failure} /> : <DoneRow key={index} result={result} />,
              )}
            </List>
          ) : (
            <Stack>
              <Text variant="note">{state.file}</Text>
              <Progress steps={state.kind === 'saving' ? state.steps : []} />
            </Stack>
          )}
        </Dialog>
      )}
    </ImportContext.Provider>
  );
}

const KINDS: Record<ImportKind, { word: string; face?: LucideIcon }> = {
  character: { word: '캐릭터' },
  persona: { word: '페르소나' },
  module: { word: '모듈', face: Package },
  plugin: { word: TOOL, face: Puzzle },
  prompt: { word: '프롬프트', face: FileText },
  chat: { word: '채팅', face: MessageSquare },
};

// Under the row: its warnings and lines first, then what asks a choice, then what does not come in.
function ImportRow({ kind, title, holds, lines, missed, missedTitle, note, control, choice }: { kind: ImportKind; title: string; holds?: string; lines: Line[]; missed: string[]; missedTitle: string; note?: string | null; control?: ReactNode; choice?: ReactNode }) {
  const { word, face } = KINDS[kind];
  const detail = (lines.length > 0 || choice || missed.length > 0 || note) && (
    <Stack gap="related">
      {lines.map((line, index) => line.failed ? <Callout key={index} tone="warn">{line.text}{line.help && <Hint label={line.help.label}>{line.help.text}</Hint>}</Callout> : <Text key={index} variant="note">{line.text}</Text>)}
      {choice}
      {missed.length > 0 && <Outcome title={missedTitle} items={missed.map((title) => ({ title }))} />}
      {note && <Text variant="note">{note}</Text>}
    </Stack>
  );
  return <ListItem leading={<Avatar face={face ?? title} tone={kind === 'persona' ? 'you' : 'plain'} />} title={title} description={[word, holds].filter(Boolean).join(' · ')} control={control} detail={detail || undefined} />;
}

// many: with other files, each ticked to come in or not.
function PreviewRow({ row: { preview, choice, ticked }, many, onChange }: { row: Read; many: boolean; onChange: (next: Partial<Read>) => void }) {
  return (
    <ImportRow
      kind={preview.kind}
      title={preview.title}
      holds={preview.holds}
      lines={[preview.verdict, preview.placed].filter((line): line is Line => line !== null)}
      missed={preview.missed}
      missedTitle={WONT_COME}
      note={preview.unused}
      control={many && <Checkbox label={`${preview.title} 가져오기`} hideLabel checked={ticked} onChange={(ticked) => onChange({ ticked })} />}
      choice={choice && <ChoiceField choice={choice} onChange={(choice) => onChange({ choice })} />}
    />
  );
}

function DoneRow({ result }: { result: Exclude<Result, { kind: 'failed' }> }) {
  return <ImportRow kind={result.kind === 'filled' ? 'character' : result.kind} title={result.title} lines={result.lines} missed={result.missed} missedTitle={MISSED} />;
}

function FailedRow({ file, failure }: { file: string; failure: string }) {
  return <ListItem leading={<Avatar face={TriangleAlert} />} title={file} description={failure} />;
}

function ChoiceField({ choice, onChange }: { choice: Choice; onChange: (choice: Choice) => void }) {
  switch (choice.kind) {
    case 'fill':
      return (
        <Stack gap="related">
          <Text>
            Risu에서 가져온 같은 이름의 캐릭터가 이미 있어요.
            <Hint label="이미지만 가져오기">기존 캐릭터의 대화와 설정은 그대로 두고 이미지만 이 카드에서 가져와요.</Hint>
          </Text>
          <ChoiceGroup label="가져올 방법" layout="fit" options={[{ value: 'new', label: '새 캐릭터로' }, { value: 'fill', label: '이미지만' }]} value={choice.on ? 'fill' : 'new'} onChange={(value) => onChange({ ...choice, on: value === 'fill' })} />
        </Stack>
      );
    case 'replace':
      return (
        <Stack gap="related">
          <Text>
            {`이전 버전 ${quoted(choice.olds)} 모듈이 있어요.`}
            <Hint label="바꾸기">{`바꾸면 이전 버전이 켜져 있던 곳에 새 버전을 켜고, 이전 버전은 ${BIN}으로 옮겨요.`}</Hint>
          </Text>
          <ChoiceGroup label="이전 버전" layout="fit" options={[{ value: 'replace', label: '바꾸기' }, { value: 'keep', label: '따로 두기' }]} value={choice.on ? 'replace' : 'keep'} onChange={(value) => onChange({ ...choice, on: value === 'replace' })} />
        </Stack>
      );
    case 'character':
      return choice.asked && <CharacterChoice picked={choice.picked} onPick={(picked) => onChange({ ...choice, picked })} />;
  }
}

function CharacterChoice({ picked, onPick }: { picked: string | null; onPick: (id: string | null) => void }) {
  const { characters } = useLibrary();
  const search = useSearch(characters, '캐릭터 검색', ({ character }) => characterTexts(character));
  const chosen = characters.find(({ id }) => id === picked)?.character;
  const name = chosen ? aliased(chosen.card.name, chosen.alias) : NO_CHARACTER;
  return (
    <Stack gap="related">
      <Text>어느 캐릭터에 넣을까요?</Text>
      <Menu place="below-start" size="lg" label="캐릭터" trigger={(opener) => <ChipButton variant="field" label={name} title="캐릭터" {...opener} />}>
        {search.field}
        {search.none && <Empty variant="menu">{search.none}</Empty>}
        {!search.words && <MenuItem label={NO_CHARACTER} checked={picked === null} onClick={() => onPick(null)} />}
        {search.found.map(({ id, character, face }) => (
          <MenuItem key={id} label={aliased(character.card.name, character.alias)} avatar={<Avatar face={character.card.name} image={face} />} checked={picked === id} onClick={() => onPick(id)} />
        ))}
      </Menu>
    </Stack>
  );
}
