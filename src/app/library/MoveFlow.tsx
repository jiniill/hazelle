import { useEffect, useRef, useState } from 'react';
import type { Inlays } from '../../engine/import/backup';
import { EXPANSION } from '../../engine/import/inflate';
import type { PresetFailure } from '../../engine/import/preset';
import type { BackupCatalog, BackupFailure, RisuBackup } from '../../engine/import/types';
import type { Unused } from '../../engine/pipeline';
import { ImportWorker } from '../../runtime/import/client';
import { ImportReadError, ImportStuck } from '../../runtime/import/protocol';
import { broughtFromRisu, fillInlays, modulesFromRisu, moveFromRisu, sortRisuFiles, type FilledInlays, type Moved, type MoveStep } from '../../runtime/move';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { describeUnused } from '../common/unused';
import { count as countText } from '../common/typedNumber';
import { LORE_BUDGET_LABEL, MISSED, moduleName } from '../common/words';
import { useFiles, useStanding, useStore } from '../session';
import { Button, Callout, Checkbox, Dialog, Outcome, Progress, Section, Stack, Text, type ProgressStep } from '../ui';
import { cardMissed, missedLines, moveMissed } from './missed';
import { hasModule, stepsOf, tickable, tickCount, toPick, type Have, type Ticks } from './movePick';

const FAILURE: Record<BackupFailure['kind'], string> = {
  encrypted: 'risuai.xyz의 전체 백업만으로는 가져올 수 없어요. Risu에서 \'부분 로컬 백업 저장\'으로 받은 파일을 함께 넣어 주세요.',
  'no-database': 'Risu 백업 파일이 아니거나 깨진 파일이에요.',
  'expands-too-far': `백업 속 데이터가 압축을 풀면 원래 크기의 ${EXPANSION}배가 넘어서 가져올 수 없어요.`,
  unreadable: 'Risu 백업 파일이 아니거나 깨진 파일이에요.',
};

const PRESET_FAILURE: Record<PresetFailure['kind'], string> = {
  'no-template': '템플릿 없는 이전 버전 프리셋',
  'decrypt-failed': '열지 못함',
  unreadable: '읽지 못함',
  'not-preset': '프리셋 아님',
};

// In the move's order (runtime/move). The character steps interleave, so each kind reached keeps its own line.
const STEP: Record<MoveStep['kind'], string> = { personas: '페르소나', modules: '모듈', prompts: '프롬프트', characters: '캐릭터', chats: '대화', pictures: '이미지' };
const READING = '백업 읽기';
type Steps = Partial<Record<MoveStep['kind'], MoveStep>>;

type Phase =
  | { kind: 'reading' }
  | { kind: 'failed'; message: string; again: (() => void) | null }
  | { kind: 'picking'; backup: RisuBackup; inlays: Inlays | null; have: Have; can: Ticks; ticks: Ticks }
  | { kind: 'running'; kinds: MoveStep['kind'][]; steps: Steps }
  | { kind: 'done'; backup: BackupCatalog; moved: Moved }
  | { kind: 'filling'; step: FilledInlays | null }
  | { kind: 'filled'; filled: FilledInlays };

