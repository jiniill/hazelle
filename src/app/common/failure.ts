import type { PromptSort } from '../../model/prompt';
import type { Receipt } from '../../model/chat';
import type { PluginAsked } from '../../runtime/tools/plugin-writer';
import { USERNAME_LENGTH, USERNAME_MARKS } from '../../contracts/accounts';
import { COMMENTS_PER_DAY, MAX_POST_PICTURES, NICKNAME_LENGTH, PICTURES_PER_DAY, POSTS_PER_DAY } from '../../contracts/board';
import type { Role } from '../../connectors/assignment';
import type { Costs } from '../../connectors/types';
import type { RelayError, ServerError } from '../../contracts/http';
import type { ApiFailure } from '../../runtime/api';
import type { RouteFailure } from '../../runtime/models/assignment';
import type { CatalogFailure } from '../../runtime/models/catalog';
import type { IllustrateFailure } from '../../runtime/tasks/illustrate';
import type { LikenessFailure } from '../../runtime/tasks/likeness';
import type { MascotFailure } from '../../runtime/tasks/mascot';
import type { StatusFailure } from '../../runtime/tasks/status';
import type { MemoryFailure } from '../../runtime/tasks/memory';
import type { PrereadFailure } from '../../runtime/tasks/preread';
import type { writerOf } from '../../runtime/models/profiles';
import type { EmbedFailure } from '../../runtime/tasks/retrieval';
import type { AgentFailed } from '../../runtime/tasks/agents';
import type { AdditionalFailure } from '../../runtime/chat/additional';
import type { KeyFailure } from '../../runtime/models/connections';
import type { ReplyError } from '../../runtime/models/generate';
import type { MetersFailure } from '../../runtime/models/meters';
import type { SignInFailure } from '../../runtime/account/sign-in';
import type { TranslateFailure, TranslatorFailure } from '../../runtime/tasks/translate';
import type { TurnFailure } from '../../runtime/chat/turn';
import { SHARE_LIMITS } from '../../contracts/shares';
import { count } from './typedNumber';
import { withParticle } from './particles';
import { SORT_PROMPT, defaultPrompt } from './prompt-words';
import { ADDITIONAL_TEXT, BIN, BOT_STUCK, DISCOUNT, inFeature, inSettings, MODEL_ROLES, MODEL_SETTINGS, NO_IMAGE_MODEL, NEEDS_ACCOUNT, NO_PICTURES, PRE_READ, SHARE, TASK_MODELS, UNREADABLE_IMAGE, BAD_PICTURE } from './words';

export const RELOAD_RETRY = '새로고침한 뒤 다시 시도해 주세요.';

// The server's codes left on the generic fallback, which names the code for the operator. Every other server code needs
// words in MESSAGES; its remaining keys are codes the runtime makes itself.
type OnFallback =
  // Only a broken or outdated client sends these; not-found otherwise answers an operator's page, or a file read that
  // runtime/files/assets handles.
  | 'bad-body'
  | 'bad-content-type'
  | 'bad-id'
  | 'bad-input'
  | 'bad-key'
  | 'length-required'
  | 'not-found'
  | 'stream-exists'
  // The server failed or was busy for a moment, which is what the fallback says.
  | 'busy'
  | 'server-error'
  | 'store-unavailable'
  // Handled before a failure is described: by the screen or runtime path that sent the request, or by describeFailure
  // from retryAfter, which the server always sends with too-many-attempts.
  | 'cache-reset'
  | 'files-full'
  | 'too-many-attempts'
  | 'too-many-bot-calls'
  | 'too-many-writes'
  | 'wrong-login'
  // Restore refusals, worded by the restores dialog.
  | 'bad-post'
  | 'bad-time'
  | 'cannot-cancel'
  | 'cannot-undo'
  | 'too-many-restores';

// Said on the username field when 다음 checks the name.
export const USERNAME_TAKEN = '이미 쓰고 있는 아이디예요.';

