import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.25',
  title: '설정 화면을 기능 중심으로 새로 정리했어요',
  text: `## 설정 창과 기능별 화면
- **보던 화면 위의 설정 창**: 넓은 화면에서 **설정**과 **도구**가 보던 화면 위의 창으로 열리고, 바깥을 누르거나 \`Esc\`를 눌러 닫으면 읽던 위치로 돌아와요.
- **기능마다 별도 화면**: **설정** 사이드바에서 각 기능 화면을 열고 상단의 **채팅에서 쓰기** 스위치로 기능을 켜거나 끌 수 있어요.
- **대화 설정 화면**: **설정 › 대화**에서 **대화 모델**과 **응답**·**로어북** 설정을 접지 않고 한눈에 볼 수 있어요.

## 기능별 모델 선택
- **기능 설정에서 모델 선택**: 각 기능의 설정 화면과 채팅 패널에서 그 기능이 쓸 모델을 선택할 수 있어요.
- **캐릭터별 번역·장면 모델**: 채팅에서 **캐릭터별 설정**을 켜면 **번역 모델**과 **장면 모델**도 캐릭터마다 다르게 지정할 수 있어요.
- **기능별 모델 목록**: **설정 › 모델**에서 각 기능에 지정된 모델을 한눈에 확인하고 해당 기능 설정으로 이동할 수 있어요.
- **기존 프롬프트 모델 이동**: 작업 프롬프트에 지정해 둔 모델은 그 프롬프트를 쓰던 기능 설정으로 자동 이동하며, **에이전트**만 계속 프롬프트에서 모델을 지정해요.

## 움직이는 설정 도움말
- **움직이는 장면 안내**: 설정 항목 옆의 **ⓘ**를 누르면 설정에 따라 화면이나 동작이 어떻게 달라지는지 움직이는 장면으로 보여 줘요.
- **옵션별 모습 비교**: 스위치나 두 가지 선택지가 있는 항목은 **켜면**·**끄면** 등 두 모습을 번갈아 보여 주고, 원하는 쪽을 눌러 멈춰 볼 수 있어요.

## 에셋 크게 보기
- **크게 보기와 확대**: 캐릭터 편집의 **에셋**에서 그림을 누르면 크게 열리고, 세로로 긴 그림도 스크롤 없이 한 화면에 보여요.
- **원본 해상도와 단축키**: 그림 위에 원본 해상도가 보이고, 확대해서 원본 픽셀로 볼 수 있어요. 내보내기·이름 바꾸기·삭제도 단축키로 할 수 있어요.

## 그 밖의 개선
- **모델 고정 표시**: 대화 프롬프트가 지정한 모델을 쓰는 채팅은 상단 모델 버튼에 **모델 고정**이 표시돼요.
- **사용량·캐시 표시 위치 이동**: **사용량 표시**와 **캐시 표시** 스위치를 **설정 › 디스플레이**로 옮겼어요.
- **삽화에서 이미지 위치 이동**: **설정 › 삽화**의 **이미지 위치**에서 디스플레이의 위치 설정으로 이동할 수 있어요.`,
};

// Once per version: a restart finds the post there. Nothing before an operator exists, since the operator writes it.
export function publishNews(db: DatabaseSync, version: string | null, news: ReleaseNews | null, now: number) {
  if (version === null || news === null || news.version !== version) return;
  db.prepare(
    `INSERT INTO posts (account_id, title, text, category, version, visibility, created_at)
     SELECT operator_account, ?, ?, 'news', ?, 'public', ? FROM installation
     WHERE operator_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM posts WHERE category = 'news' AND version = ?)`,
  ).run(news.title, news.text, version, now, version);
}
