import { useEffect, useState } from 'react';
import { calls, handEdited, shown, type AgentRun, type Receipt, type Version } from '../../model/chat';
import { setAgentMemory } from '../../runtime/chat-log';
import type { LogEntry } from '../../runtime/request-log';
import { describeReplyError } from '../common/failure';
import { ago } from '../common/time';
import { useChatMemory, useSession, useStore } from '../session';
import { useToast } from '../toast';
import { Breakdown, Button, Callout, Disclosure, Empty, Facts, Section, SidePanel, Stack, Switcher, Tabs, Text, TextField } from '../ui';
import { ShortfallNote } from './CacheDiagnosis';
import { SentLore, SentMemory, SentRequest, SentResponse } from './ChatSent';
import { money } from '../common/money';
import { cost, finish, seconds, speed, tokens } from '../common/receipt';
import { DISCOUNT, PDF_SEND, PRE_READ, STAGE_NAMES, UNKNOWN } from '../common/words';
import { infoReply } from './infoReply';
import type { InfoTab, Side } from './panels';
import type { OpenChat } from './useChat';

const TABS: { value: InfoTab; label: string }[] = [
  { value: 'reply', label: '응답' },
  { value: 'lore', label: '로어북' },
  { value: 'memory', label: '기억' },
  { value: 'request', label: '요청 원문' },
  { value: 'response', label: '응답 원문' },
];

