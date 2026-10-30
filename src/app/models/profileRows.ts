import { DETAIL, EXTRA_LABEL, MAIN, NUMBER, SERVICE_TIER_LABEL, VERBOSITY_LABEL } from '../common/settingWords';
import { DISCOUNT, PDF_SEND, RETRY_COUNT } from '../common/words';

// Apart from useProfileEditor, a lazy screen's: the settings nav reads these on every page, so importing them must not
// bring the editor into its chunk.
export const PROFILE_ROWS = {
  frequent: '자주 쓰는 설정',
  reasoning: '추론',
  budget: '추론 예산',
  cache: '캐시',
  recent: '원문으로 보낼 최근 대화',
  stop: '멈춤 문구',
  system: '시스템 메시지 전송 방식',
  streaming: '스트리밍',
};

// 설정 검색's index (shell/settings/terms.ts) reads this: a row of the editor is named here too, or the search misses it.
export const PROFILE_LABELS = [...Object.values(PROFILE_ROWS), ...[...MAIN, ...DETAIL].map((field) => NUMBER[field].label), DISCOUNT, PDF_SEND, VERBOSITY_LABEL, SERVICE_TIER_LABEL, RETRY_COUNT, EXTRA_LABEL];
