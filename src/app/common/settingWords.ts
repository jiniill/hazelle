import { readExtra, type ExtraProblem } from '../../connectors/extra';
import type { Cache, Change, ModelSettings, NumberSetting, PdfKeep, ServiceTier, Verbosity } from '../../connectors/settings';
import type { Modality, Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import type { ProfileChoice } from '../../runtime/profiles';
import { count } from './typedNumber';
import { DISCOUNT, MODEL_SETTINGS, PDF_SEND, RETRY_COUNT, SCOPE, UNKNOWN } from './words';

export const MODALITY: Record<Modality, string> = { text: '텍스트', image: '이미지', audio: '오디오', video: '영상', file: '파일', embedding: '임베딩' };

export const inputs = (model: Starred) => (model.input ? model.input.map((modality) => MODALITY[modality]).join(', ') : UNKNOWN);

export type Field = NumberSetting | 'context';
export const NUMBER: Record<Field, { label: string; help?: string; unit?: string; unset?: string }> = {
  maxOutput: { label: '응답 최대 길이', unit: '토큰' },
  context: { label: '컨텍스트 한도', help: '대화가 이 길이보다 길어지면 오래된 메시지부터 빠져요', unit: '토큰', unset: '모델 한도' },
  temperature: { label: '온도', help: '값이 높을수록 더 다양한 응답이 나와요' },
  topP: { label: 'top_p', help: '확률이 높은 후보부터 더해서 이 비율 안에 드는 후보만 선택해요' },
  topK: { label: 'top_k', help: '확률이 높은 후보부터 순서대로 이 개수만큼만 선택해요' },
  minP: { label: 'min_p', help: '가장 높은 확률과 비교해 이 비율보다 확률이 낮은 후보는 빼요' },
  frequencyPenalty: { label: '빈도 억제', help: '자주 나온 단어일수록 덜 쓰게 해요' },
  presencePenalty: { label: '존재 억제', help: '한 번이라도 나온 단어는 덜 쓰게 해요' },
  repetitionPenalty: { label: '반복 억제', help: '1보다 크면 같은 말을 덜 반복해요' },
  seed: { label: 'seed', help: '값이 같으면 같은 조건에서 비슷한 응답이 나와요' },
};
export const MAIN: Field[] = ['maxOutput', 'context', 'temperature'];
export const DETAIL: Field[] = ['topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'seed'];

// In the order a level list reads; a catalog's level not named here keeps its own name, after these.
export const LEVELS: Record<string, string> = { minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대' };
export const levelName = (level: string) => LEVELS[level] ?? level;

export const CACHE: Record<Cache, string> = { '5m': '5분', '1h': '1시간' };

export const VERBOSITY_LABEL = '응답 상세도';
export const VERBOSITY_WORDS: Record<Verbosity, string> = { low: '간단히', medium: '보통', high: '자세히' };
export const SERVICE_TIER_LABEL = '처리 등급';
export const SERVICE_TIER_WORDS: Record<ServiceTier, string> = { auto: '자동', standard_only: '표준' };
export const EXTRA_LABEL = '추가 파라미터';
export const PDF_KEEP_WORDS: Record<PdfKeep, string> = { recent: '최근 대화 제외', system: '시스템 프롬프트 제외', none: '전부' };

const NAMED: Record<Exclude<Change['setting'], Field>, string> = { stop: '멈춤 문구', reasoning: '추론', cache: '캐시', verbosity: VERBOSITY_LABEL, serviceTier: SERVICE_TIER_LABEL, discount: DISCOUNT, pdf: PDF_SEND };
const isField = (setting: Change['setting']): setting is Field => setting in NUMBER;
const settingLabel = (setting: Change['setting']) => (isField(setting) ? NUMBER[setting].label : NAMED[setting]);

// The screens never say 묶음.
const NO_VALUES = '지정 안 함';
// Where no label beside it already says 모델 설정; under one, plain 없음 and NO_VALUES.
export const NO_PROFILE = `${MODEL_SETTINGS} 없음`;
export const NO_PROFILE_VALUES = `${MODEL_SETTINGS} ${NO_VALUES}`;

// What a 모델 설정 sets, in the order the editor shows them.
export function valuesLine(settings: ModelSettings, unset: string = NO_VALUES): string {
  const { reasoning, stop, systemAsUser, streaming, cache, verbosity, serviceTier, discount, pdf, retries, extra } = settings;
  const number = (field: Field) => {
    const value = settings[field];
    return value === undefined ? [] : [`${NUMBER[field].label} ${count(value)}`];
  };
  const thinking = !reasoning
    ? []
    : [`추론 ${reasoning.kind === 'off' ? '끔' : reasoning.kind === 'budget' ? `예산 ${count(reasoning.tokens)}` : reasoning.kind === 'adaptive' ? (reasoning.level === null ? '적응형' : `적응형 · ${levelName(reasoning.level)}`) : levelName(reasoning.level)}`];
  const words = [...MAIN.flatMap(number), ...thinking, ...(cache ? [`캐시 ${CACHE[cache]}`] : []), ...(discount ? [DISCOUNT] : []), ...(pdf ? [`${PDF_SEND} ${PDF_KEEP_WORDS[pdf.keep]}${pdf.keep === 'recent' ? ` ${pdf.recent}%` : ''}`] : []), ...DETAIL.flatMap(number), ...(stop ? [`멈춤 문구 ${stop.length}개`] : []), ...(verbosity ? [`${VERBOSITY_LABEL} ${VERBOSITY_WORDS[verbosity]}`] : []), ...(serviceTier ? [`${SERVICE_TIER_LABEL} ${SERVICE_TIER_WORDS[serviceTier]}`] : []), ...(systemAsUser ? ['시스템 메시지를 사용자 메시지로 변환'] : []), ...(streaming === false ? ['스트리밍 끔'] : []), ...(retries === undefined ? [] : [`${RETRY_COUNT} ${retries}번`]), ...(extra === undefined ? [] : [extraWords(extra)])];
  return words.length ? words.join(' · ') : unset;
}

function extraWords(text: string): string {
  const { fields, problems } = readExtra(text);
  return `${EXTRA_LABEL} ${fields.length}개${problems.length ? ` (보내지 않는 줄 ${problems.length}개)` : ''}`;
}

export function extraError(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const { problems } = readExtra(text);
  if (text.trim().startsWith('{')) return problems.length ? '올바른 JSON 객체 형식이 아니라서 수정할 때까지 전송되지 않아요.' : undefined;
  const lines = (kind: ExtraProblem['kind']) => problems.filter((problem) => problem.kind === kind).map((problem) => problem.line).join(', ');
  const unreadable = lines('unreadable');
  const header = lines('header');
  const words = [...(unreadable ? [`${unreadable}번째 줄은 읽을 수 없어서 보내지 않아요.`] : []), ...(header ? [`${header}번째 줄은 헤더(header::)라서 보내지 않아요.`] : [])];
  return words.length ? words.join(' ') : undefined;
}

// A model's 모델 설정 in one line: what it sets, led by its name only when it is not the default one.
export function profileLine(choice: ProfileChoice, defaultId: string | undefined, unset?: string): string {
  if (choice.kind !== 'profile') return NO_PROFILE;
  const values = valuesLine(choice.profile.value.settings, unset);
  return choice.profile.id === defaultId ? values : `${choice.profile.value.name} · ${values}`;
}

// An empty 실패하면 다시 보내기 follows the count above it, which the placeholder names with its layer: a connection's
// follows 공용, a 모델 설정's its connection.
const RETRIES_FROM = { shared: SCOPE.default, connection: '연결' } as const;
export const followsRetries = (from: keyof typeof RETRIES_FROM, retries: number) => `${RETRIES_FROM[from]} ${retries}번`;

// A starred model whose wire format this version does not speak (Model protocol 'unsupported').
export const NOT_CALLABLE = '지금 버전에서는 이 모델을 호출할 수 없어요';

export function changeLine(left: readonly string[], capped: readonly string[]): string | undefined {
  const parts = [...(left.length ? [`제외: ${left.join(', ')}`] : []), ...(capped.length ? [`조정: ${capped.join(', ')}`] : [])];
  return parts.length ? parts.join(' · ') : undefined;
}

// undefined when it is sent the values as they are.
export function changeWords(changes: Change[]): string | undefined {
  const left = changes.filter((change) => change.change === 'left-out').map((change) => settingLabel(change.setting));
  const capped = changes.flatMap((change) => (change.change === 'capped' ? [`${settingLabel(change.setting)} ${count(change.to)}`] : []));
  return changeLine(left, capped);
}

export const defaultFirst = (profiles: readonly Stored<'profile'>[], defaultId: string | undefined) =>
  [...profiles].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.value.name.localeCompare(b.value.name, 'ko'));
