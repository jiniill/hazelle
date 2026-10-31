import { isChapter } from '../../engine/memory';
import type { Chapter, Memory, MemoryRecord } from '../../model/memory';
import type { MemoryView } from '../../runtime/memory-view';
import { editRecord, forgetRecord, pinRecord, recallRecord, restoreRecord, type RecordPatch } from '../../runtime/memory';
import { EntryList } from '../common/EntryList';
import { ago } from '../common/time';
import { useAutosave } from '../common/useAutosave';
import { CHAPTER } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, List, ListItem, PhraseField, Row, Section, SettingGroup, SettingRow, SidePanel, Stack, Switch, Text, TextField, useWide } from '../ui';
import { recordScene, recordTitle, spanOf, statusWord } from './memory';
import type { ChatActions } from './useChat';

const STALE = { changed: '대화 원문이 바뀌었어요.', rendered: '원문이 정리할 때와 달라요.', deleted: '원문 메시지가 삭제됐어요.', records: '기록이 바뀌었어요.' };

type Props = {
  chat: string;
  item: MemoryRecord | Chapter;
  memory: Memory;
  // null while the panel's view is being worked out.
  view: MemoryView | null;
  positions: ReadonlyMap<string, number>;
  actions: ChatActions;
};

export function ChatMemoryRecord({ chat, item, memory, view, positions, actions }: Props) {
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const wide = useWide();
  const save = useAutosave<RecordPatch>(`record:${chat}:${item.id}`, (patch) => editRecord(store, chat, item.id, patch));
  const shown = { ...item, ...save.unsaved };
  const span = spanOf(item.sources, positions);
  const chapter = isChapter(item) ? item : null;
  const record = isChapter(item) ? null : item;
  const noun = chapter ? CHAPTER : '기록';
  const status = view?.records.get(item.id) ?? null;
  // A record the user edited or pinned is still sent while stale.
  const stale = view?.stale.get(item.id) ?? null;
  const holder = chapter ? undefined : memory.chapters.find(({ records }) => records.some(({ id }) => id === item.id));
  const back = () => actions.memory(holder?.id ?? null);

  // A narrow panel covers the story, so it steps aside for the messages it points at.
  function find() {
    actions.find(span.there);
    if (!wide) actions.closePanel();
  }

  function rebuild() {
    session.memory.rebuild(chat, item.id);
    toast.show(`${noun} 다시 만드는 중…`);
  }

  function pin(on: boolean) {
    void pinRecord(store, chat, item.id, on).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));
  }

  function recall(on: boolean) {
    void recallRecord(store, chat, item.id, on).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));
  }

  async function forget() {
    const done = await save.remove(() => forgetRecord(store, chat, item.id));
    if (!done) return;
    if (!done.ok) return toast.failed(done, '삭제하지 못했어요.');
    back();
    toast.undoable(`${noun}${chapter ? '를' : '을'} 삭제했어요.`, () => restoreRecord(store, chat, done.data));
  }

  const text = (field: 'when' | 'where', label: string) => (
    <TextField label={label} value={shown[field] ?? ''} placeholder="이야기에 나오지 않음" onChange={(value) => save.change({ [field]: value === '' ? null : value })} />
  );
  const kept = chapter ? `이 ${CHAPTER}는 계속 보내요.` : '이 기록은 계속 보내요.';
  const dropped = chapter ? `이 ${CHAPTER} 대신 기록을 보내요.` : '이 기록은 보내지 않아요.';

  return (
    <SidePanel
      title="장기 기억"
      nav={{ title: noun, subtitle: span.words, backLabel: holder ? CHAPTER : '장기 기억', onBack: back, status: save.words }}
      page={item.id}
      onClose={actions.closePanel}
    >
      {stale && !item.forgotten && (
        <Callout tone="warn" action={stale === 'deleted' ? undefined : { label: '원문에서 다시 만들기', onClick: rebuild }}>
          {[STALE[stale], status === 'stale' ? dropped : status === 'sent' || status === 'recall-over' ? kept : ''].join(' ').trim()}
        </Callout>
      )}
      {status === 'over' && <Text variant="note">한도를 초과해서 보내지 않아요.</Text>}
      {status === 'chaptered' && <Text variant="note">{`이 기록 대신 ${CHAPTER}를 보내요.`}</Text>}
      {holder && view?.records.get(holder.id) === 'sent' && (status === 'sent' || status === 'recall-over') && <Text variant="note">{`${CHAPTER}와 함께 보내요.`}</Text>}
      {item.forgotten && (
        <Callout tone="warn" action={{ label: '원문에서 다시 만들기', onClick: rebuild }}>
          {`삭제한 ${noun}${chapter ? '예요' : '이에요'}.`}
        </Callout>
      )}
      <Row kind="actions">
        <Button variant="secondary" size="sm" disabled={span.there.length === 0} onClick={find}>
          원문 보기
        </Button>
        {!item.forgotten && (
          <Button variant="secondary" size="sm" onClick={rebuild}>
            원문에서 다시 만들기
          </Button>
        )}
      </Row>
      <TextField label="내용" lines={5} value={shown.what} onChange={(what) => save.change({ what })} />
      {text('when', '시점')}
      {text('where', '장소')}
      <SettingGroup label={noun}>
        <SettingRow label="인물" wide control={<PhraseField label="인물" phrases={shown.who} onChange={(who) => save.change({ who })} />} />
        <SettingRow label="고정" help="원문이 바뀌어도 다른 기록보다 먼저 보내요." control={<Switch label="고정" checked={item.pinned === true} onChange={pin} />} />
        {record && (
          <SettingRow
            label="원문 메시지 보내기"
            help="요약본 대신 원문 메시지를 보내요."
            note={status === 'recall-over' ? '원문이 한도를 초과해서 요약본을 보내요.' : undefined}
            control={<Switch label="원문 메시지 보내기" checked={record.recalled === true} onChange={recall} />}
          />
        )}
      </SettingGroup>
      <Section level={3} title="대사" note={`${shown.lines.length}개`}>
        <Stack gap="related">
          <EntryList
            entries={shown.lines}
            onChange={(lines) => save.change({ lines })}
            name={(index) => `대사 ${index + 1}`}
            blank={{ speaker: '', text: '' }}
            addLabel="대사 추가"
            removed={(index) => `${index + 1}번째 대사를 삭제했어요.`}
          >
            {({ value, name, set, remove }) => (
              <Stack gap="related">
                <TextField label={`${name} · 화자`} value={value.speaker} onChange={(speaker) => set({ ...value, speaker })} action={remove} />
                <TextField label={name} lines={2} value={value.text} onChange={(said) => set({ ...value, text: said })} />
              </Stack>
            )}
          </EntryList>
        </Stack>
      </Section>
      <TextField label="결과" lines={3} value={shown.outcome} onChange={(outcome) => save.change({ outcome })} />
      {chapter && (
        <Section level={3} title="기록" note={`${chapter.records.length}개`}>
          <List label="기록">
            {chapter.records.flatMap(({ id }) => memory.records.find((record) => record.id === id) ?? []).map((record) => (
              <MemoryRow key={record.id} item={record} view={view} positions={positions} onOpen={() => actions.memory(record.id)} />
            ))}
          </List>
        </Section>
      )}
      <Text variant="note">{item.receipt ? `${item.receipt.modelName} · ${ago(item.at)} 정리` : `직접 쓴 기록 · ${ago(item.at)}`}</Text>
      {!item.forgotten && (
        <Row kind="actions">
          <Button variant="danger" size="sm" onClick={() => void forget()}>
            {`이 ${noun} 삭제`}
          </Button>
        </Row>
      )}
    </SidePanel>
  );
}

export function MemoryRow({ item, view, positions, onOpen }: { item: MemoryRecord | Chapter; view: MemoryView | null; positions: ReadonlyMap<string, number>; onOpen: () => void }) {
  const status = view?.records.get(item.id);
  const chapter = isChapter(item);
  return (
    <ListItem
      title={recordTitle(item)}
      description={[spanOf(item.sources, positions).words, ...(chapter ? [`기록 ${item.records.length}개`] : []), recordScene(item)].filter(Boolean).join(' · ')}
      tags={[...(chapter ? [CHAPTER] : []), ...(item.pinned ? ['고정'] : []), ...(!chapter && item.recalled && status === 'sent' ? ['원문 전송'] : []), ...statusWord(status, view?.stale.get(item.id))]}
      onClick={onOpen}
    />
  );
}
