import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import type { Cost } from '../../connectors/types';
import { sharedModel } from '../../runtime/assignment';
import type { ToolDraft } from '../../model/tool';
import { chatNow } from '../../runtime/chat-context';
import type { ToolTrial } from '../../runtime/script-preview';
import { bodyLine, draftTrial } from '../../runtime/tools/drafts';
import { ToolFailure, type TrialWrite } from '../../runtime/tools/frame-state';
import { ModelMenu } from '../common/ModelMenu';
import { cost } from '../common/receipt';
import { useChats, useSession } from '../session';
import { Button, Callout, ChoiceGroup, CodeBlock, Empty, Facts, Row, SettingRow, Stack, Switch, Text, TextField } from '../ui';
import { fixAsk, testEvent, testPicks, type TestPick } from './studio';

const REFUSED: Record<Extract<TrialWrite, { kind: 'refused' }>['call'], string> = { 'assets.save': '파일 저장', 'chat.picture': '이미지 넣기', 'chat.send': '메시지 보내기' };

// code: the failure is the file's own, thrown or failed to load, so the AI can be asked to fix it.
type Ran = { body: string; pick: TestPick; result: ToolTrial | null | { failed: string; line: number | null; code: boolean } };

// The draft run once on a chosen chat for one event, as ScriptPreview.tool runs it: nothing is saved.
export function TestPane({ draft, reveal, onFix }: { draft: ToolDraft; reveal: (at: [number, number]) => void; onFix: (ask: string) => void }) {
  const session = useSession();
  const chats = useChats();
  const read = useMemo(() => draftTrial(session.store, draft), [session.store, draft.identity, draft.body]);
  const picks = read.ok ? testPicks(read.trial.tool.manifest) : [];
  const [chat, setChat] = useState<string | null>(null);
  const [pick, setPick] = useState('reply');
  const [text, setText] = useState('');
  // 모델 부르기 is the user's answer for the test's model calls, on the 보조 모델 unless another is picked.
  const [calling, setCalling] = useState(false);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [ran, setRan] = useState<Ran | 'running' | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const chosen = chats.find((each) => each.id === chat) ?? chats[0];
  const picked = picks.find((each) => each.value === pick) ?? picks[0];
  if (!read.ok) return <Text variant="note">헤더에 오류가 있어서 테스트할 수 없어요. 정보 탭에서 확인해 주세요.</Text>;
  if (!chosen || !picked) return <Empty>테스트하려면 먼저 채팅을 시작해 주세요.</Empty>;

  async function run(trial: typeof read & { ok: true }, on: string, pick: TestPick) {
    running.current?.abort();
    const stop = (running.current = new AbortController());
    const body = draft.body;
    setRan('running');
    const done = (result: Ran['result']) => !stop.signal.aborted && setRan({ body, pick, result });
    try {
      const scope = await chatNow(session, on, stop.signal);
      if (!scope) return done({ failed: '채팅을 열지 못했어요.', line: null, code: false });
      const event = testEvent(pick.value, scope, text, trial.trial.tool.manifest);
      if (!event) return done({ failed: '이 채팅에는 테스트할 메시지가 없어요.', line: null, code: false });
      done(await session.scriptPreview.tool(on, scope, trial.trial, event, calling ? { model } : null, stop.signal));
    } catch (error) {
      const code = error instanceof ToolFailure;
      done({ failed: error instanceof Error ? error.message : String(error), line: code ? error.line : null, code });
    }
  }

  return (
    <Stack gap="related">
      <ChoiceGroup label="채팅" layout="menu" options={chats.map(({ id, title }) => ({ value: id, label: title }))} value={chosen.id} onChange={setChat} />
      <ChoiceGroup label="실행 시점" layout="menu" options={picks.map(({ value, label, sub }) => ({ value, label, sub }))} value={picked.value} onChange={setPick} />
      {picked.text && <TextField label={picked.value === 'sending' ? '보낼 메시지' : '입력창 내용'} value={text} onChange={setText} />}
      {read.trial.tool.manifest.uses.includes('model') && (
        <>
          <SettingRow label="모델 호출" help="플러그인의 모델 호출은 모두 선택한 모델로 보내요. 기본값은 보조 모델이에요." control={<Switch label="모델 호출" checked={calling} onChange={setCalling} />} />
          {calling && <SettingRow label="모델" control={<ModelMenu route={sharedModel(session.store, 'aux', model)} onPick={setModel} />} />}
        </>
      )}
      <Text variant="note">{calling ? '채팅과 저장소는 바뀌지 않아요. 모델은 실제로 호출해서 비용이 들어요.' : '채팅과 저장소는 바뀌지 않고, 모델 호출과 네트워크 요청은 하지 않아요.'}</Text>
      <Button disabled={ran === 'running'} onClick={() => void run(read, chosen.id, picked)}>
        {ran === 'running' ? '실행하는 중…' : '테스트 실행'}
      </Button>
      {ran !== null && ran !== 'running' && (
        <TestResult
          ran={ran}
          stale={ran.body !== draft.body}
          onLine={(line) => reveal(lineRange(draft.body, bodyLine(draft, line)))}
          onFix={(failed, line) => onFix(fixAsk(failed, ran.pick.label, ran.body, line === null ? null : bodyLine(draft, line)))}
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
    ...(called.length ? [{ label: '모델 호출', value: [`${called.length}번`, spent(called)].filter(Boolean).join(' · ') }] : []),
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

// The calls' cost, when every call's is known in one unit.
function spent(costs: (Cost | null)[]): string | null {
  const known = costs.filter((each): each is Cost => each !== null);
  if (known.length !== costs.length || new Set(known.map(({ unit }) => unit)).size !== 1) return null;
  return cost({ unit: known[0]!.unit, amount: known.reduce((sum, { amount }) => sum + amount, 0), source: known.some(({ source }) => source === 'price-list') ? 'price-list' : 'reported' });
}

function lineRange(text: string, line: number): [number, number] {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return [0, 0];
  const from = lines.slice(0, line - 1).reduce((sum, each) => sum + each.length + 1, 0);
  return [from, from + lines[line - 1]!.length];
}
