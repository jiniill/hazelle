import { Ban, HardDrive, History, LockOpen, Send } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import type { AccountState } from '../../contracts/admin';
import type { ApiResult } from '../../runtime/api';
import { liftSuspension, removeAccount, sendNotice, suspend, type AdminAccount, type OwnCap } from '../../runtime/admin';
import { ACTS } from '../common/acts';
import { sizeText } from '../common/size';
import { monthDay } from '../common/time';
import { count } from '../common/typedNumber';
import { SeeAll } from '../common/useLoaded';
import { NOTICES, UNKNOWN } from '../common/words';
import { RestoresDialog } from '../common/RestoresDialog';
import { useSession } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Button, ConfirmDialog, Empty, MenuItem, MoreMenu, Panel, Table, Tag, type TableColumn } from '../ui';
import { CapsDialog } from './CapsDialog';
import { NoticeDialog } from './NoticeDialog';
import type { useAccounts } from './useAccounts';

const STATES: Record<AccountState, string | null> = { active: null, restoring: '복원 중', leaving: '탈퇴 중' };

const size = (bytes: number | null) => (bytes === null ? UNKNOWN : sizeText(bytes));
const held = (bytes: number | null, cap: OwnCap) => `${size(bytes)}${cap === 'default' ? '' : ` / ${cap === null ? '한도 없음' : sizeText(cap)}`}`;

// 텍스트 and 이미지 are fill columns: an account's own cap is read beside its size. They come before the figures, set
// right, so a left-set column never starts where a right-set one ends.
const COLUMNS: TableColumn[] = [
  { label: '계정', track: 'fill' },
  { label: '텍스트', track: 'fill' },
  { label: '이미지', track: 'fill' },
  { label: '디스크', track: 'figure' },
  { label: '가입', track: 'figure' },
  { label: '', track: 'button', keep: true },
];

const COLUMNS_HELP = '텍스트는 계정에 저장된 데이터의 크기이고, 디스크는 그 데이터가 서버에서 실제로 차지하는 용량이에요.';

