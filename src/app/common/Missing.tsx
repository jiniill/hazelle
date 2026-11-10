import { KEEP_DAYS, type Removable } from '../../model/library';
import { backBar } from '../shell/router';
import { BIN, FEATURES_TITLE, PAGES, THINGS } from './words';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';
import { withParticle } from './particles';
import { useLeaving } from './useRemoval';

const RESTORE = `캐릭터 둘러보기의 '${BIN}'에서 복원할 수 있어요.`;
const notFound = (noun: string) => `이 ${withParticle(noun, '을/를')} 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.`;
const lost = (kind: Removable) => ({ title: THINGS[kind].noun, message: notFound(THINGS[kind].noun) });
const binned = (kind: Removable) => ({ title: THINGS[kind].noun, message: `삭제된 ${withParticle(THINGS[kind].noun, '이에요/예요')}. ${RESTORE}` });
export const ABSENT = {
  chat: lost('chat'),
  'deleted-chat': binned('chat'),
  'deleted-prompt': binned('prompt'),
  'deleted-persona': binned('persona'),
  'deleted-module': binned('module'),
  'deleted-profile': binned('profile'),
  'orphaned-chat': { title: THINGS.chat.noun, message: `삭제한 캐릭터의 채팅이에요. ${KEEP_DAYS}일 안에 ${RESTORE}` },
  character: lost('character'),
  'deleted-character': binned('character'),
  connection: { title: '연결', message: notFound('연결') },
  prompt: lost('prompt'),
  persona: lost('persona'),
  module: lost('module'),
  draft: { title: '플러그인 초안', message: notFound('초안') },
  profile: lost('profile'),
  model: { title: '모델', message: '추가한 모델에서 빠졌거나 연결이 삭제된 모델이에요.' },
  feature: { title: FEATURES_TITLE, message: `${PAGES.labs}에서 켜면 쓸 수 있는 기능이에요.` },
};

export type Absent = keyof typeof ABSENT;

// Nothing while its own page is being left by a removal (useLeaving), which would otherwise flash here.
export function Missing({ what, back }: { what: Absent; back: Back | null }) {
  const leaving = useLeaving();
  if (leaving) return null;
  const { title, message } = ABSENT[what];
  return (
    <Screen top={<NavBar title={title} {...backBar(back)} />}>
      <Empty>{message}</Empty>
    </Screen>
  );
}
