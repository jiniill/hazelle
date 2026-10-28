import { useEffect, useMemo, useRef, useState } from 'react';
import type { CbsStep } from '../../../engine/cbs/evaluate';
import type { ChatScope } from '../../../engine/render';
import type { Event, ScriptUnit } from '../../../engine/script-api';
import type { LoreOwner } from '../../../model/library';
import { chatNow } from '../../../runtime/chat-context';
import type { TrialRead } from '../../../runtime/evaluation-core';
import type { Trial } from '../../../runtime/script-preview';
import { useChats, useSession } from '../../session';
import { Button, Callout, ChoiceGroup, CodeBlock, Facts, Stack, StepList, Text, type CodeAside, type StepRow } from '../../ui';
import { runaway } from '../failure';
import { HookDetail } from '../HookDetail';
import { LUA_EVENTS } from './luaApi';
import { SAMPLE, SAMPLE_LANGUAGE, SAMPLE_NOTE } from './sample';
import { chatVariable, writerName, type ChatVariables, type Defaults, type Variables } from './variables';

const LABEL = '테스트';
// The lane name the sample runs on, which no chat id takes.
const SAMPLE_CHAT = 'sample';
const WAIT_MS = 400;

// Whose draft it is, which picks the chats offered: a character's own, the one chat of a chat's lorebook, any chat
// otherwise.
type Owner = LoreOwner | null;

// Keep the chosen chat for this editor mount; expose variables only after the trial panel reads them.
type TrialChat = { owner: Owner; chat: string | null; choose: (chat: string | null) => void; read: (chat: ChatVariables | null) => void; variables: Variables };
type LuaUnit = Extract<ScriptUnit, { kind: 'lua' }>;

const NONE: Defaults = [];

// defaults: the character's 기본 변수.
export function useTrial(owner: Owner, defaults: Defaults = NONE) {
  const [chat, choose] = useState<string | null>(null);
  const [read, setRead] = useState<ChatVariables | null>(null);
  const variables = useMemo(() => ({ defaults, chat: read }), [defaults, read]);
  const trial = useMemo((): TrialChat => ({ owner, chat, choose, read: setRead, variables }), [owner?.kind, owner?.id, chat, variables]);
  const cbs = useMemo(() => (text: string): CodeAside => ({ label: LABEL, body: (reveal) => <CbsTrial text={text} trial={trial} reveal={reveal} /> }), [trial]);
  const lua = (unit: LuaUnit) => (code: string): CodeAside => ({ label: LABEL, body: () => <LuaTrial unit={{ ...unit, code }} trial={trial} /> });
  return { variables, cbs, lua };
}

// A CBS text's result as the reader sees it; null: its commands ran away and were stopped.
export function CbsResult({ result }: { result: string | null }) {
  return (
    <>
      <Text variant="note">{result === null ? '결과: 출력이 너무 길어서 중단됨' : result ? '결과' : '결과: 빈 텍스트'}</Text>
      {result && <CodeBlock variant="prose">{result}</CodeBlock>}
    </>
  );
}

const useTrialChats = (owner: Owner) => useChats().filter((summary) => (owner?.kind === 'character' ? summary.chat.character === owner.id : owner?.kind === 'chat' ? summary.id === owner.id : true));

function TrialChats({ owner, chat, onChange }: { owner: Owner; chat: string | null; onChange: (chat: string | null) => void }) {
  const chats = useTrialChats(owner);
  const where = [{ value: 'sample', label: '예시 채팅' }, ...(chats.length ? [{ value: 'mine', label: '내 채팅' }] : [])];
  return (
    <Stack gap="related">
      <ChoiceGroup label="시험할 채팅" showLabel layout="segmented" options={where} value={chat === null ? 'sample' : 'mine'} onChange={(to) => onChange(to === 'sample' ? null : chats[0]!.id)} />
      {chat === null ? (
        <Text variant="note">{SAMPLE_NOTE}</Text>
      ) : (
        <>
          <ChoiceGroup label="채팅" layout="menu" options={chats.map(({ id, title }) => ({ value: id, label: title }))} value={chat} onChange={onChange} />
          <Text variant="note">채팅은 바뀌지 않아요.</Text>
        </>
      )}
    </Stack>
  );
}