const MESSAGES: Record<Exclude<ServerError, OnFallback>, string> & { [code in OnFallback]?: never } & Partial<Record<string, string>> = {
  'bad-username': `아이디는 ${count(USERNAME_LENGTH.min)}~${count(USERNAME_LENGTH.max)}자의 글자와 숫자, ${[...USERNAME_MARKS].join(' ')}로만 만들 수 있어요.`,
  'signup-closed': '가입 정원이 다 차서 새 계정을 만들 수 없어요.',
  'too-many-signups': '가입을 너무 여러 번 시도했어요. 10분쯤 뒤에 다시 시도해 주세요.',
  // Signup's last step, after the recovery key: the name was taken after 다음 checked it, and is set on the step before.
  'username-taken': `${USERNAME_TAKEN} 이전 단계로 돌아가 다른 아이디를 입력해 주세요.`,
  'account-mismatch': '다른 탭에서 다른 계정으로 로그인해서 이 탭에서 바꾼 내용을 저장하지 못했어요. 이 탭에서 다시 로그인해 주세요.',
  suspended: `정지된 계정이라 내용을 저장하거나 모델을 호출할 수 없어요. 백업 파일은 ${inSettings('account')}에서 받을 수 있어요.`,
  'too-many-calls': '모델을 너무 자주 호출했어요. 잠시 뒤에 다시 시도해 주세요.',
  'too-many-live-calls': '동시에 받는 응답이 너무 많아요. 받고 있는 응답이 끝난 뒤 다시 시도해 주세요.',
  'storage-full': `저장 공간이 가득 찼어요. ${BIN}에서 영구 삭제하면 공간이 생겨요.`,
  'tool-file-refused': '플러그인 파일을 저장하지 못했어요. 파일 용량 한도나 차단 여부를 확인해 주세요.',
  'draft-too-large': '플러그인 코드가 512KB를 넘어서 여기서 편집할 수 없어요.',
  'risu-plugin': 'Risu 플러그인은 여기서 편집할 수 없어요.',
  'picture-unreadable': UNREADABLE_IMAGE,
  'picture-refused': '이미지 용량이 너무 크거나, 차단된 파일이거나, 파일 한도를 넘었어요.',
  'file-blocked': '운영자가 차단한 파일이라 올리거나 열 수 없어요.',
  // The admin screen's 백업 폴더 (server/backup/folder.ts).
  'folder-not-absolute': '전체 경로를 입력해 주세요. 예: D:\\헤이젤 백업',
  'folder-in-data': '헤이젤 데이터 폴더 외부의 다른 폴더를 지정해 주세요.',
  'folder-unwritable': '이 폴더에 쓸 수 없어요. 폴더가 있는지, 쓸 권한이 있는지 확인해 주세요.',
  'too-many-reports': '운영자가 아직 확인하지 않은 신고가 많아서 더 보낼 수 없어요.',
  'bad-nickname': `닉네임은 ${count(NICKNAME_LENGTH.min)}~${count(NICKNAME_LENGTH.max)}자로, @ # / 같은 기호 없이 지을 수 있어요.`,
  'nickname-taken': '이미 쓰고 있는 닉네임이에요. 다른 닉네임을 지어 주세요.',
  'no-nickname': '게시판에 쓰려면 먼저 닉네임을 정해야 해요.',
  'post-locked': '운영자가 댓글을 닫은 글이에요.',
  'not-author': '댓글과 답글은 글쓴이와 운영자만 달 수 있어요.',
  'guest-board-blocked': '운영자가 글쓰기를 막았어요.',
  'guest-board-closed': '지금은 손님 글쓰기가 닫혀 있어요. 계정을 만들면 쓸 수 있어요.',
  'too-many-posts': `글은 하루에 ${count(POSTS_PER_DAY)}개까지 쓸 수 있어요.`,
  'too-many-comments': `댓글은 하루에 ${count(COMMENTS_PER_DAY)}개까지 쓸 수 있어요.`,
  'too-many-pictures': `사진은 글 하나에 ${count(MAX_POST_PICTURES)}장, 하루에 ${count(PICTURES_PER_DAY)}장까지 올릴 수 있어요.`,
  'bad-picture': BAD_PICTURE,
  'too-many-visits': '요청을 너무 자주 보냈어요. 잠시 뒤에 다시 시도해 주세요.',
  'too-many-shares': `링크는 ${count(SHARE_LIMITS.links)}개까지 만들 수 있어요. 안 쓰는 링크를 끊고 다시 시도해 주세요.`,
  'too-many-versions': `링크 하나에 새 버전은 ${count(SHARE_LIMITS.versions)}번까지 올릴 수 있어요. 링크를 끊고 새로 공유해 주세요.`,
  'too-many-publishes': '링크를 너무 자주 공유했어요. 잠시 뒤에 다시 시도해 주세요.',
  'share-held': SHARE.heldNote,
  'no-consent': '링크로 공유하려면 먼저 공유 규칙에 동의해야 해요.',
  'not-admin': '운영자 계정으로만 할 수 있어요.',
  'needs-account': `${NEEDS_ACCOUNT}. 계정을 만들면 쓸 수 있어요.`,
  'no-session': '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.',
  conflict: '다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
  unreadable: '암호화 키로 열 수 없는 항목이라 바꿀 수 없어요.',
  'evaluation-unavailable': `채팅을 처리하지 못했어요. ${RELOAD_RETRY}`,
  'bot-stuck': `${BOT_STUCK}.`,
  'codec-unavailable': `데이터를 처리하지 못했어요. ${RELOAD_RETRY}`,
  gone: '다른 기기나 탭에서 삭제된 항목이라 바꿀 수 없어요.',
  'too-large': '용량이 너무 커서 저장할 수 없어요.',
  // A guest's store (runtime/account/guest-store).
  'browser-full': `브라우저 저장 공간이 꽉 찼어요. ${BIN}에서 영구 삭제하거나 계정을 만들면 공간이 생겨요.`,
  'browser-storage': `이 브라우저의 저장소를 열지 못했어요. ${RELOAD_RETRY}`,
  'browser-storage-blocked': '다른 탭에서 열어 둔 헤이젤을 닫고 다시 시도해 주세요.',
  offline: '서버에 연결하지 못했어요. 네트워크 상태를 확인해 주세요.',
  'timeline-changed': '계정이 복원돼서 작업을 멈췄어요. 다시 시도해 주세요.',
  'account-restoring': '계정을 복원하고 있어요. 잠시 뒤에 다시 시도해 주세요.',
  'account-busy': '운영자가 계정을 복원하고 있어요. 잠시 뒤에 다시 시도해 주세요.',
  'sole-operator': '운영자 계정은 탈퇴할 수 없어요.',
  'account-leaving': '탈퇴가 진행 중인 계정이라 로그인할 수 없어요.',
  'stream-gone': '이 응답은 서버에 더 이상 남아 있지 않아요.',
  'stream-lost': '서버에서 응답을 받다가 연결이 끊겼어요.',
};

