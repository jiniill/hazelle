import { useMemo, useState, useSyncExternalStore } from 'react';
import type { CallPurpose, LogEntry } from '../../runtime/request-log';
import { describeReplyError } from '../common/failure';
import { cacheShare, finish, seconds, tokens } from '../common/receipt';
import { ago } from '../common/time';
import { FEATURE_NAMES, ROLE_TAGS, SCRIPTS, STAGE_NAMES, TOOL, UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { Button, Callout, Empty, List, ListItem, Section, Stack, Text } from '../ui';
import { SentRequest, SentResponse } from './ChatSent';

const PAGE = 20;

const PURPOSES: Record<CallPurpose, string> = {
  reply: '응답',
  translation: FEATURE_NAMES.translate,
  input: '입력 번역',
  note: '번역가의 노트',
  memory: FEATURE_NAMES.memory,
  script: `${SCRIPTS.part}·${TOOL}`,
  illustration: FEATURE_NAMES.illustrate,
  likeness: '삽화 프로필',
  mascot: FEATURE_NAMES.mascot,
  preread: FEATURE_NAMES.preread,
  agent: FEATURE_NAMES.agents,
  embedding: ROLE_TAGS.embed,
};

export function Log({ chat }: { chat: string }) {
  const { log } = useSession();
  const held = useSyncExternalStore(log.subscribe, () => log.of(chat));
  // Recorded as each call ends; read by when each began.
  const entries = useMemo(() => held.entries.map((entry, index) => ({ entry, key: held.omitted + index })).sort((a, b) => b.entry.at - a.entry.at), [held]);
  const [more, setMore] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const picked = held.entries.filter((entry) => entry.picked).length;
  return (
    <Section title="요청 기록" help="이 화면에서 이 채팅을 위해 보낸 모델 요청이에요. 새로고침하면 사라져요.">
      {entries.length ? (
        <Stack gap="related">
          <List label="요청 기록">
            {entries.slice(0, more).map(({ entry, key }) => (
              <Row key={key} entry={entry} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />
            ))}
          </List>
          {entries.length > more && (
            <Button variant="secondary" size="sm" onClick={() => setMore(more + PAGE)}>
              더 보기
            </Button>
          )}
          {picked > 0 && <Text variant="note">{`${picked}개는 새로고침 전에 보낸 요청이라 원문을 알 수 없어요.`}</Text>}
          {held.omitted > 0 && <Text variant="note">{`오래된 기록 ${held.omitted}개는 빠졌어요.`}</Text>}
        </Stack>
      ) : (
        <Empty variant="section">보낸 요청이 없어요.</Empty>
      )}
    </Section>
  );
}

function Row({ entry, open, onToggle }: { entry: LogEntry; open: boolean; onToggle: () => void }) {
  const { receipt } = entry;
  const usage = receipt.usage;
  const input = usage?.inputTokens ?? null;
  const read = usage?.cachedInputTokens ?? null;
  const written = usage?.cacheWriteInputTokens ?? null;
  const counted = input !== null && read !== null;
  const share = cacheShare(usage);
  const facts = [receipt.modelName, finish(receipt).value, seconds(receipt.totalMs), ...(entry.purpose === 'embedding' ? [] : [`첫 토큰 ${seconds(receipt.firstTextMs)}`])];
  const used = !usage ? [`사용량 ${UNKNOWN}`] : counted ? [`읽음 ${tokens(read)}`, `저장 ${tokens(written)}`, `그 외 ${tokens(input - read - (written ?? 0))}`, `출력 ${tokens(usage.outputTokens)}`] : [`입력 ${tokens(input)}`, `출력 ${tokens(usage.outputTokens)}`];
  return (
    <ListItem
      title={entry.agent ? `${entry.agent.name} · ${STAGE_NAMES[entry.agent.stage]} ${PURPOSES.agent}` : PURPOSES[entry.purpose]}
      badge={share === null ? undefined : `${share}% 읽음`}
      description={facts.join(' · ')}
      tags={used}
      note={ago(entry.at)}
      expanded={open}
      onClick={onToggle}
      detail={
        open && (
          <Stack gap="related">
            {receipt.state === 'failed' && receipt.error && <Callout tone="warn">{describeReplyError(receipt.error)}</Callout>}
            <SentRequest entry={entry} receipt={receipt} />
            <Section level={3} title="응답 원문">
              <SentResponse entry={entry} />
            </Section>
          </Stack>
        )
      }
    />
  );
}
