import type { ToolIdentity } from '../../model/tool';
import type { DraftState } from '../../runtime/tools/drafts';
import type { ToolUse } from '../../tool-api/manifest';
import { NETWORK } from '../common/words';

export const draftTitle = (identity: ToolIdentity) => identity.displayName || '이름 없는 플러그인';

export const DRAFT_STATES: Record<Exclude<DraftState, 'applied'>, string> = { unapplied: '적용 안 함', differs: '적용한 버전과 다름' };

export const USE_TAGS: Record<ToolUse, string> = { model: '모델 호출', embed: '임베딩', memory: '장기 기억', network: NETWORK };