const SERVER_TROUBLE = '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.';
// model: the subject of 쓰던, particle and all.
const profileGone = (model: string) => `${model} 쓰던 ${MODEL_SETTINGS}이 삭제됐어요. ${inSettings('models')}에서 다른 ${MODEL_SETTINGS}을 선택해 주세요.`;
const NO_DEFAULT_PROFILE = `기본으로 지정한 ${MODEL_SETTINGS}이 없어요. ${inSettings('models')}에서 ${MODEL_SETTINGS} 하나를 기본으로 지정해 주세요.`;
const TOKENIZER = `토큰 수를 계산하지 못했어요. ${RELOAD_RETRY}`;
const EMPTY_REPLY = '모델이 내용이 비어 있는 응답을 보냈어요.';
const GONE_MESSAGE = '삭제된 메시지예요.';

type Unrouted = RouteFailure | Extract<ReturnType<typeof writerOf>, { kind: 'profile-missing' }>;

// model ends in 모델: 이 and 은 are its particles.
// prompt: the task prompt that may name its own model; null when only 설정 › 모델 chooses it.
// place: where the task's own model is picked, beside 설정 › 모델's roles it falls back to.
function describeRoute(failure: Unrouted, model: string, place: string | null): string {
  const where = place === null ? `${inSettings('models')}에서` : `${place} 또는 ${inSettings('models')}에서`;
  switch (failure.kind) {
    case 'no-model':
      return `${model}이 지정되지 않았어요. ${where} 모델을 선택해 주세요.`;
    case 'model-gone':
      return `${model}이 추가한 모델에 없어요. ${where} 다시 선택해 주세요.`;
    case 'image-only':
      return `선택한 ${model}은 이미지만 만들 수 있어요. ${where} 다른 모델을 선택해 주세요.`;
    case 'profile-missing':
      return failure.own ? profileGone(`${model}이`) : NO_DEFAULT_PROFILE;
  }
}

