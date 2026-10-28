import { useEffect, useState } from 'react';
import { tokenGroups, type From, type TokenSource } from '../../engine/pipeline';
import type { Rehearsal } from '../../runtime/script-preview';
import { afterEnter, previewRequest, type AfterEnter, type Sending } from '../../runtime/turn-context';
import { describeTurnFailure, runaway } from '../common/failure';
import { MESSAGE_ROLES, SLOT } from '../common/prompt-words';
import { tokens } from '../common/receipt';
import { PRE_READ } from '../common/words';
import { useSession } from '../session';
import { Callout, CodeBlock, Disclosure, Empty, Facts, Gauge, List, ListItem, Section, Stack, Text } from '../ui';
import { partName, RequestView } from './ChatSent';
import { HookList, STAGES } from './InspectScripts';
import type { Side } from './panels';
import type { SendNotes } from './useSendNotes';

function later(steps: AfterEnter[]): string[] {
  return steps.map((step) => {
    switch (step.kind) {
      case 'input-translation':
        return '입력 번역';
      case 'tools':
        return '플러그인 실행';
      case 'retrieval':
        return '기억 검색';
      case 'preread':
        return PRE_READ;
    }
  });
}

// The steps a send runs that a forecast leaves out, as one note; null without any.
export function useSendTimeNote(chat: string, sending: Sending) {
  const missing = later(afterEnter(useSession(), chat, sending.turn));
  return missing.length > 0 ? <Text variant="note">{`메시지를 보낼 때 작동해서 여기에는 반영되지 않아요: ${missing.join(', ')}`}</Text> : null;
}

