import { expect, it } from 'vitest';
import type { Receipt } from '../../model/chat';
import type { AgentFailed } from '../../runtime/tasks/agents';
import { describeAgentFailure, describeAskFailure, describeFailure, describeIllustrateFailure, describeMascotFailure, describeMemoryFailure, describePrereadFailure, describeTranslateFailure, describeTurnFailure } from './failure';

const failed = { error: null } as Receipt;
const refused = { error: { kind: 'network', detail: '' } } as Receipt;
const api = { ok: false, error: 'conflict' } as const;
const route = [{ kind: 'no-model' }, { kind: 'model-gone' }, { kind: 'image-only' }, { kind: 'profile-missing', own: true }, { kind: 'profile-missing', own: false }] as const;
const said = <F>(describe: (failure: F) => string, failures: readonly F[]) => failures.map(describe);

it('has words of its own for each refusal the server answers about the account, not the generic server trouble', () => {
  const generic = describeFailure({ ok: false, error: 'not-a-code' });
  const codes = ['account-mismatch', 'suspended', 'too-many-calls', 'storage-full', 'file-blocked', 'username-taken', 'too-many-reports', 'not-admin', 'signup-closed', 'too-many-signups', 'sole-operator', 'account-leaving', 'guest-board-blocked', 'guest-board-closed'];
  const words = codes.map((error) => describeFailure({ ok: false, error }));
  expect(words).not.toContain(generic);
  expect(new Set(words).size).toBe(codes.length);
  expect(generic).toContain('(not-a-code)');
  expect(describeFailure({ ok: false, error: 'server-error', status: 403 })).toContain('(server-error 403)');
});

