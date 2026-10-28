import { useState, useSyncExternalStore } from 'react';
import type { HookLog } from '../../engine/lua/run';
import type { PackOwner } from '../../model/library';
import { HookDetail } from '../common/HookDetail';
import { ago } from '../common/time';
import { useSession } from '../session';
import { Empty, List, ListItem, Section, Stack, Text } from '../ui';

export const STAGES: Record<string, string> = { load: '처음 실행', onInput: '입력', editInput: '입력 편집', onStart: '시작', editRequest: '요청 편집', editOutput: '응답 편집', onOutput: '응답', editDisplay: '화면 편집', button: '버튼',
  reply: '응답 저장', replying: '응답 편집', sending: '입력 편집', requesting: '요청 편집', showing: '화면 편집', prompt: '프롬프트', change: '메시지 변경', branch: '분기', menu: '메뉴', action: '메시지 도구', call: '도구 호출',
};

export function Scripts({ chat }: { chat: string }) {
  const { scriptJournal } = useSession();
  const log = useSyncExternalStore(
    (listener) => scriptJournal.subscribeLog(chat, listener),
    () => scriptJournal.log(chat),
  );
  const entries = log.entries.map((entry, index) => ({ entry, key: `${entry.at}:${log.omitted + index}` })).reverse();
  return (
    <Section title="실행 기록" help="새로고침하면 사라져요.">
      {entries.length === 0 ? (
        <Empty variant="section">실행된 스크립트가 없어요.</Empty>
      ) : (
        <Stack gap="related">
          <HookList label="실행 기록" entries={entries} note={(entry) => `${ago(entry.at)} · ${Math.round(entry.duration)}ms`} />
          {log.omitted > 0 && <Text variant="note">{`오래된 기록 ${log.omitted}개는 빠졌어요.`}</Text>}
        </Stack>
      )}
    </Section>
  );
}

export function HookList({ label, entries, note }: { label: string; entries: { entry: HookLog; key: string }[]; note: (entry: HookLog) => string }) {
  const { store } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const packName = (pack: PackOwner | null) => (pack === null ? null : pack.kind === 'module' ? store.get('module', pack.id)?.value.name : store.get('character', pack.id)?.value.card.name) ?? null;
  return (
    <List label={label}>
      {entries.map(({ entry, key }) => (
        <ListItem
          key={key}
          title={`${STAGES[entry.stage] ?? entry.stage} · ${entry.script || packName(entry.pack) || 'Lua'}`}
          badge={entry.errors.length ? '오류' : undefined}
          tags={hookTags(entry)}
          note={note(entry)}
          expanded={open === key}
          onClick={() => setOpen(open === key ? null : key)}
          detail={open === key && <HookDetail entry={entry} />}
        />
      ))}
    </List>
  );
}

function hookTags(entry: HookLog): string[] {
  return [
    ...(entry.stopped ? ['중단됨'] : []),
    ...(entry.changed ? ['변경됨'] : []),
    ...(entry.writes.length ? [`변수 ${entry.writes.length}개`] : []),
    ...(entry.logs.length ? [`log ${entry.logs.length}줄`] : []),
    ...(entry.missing.length ? [`지원 안 함 ${entry.missing.length}개`] : []),
  ];
}