const outcomeFacts = (receipt: Receipt) => [
  { label: '비용', value: cost(receipt.cost), tone: receipt.cost === null ? ('muted' as const) : undefined },
  finish(receipt),
  { label: '첫 토큰까지', value: seconds(receipt.firstTextMs) },
  { label: '속도', value: speed(receipt.usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
  ...(receipt.discount ? [{ label: DISCOUNT, value: '받음' }] : []),
  // The whole request's words by o200k, close to Gemini's own count: what 입력 would read had it gone as text.
  ...(receipt.pdf ? [{ label: PDF_SEND, value: receipt.calibration?.measurement.kind === 'measured' ? `원문 약 ${tokens(receipt.calibration.measurement.o200k)}` : '보냄' }] : []),
  ...(receipt.tries ? [{ label: '보낸 횟수', value: `${receipt.tries}번` }] : []),
];
const callFacts = (receipt: Receipt) => [
  { label: '입력', value: tokens(receipt.usage?.inputTokens ?? null) },
  { label: '출력', value: tokens(receipt.usage?.outputTokens ?? null) },
  ...outcomeFacts(receipt),
];

type Props = Pick<OpenChat, 'id' | 'shelf' | 'messages' | 'infoPick'> & {
  tab: InfoTab;
  onTab: (tab: InfoTab) => void;
  onPick: (id: string) => void;
  // Absent while 장기 기억's 기능 is off, which leaves out the 기억 tab that opens its panel.
  onRecord?: (id: string | null) => void;
  onEdit: (side: Side) => void;
  onCache: () => void;
  onClose: () => void;
};

export function ChatInfo({ id: chat, shelf, messages, infoPick, tab: picked, onTab, onPick, onRecord, onEdit, onCache, onClose }: Props) {
  const { log, costs } = useSession();
  const memory = useChatMemory(chat);
  const tab = picked === 'memory' && !onRecord ? 'reply' : picked;
  const replies = messages.filter((message) => message.role === 'assistant');
  const reply = infoReply(replies, infoPick);
  const at = reply ? replies.indexOf(reply) : -1;
  const version = reply && shown(reply);
  const receipt = version?.receipt ?? null;
  const translated = version?.translation?.receipt ?? null;
  const live = reply !== undefined && reply.live === version?.id;

  // A cost still 확인 중 after a reload is looked up again, for every call a continued reply took and its translation.
  useEffect(() => {
    if (!chat) return;
    for (const call of [...(receipt ? calls(receipt) : []), ...(translated ? [translated] : [])]) costs.settle(chat, call);
  }, [chat, receipt, translated, costs]);

  const stepper = (
    <Switcher
      count={`${at + 1} / ${replies.length}`}
      prev={{ label: '이전 응답 정보', disabled: at <= 0, onClick: () => onPick(replies[at - 1]!.id) }}
      next={{ label: '다음 응답 정보', disabled: at >= replies.length - 1, onClick: () => onPick(replies[at + 1]!.id) }}
    />
  );

  let body;
  // A continued reply thought in each of its calls; one call that did not say leaves the total unknown.
  const counts = receipt ? calls(receipt).map((call) => call.usage?.reasoningTokens ?? null) : [];
  const reasoned = counts.includes(null) ? null : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const thought = version && (version.reasoning || reasoned) && (
    <Section level={3} title="추론" note={reasoned ? `${tokens(reasoned)} 토큰` : undefined}>
      {version.reasoning ? <Text variant="prose">{version.reasoning}</Text> : <Empty variant="section">모델이 추론 과정을 보내지 않았어요.</Empty>}
    </Section>
  );
  if (!version) body = <Empty>응답이 없어요.</Empty>;
  else if (live) {
    body = (
      <>
        <Text variant="note">생성 중…</Text>
        {thought}
      </>
    );
  }
  else if (!receipt) {
    body = (
      <>
        <Empty>{version.reasoning ? '외부에서 가져온 응답이라 토큰과 비용 정보가 없어요.' : '모델이 직접 생성한 응답이 아니라서 토큰과 비용 정보가 없어요.'}</Empty>
        {translated && <TranslationCall receipt={translated} />}
        {thought}
      </>
    );
  }
  else {
    const earlier = calls(receipt).slice(0, -1);
    const tooled = earlier.some((call) => call.tools);
    const entry = chat ? log.entry(chat, receipt.id) : null;
    body = (
      <>
        <Tabs label="응답 정보" items={TABS.filter((each) => each.value !== 'memory' || onRecord)} value={tab} onChange={onTab} />
        {earlier.length > 0 && tab !== 'reply' && <Text variant="note">마지막으로 이어 쓴 요청의 정보예요.</Text>}
        {tab === 'reply' && (
          <>
            {handEdited(version) && <Text variant="note">수정하기 전 응답의 정보예요.</Text>}
            {earlier.length > 0 && (
              <Text variant="note">{tooled ? `모델 도구를 사용해서 ${earlier.length + 1}번 호출한 응답이에요. 비용은 호출할 때마다 발생해요.` : `${earlier.length + 1}번 호출해서 이어 쓴 응답이에요. 비용은 호출할 때마다 발생해요.`}</Text>
            )}
            <Call receipt={receipt} entry={entry} onCache={onCache} />
            {receipt.preread && <PrereadCall preread={receipt.preread} />}
            {chat && receipt.agents?.map((run) => <AgentCall key={`${run.stage}:${run.agent}`} chat={chat} version={version} run={run} />)}
            {translated && <TranslationCall receipt={translated} />}
            {thought}
            {earlier.length > 0 && (
              <Section level={3} title="이전 호출">
                {earlier.map((call, index) => (
                  <Stack key={index} gap="related">
                    <Text variant="note">{`${index === 0 ? '첫 응답' : earlier[index - 1]!.tools ? `도구 실행 후 ${index}` : `이어 쓰기 ${index}`} · ${call.modelName} · ${call.source}`}</Text>
                    <Facts variant="tiles" items={callFacts(call)} />
                  </Stack>
                ))}
              </Section>
            )}
          </>
        )}
        {tab === 'lore' && <SentLore entry={entry} character={shelf && { id: shelf.id, card: shelf.character.card }} onEdit={onEdit} />}
        {tab === 'memory' && onRecord && <SentMemory entry={entry} memory={memory} onRecord={onRecord} />}
        {tab === 'request' && <SentRequest entry={entry} receipt={receipt} />}
        {tab === 'response' && <SentResponse entry={entry} />}
      </>
    );
  }

  return (
    <SidePanel title="응답 정보" subtitle={version ? ago(version.at) : undefined} actions={replies.length > 1 && stepper} onClose={onClose}>
      {body}
    </SidePanel>
  );
}

function TranslationCall({ receipt }: { receipt: Receipt }) {
  return (
    <>
      <Section level={3} title="번역">
        <Text variant="note">{`${receipt.modelName} · ${receipt.source}`}</Text>
        <Facts variant="tiles" items={callFacts(receipt)} />
      </Section>
      <Fitting receipt={receipt} title="번역 토큰 맞추기" />
    </>
  );
}

// The brief's own call, apart from the reply's: its 입력 is the shortened prompt, and the pair shows what was saved.
function PrereadCall({ preread: { material, brief, receipt, reused, saved } }: { preread: NonNullable<Receipt['preread']> }) {
  const net = saved && { label: '절약한 비용', value: `약 ${money(saved.unit, Math.abs(saved.amount))} ${saved.amount < 0 ? '추가 발생' : '절약'}` };
  return (
    <Section level={3} title={PRE_READ} note={`원문 약 ${tokens(material)} → 줄인 뒤 ${tokens(brief)}`}>
      <Text variant="note">{reused ? '이전 응답에서 요약한 내용을 재사용해서 이번에는 비용이 들지 않았어요.' : `${receipt.modelName} · ${receipt.source}`}</Text>
      <Facts variant="tiles" items={[net || { label: '절약한 비용', value: UNKNOWN, tone: 'muted' as const }, ...(reused ? [] : callFacts(receipt))]} />
    </Section>
  );
}

// Agent info exposes editable memory for following turns (runtime/agents memoryOf).
// Wire text belongs to the page request log; post-agent raw response is that agent's rewritten reply.
function AgentCall({ chat, version, run: { agent, name, stage, receipt, note, memory, reused } }: { chat: string; version: Version; run: AgentRun }) {
  const store = useStore();
  const { log } = useSession();
  const entry = log.entry(chat, receipt.id);
  const toast = useToast();
  const kept = version.memories?.[agent] ?? memory;
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => void setAgentMemory(store, chat, version.id, agent, draft!).then((saved) => (saved.ok ? setDraft(null) : toast.failed(saved, '저장하지 못했어요.')));
  return (
    <Section level={3} title={name} note={STAGE_NAMES[stage]}>
      <Text variant="note">{reused ? '이전 응답에서 작성한 노트를 재사용했어요.' : `${receipt.modelName} · ${receipt.source}`}</Text>
      {!reused && <Facts variant="tiles" items={callFacts(receipt)} />}
      {note !== undefined && (
        <Disclosure label="노트">
          <Text>{note}</Text>
        </Disclosure>
      )}
      <Disclosure label="요청 원문">
        <SentRequest entry={entry} receipt={receipt} />
      </Disclosure>
      <Disclosure label="응답 원문">
        <SentResponse entry={entry} />
      </Disclosure>
      {kept !== undefined && (
        <Disclosure label="기억">
          {draft === null ? (
            <Stack gap="related">
              <Text>{kept || '비어 있어요.'}</Text>
              <Button variant="secondary" size="sm" onClick={() => setDraft(kept)}>
                편집
              </Button>
            </Stack>
          ) : (
            <Stack gap="related">
              <TextField label="기억" showLabel={false} lines={6} value={draft} onChange={setDraft} />
              <Button size="sm" onClick={save}>
                저장
              </Button>
            </Stack>
          )}
        </Disclosure>
      )}
    </Section>
  );
}

// onCache: only a reply's call, whose cache 점검 › 캐시 follows.
function Call({ receipt, entry, onCache }: { receipt: Receipt; entry: LogEntry | null; onCache?: () => void }) {
  const usage = receipt.usage;
  const cached = usage?.cachedInputTokens ?? null;
  const input = usage?.inputTokens ?? null;
  const fresh = input !== null && cached !== null ? input - cached : null;
  // Counted in fresh: the tokens this call sent that the next one can read from the cache.
  const written = usage?.cacheWriteInputTokens ?? null;
  return (
    <>
      <Section level={3} title="모델">
        <Text>{receipt.modelName}</Text>
        <Text variant="note">
          {receipt.source}
        </Text>
      </Section>
      {receipt.state === 'failed' && (
        <Section level={3} title="결과">
          <Callout tone="warn">
            {receipt.error && `${describeReplyError(receipt.error)} `}{seconds(receipt.totalMs)} 만에 실패했어요.
          </Callout>
        </Section>
      )}
      {usage ? (
        <Section level={3} title="토큰" note={[input && cached !== null && `캐시에서 ${Math.round((cached / input) * 100)}% 읽음`, written && `캐시에 저장 ${tokens(written)}`].filter(Boolean).join(' · ') || undefined} action={onCache && <Button variant="ghost" size="sm" onClick={onCache}>캐시 점검</Button>}>
          <Breakdown
            shares={input && fresh !== null ? [cached! / input, fresh / input] : null}
            parts={
              cached === null
                ? [
                    { label: '입력', value: tokens(input), mark: 'plain' },
                    { label: '출력', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
                : [
                    { label: '캐시에서 읽음', value: tokens(cached), mark: 'accent' },
                    { label: '새 입력', value: tokens(fresh), mark: 'plain' },
                    { label: '출력', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
            }
          />
        </Section>
      ) : (
        <Empty variant="section">제공자가 사용량을 알려 주지 않았어요.</Empty>
      )}
      <ShortfallNote receipt={receipt} entry={entry} />
      <Facts variant="tiles" items={[...(usage ? [] : [{ label: '토큰', value: UNKNOWN, tone: 'muted' as const }]), ...outcomeFacts(receipt)]} />
      <Fitting receipt={receipt} />
    </>
  );
}

const UNMEASURED = { preparation: '요청을 만들기 전에 멈춤', tokenizer: '토큰 수를 세지 못함' } as const;
const UNLEARNED = { pictures: '이미지가 포함되어 보정 안 함', incomplete: '응답이 중단되어 보정 안 함', 'missing-input': '제공자가 입력 토큰을 알려 주지 않음', empty: '전송한 텍스트 없음' } as const;
const SOURCE = { prior: '기본값', model: '이 모델의 기록', chat: '이 채팅의 기록', 'drift-reset': '변경된 배율 재보정 중', unavailable: '보정 안 함' } as const;
const BOUND = { 'hard-upper': '모델 한도에 여유를 두고 보정', 'hard-centre': '모델 한도 기준', 'user-centre': '컨텍스트 한도 기준', refusal: '한도 초과 후 축소 보정' } as const;

function Fitting({ receipt, title = '토큰 보정' }: { receipt: Receipt; title?: string }) {
  const { tokens: calibration } = useSession();
  const fit = calibration.call(receipt);
  // A receipt from before calibration has nothing to show, which is not the same as a call that could not be measured.
  if (fit.unavailable === 'historical') return null;
  const learned = fit.source === 'model' || fit.source === 'chat' || fit.source === 'drift-reset';
  return (
    <Section level={3} title={title} help="제공자가 계산한 입력 토큰과 앱이 추정한 토큰을 비교해 프롬프트 분량을 모델 한도에 맞춰요.">
      <Facts
        variant="tiles"
        items={[
          fit.denominator === null
            ? { label: '앱 계산 입력', value: UNKNOWN, tone: 'muted', notes: fit.unavailable ? [UNMEASURED[fit.unavailable]] : undefined }
            : { label: '앱 계산 입력', value: `약 ${tokens(fit.denominator)}` },
          fit.ratio === null
            ? { label: '적용 배율', value: UNKNOWN, tone: 'muted', notes: fit.ineligible ? [UNLEARNED[fit.ineligible]] : undefined }
            : { label: '적용 배율', value: `×${fit.ratio.toFixed(2)}` },
          { label: '보정 기준', value: SOURCE[fit.source], tone: fit.source === 'unavailable' ? 'muted' : undefined, notes: learned ? [`기록 ${Math.max(1, Math.round(fit.evidence))}개 반영`] : undefined },
          ...(fit.bound === null && fit.allowance === null
            ? []
            : [{ label: '전송 가능했던 입력', value: fit.allowance === null ? UNKNOWN : `약 ${tokens(fit.allowance)}`, notes: [fit.bound ? BOUND[fit.bound] : '모델 한도 미확인으로 축소 안 함', ...(fit.multiplier === null ? [] : [`배율 ×${fit.multiplier.toFixed(2)} 적용`])] }]),
          ...(fit.retries.length ? [{ label: '길이 초과로 다시 보냄', value: `${fit.retries.length}번`, tone: 'warn' as const }] : []),
        ]}
      />
    </Section>
  );
}