// A role's own model as 설정 › 모델 picks it.
const EMBED_UNCALLED = `${MODEL_ROLES.embed}을 호출하지 못했어요.`;
// tooLarge: what was too long for one call, in the caller's words.
const describeEmbedFailure = ({ reason, receipt }: EmbedFailure, tooLarge: string) => (reason === 'too-large' ? tooLarge : receipt?.error ? describeReplyError(receipt.error) : EMBED_UNCALLED);
export const describeRoleFailure = (role: Role, failure: RouteFailure) => describeRoute(failure, MODEL_ROLES[role], null);

const SECRET = { password: '비밀번호가', recovery: '복구 키가' } as const;

// Signed out, the username may be the wrong part.
export function wrongSecret(method: keyof typeof SECRET, withUsername: boolean): string {
  return `${withUsername ? '아이디나 ' : ''}${SECRET[method]} 맞지 않아요.`;
}

// own: a screen's words for codes it sends, ahead of the shared ones.
export function describeFailure(failure: ApiFailure, own: Partial<Record<ServerError, string>> = {}): string {
  if (failure.error === 'too-many-attempts' && failure.retryAfter !== undefined) {
    return `너무 여러 번 시도했어요. ${Math.ceil(failure.retryAfter / 60)}분 뒤에 다시 시도해 주세요.`;
  }
  const screen: Partial<Record<string, string>> = own;
  // The code is what to tell the operator: without it a failure no screen expected cannot be told apart.
  return screen[failure.error] ?? MESSAGES[failure.error] ?? `${SERVER_TROUBLE} (${failure.error}${failure.status === undefined ? '' : ` ${failure.status}`})`;
}

const REFUSED: Record<string, string> = {
  'max-tokens-unknown': '이 모델의 응답 최대 길이를 알 수 없어서 요청을 보낼 수 없어요.',
  'context-fit': '요청 내용이 이 모델의 컨텍스트 길이를 넘을 것 같아서 보내지 않았어요. 컨텍스트 길이가 더 긴 모델을 선택하거나 프롬프트 내용을 줄여 주세요.',
  tokenizer: `토큰 수를 계산하지 못해서 보내지 않았어요. ${RELOAD_RETRY}`,
  'unknown-connection-type': '지원하지 않는 연결 방식이에요. 화면을 새로고침해 주세요.',
  'unreadable-key': '키를 읽지 못했어요. 키 파일의 내용을 그대로 붙여 넣어 주세요.',
  'unsupported-protocol': '이 모델의 요청 방식은 지원하지 않아요.',
  'image-only': '이미지만 만드는 모델이라 대화에는 쓸 수 없어요.',
  'no-picture-input': NO_PICTURES,
  'tools-unsupported': '이 모델은 도구를 사용할 수 없어요.',
  'too-many-characters': '이 모델이 한 장면에 그릴 수 있는 최대 인물 수를 넘었어요.',
  'unknown-model': '현재 버전에서 알 수 없는 모델이에요. 화면을 새로고침해 주세요.',
  'unknown-sampler': '이 모델이 지원하지 않는 샘플러예요. 삽화 프롬프트에서 샘플러를 다시 선택해 주세요.',
  'model-gone': '연결에서 모델이 빠져서 응답을 이어서 받을 수 없어요.',
  'batch-expired': '제공자가 정해진 시간 안에 응답을 생성하지 못해 할인 요청이 만료됐어요.',
  'discount-busy': `제공자 서버에 지금 할인 요청을 처리할 여유 용량이 없어요. ${DISCOUNT}를 끄면 바로 응답을 받을 수 있어요.`,
};

// The relay refuses these, and 직접 연결 says so before it tries.
export const HTTPS_ONLY = 'https로 시작하는 주소만 연결할 수 있어요.';

