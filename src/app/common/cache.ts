import type { CacheBreak, CacheCause } from '../../model/cache';
import type { SendFate } from '../ui';
import { CACHE_READ, UNKNOWN } from './words';

// What a diagnosis names as the cause of a change, as a tag.
export const CAUSES: Record<CacheCause['kind'], string> = { tag: '값 바뀜', lore: '켜짐·꺼짐', moved: '위치 바뀜', edited: '메시지 수정', deleted: '메시지 삭제', budget: '컨텍스트 한도 초과', source: '내용 수정', written: '매번 새로 생성', memory: '기억 정리', request: '스크립트가 바꿈', unknown: `원인 ${UNKNOWN}` };

const BREAKS: Record<CacheBreak['kind'], string> = { model: '모델 바뀜', account: '계정 바뀜', reasoning: '추론 설정 바뀜', off: '캐시 꺼짐', expired: '유지 시간 지남', far: '입력이 한 번에 많이 늘어남', changed: '내용 바뀜', added: '새로 들어감', removed: '빠짐', moved: CAUSES.moved };
const CHAT_BREAKS: Partial<Record<CacheBreak['kind'], string>> = { changed: CAUSES.edited, removed: '메시지 빠짐' };

// How a request broke the cache, as a tag; a chat message's own words where the break began in the chat.
export const breakWord = (broken: CacheBreak) => ('from' in broken && broken.from.kind === 'block' && broken.from.slot === 'chat' && CHAT_BREAKS[broken.kind]) || BREAKS[broken.kind];

export const PROVIDER_MISSED = '제공자가 놓침';
// What became of a stretch of a request, as a legend names it.
export const FATES: Record<SendFate, string> = { read: CACHE_READ, again: '다시 보냄', fresh: '새로 보냄', missed: PROVIDER_MISSED };
