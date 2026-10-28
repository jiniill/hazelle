import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useAssetUrl } from '../session';
import { parseScene, sceneText, sentText, type PictureSizes, type SceneInvalid } from '../../engine/illustrate';
import { shown } from '../../model/chat';
import { paragraphsOf, type Scene } from '../../model/illustration';
import type { Shown } from '../../runtime/talk';
import { ACTS } from '../common/acts';
import { moduleName } from '../common/words';
import { describeIllustrateFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { timeOfDay } from '../common/time';
import { Button, Dialog, Failure, IconButton, SceneBoard, StoryPicture, Text, TextField } from '../ui';
import { pagedPicture, type Paged, type PicturePlace } from './picturePlaces';
import { moveFigure, removeFigure } from './sceneEdit';
import type { IllustrationActions, Reshaping } from './useChatIllustrations';

const LABEL = '삽화';

type Props = {
  place: PicturePlace;
  message: Shown;
  // A run under way for the message, which another must wait for.
  running: boolean;
  // 삽화's 기능: off, a picture stays and is drawn again no more.
  draws: boolean;
  sizes: PictureSizes;
  onDraw: IllustrationActions['draw'];
  onDismiss: IllustrationActions['dismissIllustration'];
  onReshape: IllustrationActions['reshape'];
  onDrop: IllustrationActions['dropPicture'];
};

export function ChatPicture({ place, message, running, draws, sizes, onDraw, onDismiss, onReshape, onDrop }: Props) {
  const [paged, setPaged] = useState<Paged>(null);
  const url = useAssetUrl([place, paged]);
  if (place.kind === 'drawing') {
    const { width, height } = sizes[place.scene.shape];
    return <StoryPicture src={undefined} label={LABEL} width={width} height={height} status="그리는 중" />;
  }
  if (place.kind === 'failed') {
    const { failure, version, scene } = place;
    return (
      <Failure
        title={failure.kind === 'costs' ? '유료 이미지 생성' : '삽화 실패'}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={running} onClick={() => onDismiss(message.id, scene)}>
              닫기
            </Button>
            {!draws ? null : failure.kind === 'costs' ? (
              <Button size="sm" disabled={running} onClick={() => onDraw(message.id, version, scene, true)}>
                그래도 생성
              </Button>
            ) : (
              <Button size="sm" disabled={running} onClick={() => onDraw(message.id, version, scene)}>
                {ACTS.retry.label}
              </Button>
            )}
          </>
        }
      >
        {describeIllustrateFailure(failure)}
      </Failure>
    );
  }
  const { pictures } = place;
  const picture = pagedPicture(pictures, paged);
  const { value } = picture;
  // The picture's own version may be one its message's edits replaced since.
  const { id: version, text } = shown(message);
  const { width, height } = 'tool' in value ? value : value.sent;
  // Where it stands now, which the text may have moved since its scene was written.
  const scene = 'tool' in value ? null : { ...value.scene, paragraph: place.paragraph };
  return (
    <StoryPicture
      src={url('illustration', picture.id)}
      label={'tool' in value ? (value.caption ?? LABEL) : LABEL}
      width={width}
      height={height}
      pages={{ at: pictures.indexOf(picture), versions: pictures.map(({ value }) => timeOfDay(value.at)), onPage: (index) => setPaged({ id: pictures[index]!.id, newest: pictures.at(-1)!.id }) }}
      foot={
        <>
          {/* A tool's picture is redrawn by its tool, never here. */}
          {'tool' in value ? (
            <Text variant="note">{`${withParticle(moduleName(value.tool.name), '이/가')} 만든 이미지`}</Text>
          ) : draws && (
            <>
              <IconButton icon={ACTS.regenerate.icon} size="sm" label="다시 그리기" disabled={running} onClick={() => onDraw(message.id, version, scene)} />
              <IconButton icon={SlidersHorizontal} size="sm" label="장면 바꾸기" onClick={() => onReshape({ message: message.id, version, scene: scene!, sent: value.sent, paragraphs: paragraphsOf(text).length })} />
            </>
          )}
          <IconButton icon={ACTS.remove.icon} size="sm" label={ACTS.remove.label} onClick={() => onDrop(picture)} />
        </>
      }
    />
  );
}

const UNREAD: Record<SceneInvalid, (paragraphs: number) => string> = {
  unreadable: () => 'JSON 형식이 맞지 않아요.',
  fields: () => '빠진 항목이 있어요.',
  paragraph: (paragraphs) => `after에는 1부터 ${paragraphs} 사이의 숫자를 입력해야 해요.`,
};

// Reparse edited scene JSON before drawing. Invalid typed JSON keeps the last valid scene visible.
export function SceneDialog({ reshaping, sizes, onDraw, onClose }: { reshaping: Reshaping; sizes: PictureSizes; onDraw: IllustrationActions['draw']; onClose: () => void }) {
  const [scene, setScene] = useState(reshaping.scene);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const text = typed ?? sceneText(scene);
  const changed = sceneText(scene) !== sceneText(reshaping.scene);
  function type(value: string) {
    setTyped(value);
    const read = parseScene(value, reshaping.paragraphs);
    if (read.ok) setScene(read.scene);
  }
  function place(next: Scene) {
    setScene(next);
    setTyped(null);
    setError(undefined);
  }
  function submit() {
    const read = parseScene(text, reshaping.paragraphs);
    if (!read.ok) return setError(UNREAD[read.reason](reshaping.paragraphs));
    onDraw(reshaping.message, reshaping.version, read.scene);
    onClose();
  }
  const { width, height } = sizes[scene.shape];
  return (
    <Dialog
      title="장면 바꾸기"
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit">
          다시 그리기
        </Button>
      }
    >
      {scene.characters.length > 0 && (
        <SceneBoard
          label="인물 위치"
          help="끌거나 방향키로 옮기면 그 자리에 그려요. ×로 뺀 인물은 그리지 않아요."
          width={width}
          height={height}
          figures={scene.characters}
          onMove={(index, x, y) => place(moveFigure(scene, index, x, y))}
          onRemove={(index) => place(removeFigure(scene, index))}
        />
      )}
      <TextField label="장면" kind="key" lines={14} value={text} onChange={type} error={error} help="after는 삽화가 들어갈 문단 번호이고, 나머지는 Danbooru 태그예요." />
      <TextField label={changed ? '지난번에 보낸 태그' : '보낸 태그'} kind="key" lines={6} readOnly value={sentText(reshaping.scene, reshaping.sent)} onChange={() => {}} help="이름이 프로필과 같은 인물은 외모와 옷을 프로필의 태그로 바꿔 보내요." />
    </Dialog>
  );
}