// bad-envelope has no words of its own: only a broken client sends it, and the fallback says the relay refused.
const RELAY: Record<Exclude<RelayError, 'bad-envelope'>, string> & Partial<Record<string, string>> = {
  'not-https': HTTPS_ONLY,
  'not-public': '외부에 공개된 주소만 연결할 수 있어요.',
  'upstream-unreachable': '제공자 서버에 연결하지 못했어요. 주소를 확인하거나 잠시 후 다시 시도해 주세요.',
  'relay-traffic-limit': '오늘 보낼 수 있는 한도를 다 썼어요. 매일 오전 9시에 다시 채워져요.',
  'relay-host-limit': '오늘 연결할 수 있는 주소 개수를 넘었어요. 매일 오전 9시에 다시 채워져요.',
  'upstream-not-api': '이 주소에서 API 응답 대신 웹 페이지를 보냈어요. 주소를 다시 확인해 주세요.',
  'upstream-redirect': '주소가 다른 곳으로 바뀌었어요. 주소를 다시 확인해 주세요.',
};

// The provider's own words follow ours, so an unfamiliar refusal still says what happened.
function provider(status: number, detail: string): string {
  const ours =
    status === 401 || status === 403
      ? '키가 맞지 않거나 사용할 권한이 없어요.'
      : status === 402
        ? '잔액이나 사용 한도가 부족해요.'
        : status === 404
          ? '주소나 모델을 찾지 못했어요.'
          : status === 429
            ? '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.'
            : status >= 500
              ? '제공자 서버에 문제가 생겼어요.'
              : `제공자가 요청을 거절했어요 (${status}).`;
  return detail ? `${ours} ${detail}` : ours;
}

export const describeFailedReply = (error: ReplyError | null) => (error ? describeReplyError(error) : EMPTY_REPLY);

export function describeReplyError(error: ReplyError): string {
  switch (error.kind) {
    case 'refused':
      return REFUSED[error.code] ?? error.code;
    case 'provider':
      return 'status' in error ? provider(error.status, error.detail) : `제공자가 오류를 보냈어요. ${error.detail}`;
    case 'relay':
      return RELAY[error.code] ?? '중계 서버에서 요청을 거절했어요.';
    case 'app':
      return MESSAGES[error.code] ?? SERVER_TROUBLE;
    case 'offline':
      return MESSAGES.offline!;
    case 'stopped':
      return '멈췄어요.';
    case 'bad-event':
      return `응답을 읽지 못했어요. ${error.detail}`;
    case 'network':
      return '응답을 받다가 연결이 끊겼어요.';
    case 'no-token':
      return '로그인 토큰을 받지 못했어요. 연결을 삭제한 뒤 다시 로그인해 주세요.';
    case 'pool':
      return `${error.group}에 계정이 없어요. 연결 설정에서 계정을 옮기거나 새로 추가해 주세요.`;
  }
}

const SIGN_IN_REFUSED: Record<string, string> = {
  expired_token: '인증 코드가 만료됐어요. 다시 시도해 주세요.',
  access_denied: '로그인을 취소했어요.',
};

export function describeSignInFailure(failure: SignInFailure, site: string): string {
  if (failure.kind === 'bad-answer') return `${site}의 응답을 읽지 못했어요. 다시 시도해 주세요.`;
  if (failure.kind === 'refused') return SIGN_IN_REFUSED[failure.code] ?? `${site}에서 로그인을 거절했어요 (${failure.code}).`;
  return describeReplyError(failure);
}

export function describeCatalogFailure(failure: CatalogFailure): string {
  if (failure.kind === 'not-a-catalog') return '모델 목록을 받지 못했어요. 주소를 다시 확인해 주세요.';
  return describeReplyError(failure);
}

export function describeMetersFailure(failure: MetersFailure): string {
  if (failure.kind === 'not-meters') return '사용량을 읽지 못했어요.';
  return describeReplyError(failure);
}

export function describeKeyFailure(failure: KeyFailure): string {
  switch (failure.kind) {
    case 'models':
      return describeCatalogFailure(failure.failure);
    case 'key':
      return describeMetersFailure(failure.failure);
    case 'save':
      return describeFailure(failure.failure);
    case 'stopped':
      return describeReplyError(failure);
  }
}

