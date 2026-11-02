import { useEffect, useMemo, useState } from 'react';
import { standing, type Chat, type Message } from '../../model/chat';
import type { Drawn, IllustrateSwitches, Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import { setIllustrate, setOwnIllustrate } from '../../runtime/characters';
import { chatIllustrate } from '../../runtime/features';
import { pictureSizes } from '../../engine/illustrate';
import { removeIllustration, restoreIllustration, sceneWriterOf, type IllustrateFailure } from '../../runtime/illustrate';
import { illustrationPrompt } from '../../runtime/prompts';
import { describeIllustrateFailure } from '../common/failure';
import { useChildren, useIllustrating, useSession } from '../session';
import { useToast } from '../toast';

// The failures a toast already said: each is said once, though the chat is left and opened again, and once for all the
// scenes of a run it failed together.
const told = new WeakSet<IllustrateFailure>();

function picturesByVersion(illustrations: Stored<'illustration'>[], messages: readonly Message[]): ReadonlyMap<string, Stored<'illustration'>[]> {
  const standingIds = standing(messages);
  const versions = new Map<string, Stored<'illustration'>[]>();
  for (const picture of [...illustrations].sort((a, b) => a.value.at - b.value.at)) {
    const version = standingIds.get(picture.value.version);
    if (!version) continue;
    const pictures = versions.get(version);
    if (pictures) pictures.push(picture);
    else versions.set(version, [picture]);
  }
  return versions;
}

// 어떻게 바꿀까요?: the scene a picture had and what it was drawn from, drawn again once the scene is changed. paragraphs:
// how many its version holds.
export type Reshaping = { message: string; version: string; scene: Scene; sent: Drawn['sent']; paragraphs: number };
export type IllustrationActions = ReturnType<typeof useChatIllustrations>['actions'];

export function useChatIllustrations(chatId: string, id: string | null, chat: Chat, messages: readonly Message[]) {
  const { character } = chat;
  const { store, illustrator } = useSession();
  const toast = useToast();
  const illustrate = chatIllustrate(store, chat);
  const sceneWriter = sceneWriterOf(store, chat);
  const prompt = illustrationPrompt(store, illustrate.prompt);
  // The frame a picture being drawn or placed takes: the 삽화 prompt's size tier; without a prompt nothing is drawn.
  const sizes = pictureSizes(prompt.kind === 'prompt' ? prompt.prompt.value : {});
  const illustrations = useChildren('illustration', id);
  const pictures = useMemo(() => picturesByVersion(illustrations, messages), [illustrations, messages]);
  const illustrating = useIllustrating();
  // Settled by the switch and the pictures, not by a picture landing, so the story moves aside before one does.
  const stage = illustrate.auto || illustrations.length > 0 || [...illustrating.values()].some((drawing) => drawing.chat === chatId);
  const [reshaping, setReshaping] = useState<Reshaping | null>(null);

  useEffect(() => {
    for (const drawing of illustrating.values()) {
      if (drawing.chat !== chatId) continue;
      for (const failure of [drawing.failure, ...drawing.sketches.map((sketch) => sketch.failure)]) {
        if (!failure || told.has(failure)) continue;
        told.add(failure);
        toast.error(describeIllustrateFailure(failure));
      }
    }
  }, [illustrating]);

  function setIllustrateSwitches(change: Partial<IllustrateSwitches>) {
    toast.settled(setIllustrate(store, character, change));
  }

  function setOwnIllustrateSwitches(own: boolean) {
    toast.settled(setOwnIllustrate(store, character!, own));
  }

  // scene: one already written, drawn again with no scene call. spend: the user's 그래도 만들기 on a picture that may cost.
  function draw(message: string, version: string, scene: Scene | null = null, spend = false) {
    if (id) illustrator.draw(id, message, version, { scene, spend });
  }

  function dropPicture(picture: Stored<'illustration'>) {
    toast.settled(removeIllustration(store, picture.id));
    toast.undoable('삽화를 삭제했어요.', () => restoreIllustration(store, picture));
  }

  return {
    illustrate, sceneWriter, pictures, pictureSizes: sizes, illustrating, stage, reshaping,
    actions: {
      setIllustrate: setIllustrateSwitches,
      setOwnIllustrate: setOwnIllustrateSwitches,
      draw,
      dismissIllustration: (message: string, scene: Scene | null) => illustrator.dismiss(message, scene),
      dropPicture,
      reshape: setReshaping,
    },
  };
}
