import { useToast } from '../toast';
import { Check, LockKeyhole, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { characterTexts } from '../../model/library';
import { allWritten } from '../../runtime/api';
import { markImportNoticed } from '../../runtime/chat/chat-context';
import type { UnpackFailure } from '../../engine/import/archive';
import type { ImportFailure } from '../../engine/import/types';
import { PACKED_EXTENSION } from '../../engine/import/extensions';
import { ImportWorker } from '../../runtime/import/client';
import type { BotLink } from '../../runtime/import/link';
import { ImportReadError, ImportStuck } from '../../runtime/import/protocol';
import { placeOn, type ImportPage } from '../../runtime/import/save';
import type { ModulePlace } from '../../runtime/library/modules';
import { aliased } from '../common/alias';
import { describeImportFailure } from '../common/importFailure';
import { ACTS } from '../common/acts';
import { IMPORT_ACCEPT, ImportContext } from '../common/importing';
import { PRESET_EXTENSIONS } from '../../engine/import/preset';
import { useSearch } from '../common/useSearch';
import { BIN, MISSED, NO_CHARACTER, THINGS, TOOL, UNREADABLE_FILE, WRONG_PASSWORD } from '../common/words';
import { useFiles, useLibrary, useSettings, useStore } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Route } from '../shell/routes';
import { Avatar, Button, Callout, Checkbox, ChipButton, ChoiceGroup, ConfirmDialog, Dialog, DropOverlay, Empty, Hint, List, ListItem, Menu, MenuItem, Outcome, pickFiles, Progress, Stack, Text, TextField, useFileDrop, type ProgressStep } from '../ui';
import { quoted, type ImportKind, type Line, type Preview } from './importOutcome';
import { failed, IMPORTERS, readingOf, type Choice, type Offer, type Parsed, type Result, type Target } from './importers';
import { bringLink, LinkDialog, type LinkStart } from './LinkImport';
import { MoveDialog } from './MoveDialog';
import { MoveFlow } from './MoveFlow';
import { stepOf } from './saving';

// The preview's own 못 가져온 것: nothing is saved yet.
const WONT_COME = '가져올 수 없는 항목';
// password: the one an rcc card opened with, which saving reads it with again.
type Read = { file: File; password: string | undefined; preview: Preview; choice: Choice | null; ticked: boolean };
// An rcc card waiting for its password, wrong once one was tried.
type Locked = { file: File; locked: 'asked' | 'wrong' };
type Row = { file: File; failure: string } | Locked | Read;
type State =
  | { kind: 'downloading'; step: ProgressStep }
  | { kind: 'reading'; file: string }
  | { kind: 'preview'; rows: Row[]; place: ModulePlace | null }
  | { kind: 'saving'; file: string; steps: ProgressStep[] }
  | { kind: 'done'; results: Result[] };