it('says each task failure in its own words', () => {
  expect(
    said(describeTurnFailure, [
      ...route,
      { kind: 'prompt-missing', own: true },
      { kind: 'prompt-missing', own: false },
      { kind: 'persona-missing', from: 'chat' },
      { kind: 'persona-missing', from: 'character' },
      { kind: 'persona-missing', from: 'current' },
      { kind: 'runaway' },
      { kind: 'tokenizer' },
      { kind: 'too-long', tokens: 0, budget: 0 },
      { kind: 'too-long', tokens: 9000, budget: 8000 },
      { kind: 'unstarted', failure: api },
      { kind: 'unpulled', failure: api },
      { kind: 'gone' },
      { kind: 'unsent', failure: api },
      { kind: 'unsaved', reply: null, failure: api },
      { kind: 'busy' },
      { kind: 'untranslated', failure: { kind: 'stopped' } },
      { kind: 'untranslated', failure: { kind: 'tokenizer' } },
      { kind: 'preread', failure: { kind: 'stopped' } },
      { kind: 'preread', failure: { kind: 'prompt-missing' } },
      { kind: 'agent', failure: { name: '장면 메모', failure: { kind: 'runaway' } } },
      { kind: 'additional', failure: { kind: 'no-model' } },
      { kind: 'additional', failure: { kind: 'embed', reason: 'too-large', receipt: null } },
      { kind: 'additional', failure: { kind: 'embed', reason: 'failed', receipt: refused } },
      { kind: 'additional', failure: { kind: 'embed', reason: 'failed', receipt: null } },
    ]),
  ).toEqual([
    '대화 모델이 지정되지 않았어요. 모델 버튼에서 모델을 선택해 주세요.',
    '선택한 모델이 추가한 모델에 없어요. 모델 버튼에서 다시 선택해 주세요.',
    '선택한 모델은 이미지만 만들 수 있어요. 모델 버튼에서 다른 모델을 선택해 주세요.',
    '이 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '이 채팅에서 쓰던 프롬프트가 삭제됐어요. 다른 프롬프트를 선택해 주세요.',
    '기본 프롬프트가 없어요. 설정 › 프롬프트에서 프롬프트 하나를 기본으로 지정해 주세요.',
    '이 채팅에서 쓰던 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
    '이 캐릭터에 고정해 둔 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
    '현재 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
    '명령어 실행 결과가 너무 길어서 보내기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 보내 주세요.',
    '응답 최대 길이가 컨텍스트 길이만큼 커서 프롬프트를 넣을 수 없어요. 설정 › 모델에서 이 모델의 응답 최대 길이를 줄여 주세요.',
    '마지막 메시지만 넣어도 프롬프트가 약 9,000 토큰이라, 이 모델에 넣을 수 있는 한도(8,000 토큰)를 넘어요. 프롬프트나 로어북 내용을 줄이거나, 설정 › 모델에서 이 모델이 쓰는 모델 설정을 바꿔 주세요.',
    '채팅을 만들지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '최신 대화를 불러오지 못해서 보내지 않았어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '다른 기기에서 삭제돼서 보내지 않았어요.',
    '보낸 메시지를 저장하지 못해서 응답 생성을 멈췄어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '응답을 저장하지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '응답을 생성하는 중이라 보내지 않았어요. 응답이 끝난 뒤 다시 보내 주세요.',
    '번역을 멈춰서 메시지를 보내지 않았어요.',
    '메시지를 번역하지 못해서 보내지 않았어요. 토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 번역해 주세요.',
    '토큰 절약 중에 멈춰서 메시지를 보내지 않았어요.',
    '토큰 절약에 실패해서 메시지를 보내지 않았어요. 기본 토큰 절약 프롬프트가 없어요. 설정 › 프롬프트에서 토큰 절약 프롬프트 하나를 기본으로 지정해 주세요.',
    '장면 메모가 실패해서 메시지를 보내지 않았어요. 명령어 실행 결과가 너무 길어서 호출하기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '추가 설명을 찾지 못해서 메시지를 보내지 않았어요. 임베딩 모델이 지정되지 않았어요. 설정 › 모델에서 모델을 선택해 주세요.',
    '추가 설명을 찾지 못해서 메시지를 보내지 않았어요. 문단 하나가 임베딩 모델의 한도보다 길어요. 빈 줄로 더 나눠 주세요.',
    '추가 설명을 찾지 못해서 메시지를 보내지 않았어요. 응답을 받다가 연결이 끊겼어요.',
    '추가 설명을 찾지 못해서 메시지를 보내지 않았어요. 임베딩 모델을 호출하지 못했어요.',
  ]);
  expect(
    said((failure: AgentFailed['failure']) => describeAgentFailure({ name: '장면 메모', failure }), [
      ...route,
      { kind: 'tokenizer' },
      { kind: 'runaway' },
      { kind: 'protect-invalid', pattern: '[' },
      { kind: 'failed', receipt: failed },
      { kind: 'failed', receipt: refused },
      { kind: 'lost', receipt: failed, count: 2 },
      { kind: 'unsaved', failure: api },
    ]),
  ).toEqual([
    '장면 메모 모델이 지정되지 않았어요. 장면 메모 프롬프트 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '장면 메모 모델이 추가한 모델에 없어요. 장면 메모 프롬프트 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 장면 메모 모델은 이미지만 만들 수 있어요. 장면 메모 프롬프트 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '장면 메모 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
    '명령어 실행 결과가 너무 길어서 호출하기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '보호 패턴을 읽을 수 없어요: [',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '보호된 구간 2곳이 누락되어 다듬은 응답을 적용하지 않았어요.',
    '다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
  ]);
  expect(said(describePrereadFailure, [...route, { kind: 'prompt-missing' }, { kind: 'tokenizer' }, { kind: 'runaway' }, { kind: 'failed', receipt: failed }, { kind: 'failed', receipt: refused }, { kind: 'unsaved', failure: api }])).toEqual([
    '토큰 절약 모델이 지정되지 않았어요. 설정 › 토큰 절약 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '토큰 절약 모델이 추가한 모델에 없어요. 설정 › 토큰 절약 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 토큰 절약 모델은 이미지만 만들 수 있어요. 설정 › 토큰 절약 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '토큰 절약 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '기본 토큰 절약 프롬프트가 없어요. 설정 › 프롬프트에서 토큰 절약 프롬프트 하나를 기본으로 지정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
    '명령어 실행 결과가 너무 길어서 줄이기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
  ]);
  expect(
    said(describeTranslateFailure, [
      ...route,
      { kind: 'prompt-missing', own: true },
      { kind: 'prompt-missing', own: false },
      { kind: 'runaway' },
      { kind: 'tokenizer' },
      { kind: 'failed', receipt: failed },
      { kind: 'failed', receipt: refused },
      { kind: 'unsaved', failure: api },
      { kind: 'protected-lost', count: 2 },
      { kind: 'protect-invalid', pattern: '[' },
    ]),
  ).toEqual([
    '번역 모델이 지정되지 않았어요. 설정 › 번역 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '번역 모델이 추가한 모델에 없어요. 설정 › 번역 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 번역 모델은 이미지만 만들 수 있어요. 설정 › 번역 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '번역 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '선택한 번역 프롬프트가 삭제됐어요. 채팅의 번역 메뉴에서 다른 프롬프트를 선택해 주세요.',
    '기본 번역 프롬프트가 없어요. 설정 › 프롬프트에서 번역 프롬프트 하나를 기본으로 지정해 주세요.',
    '명령어 실행 결과가 너무 길어서 번역하기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 번역해 주세요.',
    '모델이 내용이 비어 있는 번역 결과를 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '번역 결과를 저장하지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '보호된 구간 2곳이 번역 결과에서 누락됐어요. 다시 번역해 주세요.',
    '번역 프롬프트의 보호 패턴을 읽을 수 없어요: [',
  ]);
  expect(
    said(describeMemoryFailure, [
      ...route,
      { kind: 'prompt-missing' },
      { kind: 'runaway' },
      { kind: 'tokenizer' },
      { kind: 'failed', receipt: failed },
      { kind: 'failed', receipt: refused },
      { kind: 'invalid', receipt: failed, reason: 'short' },
      { kind: 'unsaved', failure: api },
      { kind: 'embed', reason: 'too-large', receipt: null },
      { kind: 'embed', reason: 'failed', receipt: null },
    ]),
  ).toEqual([
    '기억 모델이 지정되지 않았어요. 설정 › 장기 기억 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '기억 모델이 추가한 모델에 없어요. 설정 › 장기 기억 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 기억 모델은 이미지만 만들 수 있어요. 설정 › 장기 기억 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '기억 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '기본 기억 프롬프트가 없어요. 설정 › 프롬프트에서 기억 프롬프트 하나를 기본으로 지정해 주세요.',
    '명령어 실행 결과가 너무 길어서 기억을 정리하기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '모델이 마지막 메시지까지 정리하지 않았어요.',
    '기억을 저장하지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '기록이 임베딩 모델의 한도보다 길어요.',
    '임베딩 모델을 호출하지 못했어요.',
  ]);
  expect(
    said(describeIllustrateFailure, [
      ...route,
      { kind: 'prompt-missing', own: true },
      { kind: 'prompt-missing', own: false },
      { kind: 'tokenizer' },
      { kind: 'runaway' },
      { kind: 'failed', receipt: failed },
      { kind: 'failed', receipt: refused },
      { kind: 'invalid', receipt: failed, reason: 'fields' },
      { kind: 'no-image-model' },
      { kind: 'image-model-gone' },
      { kind: 'undrawn', error: { kind: 'network', detail: '' } },
      { kind: 'not-a-picture' },
      { kind: 'costs', why: 'plan' },
      { kind: 'file-refused' },
      { kind: 'gone' },
      { kind: 'empty' },
      { kind: 'unsaved', failure: api },
    ]),
  ).toEqual([
    '장면 모델이 지정되지 않았어요. 설정 › 삽화 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '장면 모델이 추가한 모델에 없어요. 설정 › 삽화 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 장면 모델은 이미지만 만들 수 있어요. 설정 › 삽화 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '장면 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '선택한 삽화 프롬프트가 삭제됐어요. 채팅의 삽화 메뉴에서 다른 프롬프트를 선택해 주세요.',
    '기본 삽화 프롬프트가 없어요. 설정 › 프롬프트에서 삽화 프롬프트 하나를 기본으로 지정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
    '명령어 실행 결과가 너무 길어서 장면을 정하기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '모델 응답에 빠진 항목이 있어요.',
    '연결된 이미지 모델이 없어요. 설정 › API 연결에서 NovelAI를 연결해 주세요.',
    '선택한 이미지 모델이 추가한 모델에 없어요. 채팅의 삽화 메뉴에서 다시 선택해 주세요.',
    '응답을 받다가 연결이 끊겼어요.',
    '모델에서 이미지가 아닌 응답을 보냈어요.',
    '요금제에 무료 이미지 혜택이 없어요. 만들 때마다 Anlas가 차감돼요.',
    '서버에서 이미지 저장을 거절했어요.',
    '삭제된 메시지예요.',
    '내용이 비어 있는 메시지예요.',
    '삽화를 저장하지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
  ]);
  expect(
    said(describeMascotFailure, [
      ...route,
      { kind: 'prompt-missing' },
      { kind: 'tokenizer' },
      { kind: 'runaway' },
      { kind: 'failed', receipt: failed },
      { kind: 'failed', receipt: refused },
      { kind: 'invalid', receipt: failed, reason: 'line' },
      { kind: 'gone' },
      { kind: 'unsaved', failure: api },
    ]),
  ).toEqual([
    '대사 모델이 지정되지 않았어요. 설정 › 마스코트 또는 설정 › 모델에서 모델을 선택해 주세요.',
    '대사 모델이 추가한 모델에 없어요. 설정 › 마스코트 또는 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 대사 모델은 이미지만 만들 수 있어요. 설정 › 마스코트 또는 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '대사 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '기본 마스코트 프롬프트가 없어요. 설정 › 프롬프트에서 마스코트 프롬프트 하나를 기본으로 지정해 주세요.',
    '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
    '명령어 실행 결과가 너무 길어서 대사를 쓰기 전에 멈췄어요. 캐릭터나 로어북, 프롬프트, 메시지 안에서 서로를 끝없이 호출하는 명령어가 있어요. 해당 명령어를 수정해 주세요.',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '모델이 대사를 쓰지 않았어요.',
    '삭제된 메시지예요.',
    '대사를 저장하지 못했어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
  ]);
  expect(said(describeAskFailure, [...route, { kind: 'failed', receipt: failed }, { kind: 'failed', receipt: refused }, { kind: 'unsaved', failure: api }, { kind: 'too-many-calls' }])).toEqual([
    '대화 모델이 지정되지 않았어요. 설정 › 모델에서 모델을 선택해 주세요.',
    '대화 모델이 추가한 모델에 없어요. 설정 › 모델에서 다시 선택해 주세요.',
    '선택한 대화 모델은 이미지만 만들 수 있어요. 설정 › 모델에서 다른 모델을 선택해 주세요.',
    '대화 모델이 쓰던 모델 설정이 삭제됐어요. 설정 › 모델에서 다른 모델 설정을 선택해 주세요.',
    '기본으로 지정한 모델 설정이 없어요. 설정 › 모델에서 모델 설정 하나를 기본으로 지정해 주세요.',
    '모델이 내용이 비어 있는 응답을 보냈어요.',
    '응답을 받다가 연결이 끊겼어요.',
    '사용량을 저장하지 못해 답을 버렸어요. 다른 기기에서 동시에 바꿔서 저장하지 못했어요. 다시 시도해 주세요.',
    '모델이 테스트만 반복하고 답을 주지 않아서 멈췄어요.',
  ]);
});