// Capture the selected/sample chat at selection time; null while loading.
// On read failure offer only character defaults, not invented chat values.
function useTrialScope({ owner, chat, read: readVariables }: TrialChat): ChatScope | 'failed' | null {
  const session = useSession();
  const label = useTrialChats(owner).find((summary) => summary.id === chat)?.title ?? '예시 채팅';
  const [read, setRead] = useState<{ chat: string; scope: ChatScope | 'failed' } | null>(null);
  useEffect(() => {
    if (chat === null) return;
    const stop = new AbortController();
    const done = (scope: ChatScope | 'failed') => !stop.signal.aborted && setRead({ chat, scope });
    chatNow(session, chat, stop.signal).then((scope) => done(scope ?? 'failed'), () => done('failed'));
    return () => stop.abort();
  }, [session, chat]);
  const scope = chat === null ? SAMPLE : read?.chat === chat ? read.scope : null;
  useEffect(() => {
    if (scope === null || scope === 'failed') return;
    const lane = { asker: 'trial', chat: chat ?? SAMPLE_CHAT, tool: 'variables' } as const;
    const stop = new AbortController();
    session.store.evaluation.variables(lane, scope, '', stop.signal).then((inspection) => {
      if (stop.signal.aborted) return;
      const kept = inspection.variables.filter((variable) => !variable.nameTruncated);
      readVariables({ label, values: new Map(kept.map((variable) => [variable.name, variable])), partial: inspection.stopped || inspection.omitted > 0 || kept.length < inspection.variables.length });
    }, () => {});
    return () => {
      stop.abort();
      readVariables(null);
      session.store.evaluation.forget(lane);
    };
  }, [session, scope, label]);
  return scope;
}

type Reveal = (at: [number, number]) => void;

function CbsTrial({ text, trial, reveal }: { text: string; trial: TrialChat; reveal: Reveal }) {
  const { store } = useSession();
  const { chat } = trial;
  const scope = useTrialScope(trial);
  const [read, setRead] = useState<{ scope: ChatScope; text: string; result: TrialRead | null | 'failed' } | null>(null);
  useEffect(() => {
    if (scope === null || scope === 'failed') return;
    const lane = { asker: 'trial', chat: chat ?? SAMPLE_CHAT } as const;
    const stop = new AbortController();
    const done = (result: TrialRead | null | 'failed') => !stop.signal.aborted && setRead({ scope, text, result });
    const timer = setTimeout(() => {
      store.evaluation.text(lane, scope, text, chat === null ? SAMPLE_LANGUAGE : null, stop.signal).then((answer) => done('kind' in answer ? null : answer), () => done('failed'));
    }, WAIT_MS);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [store, chat, scope, text]);
  useEffect(() => () => store.evaluation.forget({ asker: 'trial', chat: chat ?? SAMPLE_CHAT }), [store, chat]);
  const shown = read?.scope === scope ? read : undefined;
  return (
    <Stack gap="related">
      <TrialChats owner={trial.owner} chat={chat} onChange={trial.choose} />
      {scope === 'failed' ? (
        <Text variant="note">채팅을 열지 못했어요.</Text>
      ) : shown === undefined ? (
        <Text variant="note">계산하는 중…</Text>
      ) : shown.result === 'failed' ? (
        <Text variant="note">결과를 만들지 못했어요.</Text>
      ) : shown.result === null ? (
        <CbsResult result={null} />
      ) : (
        <>
          <CbsResult result={shown.result.read} />
          <CbsSteps text={shown.text} read={shown.result} variables={trial.variables} reveal={reveal} stale={shown.text !== text} />
        </>
      )}
    </Stack>
  );
}

// Each tag's and block's result in the order they ran, as of the text they were read from.
function CbsSteps({ text, read: { steps, omitted }, variables, reveal, stale }: { text: string; read: TrialRead; variables: Variables; reveal: Reveal; stale: boolean }) {
  if (steps.length === 0) return null;
  // The editor reads \r\n as one line break.
  const inEditor = (at: number) => at - (text.slice(0, at).split('\r\n').length - 1);
  return (
    <>
      <Text variant="note">{`단계 ${steps.length + omitted}개`}</Text>
      <StepList label="단계" steps={steps.map((step) => shownStep(text, step, variables))} onPick={(index) => !stale && reveal([inEditor(steps[index]!.at), inEditor(steps[index]!.end)])} />
      {omitted > 0 && <Text variant="note">{`단계가 많아서 뒤의 ${omitted}개는 빠졌어요.`}</Text>}
    </>
  );
}

const KEPT = { unknown: '모르는 명령어라 쓴 그대로 남아요.', unsupported: '헤이젤이 지원하지 않는 명령어라 쓴 그대로 남아요.', args: '인자가 모자라거나 읽을 수 없어서 쓴 그대로 남아요.' } as const;

// A {{getvar}} says where the chat's value came from: a draft read after the chat writes no variable.
function shownStep(text: string, { at, end, headEnd, depth, result, kept, erased, held, condition, variable }: CbsStep, variables: Variables): StepRow {
  const source = text.slice(at, headEnd ?? end);
  // Not a warning for args: a wrapper's {{slot}} stays as written on purpose.
  if (kept) return { source, result, depth, note: KEPT[kept], ...(kept !== 'args' && { tone: 'warn' as const }) };
  if (erased) return { source, result, depth, note: '앞에 쓴 글을 지워요.' };
  if (variable !== undefined) {
    const found = chatVariable(variables, variable);
    if (found === undefined) return { source, result, depth };
    return { source, result, depth, note: found ? `정한 곳: ${writerName(found.last.writer)}` : '이 채팅에 없는 변수예요.' };
  }
  if (held === undefined) return { source, result, depth };
  const verdict = held ? '참' : '거짓';
  return { source, result, depth, note: condition ? `조건 ${condition.join(' ')} → ${verdict}` : `조건이 ${verdict}`, tone: 'branch' };
}

const EVENTS = { onInput: { kind: 'input' }, onStart: { kind: 'start' }, onOutput: { kind: 'output' } } as const satisfies Record<string, Event>;
type TrialEvent = keyof typeof EVENTS;
const isTrialEvent = (name: string): name is TrialEvent => Object.hasOwn(EVENTS, name);
const EVENT_OPTIONS = LUA_EVENTS.flatMap(({ name, text }) => (isTrialEvent(name) ? [{ value: name, label: name, sub: text }] : []));

type Ran = { code: string; event: TrialEvent; trial: Trial | 'failed' };

function LuaTrial({ unit, trial }: { unit: LuaUnit; trial: TrialChat }) {
  const { scriptPreview } = useSession();
  const { chat } = trial;
  const scope = useTrialScope(trial);
  const [event, setEvent] = useState<TrialEvent>('onOutput');
  const [ran, setRan] = useState<Ran | 'running' | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const run = (on: ChatScope) => {
    running.current?.abort();
    const stop = (running.current = new AbortController());
    const at = { code: unit.code, event };
    setRan('running');
    scriptPreview.trial(chat ?? SAMPLE_CHAT, on, unit, EVENTS[event], stop.signal).then(
      (trial) => !stop.signal.aborted && setRan({ ...at, trial }),
      () => !stop.signal.aborted && setRan({ ...at, trial: 'failed' }),
    );
  };
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    running.current?.abort();
    setRan(null);
    set(value);
  };
  return (
    <Stack gap="related">
      <TrialChats owner={trial.owner} chat={chat} onChange={reset(trial.choose)} />
      <ChoiceGroup label="실행 시점" layout="menu" options={EVENT_OPTIONS} value={event} onChange={reset(setEvent)} />
      {scope === 'failed' ? (
        <Text variant="note">채팅을 열지 못했어요.</Text>
      ) : (
        <Button disabled={scope === null || ran === 'running'} onClick={() => scope && run(scope)}>
          {ran === 'running' ? '실행하는 중…' : '테스트 실행'}
        </Button>
      )}
      {ran !== null && ran !== 'running' && <LuaRan ran={ran} stale={ran.code !== unit.code} />}
    </Stack>
  );
}