const LINK = '링크';
const UNPACK_FAILURE: Record<UnpackFailure, string> = {
  encrypted: '비밀번호가 걸려 있어요. 압축을 풀고 안의 파일을 가져와 주세요.',
  'too-large': '압축을 풀면 용량이 너무 커요. 직접 풀고 안의 파일을 가져와 주세요.',
  unreadable: '압축 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요.',
};
const SKIPPED_SHOWN = 3;
const skippedLine = (names: string[]) =>
  `가져오지 않은 파일 ${names.length}개: ${names.slice(0, SKIPPED_SHOWN).join(', ')}${names.length > SKIPPED_SHOWN ? ' 등' : ''}`;

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

  async function previewOf(file: File, place: ModulePlace | null, target: Target, password?: string): Promise<Row> {
    const refused = (failure: ImportFailure): Row | string =>
      failure.kind === 'needs-password' || failure.kind === 'wrong-password' ? { file, locked: failure.kind === 'needs-password' ? 'asked' : 'wrong' } : describeImportFailure(failure);
    const row = await reading(file, password, place, async (parsed): Promise<Row> => {
      const read = readingOf(parsed).preview({ store, file: file.name, target, place });
      return typeof read === 'string' ? { file, failure: read } : { file, password, ...read, ticked: true };
    }, refused);
    return typeof row === 'string' ? { file, failure: row } : row;
  }

  // The row read again with its password, in place, while the preview stays open.
  async function unlock(row: Locked, password: string, place: ModulePlace | null) {
    const read = await previewOf(row.file, place, undefined, password);
    if (mounted.current) setState((now) => (now?.kind === 'preview' ? { ...now, rows: now.rows.map((each) => (each === row ? read : each)) } : now));
  }

  async function save({ file, password, preview: { title }, choice }: Read, place: ModulePlace | null, progress: (step: ProgressStep) => void, offer: (offer: Offer) => void): Promise<Result> {
    const saved = await reading(file, password, place, (parsed, reader) =>
      readingOf(parsed).save({ sink: { store, files }, file: file.name, title, choice, place, original: () => reader.original(file.name), step: (each) => progress(stepOf(each)), offer }),
    );
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

  async function fromLink(link: BotLink, text: string) {
    setLinking(null);
    const line = new AbortController();
    download.current = line;
    const brought = await bringLink(link, text, line.signal, (step) => setState({ kind: 'downloading', step }));
    download.current = null;
    if (!mounted.current) return;
    switch (brought.kind) {
      case 'files':
        return void take(brought.files, undefined, true, brought.skipped.length > 0 ? [{ file: new File([], LINK), failure: skippedLine(brought.skipped) }] : []);
      case 'cancelled':
        return setState(null);
      case 'locked':
        setState(null);
        return setLinking(brought.start);
      case 'failed':
        return setState({ kind: 'done', results: [failed(LINK, brought.failure)] });
    }
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
  const idsOf = (kind: ImportKind) => results.flatMap((result) => (result.kind === kind ? [result.id] : []));
  const done = idsOf('character');
  const go = (to: Route) => {
    setState(null);
    navigate(to);
  };
  const opens = [
    ...(Object.keys(IMPORTERS) as ImportKind[]).flatMap((kind) => {
      const importer = IMPORTERS[kind];
      const ids = idsOf(kind);
      return importer.opens !== null && ids.length === 1 && ids[0] !== null ? [
        <Button key={kind} variant={done.length === 1 ? 'secondary' : 'primary'} icon={importer.icon} onClick={() => go(importer.opens.route(ids[0]!))}>
          {importer.opens.label}
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
      {linking && <LinkDialog start={linking} onBring={(link, text) => void fromLink(link, text)} onClose={() => setLinking(null)} />}
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

// Under the row: its warnings and lines first, then what asks a choice, then what does not come in.
function ImportRow({ kind, title, holds, lines, missed, missedTitle, note, control, choice }: { kind: ImportKind; title: string; holds?: string; lines: Line[]; missed: string[]; missedTitle: string; note?: string | null; control?: ReactNode; choice?: ReactNode }) {
  const word = kind === 'plugin' ? TOOL : THINGS[kind].noun;
  // A persona is drawn as the user, by its name.
  const persona = kind === 'persona';
  const detail = (lines.length > 0 || choice || missed.length > 0 || note) && (
    <Stack gap="related">
      {lines.map((line, index) => line.failed ? <Callout key={index} tone="warn">{line.text}{line.help && <Hint label={line.help.label}>{line.help.text}</Hint>}</Callout> : <Text key={index} variant="note">{line.text}</Text>)}
      {choice}
      {missed.length > 0 && <Outcome title={missedTitle} items={missed.map((title) => ({ title }))} />}
      {note && <Text variant="note">{note}</Text>}
    </Stack>
  );
  return <ListItem leading={<Avatar face={persona ? title : (IMPORTERS[kind].icon ?? title)} tone={persona ? 'you' : 'plain'} />} title={title} description={[word, holds].filter(Boolean).join(' · ')} control={control} detail={detail || undefined} />;
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
