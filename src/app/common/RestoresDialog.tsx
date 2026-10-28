import { History, Play, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BEFORE_ARMED, SELF_RESTORES_PER_DAY, type RestoreAction, type RestoreError, type RestorePhase } from '../../contracts/admin';
import type { ServerError } from '../../contracts/http';
import type { ApiResult } from '../../runtime/api';
import { beginRestore, continueRestore, readPoints, readRestores, type Restore, type RestorePoint, type RestoreRun } from '../../runtime/restores';
import { ago, moment } from './time';
import { useAttempt } from './useAttempt';
import { useLoaded } from './useLoaded';
import { useToast } from '../toast';
import { ConfirmDialog, Dialog, Empty, List, ListItem, MenuItem, MoreMenu, Section, Stack, Text } from '../ui';

// The account the operator acts on, with the operator-only post a new restore or an undo answers (null when opened
// from the account, which only continues one). The signed-in account's own restores have none of it.
export type Operated = { accountId: string; username: string; post: { id: number; text: string } | null };

type Words = { tag: string; says: string };
const UNCHANGED = '계정 데이터는 바뀌지 않았어요.';
const PHASES: Record<Exclude<RestorePhase, 'done'>, Words> = {
  begun: { tag: '시작함', says: `복원을 시작했어요. ${UNCHANGED}` },
  fenced: { tag: '저장 차단', says: `계정에 데이터를 저장하거나 읽지 못하게 잠갔어요. ${UNCHANGED}` },
  checkpointed: { tag: '스냅샷 저장', says: `복원하기 직전 상태를 스냅샷으로 저장했어요. ${UNCHANGED}` },
  targeted: { tag: '시점 지정', says: `복원할 시점을 지정했어요. ${UNCHANGED} 이 단계까지는 취소할 수 있어요.` },
  armed: { tag: '복원 적용 중', says: '복원을 적용했어요. 이제는 취소할 수 없어요.' },
  rewound: { tag: '복원함', says: '데이터를 복원했어요. 계정을 다시 열면 모든 과정이 끝나요.' },
  failed: { tag: '실패', says: '복원하지 못하고 멈췄어요. 계정은 복원하기 전 상태 그대로예요.' },
  cancelled: { tag: '취소함', says: '복원을 취소했어요. 계정은 복원하기 전 상태 그대로예요.' },
};
const DONE: Words = { tag: '완료', says: '복원을 마치고 계정을 다시 열었어요.' };
const UNVERIFIED: Words = { tag: '확인 필요', says: '복원은 끝났지만 계정이 다시 열렸는지 확인하지 못했어요. 마무리 확인을 진행해 주세요.' };
const wordsOf = ({ phase, verified }: RestoreRun): Words => (phase === 'done' ? (verified ? DONE : UNVERIFIED) : PHASES[phase]);
const says = (run: RestoreRun) => `${wordsOf(run).says}${run.error === null ? '' : ` 오류: ${restoreError(run.error)}`}`;

// A stored code this build does not know shows as the server wrote it.
const ERRORS: Record<RestoreError, string> & Partial<Record<string, string>> = {
  'too-early': '저장소에 그 시각의 기록이 없어요. 그보다 더 늦은 시각으로 새로 복원해 주세요.',
  'store-unavailable': '계정의 저장소나 스냅샷을 읽지 못했어요. 잠시 뒤에 이어서 진행해 주세요.',
  'not-rewound': '저장소가 아직 그 시점으로 돌아가지 않았어요. 잠시 뒤에 이어서 진행해 주세요.',
  'not-verified': '계정이 아직 다시 열리지 않았어요. 잠시 뒤에 마무리 확인을 진행해 주세요.',
  stuck: '같은 단계가 계속 반복돼서 멈췄어요.',
};
export const restoreError = (code: string) => ERRORS[code] ?? code;
const REFUSED: Partial<Record<ServerError, string>> = {
  'bad-post': "해당 계정이 작성한 '운영자에게만' 글에서만 복원할 수 있어요.",
  'too-many-restores': `복원은 하루에 최대 ${SELF_RESTORES_PER_DAY}번까지 할 수 있어요.`,
  'bad-time': '10분 전부터 6일 전 사이의 시점으로만 복원할 수 있어요.',
  'cannot-undo': '가장 최근에 한 복원만, 끝난 뒤 7일 안에 한 번 되돌릴 수 있어요.',
  'account-busy': '이미 다른 복원이나 탈퇴가 진행 중이에요.',
  'cannot-cancel': '이미 복원이 적용돼서 취소할 수 없어요. 이어서 하기를 눌러 끝까지 완료해 주세요.',
};