// Risu backups dropped or picked, read as one (design F7), with the export of the pictures inside messages when it
// came along; that export alone fills the chats already here instead. aside: other files dropped with them, which are
// not imported.
export function MoveFlow({ files: dropped, aside, onClose }: { files: File[]; aside: number; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const { storage } = useStanding();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const reader = useRef<ImportWorker | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    const source = new ImportWorker();
    reader.current = source;
    void (async () => {
      let sorted: Awaited<ReturnType<typeof sortRisuFiles>>;
      try {
        sorted = await sortRisuFiles(dropped);
      } catch {
        if (live) setPhase({ kind: 'failed', message: '파일을 읽지 못했어요. 다시 가져와 주세요.', again: null });
        return;
      }
      if (!live) return;
      const { backups, inlays } = sorted;
      if (backups.length === 0) {
        source.close();
        return void fill(inlays!);
      }
      const read = await source.backup(backups);
      if (!live) return;
      if (!read.ok) {
        source.close();
        return setPhase({ kind: 'failed', message: FAILURE[read.failure.kind], again: null });
      }
      const have: Have = { characters: broughtFromRisu(store), modules: new Set(modulesFromRisu(store).keys()) };
      const can = tickable(read.backup.catalog, have);
      // Personas and presets carry no Risu id, so once anything was brought they start unticked rather than come twice.
      const ticks = have.characters.size + have.modules.size === 0 ? can : { ...can, personas: can.personas.map(() => false), presets: can.presets.map(() => false) };
      setPhase({ kind: 'picking', backup: read.backup, inlays, have, can, ticks });
    })().catch((error: unknown) => {
      if (!live) return;
      if (!(error instanceof ImportReadError)) throw error;
      source.close();
      setPhase({ kind: 'failed', message: error instanceof ImportStuck ? '백업 파일을 읽다가 멈춰서 그만뒀어요. 파일이 깨졌을 수 있어요.' : '백업 파일을 읽지 못했어요. 다시 가져와 주세요.', again: null });
    });
    return () => {
      live = false;
      source.close();
      reader.current = null;
      stop.current?.abort();
    };
  }, [dropped, store]);

  async function fill(inlays: Inlays) {
    const controller = new AbortController();
    stop.current = controller;
    setPhase({ kind: 'filling', step: null });
    const filled = await fillInlays(store, files, inlays, (step) => {
      if (!controller.signal.aborted) setPhase({ kind: 'filling', step });
    }, controller.signal);
    if (controller.signal.aborted) return;
    setPhase(filled.ok ? { kind: 'filled', filled: filled.data } : { kind: 'failed', message: `채우지 못했어요. ${describeFailure(filled)}`, again: () => void fill(inlays) });
  }

  async function run(backup: RisuBackup, inlays: Inlays | null, ticks: Ticks) {
    const pick = toPick(backup.catalog, ticks);
    const kinds = stepsOf(pick, inlays !== null);
    const source = reader.current!;
    const steps: Steps = {};
    setPhase({ kind: 'running', kinds, steps });
    try {
      const moved = await moveFromRisu(store, files, backup, pick, inlays, (step) => {
        steps[step.kind] = step;
        if (reader.current === source) setPhase({ kind: 'running', kinds, steps: { ...steps } });
      });
      if (reader.current !== source) return;
      if (moved.ok) {
        source.close();
        return setPhase({ kind: 'done', backup: backup.catalog, moved: moved.data });
      }
      // Retries keep landed saves and skip known character/module ids. Personas/presets lack ids, so do not reselect
      // them after progress passed them; reaching characters proves presets finished after their modules.
      const rest = {
        ...ticks,
        ...(Object.keys(steps).some((kind) => kind !== 'personas') && { personas: ticks.personas.map(() => false) }),
        ...(steps.characters && { presets: ticks.presets.map(() => false) }),
      };
      // A retry would stop at once on a full account, so none is offered.
      if (moved.error === 'storage-full') return setPhase({ kind: 'failed', message: '텍스트 저장 공간이 가득 차서 멈췄어요. 멈추기 전까지 가져온 내용은 저장됐어요.', again: null });
      setPhase({ kind: 'failed', message: `저장하지 못했어요. ${describeFailure(moved)}`, again: () => void run(backup, inlays, rest) });
    } catch (error) {
      if (reader.current !== source) return;
      if (!(error instanceof ImportReadError)) throw error;
      source.close();
      setPhase({ kind: 'failed', message: `${error instanceof ImportStuck ? '백업 파일을 읽다가 멈춰서 그만뒀어요.' : '백업 파일을 읽지 못했어요.'} 멈추기 전까지 가져온 내용은 저장됐어요.`, again: null });
    }
  }

  const names = dropped.map((file) => file.name).join(' + ');
  const note = aside > 0 ? `${names} (파일 ${aside}개 제외)` : names;
  const close = (
    <Button variant="secondary" onClick={onClose}>
      닫기
    </Button>
  );

  if (phase.kind === 'filling') {
    const { step } = phase;
    return (
      <Dialog title="메시지 이미지 채우는 중" note={note} onClose={onClose}>
        <Progress hero steps={[{ label: '파일 읽기', finished: true }, step ? { label: '대화', done: step.chats, total: step.total } : { label: '대화' }]} />
      </Dialog>
    );
  }
  if (phase.kind === 'filled') {
    const { pictures, missed, unread } = phase.filled;
    const lines = [...(missed ? moveMissed([{ kind: 'inlay', count: missed }]) : []), ...(unread ? [`읽지 못한 대화 ${unread}개`] : [])];
    return (
      <Dialog title="채웠어요" note={note} onClose={onClose} actions={close}>
        <Stack gap="section">
          <Text>{`이미지 ${pictures}개를 채웠어요`}</Text>
          {lines.length > 0 && <Outcome title="못 채운 것" items={lines.map((title) => ({ title }))} />}
        </Stack>
      </Dialog>
    );
  }
  if (phase.kind === 'reading' || phase.kind === 'running') {
    const stages = phase.kind === 'running' ? phase.kinds.map((kind): ProgressStep => {
      const step = phase.steps[kind];
      return step ? { label: STEP[kind], done: step.done, total: step.total } : { label: STEP[kind] };
    }) : [];
    return (
      <Dialog title={phase.kind === 'reading' ? '백업 읽는 중' : '가져오는 중'} note={note} onClose={() => {}}>
        <Progress hero steps={[{ label: READING, finished: phase.kind === 'running' }, ...stages]} />
      </Dialog>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Dialog
        title="가져오지 못했어요"
        note={note}
        onClose={onClose}
        actions={
          phase.again ? (
            <>
              {close}
              <Button onClick={phase.again}>{ACTS.retry.label}</Button>
            </>
          ) : (
            close
          )
        }
      >
        <Callout tone="warn">{phase.message}</Callout>
        {phase.again && <Text variant="note">다시 시도하면 멈춘 곳부터 이어서 가져와요.</Text>}
      </Dialog>
    );
  }
  if (phase.kind === 'done') {
    return (
      <Dialog title="가져왔어요" note={note} onClose={onClose} actions={close}>
        <Summary {...phase} />
      </Dialog>
    );
  }

  const { backup, inlays, have, can, ticks } = phase;
  const { catalog } = backup;
  const count = tickCount(ticks);
  const room = storage.fileBytesCap === null ? null : Math.max(0, storage.fileBytesCap - storage.fileBytes);
  const pictures = catalog.pictures + (inlays?.count ?? 0);
  const pictureBytes = catalog.pictureBytes + (inlays?.bytes ?? 0);
  const tick = (part: keyof Ticks, next: boolean[]) => setPhase({ ...phase, ticks: { ...ticks, [part]: next } });
  return (
    <Dialog
      title="Risu 백업"
      note={note}
      onClose={onClose}
      actions={
        <Button disabled={count === 0} onClick={() => void run(backup, inlays, ticks)}>
          {`가져오기 ${count}개`}
        </Button>
      }
    >
      <Stack gap="section">
        <Text variant="note">{pictures > 0 ? `이미지 ${pictures}개(${sizeText(pictureBytes)})가 들어 있어요.` : '이미지가 들어 있지 않아요. 이미지를 뺀 백업 파일이라면 전체 백업 파일을 함께 넣어 주세요.'}</Text>
        {room !== null && pictureBytes > room && <Callout tone="warn">{`남은 이미지 저장 공간은 ${sizeText(room)}예요. 용량을 넘는 이미지는 빼고 가져와요.`}</Callout>}
        <Picks
          title="캐릭터"
          rows={catalog.characters.map((character) => ({ label: character.name, note: have.characters.has(character.id) ? '이미 있음' : `대화 ${character.chatCount}개` }))}
          can={can.characters}
          ticks={ticks.characters}
          onChange={(next) => tick('characters', next)}
        />
        <Picks title="페르소나" rows={catalog.personas.map((persona) => ({ label: aliased(persona.name, persona.alias) }))} can={can.personas} ticks={ticks.personas} onChange={(next) => tick('personas', next)} />
        <Picks
          title="프롬프트"
          rows={catalog.presets.map((preset) => ({ label: preset.name, note: preset.failure === null ? undefined : PRESET_FAILURE[preset.failure] }))}
          can={can.presets}
          ticks={ticks.presets}
          onChange={(next) => tick('presets', next)}
        />
        <Picks
          title="모듈"
          rows={catalog.modules.map((module) => ({ label: moduleName(module.name), note: hasModule(have, module.risu) ? '이미 있음' : undefined }))}
          can={can.modules}
          ticks={ticks.modules}
          onChange={(next) => tick('modules', next)}
        />
      </Stack>
    </Dialog>
  );
}

