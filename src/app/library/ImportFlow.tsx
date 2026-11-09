import { sameTool } from '../../runtime/tools/store';
import { useToast } from '../toast';
import { Check, FileText, LockKeyhole, MessageSquare, Package, Puzzle, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { characterTexts, live } from '../../model/library';
import { allWritten, type ApiFailure } from '../../runtime/api';
import { importChat } from '../../runtime/chat-log';
import { markImportNoticed } from '../../runtime/chat-context';
import type { UnpackFailure } from '../../engine/import/archive';
import type { ImportFailure } from '../../engine/import/types';
import { PACKED_EXTENSION } from '../../engine/import/extensions';
import { ImportWorker } from '../../runtime/import/client';
import { downloadLink, readLink, type BotLink, type LinkFailure } from '../../runtime/import/link';
import { ImportReadError, ImportStuck } from '../../runtime/import/protocol';
import { chatDestination, placeOn, saveCharacter, saveModule, savePersona, savePrompt, saveTool, type ImportPage, type Undo } from '../../runtime/import/save';
import { sameNamespace, type ModulePlace } from '../../runtime/modules';
import { fillPictures, importRisuChats, risuMatch } from '../../runtime/move';
import { aliased } from '../common/alias';
import { describeReplyError } from '../common/failure';
import { describeImportFailure } from '../common/importFailure';
import { ACTS } from '../common/acts';
import { IMPORT_ACCEPT, ImportContext } from '../common/importing';
import { PRESET_EXTENSIONS } from '../../engine/import/preset';
import { useSearch } from '../common/useSearch';
import { BIN, MISSED, moduleName, namedObject, NO_CHARACTER, promptName, TOOL, UNREADABLE_FILE, WRONG_PASSWORD } from '../common/words';
import { useFiles, useLibrary, useSettings, useStore } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Route } from '../shell/routes';
import { Avatar, Button, Callout, Checkbox, ChipButton, ChoiceGroup, ConfirmDialog, Dialog, DropOverlay, Empty, Hint, List, ListItem, Menu, MenuItem, Outcome, pickFiles, Progress, Stack, Text, TextField, useFileDrop, type ProgressStep } from '../ui';
import { characterOutcome, characterPreview, chatOutcome, chatPreview, failureOf, moduleOutcome, modulePreview, personaOutcome, personaPreview, placement, promptOutcome, promptPreview, quoted, toolOutcome, toolPreview, unsaved, withOriginal, type ImportKind, type ImportOutcome, type Line, type Preview } from './importOutcome';
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
// password: the one an rcc card opened with, which saving reads it with again.
type Read = { file: File; password: string | undefined; preview: Preview; choice: Choice | null; ticked: boolean };
// An rcc card waiting for its password, wrong once one was tried.
type Locked = { file: File; locked: 'asked' | 'wrong' };
type Row = { file: File; failure: string } | Locked | Read;
type Parsed = Exclude<Awaited<ReturnType<ImportWorker['card']>>, { ok: false }>;
// password: why a Proton link asks for its owner's password.
type LinkStart = { text: string; password: 'asked' | 'wrong' | null };
type Result = ImportOutcome | { kind: 'filled'; file: string; title: string; lines: Line[]; missed: string[] } | { kind: 'failed'; file: string; failure: string };
type State =
  | { kind: 'downloading'; step: ProgressStep }
  | { kind: 'reading'; file: string }
  | { kind: 'preview'; rows: Row[]; place: ModulePlace | null }
  | { kind: 'saving'; file: string; steps: ProgressStep[] }
  | { kind: 'done'; results: Result[] };
// What one file brought, offered back with its 되돌리기.
type Offer = { message: string; run: Undo };