export const RUNAWAY_FIX = '캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.';
export const runaway = (before: string) => `명령어 실행 결과가 너무 길어서 ${before} 멈췄어요. ${RUNAWAY_FIX}`;
export const LORE_RUNAWAY = runaway('로어북을 스크립트에 넘기기 전에');

const noDefault = (sort: PromptSort) => `${defaultPrompt(sort)}가 없어요. ${inSettings('prompts')}에서 ${SORT_PROMPT[sort]} 하나를 기본으로 지정해 주세요.`;

// The kinds every task that runs a prompt on a model shares; a task's own kinds are said before these.
type TaskFailure = Unrouted | { kind: 'prompt-missing' } | { kind: 'tokenizer' } | { kind: 'runaway' } | { kind: 'failed'; receipt: Receipt };
// model, place: as describeRoute takes them. before: the step a runaway stopped ahead of.
type Task = { model: string; place: string; sort: PromptSort; before: string };

function describeTask(failure: TaskFailure, { model, place, sort, before }: Task): string {
  switch (failure.kind) {
    case 'no-model':
    case 'model-gone':
    case 'image-only':
    case 'profile-missing':
      return describeRoute(failure, model, place);
    case 'prompt-missing':
      return noDefault(sort);
    case 'tokenizer':
      return TOKENIZER;
    case 'runaway':
      return runaway(before);
    case 'failed':
      return describeFailedReply(failure.receipt.error);
  }
}

const featureTask = (feature: keyof typeof TASK_MODELS, before: string): Task => ({ model: TASK_MODELS[feature], place: inFeature(feature), sort: feature, before });