const ENDED: RestorePhase[] = ['done', 'failed', 'cancelled'];

// Poll phase each second while the request runs: the server answers only when the operation stops/finishes.
// At most one operation is open per account.
function useUnderWay(whose: string | null, busy: boolean): RestoreRun | null {
  const [run, setRun] = useState<RestoreRun | null>(null);
  useEffect(() => {
    if (!busy) {
      setRun(null);
      return;
    }
    let live = true;
    const timer = setInterval(() => {
      void readRestores(whose).then((answer) => {
        if (live && answer.ok) setRun(answer.data.find(({ phase }) => !ENDED.includes(phase)) ?? null);
      });
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [whose, busy]);
  return run;
}

const ACTIONS: Record<RestoreAction, { label: string; sub: string }> = {
  resume: { label: '이어서 하기', sub: '멈춘 단계부터 이어서 진행해요' },
  cancel: { label: '취소', sub: '계정을 복원하기 전 상태로 다시 열어요' },
  finalize: { label: '마무리 확인', sub: '계정이 다시 열렸는지 확인해요' },
};

function described(restore: Restore): string {
  const undo = restore.canUndo && restore.undoExpiresAt !== null ? ` ${moment(restore.undoExpiresAt)}까지 복원하기 전 상태로 되돌릴 수 있어요.` : '';
  return `${says(restore)}${undo}`;
}

type Asking = { kind: 'restore'; point: RestorePoint } | { kind: 'undo'; restore: Restore } | { kind: 'resume'; restore: Restore };

export function RestoresDialog({ operated, onClose, onActed }: { operated: Operated | null; onClose: () => void; onActed?: () => void }) {
  const whose = operated?.accountId ?? null;
  const subject = operated ? `${operated.username} 계정` : '계정';
  const post = operated?.post?.id;
  // The operator begins one only on a post; the account itself always may.
  const begins = operated === null || operated.post !== null;
  const toast = useToast();
  const restores = useLoaded(() => readRestores(whose));
  const points = useLoaded(() => (begins ? readPoints(whose) : Promise.resolve({ ok: true as const, data: [] })));
  const [asking, setAsking] = useState<Asking | null>(null);
  const { busy, run } = useAttempt();
  const underWay = useUnderWay(whose, busy);
  // The confirm dialog's text: the warning, and once the operation is seen under way, its phase.
  const standing = (warning: string) => (underWay ? `${wordsOf(underWay).tag} · ${wordsOf(underWay).says}` : warning);

  // The server runs it in the request and the operation keeps its phase if the page goes, so the request is not stopped
  // when the dialog closes; the toast tells where it ended.
  const go = (request: () => Promise<ApiResult<RestoreRun>>) =>
    run(async () => {
      const answer = await request();
      setAsking(null);
      if (!answer.ok) {
        toast.failed(answer, `${subject}을 복원하지 못했어요.`, REFUSED);
        return null;
      }
      const ended = answer.data;
      if (ended.phase === 'done' && ended.verified) toast.show(`${subject}의 복원을 끝냈어요.`);
      else if (ended.phase === 'cancelled') toast.show(`${subject}의 복원을 취소했어요.`);
      else toast.error(`${subject}의 복원이 '${wordsOf(ended).tag}'에서 멈췄어요.`, { detail: says(ended) });
      restores.reload();
      points.reload();
      onActed?.();
      return null;
    });

  // Up to targeted nothing has changed, so resuming from there arms the restore, which cannot be taken back.
  const act = (restore: Restore, action: RestoreAction) =>
    action === 'resume' && BEFORE_ARMED.includes(restore.phase) ? setAsking({ kind: 'resume', restore }) : void go(() => continueRestore(whose, restore.id, action));

  if (asking?.kind === 'restore') {
    return (
      <ConfirmDialog title={`${subject}을 ${moment(asking.point.takenAt)} 기록으로 복원할까요?`} confirm="복원" icon={History} busy={busy} onConfirm={() => void go(() => beginRestore(whose, { post, at: asking.point.at }))} onClose={() => setAsking(null)}>
        {standing('그 기록 이후에 저장한 내용은 모두 사라져요. 복원하는 동안에는 계정을 쓸 수 없고, 7일 안에는 복원 전으로 되돌릴 수 있어요.')}
      </ConfirmDialog>
    );
  }
  if (asking?.kind === 'undo') {
    return (
      <ConfirmDialog title={`${subject}을 복원 전으로 되돌릴까요?`} confirm="복원 전으로 되돌리기" icon={Undo2} busy={busy} onConfirm={() => void go(() => beginRestore(whose, { post, undoes: asking.restore.id }))} onClose={() => setAsking(null)}>
        {standing('복원한 뒤에 새로 저장한 내용은 모두 사라져요.')}
      </ConfirmDialog>
    );
  }
  if (asking?.kind === 'resume') {
    return (
      <ConfirmDialog title="복원을 이어서 진행할까요?" confirm="이어서 하기" icon={Play} busy={busy} onConfirm={() => void go(() => continueRestore(whose, asking.restore.id, 'resume'))} onClose={() => setAsking(null)}>
        {standing('한 번 적용하면 취소할 수 없고, 복원 시점 이후에 저장한 내용은 모두 사라져요.')}
      </ConfirmDialog>
    );
  }

  return (
    <Dialog title={operated ? `${operated.username} 복원` : '복원'} onClose={onClose}>
      <Stack gap="group">
        {operated?.post && <Text variant="prose">{operated.post.text}</Text>}
        {begins && (
          <Section level={3} title="복원할 기록" help="텍스트와 캐릭터, 채팅, 설정을 그때의 기록으로 되돌려요.">
            {points.loading}
            {points.failure}
            {points.data && points.data.length === 0 && <Empty variant="section">복원할 수 있는 기록이 없어요.</Empty>}
            {points.data && points.data.length > 0 && (
              <List label="복원할 기록">
                {points.data.map((point) => (
                  <ListItem
                    key={point.at}
                    title={`${moment(point.takenAt)} 기록`}
                    tags={point.kind === 'checkpoint' ? ['복원 직전'] : undefined}
                    note={ago(point.takenAt)}
                    onClick={() => setAsking({ kind: 'restore', point })}
                  />
                ))}
              </List>
            )}
          </Section>
        )}
        <Section level={3} title="복원 기록" help={begins ? undefined : "복원은 해당 계정이 작성한 '운영자에게만' 글에서 시작할 수 있어요."}>
          {restores.loading}
          {restores.failure}
          {restores.data && restores.data.length === 0 && <Empty variant="section">아직 복원한 기록이 없어요.</Empty>}
          {restores.data && restores.data.length > 0 && (
            <List label="복원 기록">
              {restores.data.map((restore) => {
                const undoable = restore.canUndo && begins;
                return (
                  <ListItem
                    key={restore.id}
                    title={restore.at === null ? '복원 전으로 되돌리기' : `${moment(restore.targetAt ?? restore.at)} ${restore.targetAt === null ? '시점' : '기록'}으로 복원`}
                    tags={operated && restore.postId === null ? [wordsOf(restore).tag, '직접 복원'] : [wordsOf(restore).tag]}
                    description={described(restore)}
                    note={ago(restore.updatedAt)}
                    trailing={
                      (restore.actions.length > 0 || undoable) && (
                        <MoreMenu of="복원">
                          {restore.actions.map((action) => (
                            <MenuItem key={action} icon={action === 'cancel' ? X : Play} label={ACTIONS[action].label} sub={ACTIONS[action].sub} onClick={() => act(restore, action)} />
                          ))}
                          {undoable && <MenuItem icon={Undo2} label="복원 전으로 되돌리기" sub="복원 시점 이후에 저장한 내용은 모두 사라져요" tone="warn" onClick={() => setAsking({ kind: 'undo', restore })} />}
                        </MoreMenu>
                      )
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </Stack>
    </Dialog>
  );
}
