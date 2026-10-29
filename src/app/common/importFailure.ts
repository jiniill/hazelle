import { EXPANSION, METADATA_BYTES } from '../../engine/import/inflate';
import { USES } from '../../engine/import/tool';
import type { ImportFailure } from '../../engine/import/types';
import { sizeText } from './size';
import { RISU_PLUGIN } from './words';

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '가져올 수 없는 파일 형식이에요.',
  encrypted: '암호화된 캐릭터 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요.',
};

// Importer detail codes not listed here use the generic unreadable-file message.
const DETAIL_FAILURE: Record<string, string> = {
  'other-version': '이전 버전에서 만든 채팅 파일이라 가져올 수 없어요.',
  'not-preset': 'Risu 파일이지만 프리셋 파일이 아니에요.',
  'decrypt-failed': '프리셋을 열지 못했어요. 파일이 깨졌을 수 있어요.',
  'no-template': '프롬프트 템플릿을 쓰지 않는 프리셋은 가져올 수 없어요. Risu에서 템플릿을 켜고 다시 내보내 주세요.',
  'tool-too-large': '플러그인 파일 용량이 너무 커요.',
  'tool-encoding': 'UTF-8 형식의 텍스트 파일이 아니에요.',
  'tool-api': '헤이젤 플러그인 파일이 아니에요. 파일 맨 위에 //@api 1이 있어야 해요.',
  'tool-identity': '//@name과 //@author가 꼭 있어야 하고, 글자와 숫자, _ . - 기호만 쓸 수 있어요.',
  'tool-setting': '설정 줄을 읽지 못했어요.',
  'tool-menu': '메뉴 줄을 읽지 못했어요.',
  'tool-action': '메시지 동작 줄을 읽지 못했어요.',
  'tool-input': '입력창 항목 줄을 읽지 못했어요.',
  'tool-composer': '입력창 줄을 읽지 못했어요.',
  'tool-composer-needed': '입력창 버튼을 쓰려면 //@composer도 있어야 해요.',
  'tool-uses': `//@uses에는 ${USES.join(', ')}만 쓸 수 있어요.`,
  'tool-unknown': '알 수 없는 줄이에요.',
  'risu-old': `예전 버전의 ${RISU_PLUGIN}이라 가져올 수 없어요. API 3.0 플러그인만 쓸 수 있어요.`,
  'risu-name': '//@name이 꼭 있어야 해요.',
  'persona-unreadable': 'Risu 페르소나 PNG 파일이지만 내용을 읽지 못했어요.',
  'persona-incomplete': '이름이나 설명이 빠진 페르소나라 가져올 수 없어요.',
  'expands-too-far': `압축을 풀면 파일 크기의 ${EXPANSION}배가 넘어서 가져올 수 없어요.`,
  'entry-too-large': `이미지를 뺀 내용이 ${sizeText(METADATA_BYTES)}를 넘어서 가져올 수 없어요.`,
};

export function describeImportFailure({ kind, detail, line }: ImportFailure): string {
  const known = detail && DETAIL_FAILURE[detail];
  if (!known) return FAILURE[kind];
  return line ? `${known} ${line}` : known;
}