// total: every account, leaving ones too, as the rows count them; null while the service is not read.
export function AccountsSection({ loaded, total, onActed, children }: { loaded: ReturnType<typeof useAccounts>; total: number | null; onActed: () => void; children?: ReactNode }) {
  const { username: own } = useSession();
  const toast = useToast();
  const { rows, head } = loaded;
  const [removing, setRemoving] = useState<AdminAccount | null>(null);
  const [capping, setCapping] = useState<AdminAccount | null>(null);
  const [writing, setWriting] = useState<{ account: AdminAccount; suspend: boolean } | null>(null);
  const [restoring, setRestoring] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false);

  function acted(id?: string) {
    loaded.acted(id);
    onActed();
  }

  async function act(id: string, done: Promise<ApiResult<undefined>>, failed: string) {
    const answer = await done;
    if (!answer.ok) return toast.failed(answer, failed);
    acted(id);
  }

  async function remove(account: AdminAccount) {
    setBusy(true);
    await act(account.accountId, removeAccount(account.accountId), account.state === 'leaving' ? `${account.username} 계정의 탈퇴 처리를 끝내지 못했어요.` : `${account.username} 계정을 삭제하지 못했어요.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <Panel
      title="계정"
      note={total === null ? undefined : `${count(total)}명`}
      action={
        // Not hidden when the head is whole: it holds only the flagged accounts, and every other one is behind this door.
        head ? (
          <SeeAll onClick={() => navigate({ kind: 'admin-list', list: 'accounts' })} />
        ) : (
          <Button variant="ghost" busy={loaded.busy} onClick={loaded.reload}>새로고침</Button>
        )
      }
      help={head ? `정지됐거나 복원·탈퇴 중인 계정만 여기에 보여요. ${COLUMNS_HELP}` : COLUMNS_HELP}
    >
      {loaded.loading}
      {loaded.failure}
      {/* Only the head can be empty: the whole list holds the operator's own account. */}
      {rows && rows.length === 0 && <Empty variant="section">확인할 계정이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <Table
          label="계정"
          columns={COLUMNS}
          rows={rows.map((account) => {
            const state = STATES[account.state];
            const others = account.username !== own;
            const tags = [...(others ? [] : ['운영자']), ...(state ? [state] : []), ...(account.suspended ? ['정지됨'] : [])];
            return {
              key: account.accountId,
              summary: `텍스트 ${held(account.bytes, account.bytesCap)} · 이미지 ${held(account.fileBytes, account.fileBytesCap)} · 디스크 ${size(account.disk)} · ${monthDay(account.createdAt)} 가입`,
              cells: [
                <>
                  {account.username}
                  {tags.map((tag) => (
                    <Fragment key={tag}>
                      {' '}
                      <Tag>{tag}</Tag>
                    </Fragment>
                  ))}
                </>,
                held(account.bytes, account.bytesCap),
                held(account.fileBytes, account.fileBytesCap),
                size(account.disk),
                monthDay(account.createdAt),
                <MoreMenu of={account.username}>
                  {account.state === 'leaving' ? (
                    <MenuItem icon={ACTS.remove.icon} label="탈퇴 마무리" sub="중단된 탈퇴 처리를 끝내요" tone="warn" onClick={() => setRemoving(account)} />
                  ) : (
                    <>
                      <MenuItem icon={HardDrive} label="저장 한도" onClick={() => setCapping(account)} />
                      <MenuItem icon={History} label="복원 기록" onClick={() => setRestoring(account)} />
                      {others && <MenuItem icon={Send} label={NOTICES.send} onClick={() => setWriting({ account, suspend: false })} />}
                      {others &&
                        (account.suspended ? (
                          <MenuItem icon={LockOpen} label="정지 해제" onClick={() => void act(account.accountId, liftSuspension(account.accountId), `${account.username} 계정의 정지를 해제하지 못했어요.`)} />
                        ) : (
                          <MenuItem icon={Ban} label="정지" sub="읽기와 백업, 알림 확인, 탈퇴만 할 수 있어요" onClick={() => setWriting({ account, suspend: true })} />
                        ))}
                      {others && account.state === 'active' && <MenuItem icon={ACTS.remove.icon} label="계정 삭제" tone="warn" onClick={() => setRemoving(account)} />}
                    </>
                  )}
                </MoreMenu>,
              ],
            };
          })}
        />
      )}
      {loaded.more}
      {children}
      {capping && (
        <CapsDialog
          account={capping}
          onClose={() => setCapping(null)}
          onSaved={() => {
            setCapping(null);
            acted(capping.accountId);
          }}
        />
      )}
      {writing &&
        (writing.suspend ? (
          <NoticeDialog
            title={`${writing.account.username} 계정을 정지할까요?`}
            label="정지 이유"
            placeholder="이 내용은 알림으로 전달돼요."
            confirm={{ label: '정지', icon: Ban }}
            send={(reason) => suspend(writing.account.accountId, reason)}
            onSent={() => {
              setWriting(null);
              acted(writing.account.accountId);
            }}
            onClose={() => setWriting(null)}
          />
        ) : (
          <NoticeDialog
            title={`${writing.account.username}에게 ${NOTICES.send}`}
            label="보낼 내용"
            confirm={{ label: '보내기', icon: Send }}
            send={(text) => sendNotice(writing.account.accountId, text)}
            onSent={() => {
              setWriting(null);
              toast.show(`${writing.account.username}에게 보냈어요.`);
              onActed();
            }}
            onClose={() => setWriting(null)}
          />
        ))}
      {removing &&
        (removing.state === 'leaving' ? (
          <ConfirmDialog title={`${removing.username} 계정의 탈퇴 처리를 끝낼까요?`} confirm="마무리" icon={ACTS.remove.icon} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            남은 데이터를 모두 삭제하고 계정을 완전히 삭제해요. 이 작업은 되돌릴 수 없어요.
          </ConfirmDialog>
        ) : (
          <ConfirmDialog title={`${removing.username} 계정을 삭제할까요?`} confirm={ACTS.remove.label} icon={ACTS.remove.icon} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            계정과 그 안에 저장된 모든 데이터를 삭제해요. 이 작업은 되돌릴 수 없어요.
          </ConfirmDialog>
        ))}
      {restoring && (
        <RestoresDialog
          key={restoring.accountId}
          operated={{ accountId: restoring.accountId, username: restoring.username, post: null }}
          onClose={() => setRestoring(null)}
          onActed={() => acted(restoring.accountId)}
        />
      )}
    </Panel>
  );
}
