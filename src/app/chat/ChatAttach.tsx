import { FilePlus, ImagePlus, Paperclip } from 'lucide-react';
import { Menu, MenuItem, pickFiles, ToolButton } from '../ui';
import { NO_PICTURES, UNKNOWN_PICTURES } from '../common/words';
import type { RowTool } from './ChatToolRow';

const PICTURES = 'image/*';
const MOVED = '가져온 이미지도 보내기';

type Props = {
  sees: boolean | null;
  // null: the chat holds no picture brought from Risu, so there is nothing to switch.
  moved: boolean | null;
  onAttach: (files: File[]) => void;
  onMoved: (on: boolean) => void;
};

export const attachTool = (props: Props): RowTool => ({ key: 'attach', label: '첨부', icon: Paperclip, live: props.moved === true, node: <ChatAttach {...props} />, open: <AttachItems {...props} /> });

function ChatAttach(props: Props) {
  const { moved } = props;
  return (
    <Menu place="above-start" label="첨부" trigger={(opener) => <ToolButton icon={Paperclip} label="첨부" phone="icon" wide="icon" mark={moved ? { kind: 'dot' } : undefined} detail={moved ? `${MOVED} 켜짐` : undefined} {...opener} />}>
      <AttachItems {...props} />
    </Menu>
  );
}

function AttachItems({ sees, moved, onAttach, onMoved }: Props) {
  return (
    <>
      <MenuItem icon={ImagePlus} label="이미지 추가" description={sees === false ? NO_PICTURES : sees === null ? UNKNOWN_PICTURES : undefined} disabled={sees === false} onClick={() => pickFiles(PICTURES, true, onAttach)} />
      <MenuItem icon={FilePlus} label="텍스트 파일 추가" onClick={() => pickFiles('', true, onAttach)} />
      {moved !== null && <MenuItem label={MOVED} description="Risu에서 가져온 이미지예요. 보낼 때마다 토큰이 들어요." checked={moved} multiple onClick={() => onMoved(!moved)} />}
    </>
  );
}
