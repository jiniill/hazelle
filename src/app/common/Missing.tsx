import { KEEP_DAYS } from '../../model/library';
import { backBar } from '../shell/router';
import { BIN, FEATURES_TITLE, PAGES } from './words';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

const RESTORE = `캐릭터 둘러보기의 '${BIN}'에서 복원할 수 있어요.`;
const COPY = {
  chat: { title: '채팅', message: '이 채팅을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  'deleted-chat': { title: '채팅', message: `삭제된 채팅이에요. ${RESTORE}` },
  'deleted-prompt': { title: '프롬프트', message: `삭제된 프롬프트예요. ${RESTORE}` },
  'deleted-persona': { title: '페르소나', message: `삭제된 페르소나예요. ${RESTORE}` },
  'deleted-module': { title: '모듈', message: `삭제된 모듈이에요. ${RESTORE}` },
  'deleted-profile': { title: '모델 설정', message: `삭제된 모델 설정이에요. ${RESTORE}` },
  'orphaned-chat': { title: '채팅', message: `삭제한 캐릭터의 채팅이에요. ${KEEP_DAYS}일 안에 ${RESTORE}` },
  character: { title: '캐릭터', message: '이 캐릭터를 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  'deleted-character': { title: '캐릭터', message: `삭제된 캐릭터예요. ${RESTORE}` },
  connection: { title: '연결', message: '이 연결을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  prompt: { title: '프롬프트', message: '이 프롬프트를 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  persona: { title: '페르소나', message: '이 페르소나를 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  module: { title: '모듈', message: '이 모듈을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  draft: { title: '플러그인 초안', message: '이 초안을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  profile: { title: '모델 설정', message: '이 모델 설정을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.' },
  model: { title: '모델', message: '추가한 모델에서 빠졌거나 연결이 삭제된 모델이에요.' },
  feature: { title: FEATURES_TITLE, message: `${PAGES.labs}에서 켜면 쓸 수 있는 기능이에요.` },
};

export type Absent = keyof typeof COPY;

export function Missing({ what, back }: { what: Absent; back: Back }) {
  const { title, message } = COPY[what];
  return (
    <Screen top={<NavBar title={title} {...backBar(back)} />}>
      <Empty>{message}</Empty>
    </Screen>
  );
}
