import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { sumCosts } from '../../connectors/pricing';
import { sharedModel } from '../../runtime/assignment';
import type { ToolDraft } from '../../model/tool';
import { chatNow } from '../../runtime/chat-context';
import type { ToolTrial } from '../../runtime/script-preview';
import type { Session } from '../../runtime/session';
import { bodyLine, draftTrial } from '../../runtime/tools/drafts';
import { ToolFailure, type TrialWrite } from '../../runtime/tools/frame-state';
import { trialReport, type PluginRunner } from '../../runtime/tools/plugin-writer';
import { describeImportFailure } from '../common/importFailure';
import { ModelMenu } from '../common/ModelMenu';
import { cost } from '../common/receipt';
import { useChats, useSession } from '../session';
import { Button, Callout, ChoiceGroup, CodeBlock, Empty, Facts, Row, SettingRow, Stack, Switch, Text, TextField } from '../ui';
import { fixAsk, testEvent, testPicks, type TestPick } from './studio';

const REFUSED: Record<Extract<TrialWrite, { kind: 'refused' }>['call'], string> = { 'assets.save': '파일 저장', 'chat.picture': '이미지 넣기', 'chat.send': '메시지 보내기' };

// What 테스트 holds across its runs and the AI's: the chat, and the answer for the plugin's model calls, on the 보조 모델
// unless another is picked. chat null: the latest.
export type TestSetup = { chat: string | null; calling: boolean; model: ModelRef | null };

// code: the failure is the file's own, thrown or failed to load, so the AI can be asked to fix it. line: the body's.
type Tested = ToolTrial | null | { failed: string; line: number | null; code: boolean };

// The draft run once on a chat for one moment, as ScriptPreview.tool runs it: nothing is saved.
async function runTest(session: Session, draft: ToolDraft, chat: string, moment: string, text: string, setup: TestSetup, signal: AbortSignal): Promise<Tested> {
  const read = draftTrial(session.store, draft);
  if (!read.ok) return { failed: describeImportFailure(read.failure), line: null, code: true };
  try {
    const scope = await chatNow(session, chat, signal);
    if (!scope) return { failed: '채팅을 열지 못했어요.', line: null, code: false };
    const event = testEvent(moment, scope, text, read.trial.tool.manifest);
    if (!event) return { failed: '이 채팅에는 테스트할 메시지가 없어요.', line: null, code: false };
    return await session.scriptPreview.tool(chat, scope, read.trial, event, setup.calling ? { model: setup.model } : null, signal);
  } catch (error) {
    const code = error instanceof ToolFailure;
    return { failed: error instanceof Error ? error.message : String(error), line: code && error.line !== null ? bodyLine(draft, error.line) : null, code };
  }
}

// 테스트 as the AI's run_test: on the code it wrote, under the draft's identity, on the chat 테스트 holds.
export function testRunner(session: Session, draft: ToolDraft, chat: string | null, setup: TestSetup): PluginRunner | null {
  const read = draftTrial(session.store, draft);
  if (!read.ok || chat === null) return null;
  return {
    moments: testPicks(read.trial.tool.manifest),
    async run(code, moment, text, signal) {
      const tried = { ...draft, body: code };
      const known = draftTrial(session.store, tried);
      const pick = (known.ok ? testPicks(known.trial.tool.manifest) : []).find((each) => each.value === moment);
      const label = pick?.label ?? moment;
      if (known.ok && !pick) return { moment: label, ended: { failed: '이 코드에 없는 실행 시점이에요.', line: null }, report: `Not run: ${moment} is not a moment of this file.` };
      const ran = await runTest(session, tried, chat, moment, text, setup, signal);
      if (ran === null) return { moment: label, ended: 'unheard', report: `Nothing ran: the file has no handler for the ${pick!.sub.split(' ')[0]} event.` };
      if ('failed' in ran) {
        const at = ran.line === null ? undefined : code.split('\n')[ran.line - 1];
        return { moment: label, ended: { failed: ran.failed, line: ran.line }, report: [`Error: ${ran.failed}`, at !== undefined && `Line ${ran.line}: ${at.trim()}`].filter(Boolean).join('\n') };
      }
      return { moment: label, ended: 'passed', report: trialReport(ran) };
    },
  };
}

type Ran = { body: string; pick: TestPick; result: Tested };