const LINK = '링크';
const linkFailure = (failure: Exclude<LinkFailure, { kind: 'cancelled' | 'needs-password' | 'wrong-password' }>) => {
  switch (failure.kind) {
    case 'missing': return '봇을 찾지 못했어요. 삭제됐거나 비공개일 수 있어요.';
    case 'refused': return '사이트에서 다운로드를 거절했어요. 잠시 뒤 다시 시도해 주세요.';
    case 'not-a-file': return '웹 페이지가 열리는 링크예요. 파일을 바로 받는 링크를 넣어 주세요.';
    case 'guest-blocked': return '이 사이트는 손님 모드에서 바로 가져올 수 없어요. 파일을 직접 받아서 넣어 주세요.';
    case 'needs-account': return 'Proton 링크는 손님 모드에서 가져올 수 없어요. 파일을 직접 받아서 넣어 주세요.';
    case 'no-bot-file': return '가져올 수 있는 파일이 없어요.';
    case 'damaged': return `${UNREADABLE_FILE} 링크가 잘렸거나 파일이 손상됐을 수 있어요.`;
    case 'lost': return '다운로드가 끊겼어요. 인터넷 연결을 확인해 주세요.';
    case 'relay': return describeReplyError(failure.failure);
  }
};
const UNPACK_FAILURE: Record<UnpackFailure, string> = {
  encrypted: '비밀번호가 걸려 있어요. 압축을 풀고 안의 파일을 가져와 주세요.',
  'too-large': '압축을 풀면 용량이 너무 커요. 직접 풀고 안의 파일을 가져와 주세요.',
  unreadable: '압축 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요.',
};
const SKIPPED_SHOWN = 3;
const skippedLine = (names: string[]) =>
  `가져오지 않은 파일 ${names.length}개: ${names.slice(0, SKIPPED_SHOWN).join(', ')}${names.length > SKIPPED_SHOWN ? ' 등' : ''}`;

const failed = (file: string, failure: string): Result => ({ kind: 'failed', file, failure });
const notSaved = (file: string, failure: ApiFailure): Result => failed(file, unsaved(failure));
const offered = (name: string, noun: string, run: Undo): Offer => ({ message: `${namedObject(name, noun)} 가져왔어요.`, run });

// The page a route shows, where a module dropped or picked there is turned on first (placeOn): a character's page,
// editor or chat, a prompt's editor, a persona's page, or 설정 › 모듈 for 항상, which also reads any .charx as a module.
// A file of chats that names no character goes to the character found here too.
function pageOf(route: Route): ImportPage | null {
  switch (route.kind) {
    case 'shelf':
    case 'new-chat':
      return route.character === null ? null : { kind: 'character', id: route.character };
    case 'edit':
      return { kind: 'character', id: route.character };
    case 'chat':
    case 'prompt':
    case 'persona':
      return { kind: route.kind, id: route.id };
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
  const noticed = useSettings().importNotice === true;
  const [notice, setNotice] = useState<(() => void) | null>(null);
  const readers = useRef(new Set<ImportWorker>());
  const download = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [state, setState] = useState<State | null>(null);
  const [moving, setMoving] = useState<{ files: File[]; aside: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [linking, setLinking] = useState<LinkStart | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      download.current?.abort();
      for (const reader of readers.current) reader.close();
      readers.current.clear();
    };
  }, []);

  // A file is read once for its preview and again to save it, so a batch never holds every archive while the user looks.