export function describeTurnFailure(failure: TurnFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `${MODEL_ROLES.main}이 지정되지 않았어요. 모델 버튼에서 모델을 선택해 주세요.`;
    case 'model-gone':
      return '선택한 모델이 추가한 모델에 없어요. 모델 버튼에서 다시 선택해 주세요.';
    case 'image-only':
      return '선택한 모델은 이미지만 만들 수 있어요. 모델 버튼에서 다른 모델을 선택해 주세요.';
    case 'prompt-missing':
      return failure.own ? '이 채팅에서 쓰던 프롬프트가 삭제됐어요. 다른 프롬프트를 선택해 주세요.' : noDefault('conversation');
    case 'persona-missing':
      return {
        chat: '이 채팅에서 쓰던 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
        character: '이 캐릭터에 고정해 둔 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
        current: '현재 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
      }[failure.from];
    case 'profile-missing':
      return failure.own ? profileGone('이 모델이') : NO_DEFAULT_PROFILE;
    case 'runaway':
      return runaway('보내기 전에');
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 보내 주세요.';
    case 'too-long':
      if (failure.budget <= 0) return `응답 최대 길이가 컨텍스트 길이만큼 커서 프롬프트를 넣을 수 없어요. ${inSettings('models')}에서 이 모델의 응답 최대 길이를 줄여 주세요.`;
      return `마지막 메시지만 넣어도 프롬프트가 약 ${count(failure.tokens)} 토큰이라, 이 모델에 넣을 수 있는 한도(${count(failure.budget)} 토큰)를 넘어요. 프롬프트나 로어북 내용을 줄이거나, ${inSettings('models')}에서 이 모델이 쓰는 ${MODEL_SETTINGS}을 바꿔 주세요.`;
    case 'unstarted':
      return `채팅을 만들지 못했어요. ${describeFailure(failure.failure)}`;
    case 'unpulled':
      return `최신 대화를 불러오지 못해서 보내지 않았어요. ${describeFailure(failure.failure)}`;
    case 'gone':
      return '다른 기기에서 삭제돼서 보내지 않았어요.';
    case 'unsent':
      return `보낸 메시지를 저장하지 못해서 응답 생성을 멈췄어요. ${describeFailure(failure.failure)}`;
    case 'unsaved':
      return `응답을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'busy':
      return '응답을 생성하는 중이라 보내지 않았어요. 응답이 끝난 뒤 다시 보내 주세요.';
    case 'untranslated':
      return failure.failure.kind === 'stopped' ? '번역을 멈춰서 메시지를 보내지 않았어요.' : `메시지를 번역하지 못해서 보내지 않았어요. ${describeTranslateFailure(failure.failure)}`;
    case 'preread':
      return failure.failure.kind === 'stopped' ? `${PRE_READ} 중에 멈춰서 메시지를 보내지 않았어요.` : `${PRE_READ}에 실패해서 메시지를 보내지 않았어요. ${describePrereadFailure(failure.failure)}`;
    case 'agent':
      return `${withParticle(failure.failure.name, '이/가')} 실패해서 메시지를 보내지 않았어요. ${describeAgentFailure(failure.failure)}`;
    case 'additional':
      return `${ADDITIONAL_TEXT}을 찾지 못해서 메시지를 보내지 않았어요. ${describeAdditionalFailure(failure.failure)}`;
  }
}

function describeAdditionalFailure(failure: AdditionalFailure['failure']): string {
  switch (failure.kind) {
    case 'no-model':
    case 'model-gone':
    case 'image-only':
      return describeRoleFailure('embed', failure);
    case 'embed':
      return describeEmbedFailure(failure, `문단 하나가 ${MODEL_ROLES.embed}의 한도보다 길어요. 빈 줄로 더 나눠 주세요.`);
  }
}

// The failed agent's own words, without its name, which the caller says.
export function describeAgentFailure({ name, failure }: AgentFailed): string {
  switch (failure.kind) {
    case 'protect-invalid':
      return `보호 패턴을 읽을 수 없어요: ${failure.pattern}`;
    case 'lost':
      return `보호된 구간 ${failure.count}곳이 누락되어 다듬은 응답을 적용하지 않았어요.`;
    case 'unsaved':
      return describeFailure(failure.failure);
  }
  return describeTask(failure, { model: `${name} 모델`, place: `${name} 프롬프트`, sort: 'agent', before: '호출하기 전에' });
}

export function describePrereadFailure(failure: Exclude<PrereadFailure, { kind: 'stopped' }>): string {
  if (failure.kind === 'unsaved') return describeFailure(failure.failure);
  return describeTask(failure, featureTask('preread', '줄이기 전에'));
}

export function describeAskFailure(failure: Exclude<Extract<PluginAsked, { ok: false }>['failure'], { kind: 'stopped' }>): string {
  switch (failure.kind) {
    case 'failed':
      return describeFailedReply(failure.receipt.error);
    case 'unsaved':
      return `사용량을 저장하지 못해 답을 버렸어요. ${describeFailure(failure.failure)}`;
    case 'too-many-calls':
      return '모델이 테스트만 반복하고 답을 주지 않아서 멈췄어요.';
    default:
      return describeRoute(failure, MODEL_ROLES.main, null);
  }
}

export function describeTranslateFailure(failure: Exclude<TranslateFailure, { kind: 'stopped' }> | TranslatorFailure): string {
  switch (failure.kind) {
    case 'prompt-missing':
      if (failure.own) return '선택한 번역 프롬프트가 삭제됐어요. 채팅의 번역 메뉴에서 다른 프롬프트를 선택해 주세요.';
      break;
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 번역해 주세요.';
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 내용이 비어 있는 번역 결과를 보냈어요.';
    case 'unsaved':
      return `번역 결과를 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'protected-lost':
      return `보호된 구간 ${failure.count}곳이 번역 결과에서 누락됐어요. 다시 번역해 주세요.`;
    case 'protect-invalid':
      return `번역 프롬프트의 보호 패턴을 읽을 수 없어요: ${failure.pattern}`;
  }
  return describeTask(failure, featureTask('translate', '번역하기 전에'));
}

const UNREADABLE = '모델 응답의 형식이 맞지 않아요.';

const wrongField = (label: string) => `모델 응답의 '${label}' 항목이 빠졌거나 형식이 맞지 않아요.`;
const MEMORY_INVALID: Record<Extract<MemoryFailure, { kind: 'invalid' }>['reason'], string> = {
  unreadable: UNREADABLE,
  shape: '모델 응답에 요약이 없어요.',
  order: '모델 응답의 기록 범위가 메시지 순서와 맞지 않아요.',
  short: '모델이 마지막 메시지까지 정리하지 않았어요.',
  when: wrongField('시점'),
  where: wrongField('장소'),
  who: wrongField('인물'),
  what: wrongField('내용'),
  lines: wrongField('대사'),
  outcome: wrongField('결과'),
  to: wrongField('메시지 번호'),
  state: wrongField('상태'),
  opens: wrongField('미해결 사건'),
  closes: wrongField('해결된 사건'),
};

