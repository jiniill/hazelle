import { expect, it } from 'vitest';
import { KEEP_DAYS } from '../../model/library';
import { ABSENT } from './Missing';

const RESTORE = "캐릭터 둘러보기의 '휴지통'에서 복원할 수 있어요.";
const GONE = '찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.';

it('builds each kind’s missing and binned page from its noun with the particle it takes', () => {
  expect(ABSENT).toEqual({
    chat: { title: '채팅', message: `이 채팅을 ${GONE}` },
    'deleted-chat': { title: '채팅', message: `삭제된 채팅이에요. ${RESTORE}` },
    'deleted-prompt': { title: '프롬프트', message: `삭제된 프롬프트예요. ${RESTORE}` },
    'deleted-persona': { title: '페르소나', message: `삭제된 페르소나예요. ${RESTORE}` },
    'deleted-module': { title: '모듈', message: `삭제된 모듈이에요. ${RESTORE}` },
    'deleted-profile': { title: '모델 설정', message: `삭제된 모델 설정이에요. ${RESTORE}` },
    'orphaned-chat': { title: '채팅', message: `삭제한 캐릭터의 채팅이에요. ${KEEP_DAYS}일 안에 ${RESTORE}` },
    character: { title: '캐릭터', message: `이 캐릭터를 ${GONE}` },
    'deleted-character': { title: '캐릭터', message: `삭제된 캐릭터예요. ${RESTORE}` },
    connection: { title: '연결', message: `이 연결을 ${GONE}` },
    prompt: { title: '프롬프트', message: `이 프롬프트를 ${GONE}` },
    persona: { title: '페르소나', message: `이 페르소나를 ${GONE}` },
    module: { title: '모듈', message: `이 모듈을 ${GONE}` },
    draft: { title: '플러그인 초안', message: `이 초안을 ${GONE}` },
    profile: { title: '모델 설정', message: `이 모델 설정을 ${GONE}` },
    model: { title: '모델', message: '추가한 모델에서 빠졌거나 연결이 삭제된 모델이에요.' },
    feature: { title: '기능', message: '실험실에서 켜면 쓸 수 있는 기능이에요.' },
  });
});