// A zip's files are the exception: unpacked, they stay in memory until the dialog closes.
  async function reading<T extends object>(
    file: File,
    password: string | undefined,
    place: ModulePlace | null,
    use: (parsed: Parsed, reader: ImportWorker) => Promise<T>,
    refused: (failure: ImportFailure) => T | string = describeImportFailure,
  ): Promise<T | string> {
    return withReader(async (reader) => {
      const parsed = await reader.card(file, place?.kind === 'always', password);
      return parsed.ok ? use(parsed, reader) : refused(parsed.failure);
    });
  }

  async function withReader<T>(use: (reader: ImportWorker) => Promise<T>): Promise<T | string> {
    const reader = new ImportWorker();
    readers.current.add(reader);
    try {
      return await use(reader);
    } catch (error) {
      if (!(error instanceof ImportReadError)) throw error;
      return error instanceof ImportStuck ? '파일을 읽는 중 응답이 없어 중단했어요. 파일이 손상됐을 수 있어요.' : `${UNREADABLE_FILE} 다시 가져와 주세요.`;
    } finally {
      reader.close();
      readers.current.delete(reader);
    }
  }

  const nameOf = (id: string | null) => {
    const shown = id === null ? null : store.get('character', id)!.value;
    return shown && aliased(shown.card.name, shown.alias);
  };

  async function previewOf(file: File, place: ModulePlace | null, target: Target, password?: string): Promise<Row> {
    const at = place?.kind ?? null;
    const refused = (failure: ImportFailure): Row | string =>
      failure.kind === 'needs-password' || failure.kind === 'wrong-password' ? { file, locked: failure.kind === 'needs-password' ? 'asked' : 'wrong' } : describeImportFailure(failure);
    const row = await reading(file, password, place, async (parsed): Promise<Row> => {
      const shown = (preview: Preview, choice: Choice | null = null): Row => ({ file, password, preview, choice, ticked: true });
      if ('chat' in parsed || 'risuChats' in parsed) {
        const choice: Choice = { kind: 'character', ...chatDestination(store, parsed, target, place) };
        const titles = 'chat' in parsed ? [parsed.chat.chat.value.title] : parsed.risuChats.map(({ title }) => title);
        return shown(chatPreview(file.name, titles, 'chat' in parsed ? [] : moveMissed(parsed.missed), choice.kind === 'character' && !choice.asked ? nameOf(choice.picked) : undefined), choice);
      }
      if ('tool' in parsed) {
        const previous = sameTool(store, parsed.tool.manifest);
        // importTool refuses an identity whose module is in 휴지통 rather than revive it or keep a second copy.
        if (previous && !live(store.get('module', previous.parent!))) return { file, failure: `${BIN}에 같은 ${TOOL}이 있어요. 복원한 뒤에 다시 가져와 주세요.` };
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
    }, refused);
    return typeof row === 'string' ? { file, failure: row } : row;
  }

  // The row read again with its password, in place, while the preview stays open.
  async function unlock(row: Locked, password: string, place: ModulePlace | null) {
    const read = await previewOf(row.file, place, undefined, password);
    if (mounted.current) setState((now) => (now?.kind === 'preview' ? { ...now, rows: now.rows.map((each) => (each === row ? read : each)) } : now));
  }

  async function save({ file, password, preview: { title }, choice }: Read, place: ModulePlace | null, progress: (step: ProgressStep) => void, offer: (offer: Offer) => void): Promise<Result> {
    const saved = await reading(file, password, place, async (parsed, reader): Promise<Result> => {
      const sink = { store, files };
      const original = () => reader.original(file.name);
      const step = (each: Parameters<typeof stepOf>[0]) => progress(stepOf(each));
      if ('chat' in parsed || 'risuChats' in parsed) {
        const character = choice?.kind === 'character' ? choice.picked : null;
        if ('chat' in parsed) {
          const saved = await importChat(sink, parsed.chat, character);
          return saved.ok ? chatOutcome(file.name, title, [saved.data.id], nameOf(character), chatMissed(saved.data.dropped)) : notSaved(file.name, saved);
        }
        const saved = await importRisuChats(store, character, parsed.risuChats);
        return saved.ok ? chatOutcome(file.name, title, saved.data, nameOf(character), []) : notSaved(file.name, saved);
      }
      if ('tool' in parsed) {
        const saved = await saveTool(sink, parsed.tool, place);
        if (!saved.ok) return notSaved(file.name, saved);
        if (saved.data.undo) offer(offered(parsed.tool.manifest.displayName, TOOL, saved.data.undo));
        return toolOutcome(file.name, title, saved.data.saved, placement(place, saved.data.placed));
      }
      if ('preset' in parsed) {
        const saved = await savePrompt(sink, parsed.preset, original, step);
        if (!saved.ok) return notSaved(file.name, saved);
        const { id, paired, waiting, kept, undo } = saved.data;
        offer(offered(promptName(parsed.preset.prompt.name), '프롬프트', undo));
        return withOriginal(promptOutcome(file.name, title, id, paired.map((each) => moduleName(store.get('module', each)!.value.name)), waiting), kept);
      }
      if ('module' in parsed) {
        const saved = await saveModule(sink, parsed.module, choice?.kind === 'replace' && choice.on, place, original, step);
        if (!saved.ok) return notSaved(file.name, saved);
        const { id, unsupported, placed, replaced, paired, kept, undo } = saved.data;
        offer(offered(moduleName(parsed.module.name), '모듈', undo));
        const replacing = replaced && { names: replaced.olds.map(({ value }) => moduleName(value.name)), places: replaced.places.ok ? replaced.places.data : 0, failure: failureOf(replaced.places) };
        const pairing = { prompts: paired.ok ? paired.data.map((prompt) => promptName(prompt.value.name)) : [], failure: failureOf(paired) };
        return withOriginal(moduleOutcome(file.name, title, id, unsupported, placement(place, placed), pairing, replacing), kept);
      }
      if ('persona' in parsed) {
        const saved = await savePersona(store, parsed.persona);
        if (!saved.ok) return notSaved(file.name, saved);
        offer(offered(aliased(parsed.persona.name, parsed.persona.alias), '페르소나', saved.data.undo));
        return personaOutcome(file.name, title, saved.data.saved);
      }
      if (choice?.kind === 'fill' && choice.on) {
        progress(stepOf({ kind: 'picture' }));
        const filled = await fillPictures(store, files, { kind: 'asset', parent: choice.into }, parsed.card.assets);
        if (!filled.ok) return notSaved(file.name, filled);
        return { kind: 'filled', file: file.name, title, lines: [{ text: `이미지 ${filled.data.kept.length}개를 가져왔어요.`, failed: false }], missed: missedLines(filled.data.unsupported) };
      }
      const saved = await saveCharacter(sink, parsed.card, original, step);
      if (!saved.ok) return notSaved(file.name, saved);
      offer(offered(parsed.card.card.name, '캐릭터', saved.data.undo));
      return withOriginal(characterOutcome(file.name, title, saved.data.saved), saved.data.kept);
    });
    return typeof saved === 'string' ? failed(file.name, saved) : saved;
  }

  // shown: false for a file the user has already seen, as a share link's page shows its bot.
  // A zip stands in the list only for what it could not give: then every file inside is one more picked file.
  async function unpacked(picked: File[]): Promise<{ files: File[]; rows: Row[] }> {
    const files: File[] = [];
    const rows: Row[] = [];
    for (const file of picked) {
      if (!file.name.toLowerCase().endsWith(PACKED_EXTENSION)) {
        files.push(file);
        continue;
      }
      setState({ kind: 'reading', file: file.name });
      const opened = await withReader((reader) => reader.zip(file));
      if (typeof opened === 'string') rows.push({ file, failure: opened });
      else if (!opened.ok) rows.push({ file, failure: UNPACK_FAILURE[opened.failure] });
      else {
        files.push(...opened.files);
        if (opened.files.length === 0) rows.push({ file, failure: '가져올 수 있는 파일이 없어요.' });
        else if (opened.skipped.length > 0) rows.push({ file, failure: skippedLine(opened.skipped) });
      }
    }
    return { files, rows };
  }

  async function bringLink(link: BotLink, text: string) {
    setLinking(null);
    const line = new AbortController();
    download.current = line;
    const megabytes = (bytes: number) => Math.round(bytes / 1e6);
    const shown = (done: number, total?: number): State => ({ kind: 'downloading', step: { label: '다운로드 (MB)', done, ...(total !== undefined && { total }) } });
    setState(shown(0));
    let last = 0;
    // Each state renders every useImport screen: once per megabyte, not once per network chunk.
    const answer = await downloadLink(link, line.signal, (done, total) => {
      if (megabytes(done) === last) return;
      last = megabytes(done);
      setState(shown(last, total === undefined ? undefined : megabytes(total)));
    });
    download.current = null;
    if (!mounted.current) return;
    if (answer.ok) return void take(answer.files, undefined, true, answer.skipped.length > 0 ? [{ file: new File([], LINK), failure: skippedLine(answer.skipped) }] : []);
    const { failure } = answer;
    if (failure.kind === 'cancelled') return setState(null);
    if (failure.kind === 'needs-password' || failure.kind === 'wrong-password') {
      setState(null);
      return setLinking({ text, password: failure.kind === 'needs-password' ? 'asked' : 'wrong' });
    }
    setState({ kind: 'done', results: [failed(LINK, linkFailure(failure))] });
  }

  async function take(picked: File[], target: Target, shown = true, aside: Row[] = []): Promise<Result[]> {
    if (picked.length === 0 || (state !== null && state.kind !== 'done') || moving) return [];
    const { files, rows: unread } = await unpacked(picked);
    const rows = [...aside, ...unread];
    if (!mounted.current) return [];
    const backups = files.filter((file) => file.name.toLowerCase().endsWith('.bin'));
    if (backups.length > 0) {
      setState(null);
      setMoving({ files: backups, aside: files.length - backups.length });
      return [];
    }
    const page = pageOf(route);
    const place = page && placeOn(store, page);
    for (const file of files) {
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
    const undos: Offer[] = [];
    for (const row of rows) {
      if (!mounted.current) return results;
      if (!('preview' in row)) {
        results.push(failed(row.file.name, 'failure' in row ? row.failure : describeImportFailure({ kind: 'needs-password' })));
        continue;
      }
      setState({ kind: 'saving', file: row.file.name, steps: [] });
      results.push(await save(row, place, (step) => setState({ kind: 'saving', file: row.file.name, steps: [step] }), (undo) => undos.push(undo)));
    }
    if (undos.length === 1) toast.undoable(undos[0]!.message, undos[0]!.run);
    else if (undos.length > 1) toast.undoable(`${undos.length}개를 가져왔어요.`, () => allWritten(undos.map(({ run }) => run())));
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
      <Button key="chat" icon={ACTS.newChat.icon} onClick={() => go({ kind: 'new-chat', character: done[0]! })}>
        {ACTS.newChat.label}
      </Button>,
    ] : []),
  ];
  const rows = state?.kind === 'preview' ? state.rows : [];
  const ready = rows.filter((row): row is Read => 'preview' in row);
  const locked = rows.some((row) => 'locked' in row);
  const ticked = ready.filter((row) => row.ticked);
  const title =
    state?.kind === 'downloading' ? '봇 받는 중'
    : state?.kind === 'reading' ? '파일 읽는 중'
    : state?.kind === 'saving' ? '가져오는 중'
    : state?.kind === 'preview' ? (ready.length > 0 || locked ? '가져올까요?' : '가져오지 못했어요')
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
        pickLink: () => asked(() => setLinking({ text: '', password: null })),
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
            toast.settled(markImportNoticed(store));
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
      {linking && <LinkDialog start={linking} onBring={(link, text) => void bringLink(link, text)} onClose={() => setLinking(null)} />}
      {moving && <MoveFlow files={moving.files} aside={moving.aside} onClose={() => setMoving(null)} />}
      {state && (
        <Dialog
          title={title}
          onClose={state.kind === 'reading' || state.kind === 'saving' ? undefined : () => (state.kind === 'downloading' ? download.current?.abort() : setState(null))}
          actions={actions}
        >
          {state.kind === 'preview' ? (
            <List label="가져올 파일" box>
              {ready.map((row, index) => <PreviewRow key={index} row={row} many={ready.length > 1} onChange={(next) => change(row, next)} />)}
              {rows.flatMap((row, index) => ('locked' in row ? [<LockedRow key={`locked-${index}`} row={row} onOpen={(password) => unlock(row, password, state.place)} />] : []))}
              {rows.flatMap((row, index) => ('failure' in row ? [<FailedRow key={`failed-${index}`} file={row.file.name} failure={row.failure} />] : []))}
            </List>
          ) : state.kind === 'done' ? (
            <List label="가져온 파일" box>
              {[...results.filter((result) => result.kind !== 'failed'), ...results.filter((result) => result.kind === 'failed')].map((result, index) =>
                result.kind === 'failed' ? <FailedRow key={index} file={result.file} failure={result.failure} /> : <DoneRow key={index} result={result} />,
              )}
            </List>
          ) : state.kind === 'downloading' ? (
            <Progress steps={[state.step]} />
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

function LinkDialog({ start, onBring, onClose }: { start: LinkStart; onBring: (link: BotLink, text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(start.text);
  const [password, setPassword] = useState('');
  const link = readLink(text);
  const asking = start.password !== null && link?.kind === 'proton';
  const ready = link !== null && (!asking || password !== '');
  return (
    <Dialog
      title="링크로 가져오기"
      onClose={onClose}
      actions={<Button disabled={!ready} onClick={() => link && onBring(asking ? { ...link, password } : link, text)}>{ACTS.import.label}</Button>}
    >
      <Stack>
        <TextField
          label="봇 링크"
          value={text}
          onChange={setText}
          placeholder="https://realm.risuai.net/character/..."
          help="Realm 봇 링크, Proton Drive 공개 링크, 파일을 바로 받는 https 링크를 넣어요. Realm 외의 링크는 하루 사용량에 포함돼요."
          error={text.trim() !== '' && link === null ? 'https로 시작하는 링크를 넣어 주세요.' : undefined}
        />
        {asking && (
          <TextField
            label="링크 비밀번호"
            kind="current-password"
            value={password}
            onChange={setPassword}
            hint="헤이젤은 Proton 공식 앱이 아니에요. 비밀번호는 이 브라우저에서만 쓰여요."
            error={start.password === 'wrong' ? WRONG_PASSWORD : undefined}
          />
        )}
      </Stack>
    </Dialog>
  );
}

function LockedRow({ row: { file, locked }, onOpen }: { row: Locked; onOpen: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [opening, setOpening] = useState(false);
  const open = () => {
    setOpening(true);
    void onOpen(password).finally(() => setOpening(false));
  };
  return (
    <ListItem
      leading={<Avatar face={LockKeyhole} />}
      title={file.name}
      description={describeImportFailure({ kind: 'needs-password' })}
      detail={
        <Stack gap="related">
          <TextField label="카드 비밀번호" kind="current-password" value={password} onChange={setPassword} error={locked === 'wrong' ? WRONG_PASSWORD : undefined} />
          <Button variant="secondary" size="sm" busy={opening} disabled={password === ''} onClick={open}>
            {locked === 'wrong' ? ACTS.retry.label : '열기'}
          </Button>
        </Stack>
      }
    />
  );
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
            같은 이름의 캐릭터가 있어요. 어떻게 가져올까요?
            <Hint label="이미지만 넣기">Risu에서 가져온 캐릭터의 채팅과 설정은 그대로 두고 이 카드의 이미지만 넣어요.</Hint>
          </Text>
          <ChoiceGroup label="가져올 방법" layout="list" options={[{ value: 'new', label: '새 캐릭터로 추가' }, { value: 'fill', label: '기존 캐릭터에 이미지만 넣기' }]} value={choice.on ? 'fill' : 'new'} onChange={(value) => onChange({ ...choice, on: value === 'fill' })} />
        </Stack>
      );
    case 'replace':
      return (
        <Stack gap="related">
          <Text>
            {`이전 버전 ${quoted(choice.olds)} 모듈이 있어요. 어떻게 할까요?`}
            <Hint label="새 버전으로 바꾸기">{`새 버전으로 바꾸면 이전 버전이 켜져 있던 곳에 그대로 적용하고, 이전 버전은 ${BIN}으로 이동해요.`}</Hint>
          </Text>
          <ChoiceGroup label="이전 버전" layout="list" options={[{ value: 'replace', label: '새 버전으로 바꾸기' }, { value: 'keep', label: '둘 다 유지' }]} value={choice.on ? 'replace' : 'keep'} onChange={(value) => onChange({ ...choice, on: value === 'replace' })} />
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
