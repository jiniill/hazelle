// The public guides (design §6.13). One text for both readers: static.ts writes it into the page for a crawler that
// runs no script, app/guide draws it. A picture is a file under public/guide.

export type GuideBlock = string | { steps: string[] } | { picture: string; alt: string } | { link: string; label: string };
export type Guide = { path: string; title: string; line: string; sections: { title: string; blocks: GuideBlock[] }[] };

export const GUIDE_INDEX = { path: '/guide', title: '헤이젤 가이드', line: 'API 키 연결부터 RisuAI 백업 옮기기까지, 처음 쓸 때 필요한 방법을 정리했어요.' };

const CONNECT = '/guide/connect';
const MOVE = '/guide/move-from-risu';

export const GUIDES: Guide[] = [
  {
    path: CONNECT,
    title: 'API 키 연결하고 대화 시작하는 법',
    line: 'OpenRouter, Claude, Gemini, GPT를 내 API 키로 연결하고 캐릭터와 대화를 시작해요.',
    sections: [
      {
        title: '새 연결 열기',
        blocks: ['첫 화면에서 새 연결을 눌러요. 가입하지 않아도 손님 모드로 바로 쓸 수 있어요.', { picture: '/guide/connect-home.png', alt: '첫 화면의 새 연결 카드' }],
      },
      {
        title: '제공자 선택하기',
        blocks: [
          '목록에서 쓸 제공자를 선택해요. 키 하나로 여러 회사 모델을 쓰려면 OpenRouter가 편해요.',
          '이미 받아 둔 키가 있으면 검색칸에 붙여 넣어도 돼요.',
          { picture: '/guide/connect-providers.png', alt: '제공자 목록과 검색칸' },
        ],
      },
      {
        title: 'API 키 입력하기',
        blocks: [
          { steps: ['API 키 칸 아래 링크로 제공자 사이트에서 키를 만들어요.', '만든 키를 API 키 칸에 붙여 넣어요.', '모델 선택을 눌러요.'] },
          { picture: '/guide/connect-key.png', alt: 'API 키 칸과 모델 선택 버튼' },
          '손님 모드에서는 키가 이 브라우저에만 저장돼요. 계정이 있으면 암호화해서 저장해요.',
        ],
      },
      {
        title: '모델 추가하기',
        blocks: [
          '목록에서 쓸 모델의 + 를 눌러요. 추가한 모델만 채팅의 모델 메뉴에 나와요.',
          '목록에 없는 새 모델은 모델 ID로 추가에서 넣을 수 있어요.',
          { picture: '/guide/connect-models.png', alt: '추가한 모델 두 개와 모델 목록' },
        ],
      },
      {
        title: '봇 가져와서 대화하기',
        blocks: [
          { steps: ['첫 화면에서 봇 가져오기를 눌러요.', 'PNG, charx, zip 파일을 선택해요.', '채팅 시작을 누르고 메시지를 보내요.'] },
          '대화 도중 모델을 바꾸려면 위쪽 모델 버튼을 눌러요. 여기서 바꾸면 이 채팅에만 적용돼요.',
          { picture: '/guide/connect-model-menu.png', alt: '채팅 화면의 모델 메뉴' },
          { picture: '/guide/connect-chat.png', alt: '연결한 모델이 응답한 채팅 화면' },
          '응답마다 메뉴의 응답 정보에서 토큰과 비용을 볼 수 있어요.',
        ],
      },
      { title: 'RisuAI에서 쓰던 봇이 있다면', blocks: [{ link: MOVE, label: 'RisuAI·포켓리스 백업 옮기는 법' }] },
    ],
  },
  {
    path: MOVE,
    title: 'RisuAI·포켓리스 백업 옮기는 법',
    line: 'RisuAI와 포켓리스의 캐릭터, 채팅, 페르소나, 프롬프트, 모듈을 백업 파일로 헤이젤에 옮겨요.',
    sections: [
      {
        title: '백업 파일 받기',
        blocks: [
          { steps: ["RisuAI 앱: '로컬 백업 저장'으로 받아요.", "포켓리스: '로컬 백업 다운로드'로 받아요.", "risuai.xyz: '부분 백업'으로 받아요. 이미지까지 옮기려면 전체 백업도 함께 받아요."] },
          "risuai.xyz의 전체 백업은 고급 설정에서 'Skip Saving Assets on Web Sync'를 꺼야 이미지가 들어 있어요. 전체 백업만으로는 가져올 수 없어요.",
        ],
      },
      {
        title: 'Risu에서 이사 열기',
        blocks: [
          { steps: ['첫 화면에서 Risu에서 이사를 눌러요.', '안내를 읽고 확인했어요를 눌러요.', '파일 가져오기로 백업 파일을 넣고 백업 읽기를 눌러요.'] },
          { picture: '/guide/move-dialog.png', alt: 'Risu에서 이사 창의 백업 파일 칸' },
          '제작자가 RisuAI에서만 쓰도록 배포한 봇은 가져오지 마세요.',
        ],
      },
      {
        title: '가져올 항목 선택하기',
        blocks: ['캐릭터, 페르소나, 프롬프트, 모듈이 모두 선택되어 있어요. 빼고 싶은 것만 해제해요.', '이미 옮긴 항목은 이미 있음으로 표시되고, 새 백업으로 다시 하면 나머지만 가져와요.', '중간에 끊겨도 다시 시도하면 멈춘 곳부터 이어서 가져와요.'],
      },
      {
        title: '옮겨지지 않는 것',
        blocks: [
          { steps: ['HypaPlus, LIBRA 같은 장기 기억 플러그인이 쌓은 기억', '포켓리스의 모델·메모리 프리셋과 키 풀'] },
          '옮긴 채팅은 장기 기억이 꺼진 채로 시작해요. 켜면 그때 요약해요.',
        ],
      },
      { title: '옮긴 다음에는', blocks: ['대화하려면 모델을 연결해야 해요.', { link: CONNECT, label: 'API 키 연결하고 대화 시작하는 법' }] },
    ],
  },
];
