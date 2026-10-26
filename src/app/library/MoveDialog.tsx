import { useState, type ReactNode } from 'react';
import { ACTS, importOf } from '../common/acts';
import { useCopy } from '../common/useCopy';
import { Button, Dialog, Disclosure, FileButton, Row, Section, Stack, Text } from '../ui';
import { INLAY_BOOKMARK, INLAY_EXPORT } from './inlayExport';

// Risu에서 이사: says which Risu files to get and takes them, the text's, for an account user the full backup that holds
// the pictures (design F7), and the export of the pictures inside messages. That export alone fills the chats already
// here (메시지 이미지 채우기). MoveFlow tells the files apart by what they hold.
export function MoveDialog({ onRead, onClose }: { onRead: (files: File[]) => void; onClose: () => void }) {
  const copy = useCopy();
  const [text, setText] = useState<File | null>(null);
  const [pictures, setPictures] = useState<File | null>(null);
  const [inlays, setInlays] = useState<File | null>(null);
  return (
    <Dialog
      title="Risu에서 이사"
      onClose={onClose}
      actions={
        <Button disabled={text === null && inlays === null} onClick={() => onRead(text ? [text, pictures, inlays].filter((file) => file !== null) : [inlays!])}>
          {text === null && inlays !== null ? '메시지 이미지 채우기' : '백업 읽기'}
        </Button>
      }
    >
      <Stack gap="section">
        <Text>캐릭터와 채팅, 페르소나, 프롬프트, 모듈을 가져와요. HypaPlus, LIBRA 같은 장기 기억 플러그인이 쌓은 기억은 옮겨지지 않아요.</Text>
        <Slot
          title="백업 파일"
          note="Risu의 '로컬 백업 저장'이나 PocketRisu의 '로컬 백업 다운로드'로 받은 파일이에요. risuai.xyz에서 쓰면 '부분 백업'으로 받아 주세요."
          help="모델·메모리 프리셋과 캐릭터 비활성 표시는 옮겨지지 않아요. '원본 리스용 백업 내보내기' 파일에는 메시지 속 이미지도 빠져요."
          file={text}
          onFile={setText}
        />
        <Slot
          title="이미지가 든 전체 백업"
          note="risuai.xyz에서 쓸 때만 넣어요. 고급 설정에서 'Skip Saving Assets on Web Sync'를 끄고 받아야 이미지가 들어 있어요."
          file={pictures}
          onFile={setPictures}
        />
        <Disclosure label="메시지 속 이미지도 옮기기">
          <Slot
            title="메시지 속 이미지"
            note="Risu 웹에서 F12를 눌러 콘솔에 코드를 붙여 넣으면 risu-inlays.bin 파일을 받아요. 이미 옮긴 채팅에 이미지를 채울 때는 이 파일만 넣으면 돼요. PocketRisu 백업에는 이미 들어 있어요."
            help="콘솔에서 붙여 넣기가 막히면 allow pasting을 먼저 입력해 주세요. 북마크로 쓰려면 새 북마크의 URL에 주소를 넣고 Risu 웹 화면에서 누르면 돼요."
            file={inlays}
            onFile={setInlays}
          >
            <Row kind="toolbar">
              <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(INLAY_EXPORT)}>
                코드 복사
              </Button>
              <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(INLAY_BOOKMARK)}>
                북마크 주소 복사
              </Button>
            </Row>
          </Slot>
        </Disclosure>
      </Stack>
    </Dialog>
  );
}

function Slot({ title, note, help, file, onFile, children }: { title: string; note: string; help?: string; file: File | null; onFile: (file: File) => void; children?: ReactNode }) {
  return (
    <Section level={3} title={title} help={help}>
      <Stack gap="related">
        <Text variant="note">{note}</Text>
        {children}
        <FileButton accept=".bin" size="sm" icon={ACTS.import.icon} onFiles={([file]) => onFile(file!)}>
          {file ? file.name : importOf('파일')}
        </FileButton>
      </Stack>
    </Section>
  );
}
