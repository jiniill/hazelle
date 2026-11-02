// The public guides (design §6.13). One text for both readers: static.ts writes it into the page for a crawler that
// runs no script, app/guide draws it. A picture is a file under public/guide.

export type GuideBlock = string | { steps: string[] } | { picture: string; alt: string } | { link: string; label: string };
export type Guide = { path: string; title: string; line: string; sections: { title: string; blocks: GuideBlock[] }[] };

export const GUIDE_INDEX = { path: '/guide', title: '헤이젤 가이드', line: '처음 시작할 때 필요한 안내예요.' };

const MOVE = '/guide/move-from-risu';

export const GUIDES: Guide[] = [
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
      { title: '옮긴 다음에는', blocks: ['대화하려면 모델을 연결해야 해요.', { link: '/', label: 'API 키 연결하고 대화 시작하기' }] },
    ],
  },
];