export function TestPane({ draft, setup, onSetup, reveal, onFix }: { draft: ToolDraft; setup: TestSetup; onSetup: (setup: TestSetup) => void; reveal: (at: [number, number]) => void; onFix: (ask: string) => void }) {
  const session = useSession();
  const chats = useChats();
  const read = useMemo(() => draftTrial(session.store, draft), [session.store, draft.identity, draft.body]);
  const picks = read.ok ? testPicks(read.trial.tool.manifest) : [];
  const [pick, setPick] = useState('reply');
  const [text, setText] = useState('');
  const [ran, setRan] = useState<Ran | 'running' | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const chosen = chats.find((each) => each.id === setup.chat) ?? chats[0];
  const picked = picks.find((each) => each.value === pick) ?? picks[0];
  if (!read.ok) return <Text variant="note">헤더에 오류가 있어서 테스트할 수 없어요. 정보 탭에서 확인해 주세요.</Text>;
  if (!chosen || !picked) return <Empty>테스트하려면 먼저 채팅을 시작해 주세요.</Empty>;

  async function run(on: string, pick: TestPick) {
    running.current?.abort();
    const stop = (running.current = new AbortController());
    const body = draft.body;
    setRan('running');
    const result = await runTest(session, draft, on, pick.value, text, setup, stop.signal);
    if (!stop.signal.aborted) setRan({ body, pick, result });
  }

  return (
    <Stack gap="related">
      <ChoiceGroup label="채팅" layout="menu" options={chats.map(({ id, title }) => ({ value: id, label: title }))} value={chosen.id} onChange={(chat) => onSetup({ ...setup, chat })} />
      <ChoiceGroup label="실행 시점" layout="menu" options={picks.map(({ value, label, sub }) => ({ value, label, sub }))} value={picked.value} onChange={setPick} />
      {picked.text && <TextField label={picked.value === 'sending' ? '보낼 메시지' : '입력창 내용'} value={text} onChange={setText} />}
      {read.trial.tool.manifest.uses.includes('model') && (
        <>
          <SettingRow label="모델 호출" help="플러그인의 모델 호출은 모두 선택한 모델로 보내요. 기본값은 보조 모델이에요." control={<Switch label="모델 호출" checked={setup.calling} onChange={(calling) => onSetup({ ...setup, calling })} />} />
          {setup.calling && <SettingRow label="모델" control={<ModelMenu route={sharedModel(session.store, 'aux', setup.model)} onPick={(model) => onSetup({ ...setup, model })} />} />}
        </>
      )}
      <Text variant="note">{setup.calling ? '채팅과 저장소는 바뀌지 않아요. 모델은 실제로 호출해서 비용이 들어요.' : '채팅과 저장소는 바뀌지 않고, 모델 호출과 네트워크 요청은 하지 않아요.'}</Text>
      <Button disabled={ran === 'running'} onClick={() => void run(chosen.id, picked)}>
        {ran === 'running' ? '실행하는 중…' : '테스트 실행'}
      </Button>
      {ran !== null && ran !== 'running' && (
        <TestResult
          ran={ran}
          stale={ran.body !== draft.body}
          onLine={(line) => reveal(lineRange(draft.body, line))}
          onFix={(failed, line) => onFix(fixAsk(failed, ran.pick.label, ran.body, line))}
        />
      )}
    </Stack>
  );
}

type ResultProps = { ran: Ran; stale: boolean; onLine: (line: number) => void; onFix: (failed: string, line: number | null) => void };

function TestResult({ ran: { pick, result }, stale, onLine, onFix }: ResultProps) {
  if (result === null) return <Text variant="note">{`이 코드에는 '${pick.sub.split(' ')[0]!}' 핸들러가 없어요.`}</Text>;
  if ('failed' in result) {
    const { failed, line, code } = result;
    return (
      <Stack gap="related">
        <Callout tone="warn">{failed}</Callout>
        {!stale && (code || line !== null) && (
          <Row kind="actions">
            {line !== null && <Button variant="secondary" size="sm" onClick={() => onLine(line)}>코드에서 보기</Button>}
            {code && <Button variant="primary" size="sm" onClick={() => onFix(failed, line)}>AI로 수정</Button>}
          </Row>
        )}
      </Stack>
    );
  }
  const { outcome, said, asked, calls, writes, called } = result;
  const answer = answerText(outcome.value);
  const listed = (label: string, items: string[]) => (items.length ? [{ label, value: items.join(' · ') }] : []);
  const count = (label: string, length: number, unit = '개') => (length ? [{ label, value: `${length}${unit}` }] : []);
  const total = sumCosts(called);
  const kept = (kind: 'storage' | 'setting') => writes.flatMap((write) => (write.kind === kind ? [write.key] : []));
  const facts = [
    ...listed('알림 표시', said.map(({ text }) => text)),
    ...count('질문 표시', asked.length),
    ...count('채팅 상태', outcome.writes.length),
    ...count('채팅 데이터', outcome.tool?.data.length ?? 0),
    ...listed('배지', (outcome.tool?.badges ?? []).flatMap(({ text }) => (text === null ? [] : [text]))),
    ...count('메시지 수정', outcome.edits.length),
    ...count('메시지 추가', outcome.added.length),
    ...count('채팅 로어북 항목', outcome.lore.length),
    ...listed('저장소', kept('storage')),
    ...listed('설정', kept('setting')),
    ...listed('생략된 동작', writes.flatMap((write) => (write.kind === 'refused' ? [REFUSED[write.call]] : []))),
    ...(called.length ? [{ label: '모델 호출', value: [`${called.length}번`, total && cost(total)].filter(Boolean).join(' · ') }] : []),
    ...count('생략된 모델 호출', calls.model, '번'),
    ...count('생략된 임베딩 생성', calls.embed, '번'),
    ...count('생략된 네트워크 요청', calls.fetch, '번'),
  ];
  return (
    <Stack gap="related">
      {stale && <Text variant="note">코드가 바뀌었어요. 다시 실행하면 지금 코드로 테스트해요.</Text>}
      {answer.map(({ label, text }) => (
        <Fragment key={label}>
          <Text variant="note">{label}</Text>
          <CodeBlock variant="prose">{text}</CodeBlock>
        </Fragment>
      ))}
      {facts.length > 0 && <Facts items={facts} />}
      {answer.length === 0 && facts.length === 0 && <Text variant="note">변경되는 내용이 없어요.</Text>}
    </Stack>
  );
}

// What the run answered: a prompt's slot texts, or the text a sending or input answer puts in place.
function answerText(value: unknown): { label: string; text: string }[] {
  if (typeof value === 'string') return value ? [{ label: '결과', text: value }] : [];
  if (value === null || typeof value !== 'object') return [];
  const { tool, memory } = value as Exclude<Hazelle.PromptAnswer, string | null>;
  return [...(tool ? [{ label: '플러그인 블록', text: tool }] : []), ...(memory ? [{ label: '장기 기억 블록', text: memory.text }] : [])];
}


function lineRange(text: string, line: number): [number, number] {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return [0, 0];
  const from = lines.slice(0, line - 1).reduce((sum, each) => sum + each.length + 1, 0);
  return [from, from + lines[line - 1]!.length];
}
