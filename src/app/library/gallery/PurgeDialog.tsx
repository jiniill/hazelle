import { ACTS } from '../../common/acts';
import { ConfirmDialog } from '../../ui';
import { PURGE } from '../../common/words';

// The one removal that asks first: 영구 삭제 cannot be undone, where every other deletion offers 되돌리기.
export function PurgeDialog({ what, onPurge, onClose }: { what: string; onPurge: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog title={`${PURGE}할까요?`} confirm={PURGE} icon={ACTS.remove.icon} onConfirm={onPurge} onClose={onClose}>
      {what} {PURGE}해요. 되돌릴 수 없어요.
    </ConfirmDialog>
  );
}
