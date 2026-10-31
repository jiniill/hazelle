import { setCacheNoteHidden } from '../../runtime/chat-context';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { SettingRow, Switch } from '../ui';

export function CacheNoteRow() {
  const store = useStore();
  const toast = useToast();
  const { cacheNoteHidden } = useSettings();
  return (
    <SettingRow
      label="캐시 표시"
      help="보내기 버튼 옆에 남은 시간과 경고를 보여 줘요. 꺼도 캐시는 그대로 쓰고, 점검에서 볼 수 있어요."
      changed={cacheNoteHidden !== undefined}
      control={<Switch label="캐시 표시" checked={cacheNoteHidden === undefined} onChange={(on) => void setCacheNoteHidden(store, !on).then((result) => result.ok || toast.failed(result))} />}
    />
  );
}