type PicksProps = { title: string; rows: { label: string; note?: string }[]; can: boolean[]; ticks: boolean[]; onChange: (ticks: boolean[]) => void };

function Picks({ title, rows, can, ticks, onChange }: PicksProps) {
  if (rows.length === 0) return null;
  const all = can.every((open, index) => !open || ticks[index]);
  const action = can.filter(Boolean).length > 1 && (
    <Button variant="link" onClick={() => onChange(can.map((open) => open && !all))}>
      {all ? '모두 해제' : '모두 선택'}
    </Button>
  );
  return (
    <Section level={3} title={title} note={`${rows.length}개`} action={action || undefined}>
      <Stack gap="related">
        {rows.map((row, index) => (
          <Checkbox
            key={index}
            label={row.label}
            note={row.note}
            checked={ticks[index]!}
            disabled={!can[index]}
            onChange={(checked) => onChange(ticks.map((ticked, at) => (at === index ? checked : ticked)))}
          />
        ))}
      </Stack>
    </Section>
  );
}

function Summary({ backup, moved }: { backup: BackupCatalog; moved: Moved }) {
  const chats = moved.characters.reduce((sum, character) => sum + character.chats, 0);
  const missed = [
    ...moveMissed(backup.unsupported).map((title) => ({ title })),
    ...moved.characters.flatMap((character) => {
      const lines = [...cardMissed(character.unsupported, character.faceless), ...moveMissed(character.missed)];
      return lines.length ? [{ title: character.name, note: lines.join(' · ') }] : [];
    }),
    ...backup.presets.flatMap((preset) => (preset.failure === null ? [] : [{ title: preset.name, note: `프롬프트 · ${PRESET_FAILURE[preset.failure]}` }])),
    ...moved.modules.flatMap(({ name, unsupported }) => {
      const lines = missedLines(unsupported);
      return lines.length ? [{ title: moduleName(name), note: `모듈 · ${lines.join(' · ')}` }] : [];
    }),
  ];
  const totals = new Map<Unused['kind'], number>();
  for (const item of moved.characters.flatMap((character) => character.unused)) totals.set(item.kind, (totals.get(item.kind) ?? 0) + item.count);
  const notUsed = describeUnused([...totals].map(([kind, count]) => ({ kind, count })));
  return (
    <Stack gap="section">
      <Text>{`캐릭터 ${moved.characters.length}개 · 대화 ${chats}개 · 페르소나 ${moved.personas}개 · 프롬프트 ${moved.prompts}개 · 모듈 ${moved.modules.length}개`}</Text>
      {moved.loreBudget !== null && <Text variant="note">{`Risu에서 정한 ${LORE_BUDGET_LABEL}(${countText(moved.loreBudget)}토큰) 설정도 함께 가져왔어요.`}</Text>}
      {moved.toggles > 0 && <Text variant="note">{`Risu에서 쓰던 토글 값 ${moved.toggles}개도 함께 가져왔어요.`}</Text>}
      {missed.length > 0 && <Outcome title={MISSED} items={missed} />}
      {notUsed && <Text variant="note">{notUsed}</Text>}
    </Stack>
  );
}