function LuaRan({ ran: { event, trial }, stale }: { ran: Ran; stale: boolean }) {
  if (trial === 'failed') return <Callout tone="warn">시험 실행하지 못했어요.</Callout>;
  const { outcome, said, asked, calls, loreRanAway } = trial;
  const count = (label: string, length: number, unit = '개') => (length ? [{ label, value: `${length}${unit}` }] : []);
  const facts = [
    ...(outcome.stop ? [{ label: '보내기', value: '중단됨' }] : []),
    ...(said.length ? [{ label: '알림 표시', value: said.map(({ text }) => text).join(' · ') }] : []),
    ...count('질문 표시', asked.length),
    ...count('메시지 추가', outcome.added.length),
    ...count('메시지 수정', outcome.edits.length),
    ...count('메시지 삭제', outcome.removed.length),
    ...count('채팅 로어북 항목', outcome.lore.length),
    ...count('생략된 모델 호출', calls.model, '번'),
    ...count('생략된 임베딩 생성', calls.embed, '번'),
    ...count('생략된 배경 변경', calls.background, '번'),
  ];
  const traced = outcome.trace?.entries ?? [];
  return (
    <Stack gap="related">
      {stale && <Text variant="note">코드가 바뀌었어요. 다시 실행하면 지금 코드로 시험해요.</Text>}
      {!outcome.handled && <Text variant="note">{`이 코드에는 ${event} 함수가 없어요.`}</Text>}
      {loreRanAway && <Callout tone="warn">{runaway('로어북을 스크립트에 넘기기 전에')}</Callout>}
      {facts.length > 0 && <Facts items={facts} />}
      {traced.map((entry, index) => (
        <HookDetail key={index} entry={entry} />
      ))}
      {outcome.handled && facts.length === 0 && traced.every((entry) => !entry.writes.length && !entry.logs.length && !entry.errors.length) && <Text variant="note">바뀌는 것이 없어요.</Text>}
    </Stack>
  );
}