export function describeMemoryFailure(failure: MemoryFailure): string {
  switch (failure.kind) {
    case 'invalid':
      return MEMORY_INVALID[failure.reason];
    case 'unsaved':
      return `기억을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'embed':
      return describeEmbedFailure(failure, `기록이 ${MODEL_ROLES.embed}의 한도보다 길어요.`);
  }
  return describeTask(failure, featureTask('memory', '기억을 정리하기 전에'));
}

const SCENE_INVALID = { unreadable: UNREADABLE, fields: '모델 응답에 빠진 항목이 있어요.', paragraph: '모델이 메시지에 없는 문단 번호를 선택했어요.' } as const;

const COSTS: Record<Costs, string> = {
  plan: '요금제에 무료 이미지 혜택이 없어요. 만들 때마다 Anlas가 차감돼요.',
  size: "이미지 크기가 '크게'로 설정되어 있어 무료로 생성할 수 없어요. 생성할 때마다 Anlas가 차감돼요.",
  steps: '스텝이 무료 범위를 넘어 무료로 만들 수 없어요. 만들 때마다 Anlas가 차감돼요.',
  allowance: '무료 사용량을 다 썼어요. 다시 채워질 때까지 만들 때마다 Anlas가 차감돼요.',
  unknown: '무료로 만들 수 있는지 확인할 수 없어요. 만들면 사용량이 차감될 수 있어요.',
};

export function describeIllustrateFailure(failure: IllustrateFailure): string {
  switch (failure.kind) {
    case 'prompt-missing':
      if (failure.own) return '선택한 삽화 프롬프트가 삭제됐어요. 채팅의 삽화 메뉴에서 다른 프롬프트를 선택해 주세요.';
      break;
    case 'invalid':
      return SCENE_INVALID[failure.reason];
    case 'no-image-model':
      return `${NO_IMAGE_MODEL} ${inSettings('connections')}에서 NovelAI를 연결해 주세요.`;
    case 'image-model-gone':
      return '선택한 이미지 모델이 추가한 모델에 없어요. 채팅의 삽화 메뉴에서 다시 선택해 주세요.';
    case 'undrawn':
      return describeReplyError(failure.error);
    case 'not-a-picture':
      return '모델에서 이미지가 아닌 응답을 보냈어요.';
    case 'costs':
      return COSTS[failure.why];
    case 'file-refused':
      return '서버에서 이미지 저장을 거절했어요.';
    case 'gone':
      return GONE_MESSAGE;
    case 'empty':
      return '내용이 비어 있는 메시지예요.';
    case 'unsaved':
      return `삽화를 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
  return describeTask(failure, featureTask('illustrate', '장면을 정하기 전에'));
}

// The profiles are written by the 장면 모델, so its failures read as the scene's.
export function describeLikenessFailure(failure: LikenessFailure): string {
  switch (failure.kind) {
    case 'unread':
      return `이미지를 읽지 못했어요. ${describeFailure(failure.failure)}`;
    case 'unsaved':
      return `프로필을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'gone':
      return '삭제됐어요.';
    default:
      return describeIllustrateFailure(failure);
  }
}

export function describeStatusFailure(failure: StatusFailure): string {
  switch (failure.kind) {
    case 'invalid':
      return UNREADABLE;
    case 'gone':
      return GONE_MESSAGE;
    case 'unsaved':
      return `상태를 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
  return describeTask(failure, featureTask('status', '상태를 쓰기 전에'));
}

const REMARK_INVALID = { unreadable: UNREADABLE, line: '모델이 대사를 쓰지 않았어요.' } as const;

export function describeMascotFailure(failure: MascotFailure): string {
  switch (failure.kind) {
    case 'invalid':
      return REMARK_INVALID[failure.reason];
    case 'gone':
      return GONE_MESSAGE;
    case 'unsaved':
      return `대사를 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
  return describeTask(failure, featureTask('mascot', '대사를 쓰기 전에'));
}
