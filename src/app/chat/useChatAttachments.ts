import { useSyncExternalStore } from 'react';
import { seesPictures } from '../../connectors/types';
import { SIGNATURE } from '../../engine/assets';
import type { Chat } from '../../model/chat';
import { without } from '../../model/fields';
import type { Route, RouteFailure } from '../../runtime/assignment';
import { seesPicturesNow } from '../../runtime/connections';
import { addDraftFile, addDraftPicture, TEXT_FILE_BYTES } from '../../runtime/attachments';
import { NO_PICTURES, UNKNOWN_PICTURES } from '../common/words';
import { useChildren, useSession } from '../session';
import { useToast } from '../toast';

// sees null is unknown and asks on next attachment; moved null means no imported pictures to opt in.
export function useChatAttachments(id: string | null, key: string, chat: Chat, route: Route | RouteFailure) {
  const session = useSession();
  const { drafts, store } = session;
  const toast = useToast();
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.attachments(key));
  const brought = useChildren('inlay', id).some(({ value }) => !value.attached && value.type !== SIGNATURE);
  const sees = 'kind' in route ? false : route.model.input === null && !route.model.pictures ? null : seesPictures(route.model);

  // A picture by its type, since the browser names every picture it draws; any other file is taken as text.
  async function attach(files: File[]) {
    const pictures = files.filter(({ type }) => type.startsWith('image/'));
    const texts = files.filter((file) => !pictures.includes(file));
    const added = await Promise.all(texts.map((file) => addDraftFile(session, key, file)));
    const large = added.filter((result) => result === 'too-large').length;
    const binary = added.filter((result) => result === 'not-text').length;
    if (large) toast.show(`${TEXT_FILE_BYTES / 1024}KB가 넘는 파일 ${large}개는 넣지 않았어요.`);
    if (binary) toast.show(`텍스트가 아닌 파일 ${binary}개는 넣지 않았어요.`);
    if (!pictures.length) return;
    if ('kind' in route || !(await seesPicturesNow(session, route))) return toast.show(sees === null ? UNKNOWN_PICTURES : NO_PICTURES);
    const drawn = await Promise.all(pictures.map((file) => addDraftPicture(session, key, file)));
    const refused = drawn.filter((ok) => !ok).length;
    if (refused) toast.show(`열 수 없는 이미지 ${refused}개는 넣지 않았어요.`);
  }

  function sendMoved(on: boolean) {
    if (!id) return;
    void store.update('chat', id, (current) => (on ? { ...current, movedPictures: true as const } : without(current, 'movedPictures'))).then((saved) => saved.ok || toast.failed(saved));
  }

  return {
    attachments: { draft, sees, moved: brought ? chat.movedPictures === true : null },
    actions: { attach: (files: File[]) => void attach(files), detach: (name: string) => drafts.detach(key, name), sendMoved },
  };
}
