import { ArrowUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { entryName, type Cost } from '../../connectors/types';
import { cacheDiff, changedLines } from '../../engine/cache-diff';
import { toolSource } from '../../engine/import/tool';
import type { Stored } from '../../model/kinds';
import type { DraftAsk, ToolDraft, ToolIdentity } from '../../model/tool';
import type { ObjectStore } from '../../runtime/store';
import { routeOf, sharedModel } from '../../runtime/assignment';
import { writeWhole } from '../../runtime/export-file';
import { addDraftAsk, applyPreview, deleteDraft, restoreDraft, saveDraft, type DraftFile } from '../../runtime/tools/drafts';
import { askEstimate, askPlugin, type PluginAsked } from '../../runtime/tools/plugin-writer';
import { ACTS } from '../common/acts';
import { jsLanguage } from '../common/code/javascript';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { describeAskFailure } from '../common/failure';
import { describeImportFailure } from '../common/importFailure';
import { ModelMenu } from '../common/ModelMenu';
import { FileExport } from '../common/FileExport';
import { cost } from '../common/receipt';
import { useAutosave } from '../common/useAutosave';
import { STOP, TOOL, toolVersion } from '../common/words';
import { useConnections, useSession, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, CodeField, CommentBox, Empty, Exchange, Facts, MenuItem, NavBar, Row, Screen, Section, Stack, Tag, TextDiff, TextField, type CodeAside } from '../ui';
import { ApplyDialog } from './ApplyDialog';
import { draftTitle, USE_TAGS } from './studio';
import { TestPane } from './StudioTest';

function askFoot(store: ObjectStore, ask: Pick<DraftAsk, 'model' | 'cost'>): string {
  const route = routeOf(store, ask.model);
  return ['kind' in route ? ask.model.model : entryName(route.model), ask.cost && cost(ask.cost)].filter(Boolean).join(' · ');
}

export function StudioScreen({ stored, back }: { stored: Stored<'tooldraft'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const { id, value } = stored;
  const autosave = useAutosave<DraftFile>(`tooldraft:${id}`, (patch) => saveDraft(store, id, patch));
  const draft: ToolDraft = { ...value, identity: autosave.unsaved.identity ?? value.identity, body: autosave.unsaved.body ?? value.body };
  const title = draftTitle(draft.identity);
  const language = useMemo(() => jsLanguage(), []);
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function remove() {
    const removed = await autosave.remove(() => deleteDraft(store, id));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    navigate({ kind: 'plugins' });
    toast.undoable(`'${title}' 초안을 삭제했어요.`, () => restoreDraft(store, id, draft));
  }

  const asides: CodeAside[] = [
    { label: 'AI', body: () => <AiPane id={id} draft={draft} flush={autosave.flush} /> },
    { label: '테스트', body: (reveal) => <TestPane draft={draft} reveal={reveal} /> },
    { label: '정보', body: (reveal) => <InfoPane draft={draft} onIdentity={(identity) => autosave.change({ identity })} reveal={reveal} /> },
  ];
  return (
    <Screen
      width="page"
      fill
      top={
        <NavBar
          title={title}
          subtitle={draft.identity.version ? toolVersion(draft.identity.version) : undefined}
          status={autosave.words}
          {...backBar(back)}
          actions={
            <Button
              variant="primary"
              onClick={() =>
                void autosave.flush().then((flushed) => flushed && setApplying(true))
              }
            >
              적용
            </Button>
          }
          menu={{
            of: '초안',
            items: (
              <>
                <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />
                <MenuItem icon={ACTS.remove.icon} label={`초안 ${ACTS.remove.label}`} tone="warn" onClick={() => void remove()} />
              </>
            ),
          }}
        />
      }
    >
      <CodeField label="코드" value={draft.body} onChange={(body: string) => autosave.change({ body })} language={language} area={() => {}} asides={asides} />
      {applying && <ApplyDialog id={id} draft={draft} onClose={() => setApplying(false)} />}
      {exporting && <DraftExport name={title} text={toolSource(draft.identity, draft.body)} onClose={() => setExporting(false)} />}
    </Screen>
  );
}

// An answer waits here until kept or dropped; either way the ask joins the draft's list, its change only when kept.
type Pending = { ask: string; before: string; asked: Extract<PluginAsked, { ok: true }> };
type Run = { kind: 'idle' } | { kind: 'running'; ask: string; length: number } | { kind: 'failed'; ask: string; message: string } | { kind: 'answered'; pending: Pending };

function AiPane({ id, draft, flush }: { id: string; draft: ToolDraft; flush: () => Promise<boolean> }) {
  const session = useSession();
  const { store } = session;
  useConnections();
  const toast = useToast();
  const [ask, setAsk] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [estimate, setEstimate] = useState<Cost | null>(null);
  const [picked, setPicked] = useState<ModelRef | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const running = run.kind === 'running';

  useEffect(() => {
    if (!ask.trim()) return setEstimate(null);
    let current = true;
    const timer = setTimeout(() => void askEstimate(session, { body: draft.body, ask, model: picked }).then((found) => current && setEstimate(found)), 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [session, draft.body, ask, picked]);

  async function send() {
    if (!(await flush())) return;
    const asked = ask.trim();
    const before = draft.body;
    const controller = new AbortController();
    abort.current = controller;
    setAsk('');
    setRun({ kind: 'running', ask: asked, length: 0 });
    const answer = await askPlugin(session, { body: before, ask: asked, model: picked }, controller.signal, (live) => setRun({ kind: 'running', ask: asked, length: live.length }));
    abort.current = null;
    if (!answer.ok) {
      if (answer.failure.kind === 'stopped') {
        setAsk(asked);
        return setRun({ kind: 'idle' });
      }
      return setRun({ kind: 'failed', ask: asked, message: describeAskFailure(answer.failure) });
    }
    if (!answer.answer.ok) {
      const kept = await addDraftAsk(store, id, { ask: asked, note: answer.answer.note, model: answer.model, cost: answer.cost, at: Date.now() }, null);
      if (!kept.ok) toast.failed(kept, '저장하지 못했어요.');
      return setRun({ kind: 'idle' });
    }
    setRun({ kind: 'answered', pending: { ask: asked, before, asked: answer } });
  }

  async function settle({ ask: asked, asked: { answer, model, cost: spent } }: Pending, keep: boolean) {
    if (!answer.ok) return;
    const kept = await addDraftAsk(store, id, { ask: asked, note: answer.note, model, cost: spent, at: Date.now() }, keep ? answer.body : null);
    if (!kept.ok) return toast.failed(kept, '저장하지 못했어요.');
    setRun({ kind: 'idle' });
  }

  const pending = run.kind === 'answered' ? run.pending : null;
  const hint = running ? `생성 중… ${run.length.toLocaleString()}자` : estimate === null ? undefined : `예상 ${cost(estimate)}`;
  return (
    <Stack gap="group">
      {draft.asks.length === 0 && !pending && run.kind === 'idle' && <Empty>{`바꾸고 싶은 점을 적으면 AI가 ${TOOL} 코드를 수정해요.`}</Empty>}
      {draft.asks.map((each) => (
        <Exchange key={each.at} ask={each.ask} answer={each.note} foot={askFoot(store, each)} />
      ))}
      {run.kind === 'running' && <Exchange ask={run.ask} answer="생성 중…" />}
      {run.kind === 'failed' && (
        <Exchange ask={run.ask}>
          <Callout tone="warn">{run.message}</Callout>
        </Exchange>
      )}
      {pending && pending.asked.answer.ok && (
        <Exchange ask={pending.ask} answer={pending.asked.answer.note} foot={askFoot(store, pending.asked)}>
          <PendingChange pending={pending} current={draft.body} onSettle={(keep) => void settle(pending, keep)} />
        </Exchange>
      )}
      <CommentBox
        label="수정할 내용"
        value={ask}
        onChange={setAsk}
        placeholder="수정할 내용을 입력해 주세요"
        hint={hint}
        actions={
          <>
            <ModelMenu route={sharedModel(store, 'main', picked)} onPick={setPicked} />
            {running ? (
              <Button variant="secondary" onClick={() => abort.current?.abort()}>{STOP}</Button>
            ) : (
              <Button variant="primary" icon={ArrowUp} disabled={!ask.trim() || pending !== null} onClick={() => void send()}>보내기</Button>
            )}
          </>
        }
      />
    </Stack>
  );
}

function PendingChange({ pending, current, onSettle }: { pending: Pending; current: string; onSettle: (keep: boolean) => void }) {
  const { answer } = pending.asked;
  const runs = useMemo(() => (answer.ok ? cacheDiff(pending.before, answer.body).runs : []), [answer, pending.before]);
  if (!answer.ok) return null;
  const lines = changedLines(runs);
  return (
    <Stack gap="related">
      <Row kind="spread">
        <span>{lines ? (lines.from === lines.to ? `${lines.from}번째 줄 변경` : `${lines.from}–${lines.to}번째 줄 변경`) : '바뀐 곳 없음'}</span>
        <Row kind="actions">
          <Button variant="ghost" size="sm" onClick={() => onSettle(false)}>버리기</Button>
          <Button variant="primary" size="sm" onClick={() => onSettle(true)}>반영</Button>
        </Row>
      </Row>
      {current !== pending.before && <Callout tone="warn">응답을 받는 동안 코드를 수정했어요. 반영하면 그사이 바꾼 내용은 사라져요.</Callout>}
      <TextDiff runs={runs} label="AI가 바꾼 코드" />
    </Stack>
  );
}

function InfoPane({ draft, onIdentity, reveal }: { draft: ToolDraft; onIdentity: (identity: ToolIdentity) => void; reveal: (at: [number, number]) => void }) {
  const store = useStore();
  const preview = applyPreview(store, draft);
  const { identity } = draft;
  const none = '없음';
  return (
    <Stack gap="group">
      <Stack gap="related">
        <TextField label="이름" value={identity.displayName} onChange={(displayName) => onIdentity({ ...identity, displayName })} />
        <TextField label="설명" value={identity.description} onChange={(description) => onIdentity({ ...identity, description })} />
        <TextField label="버전" value={identity.version} onChange={(version) => onIdentity({ ...identity, version })} help="바꾸지 않으면 적용할 때마다 자동으로 올라가요." />
        <Facts items={[{ label: '제작자', value: identity.author }]} />
      </Stack>
      {preview.ok ? (
        <>
          <Section title="권한" level={3}>
            {preview.manifest.uses.length > 0 ? <Row kind="tags">{preview.manifest.uses.map((use) => <Tag key={use} tone="accent">{USE_TAGS[use]}</Tag>)}</Row> : <Empty>{none}</Empty>}
          </Section>
          <Section title="설정" level={3} note={preview.manifest.settings.length > 0 ? `${preview.manifest.settings.length}개` : undefined}>
            {preview.manifest.settings.length > 0 ? <Facts items={preview.manifest.settings.map((field) => ({ label: field.label, value: field.type }))} /> : <Empty>{none}</Empty>}
          </Section>
          <Section title="메뉴·버튼" level={3}>
            <Facts
              items={[
                { label: '메뉴(⋯)', value: preview.manifest.menu.map((item) => item.label).join(', ') || none },
                { label: '메시지 버튼', value: (preview.manifest.actions ?? []).map((item) => item.label).join(', ') || none },
                { label: '입력창 버튼', value: preview.manifest.composer?.label ?? none },
                { label: '입력창 버튼 항목', value: (preview.manifest.inputs ?? []).map((item) => item.label).join(', ') || none },
                { label: '전용 화면', value: preview.manifest.page?.label ?? none },
              ]}
            />
          </Section>
        </>
      ) : (
        <Callout tone="warn" action={{ label: '코드에서 보기', onClick: () => reveal(lineAt(draft.body, preview.failure.line)) }}>
          {describeImportFailure(preview.failure)}
        </Callout>
      )}
    </Stack>
  );
}

function lineAt(text: string, line: string | undefined): [number, number] {
  const lines = text.split('\n');
  const at = line === undefined ? -1 : lines.findIndex((each) => each.trim() === line);
  if (at < 0) return [0, 0];
  const from = lines.slice(0, at).reduce((sum, each) => sum + each.length + 1, 0);
  return [from, from + lines[at]!.length];
}

function DraftExport({ name, text, onClose }: { name: string; text: string; onClose: () => void }) {
  const toast = useToast();
  const file = fileNamed(name, TOOL, 'js');
  function save(show: (label: string | null) => void) {
    runExport(toast, file, (output) => writeWhole(output, new TextEncoder().encode(text)), show, () => {
      toast.show(`'${name}' 초안을 내보냈어요.`);
      onClose();
    });
  }
  return <FileExport format={`헤이젤 ${TOOL}`} file={file} help="플러그인 가져오기로 열 수 있어요." blocked={null} onExport={save} onClose={onClose} />;
}