export function NextRequest({ chat, sending, request, editor, onEdit }: { chat: string; sending: Sending; request: SendNotes['request']; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const lead = useSendTimeNote(chat, sending);
  return (
    <Stack gap="section">
      <Section title="보낼 입력">
        <NextTokens sending={sending} />
      </Section>
      <RequestView
        level={2}
        prompt={sending.prompt}
        title="보낼 순서대로"
        lead={lead}
        request={request}
        unbuilt={UNBUILT}
        editor={editor}
        onEdit={onEdit}
      />
      <Rehearsed chat={chat} sending={sending} editor={editor} onEdit={onEdit} />
    </Stack>
  );
}

const UNBUILT = '이 연결 방식은 요청 본문을 미리 만들어 볼 수 없어요.';

// Mounted only while the 요청 tab shows and no reply is being written (ChatInspect), so a send never waits on one.
function Rehearsed({ chat, sending, editor, onEdit }: { chat: string; sending: Sending; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const { scriptPreview } = useSession();
  const [rehearsal, setRehearsal] = useState<Rehearsal | null | 'failed' | undefined>(undefined);
  useEffect(() => {
    setRehearsal(undefined);
    const controller = new AbortController();
    scriptPreview.rehearse(chat, sending, controller.signal).then(
      (result) => !controller.signal.aborted && setRehearsal(result),
      () => !controller.signal.aborted && setRehearsal('failed'),
    );
    return () => controller.abort();
  }, [chat, sending]);
  if (rehearsal === null) return null;
  return (
    <Section title="스크립트 실행 예상" help="보내기 전에 실행되는 봇 스크립트를 미리 실행해 본 결과예요.">
      {rehearsal === undefined ? (
        <Text variant="note">계산하는 중…</Text>
      ) : rehearsal === 'failed' ? (
        <Empty variant="section">스크립트를 미리 실행하지 못했어요.</Empty>
      ) : (
        <RehearsalView rehearsal={rehearsal} sending={sending} editor={editor} onEdit={onEdit} />
      )}
    </Section>
  );
}

function RehearsalView({ rehearsal, sending, editor, onEdit }: { rehearsal: Rehearsal; sending: Sending; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const { trace, stopped, said, asked, calls, input, prompt, request, changed, loreRanAway } = rehearsal;
  const facts = [
    ...(input === null ? [] : [{ label: '입력이 바뀌어요', value: input }]),
    ...(asked.length ? [{ label: '보낼 때 물어봐요', value: `${asked.length}개` }] : []),
    ...(said.length ? [{ label: '보낼 때 알림을 띄워요', value: `${said.length}개` }] : []),
    ...(calls.model ? [{ label: '보낼 때 모델을 호출해요', value: `${calls.model}번` }] : []),
    ...(calls.embed ? [{ label: '보낼 때 임베딩을 만들어요', value: `${calls.embed}번` }] : []),
    ...(calls.background ? [{ label: '보낼 때 배경을 바꿔요', value: `${calls.background}번` }] : []),
  ];
  return (
    <Stack gap="related">
      {facts.length > 0 && <Facts items={facts} variant="tiles" />}
      {loreRanAway && <Callout tone="warn">{runaway('로어북을 스크립트에 넘기기 전에')}</Callout>}
      {stopped !== null ? (
        <Text variant="note">{`${STAGES[stopped]} 단계에서 멈춰서 요청을 보내지 않아요.`}</Text>
      ) : !changed ? (
        <Text variant="note">스크립트가 요청을 바꾸지 않아요.</Text>
      ) : null}
      {trace.entries.length > 0 && <HookList label="스크립트 실행 예상" entries={trace.entries.map((entry, index) => ({ entry, key: String(index) }))} note={(entry) => `${Math.round(entry.duration)}ms`} />}
      {trace.omitted > 0 && <Text variant="note">{`앞선 기록 ${trace.omitted}개는 빠졌어요.`}</Text>}
      {prompt !== null && ('kind' in prompt ? <Callout tone="warn">{describeTurnFailure(prompt)}</Callout> : <RequestView prompt={prompt} title="스크립트 실행 후" request={() => previewRequest({ ...sending, prompt })} unbuilt={UNBUILT} editor={editor} onEdit={onEdit} sameAs={sending.prompt.problems} />)}
      {request !== null && (
        <Section level={3} title="요청 편집 후">
          <Stack gap="related">
            {request.map((message, index) => (
              <Disclosure key={index} label={MESSAGE_ROLES[message.role]}>
                <CodeBlock>{message.content}</CodeBlock>
              </Disclosure>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

function sourceName(source: TokenSource): string {
  switch (source.kind) {
    case 'description':
    case 'persona':
    case 'memory':
    case 'lorebook':
      return SLOT[source.kind].name;
    case 'chat':
      return '대화';
    default:
      return partName(source, 'system');
  }
}

function NextTokens({ sending }: { sending: Sending }) {
  const { groups, total, fit, dropped } = tokenGroups(sending.prompt, sending.calibration);
  const counted = (source: TokenSource, count: number) => (source.kind === 'chat' ? `메시지 ${count}개` : source.kind === 'lorebook' ? `항목 ${count}개` : undefined);
  return (
    <Stack gap="related">
      <Gauge
        share={fit.allowance ? total / fit.allowance : undefined}
        tone={fit.allowance && total > fit.allowance ? 'warn' : 'plain'}
        amount={`약 ${tokens(total)}`}
        of={fit.allowance === null ? undefined : `약 ${tokens(fit.allowance)}`}
        note={['앱 추정', ...(fit.allowance !== null && fit.multiplier !== null ? [`배율 ×${fit.multiplier.toFixed(2)} 반영`] : [])].join(' · ')}
      />
      {fit.allowance === null && <Text variant="note">모델 한도를 알 수 없어서 내용을 줄이지 않아요.</Text>}
      {dropped > 0 && <Text variant="note">{`한도를 넘어서 오래된 메시지 ${dropped}개가 빠져요.`}</Text>}
      <Disclosure label="토큰을 쓰는 곳">
        <List label="토큰을 쓰는 곳">
          {[...groups].sort((a, b) => b.tokens - a.tokens).map((group) => (
            <ListItem key={JSON.stringify(group.source)} title={sourceName(group.source)} description={counted(group.source, group.count)} note={tokens(group.tokens)} />
          ))}
        </List>
      </Disclosure>
    </Stack>
  );
}

