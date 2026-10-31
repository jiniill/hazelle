import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_POST_PICTURES, type Post } from '../../contracts/board';
import { addPostPicture, deletePostPicture, readPostPicture } from '../../runtime/board';
import { postedPicture } from '../../runtime/picture';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { PICTURE_NOTE } from '../common/words';
import { useAccount, useStanding } from '../session';
import { Attachments, type Attached, Callout, ConfirmDialog, FileButton, Row, Stack, Text } from '../ui';

const UNREADABLE = '이 사진은 올릴 수 없어요.';
const label = (index: number) => `사진 ${index + 1}`;
const shown = (key: string, url: string, index: number): Attached => ({ key, url, label: label(index), kind: 'picture', state: 'saved' });

type Draft = { key: string; url: string; bytes: Uint8Array<ArrayBuffer> };

// Pictures of a post still being written, sent once it stands.
export function useDraftPictures() {
  const [items, setItems] = useState<Draft[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const held = useRef(items);
  held.current = items;
  useEffect(() => () => held.current.forEach(({ url }) => URL.revokeObjectURL(url)), []);
  const add = async (files: File[]) => {
    const drawn = await Promise.all(files.slice(0, MAX_POST_PICTURES - items.length).map(postedPicture));
    const fit = drawn.flatMap((picture) => (picture ? [{ key: crypto.randomUUID(), url: URL.createObjectURL(new Blob([picture.bytes], { type: picture.type })), bytes: picture.bytes }] : []));
    setFailure(fit.length < drawn.length ? UNREADABLE : null);
    setItems((now) => [...now, ...fit]);
  };
  const remove = (key: string) => {
    URL.revokeObjectURL(items.find((item) => item.key === key)!.url);
    setItems((now) => now.filter((item) => item.key !== key));
  };
  return { items, failure, add, remove };
}

function AddPicture({ count, busy, onFiles }: { count: number; busy: boolean; onFiles: (files: File[]) => void }) {
  return (
    <>
      <Row kind="toolbar">
        <FileButton accept="image/*" multiple size="sm" icon={ImagePlus} busy={busy} disabled={count >= MAX_POST_PICTURES} onFiles={onFiles}>
          사진 추가
        </FileButton>
      </Row>
      <Text variant="note">{PICTURE_NOTE}</Text>
    </>
  );
}

export function DraftPictures({ pictures }: { pictures: ReturnType<typeof useDraftPictures> }) {
  return (
    <Stack gap="related">
      <Attachments opens items={pictures.items.map(({ key, url }, index) => shown(key, url, index))} onRemove={pictures.remove} />
      <AddPicture count={pictures.items.length} busy={false} onFiles={(files) => void pictures.add(files)} />
      {pictures.failure && <Callout tone="warn">{pictures.failure}</Callout>}
    </Stack>
  );
}

// Read with the session's headers, which an <img src> cannot carry.
function usePictureUrls({ id, pictures }: Post) {
  const [urls, setUrls] = useState<{ id: number; url: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = pictures.map((picture) => picture.id).join();
  useEffect(() => {
    let stopped = false;
    const made: string[] = [];
    void Promise.all(pictures.map((picture) => readPostPicture(id, picture.id))).then((read) => {
      if (stopped) return;
      setFailed(read.some((answer) => !answer.ok));
      setUrls(
        read.flatMap((answer, index) => {
          if (!answer.ok) return [];
          const url = URL.createObjectURL(new Blob([answer.data], { type: pictures[index]!.type }));
          made.push(url);
          return [{ id: pictures[index]!.id, url }];
        }),
      );
    });
    return () => {
      stopped = true;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [id, asked]);
  return { urls, failed };
}

export function PostPictures({ post, reload }: { post: Post; reload: () => void }) {
  const { guest } = useAccount();
  const { suspended } = useStanding();
  const { urls, failed } = usePictureUrls(post);
  const { busy, failure, run } = useAttempt();
  const [removing, setRemoving] = useState<number | null>(null);
  const mine = post.author.mine && !guest;
  const adds = mine && post.visibility === 'operator' && post.text !== null && !post.locked && !suspended;
  if (!adds && !post.pictures.length) return null;

  const add = (files: File[]) =>
    run(async () => {
      for (const file of files.slice(0, MAX_POST_PICTURES - post.pictures.length)) {
        const picture = await postedPicture(file);
        if (!picture) return UNREADABLE;
        const added = await addPostPicture(post.id, picture.bytes);
        if (!added.ok) return describeFailure(added);
      }
      reload();
      return null;
    });

  const remove = (picture: number) =>
    run(async () => {
      const removed = await deletePostPicture(post.id, picture);
      setRemoving(null);
      if (!removed.ok) return describeFailure(removed);
      reload();
      return null;
    });

  return (
    <Stack gap="related">
      {urls === null && post.pictures.length > 0 && <Text variant="note">사진을 불러오는 중…</Text>}
      {failed && <Callout tone="warn">사진을 불러오지 못했어요.</Callout>}
      <Attachments opens items={(urls ?? []).map(({ id, url }, index) => shown(String(id), url, index))} onRemove={mine ? (key) => setRemoving(Number(key)) : undefined} />
      {adds && <AddPicture count={post.pictures.length} busy={busy} onFiles={(files) => void add(files)} />}
      {failure && <Callout tone="warn">{failure}</Callout>}
      {removing !== null && (
        <ConfirmDialog title="사진을 삭제할까요?" confirm={ACTS.remove.label} icon={ACTS.remove.icon} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
          삭제하면 되돌릴 수 없어요.
        </ConfirmDialog>
      )}
    </Stack>
  );
}
