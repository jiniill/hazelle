import { entryName } from '../../connectors/types';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import type { Chat, ChatItem } from '../../model/chat';
import { emptyMemory, type Fact, type MemorySettings, type Thread } from '../../model/memory';
import { embedModel } from '../../runtime/assignment';
import { memoryOwner, memorySetup } from '../../runtime/memory-read';
import { memoryView, type MemoryView } from '../../runtime/memory-view';
import { memoryWriter, removeFact, removeThread, setChatMemory, setFact, setThread } from '../../runtime/memory';
import { memoryPrompt } from '../../runtime/prompts';
import { ACTS, addOf } from '../common/acts';
import { describeMemoryFailure } from '../common/failure';
import { MemoryFields, MemorySplit, settingsOf } from '../common/MemoryFields';
import { tokens } from '../common/receipt';
import { TaskModelRow, type PromptDoor } from '../common/TaskPrompt';
import { filled, typedText } from '../common/typed';
import { useAutosave } from '../common/useAutosave';
import { CHAPTER, follows, inFeature, inSettings, MODEL_ROLES, opens, resetTo, SCOPE, scopeTag } from '../common/words';
import { useChatMemory, usePrompts, useRemembering, useSession, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { navigate } from '../shell/router';
import { Button, Callout, ConfirmDialog, Empty, IconButton, List, MenuItem, MoreMenu, Progress, Row, Section, SidePanel, Stack, Text, TextField } from '../ui';
import { MemoryRow, type ChatMemoryRecord } from './ChatMemoryRecord';
import { factGroups, memoryRows, MessagePositions } from './memory';
import type { OpenChat } from './useChat';

const NO_MEMORY = emptyMemory();

// While a reply streams the last answer stands, since every chunk changes the messages.
function useView(id: string, busy: boolean, inputs: unknown[]): MemoryView | null {
  const session = useSession();
  const [view, setView] = useState<MemoryView | null>(null);
  useEffect(() => {
    if (busy) return;
    let live = true;
    void memoryView(session, id).then(
      (view) => live && setView(view),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [id, busy, ...inputs]);
  return view;
}

// 장기 기억 (design §6.2). Without memoryView's answer nothing is said about what is sent: no status, no tokens, no missing
// slot.
type Props = Pick<OpenChat, 'messages' | 'busy'> & {
  item: ChatItem;
  record: string | null;
  onClose: () => void;
  onTool: (id: string) => void;
  onEditPrompt: (() => void) | undefined;
  onEditTaskPrompt: (door: PromptDoor) => void;
  onRecord: (id: string | null) => void;
  renderRecord: (record: Omit<ComponentProps<typeof ChatMemoryRecord>, 'actions'>) => ReactNode;
};

export function ChatMemory({ record, item, messages, busy, onClose, onTool, onEditPrompt, onEditTaskPrompt, onRecord, renderRecord }: Props) {
  const { id, chat: own } = item;
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const memory = useChatMemory(id) ?? NO_MEMORY;
  const settings = useSettings();
  const prompts = usePrompts();
  const { running, failed, chapterFailed, indexing, indexFailed } = useRemembering();
  const [messagePositions] = useState(() => new MessagePositions());
  const positions = messagePositions.read(messages);
  const setup = memorySetup(store, own);
  // A tool holding the slot leaves these records as they are, readable, until the slot is theirs again (design §6.10).
  const owner = memoryOwner(store, own);
  const holder = owner?.kind === 'tool' ? owner.unit : null;
  const view = useView(id, busy, [memory, own, messages, settings, prompts]);
  const [rebuilding, setRebuilding] = useState(false);
  const [resets, setResets] = useState(0);
  const save = useAutosave<MemorySettings>(`chat-memory:${id}`, (patch) => {
    const current = store.get('chat', id);
    if (!current) return Promise.resolve({ ok: false, error: 'gone' } as const);
    return setChatMemory(store, id, { ...settingsOf(memorySetup(store, current.value)), ...patch });
  });

  const opened = record === null ? undefined : [...memory.records, ...memory.chapters].find((each) => each.id === record);
  if (opened) return renderRecord({ chat: id, item: opened, memory, view, positions });

  async function revert() {
    if (!(await save.flush())) return;
    void setChatMemory(store, id, null).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.'));
    setResets((count) => count + 1);
  }

  const writing = running.get(id);
  const failure = failed.get(id);
  const unchaptered = chapterFailed.get(id);
  const embedding = indexing.get(id);
  const unindexed = indexFailed.get(id);
  const embeds = !('kind' in embedModel(store));
  const rows = memoryRows(memory);
  const retry = { label: ACTS.retry.label, onClick: () => session.memory.retry(id) };
  const more = (
    <MoreMenu of="장기 기억">
      <MenuItem label="원문에서 전부 다시 만들기" onClick={() => setRebuilding(true)} />
    </MoreMenu>
  );

  return (
    <SidePanel title="장기 기억" actions={holder ? undefined : more} onClose={onClose}>
      {holder && (
        <Row kind="spread">
          <Text>{`${holder.tool.manifest.displayName} 플러그인이 장기 기억을 관리하고 있어요.`}</Text>
          {holder.tool.manifest.page && <Button variant="secondary" size="sm" onClick={() => onTool(holder.module)}>플러그인 열기</Button>}
        </Row>
      )}
      {writing ? (
        <Text variant="note">{`기억 정리 중 · ${writing.model} · 남은 호출 ${writing.left}개`}</Text>
      ) : (
        failure && (
          <Callout tone="warn" action={retry}>
            {`기억을 정리하지 못했어요. ${describeMemoryFailure(failure)}`}
          </Callout>
        )
      )}
      {!writing && unchaptered && (
        <Callout tone="warn" action={retry}>
          {`${CHAPTER}를 만들지 못했어요. ${describeMemoryFailure(unchaptered)}`}
        </Callout>
      )}
      {embedding !== undefined && <Progress steps={[{ label: '검색 준비 중', ...embedding }]} />}
      {embedding === undefined && unindexed && (
        <Callout tone="warn" action={retry}>
          {`검색할 기록을 준비하지 못했어요. ${describeMemoryFailure(unindexed)}`}
        </Callout>
      )}
      {owner?.kind === 'built-in' && !embeds && (
        <Row kind="spread">
          <Text variant="note">{`${MODEL_ROLES.embed}을 선택하면 지금 대화와 관련된 지난 기록을 찾아 넣어요.`}</Text>
          <Button variant="link" size="sm" onClick={() => navigate({ kind: 'models' })}>
            {opens(inSettings('models'))}
          </Button>
        </Row>
      )}
      {!owner && <Text variant="note">이 채팅은 장기 기억을 쓰지 않아요.</Text>}
      {owner && view && !view.slot && (
        <Callout tone="warn" action={onEditPrompt ? { label: '프롬프트 열기', onClick: onEditPrompt } : undefined}>
          프롬프트에 장기 기억 블록이 없어서 기억을 보내지 않아요.
        </Callout>
      )}
      {view && owner?.kind === 'built-in' && <MemoryFill view={view} />}
      {owner?.kind === 'built-in' && <WriterRow chat={own} onEditPrompt={onEditTaskPrompt} />}

      {(!holder || memory.state.length > 0) && <Section
        level={3}
        title="상태"
        note={view && !holder ? `약 ${tokens(view.tokens.state)} / ${tokens(view.tokens.stateLimit)} 토큰` : undefined}
        help="관계, 호칭, 소지품, 부상, 위치 같은 현재 상태예요."
      >
        {view && !holder && view.tokens.state > view.tokens.stateLimit && <Callout tone="warn">상태가 한도를 넘었어요. 필요 없는 상태를 삭제하거나 내용을 줄여 주세요.</Callout>}
        {factGroups(memory.state).flatMap(({ facts }) => facts.map((fact) => <FactRow key={`${fact.about}\n${fact.field}`} chat={id} fact={fact} />))}
        {memory.state.length === 0 && <Empty variant="section">기록된 상태가 없어요.</Empty>}
        {!holder && <NewFact chat={id} />}
      </Section>}

      {(!holder || memory.threads.length > 0) && <Threads chat={id} threads={memory.threads} adding={!holder} />}

      {(!holder || memory.records.length > 0) && <Section level={3} title="기록" note={`${rows.filter((each) => !each.forgotten).length}개`}>
        {view?.crowded && <Callout tone="warn">고정한 기록이 한도를 다 채워서 나머지 기록은 보내지 않아요.</Callout>}
        {memory.records.length ? (
          <List label="기록">
            {rows.map((each) => (
              <MemoryRow key={each.id} item={each} view={view} positions={positions} onOpen={() => onRecord(each.id)} />
            ))}
          </List>
        ) : (
          <Empty variant="section">아직 기록이 없어요.</Empty>
        )}
      </Section>}

      {!holder && <Section
        level={3}
        title="설정"
        tag={scopeTag(setup.own ? 'chat' : 'default')}
        help={{ text: '여기서 바꾸면 지금 이 채팅에만 적용돼요.', open: { label: opens(inFeature('memory')), onClick: () => navigate({ kind: 'feature', feature: 'memory' }) } }}
        action={
          setup.own && (
            <Button variant="link" onClick={() => void revert()}>
              {resetTo(SCOPE.default)}
            </Button>
          )
        }
      >
        <MemoryFields key={resets} value={{ ...settingsOf(setup), ...save.unsaved }} onChange={save.change} />
      </Section>}

      {rebuilding && (
        <ConfirmDialog
          title="대화 원문으로 기억을 전부 다시 만들까요?"
          confirm="다시 만들기"
          icon={ACTS.regenerate.icon}
          onConfirm={() => {
            session.memory.rebuild(id, null);
            setRebuilding(false);
          }}
          onClose={() => setRebuilding(false)}
        >
          대화가 길면 요금이 많이 나올 수 있고, 되돌릴 수 없어요.
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}

// Without a 장기 기억 slot no summary runs on its own (runtime/memory), so none is told as next. found is left out: what an
// embedding model adds is known only once a request is made.
function MemoryFill({ view }: { view: MemoryView }) {
  const { used, budget, waiting, recent } = view.tokens;
  const { batch, window } = view.setup;
  const left = batch - waiting;
  return (
    <Stack gap="related">
      <MemorySplit
        whole={Math.max(budget + batch + window, used + waiting + recent)}
        records={{ tokens: used, value: `약 ${tokens(used)} / ${tokens(budget)} 토큰` }}
        waiting={{ tokens: waiting, value: `약 ${tokens(waiting)} / ${tokens(batch)} 토큰` }}
        recent={{ tokens: recent, value: `약 ${tokens(recent)} 토큰` }}
      />
      {view.slot && <Text variant="note">{left > 0 ? `다음 정리까지 약 ${tokens(left)} 토큰` : '기억을 정리할 만큼 대화가 충분히 쌓였어요.'}</Text>}
    </Stack>
  );
}

function WriterRow({ chat, onEditPrompt }: { chat: Chat; onEditPrompt: (door: PromptDoor) => void }) {
  const store = useStore();
  const writer = memoryWriter(store, chat);
  const prompt = memoryPrompt(store);
  return (
    <TaskModelRow
      label="기억 모델"
      noun="기억"
      choice={prompt}
      sub={prompt.kind === 'prompt' && !prompt.prompt.value.model ? follows(MODEL_ROLES.aux) : undefined}
      model={'kind' in writer ? describeMemoryFailure(writer) : entryName(writer.route.model)}
      onEdit={onEditPrompt}
    />
  );
}

// Whom a fact concerns and which field stay, so a rename is a delete and an add.
function FactRow({ chat, fact }: { chat: string; fact: Fact }) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Pick<Fact, 'value'>>(`fact:${chat}:${fact.about}\n${fact.field}`, (patch) => setFact(store, chat, { ...fact, ...patch, record: null }, fact));
  const [typed, setTyped] = useState<string>();
  const value = typedText(typed, filled, save.unsaved.value ?? fact.value, String);
  const name = `${fact.about} · ${fact.field}`;

  function type(next: string) {
    setTyped(next);
    save.change({ value: next }, next.trim() !== '');
  }

  async function remove() {
    const removed = await save.remove(() => removeFact(store, chat, fact));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${name}' 상태를 삭제했어요.`, () => setFact(store, chat, removed.data, null));
  }

  return (
    <TextField
      label={name}
      value={value}
      onChange={type}
      error={value.trim() ? undefined : '값을 입력해 주세요.'}
      action={<IconButton icon={ACTS.remove.icon} label={`${name} ${ACTS.remove.label}`} size="sm" onClick={() => void remove()} />}
    />
  );
}

function NewFact({ chat }: { chat: string }) {
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Omit<Fact, 'record'> | null>(null);
  if (!draft) {
    return (
      <Row kind="actions">
        <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => setDraft({ about: '', field: '', value: '' })}>
          {addOf('상태')}
        </Button>
      </Row>
    );
  }
  const ready = draft.about.trim() !== '' && draft.field.trim() !== '' && draft.value.trim() !== '';
  function add() {
    void setFact(store, chat, { ...draft!, record: null }, null).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));
    setDraft(null);
  }
  return (
    <Stack gap="related">
      <TextField label="대상" placeholder="예: 이름이나 장소" value={draft.about} onChange={(about) => setDraft({ ...draft, about })} />
      <TextField label="항목" placeholder="예: 호칭" value={draft.field} onChange={(field) => setDraft({ ...draft, field })} />
      <TextField label="값" value={draft.value} onChange={(value) => setDraft({ ...draft, value })} />
      <Row kind="actions">
        <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
          취소
        </Button>
        <Button size="sm" disabled={!ready} onClick={add}>
          추가
        </Button>
      </Row>
    </Stack>
  );
}

// A blank new thread is page-only until first saved. Later deletion must not revive that draft.
function Threads({ chat, threads, adding }: { chat: string; threads: Thread[]; adding: boolean }) {
  const [drafts, setDrafts] = useState<Thread[]>([]);
  const unsaved = drafts.filter((draft) => !threads.some(({ id }) => id === draft.id));
  if (unsaved.length !== drafts.length) setDrafts(unsaved);
  const shown = [...threads, ...unsaved];
  return (
    <Section level={3} title="미해결 사건" note={`${threads.length}개`} help="약속이나 복선처럼 아직 끝나지 않은 일이에요.">
      {shown.map((thread, index) => (
        <ThreadRow
          key={thread.id}
          chat={chat}
          thread={thread}
          name={`미해결 사건 ${index + 1}`}
          onDrop={() => setDrafts((current) => current.filter(({ id }) => id !== thread.id))}
        />
      ))}
      {shown.length === 0 && <Empty variant="section">미해결 사건이 없어요.</Empty>}
      {adding && <Row kind="actions">
        <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), text: '', opened: null }])}>
          {addOf('미해결 사건')}
        </Button>
      </Row>}
    </Section>
  );
}

// onDrop: it is a draft no more, deleted before anything of it was saved.
function ThreadRow({ chat, thread, name, onDrop }: { chat: string; thread: Thread; name: string; onDrop: () => void }) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Pick<Thread, 'text'>>(`thread:${chat}:${thread.id}`, (patch) => setThread(store, chat, { ...thread, ...patch }, true));
  const [typed, setTyped] = useState<string>();
  const text = typedText(typed, filled, save.unsaved.text ?? thread.text, String);

  function type(next: string) {
    setTyped(next);
    save.change({ text: next }, next.trim() !== '');
  }

  async function remove() {
    const removed = await save.remove(() => removeThread(store, chat, thread.id));
    if (!removed) return;
    if (!removed.ok) return removed.error === 'gone' ? onDrop() : toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable('미해결 사건을 삭제했어요.', () => setThread(store, chat, removed.data, false));
  }

  return (
    <TextField
      label={name}
      lines={2}
      value={text}
      onChange={type}
      action={<IconButton icon={ACTS.remove.icon} label={`${name} ${ACTS.remove.label}`} size="sm" onClick={() => void remove()} />}
    />
  );
}
