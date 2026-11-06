// The public guides (design §6.13). One text for both readers: static.ts writes it into the page for a crawler that
// runs no script, app/guide draws it. A picture is a file under public/guide.

// A Hazelle control's name stands in 「」 and is drawn as a button's name; another app's menu stays in quotes.
export const spans = (text: string) => text.split(/「([^」]+)」/).map((part, index) => ({ text: part, control: index % 2 === 1 }));

export type GuideStep = string | { text: string; note?: string; picture?: { src: string; alt: string; caption: string } };
export type GuideBlock = string | { steps: GuideStep[] } | { list: string[] } | { tip: string } | { warn: string } | { table: { columns: string[]; rows: string[][] } };
export type GuideTopic = 'connect' | 'move' | 'feature';
export type Guide = {
  path: string;
  topic: GuideTopic;
  title: string;
  line: string;
  // The day it last changed, YYYY-MM-DD: the page's meta, the Article's dateModified and the sitemap's lastmod.
  updated: string;
  needs: string[];
  sections: { id: string; title: string; blocks: GuideBlock[] }[];
  faq: { question: string; answer: string }[];
  end: { title: string; line: string; link: string; label: string };
};

export const GUIDE_INDEX = { path: '/guide', title: '헤이젤 가이드', line: 'API 키 연결과 백업 이사를 안내해요.' };
export const GUIDE_TOPICS: Record<GuideTopic, string> = { connect: '연결', move: '옮기기', feature: '기능' };
export const GUIDE_WORDS = { path: '가이드', contents: '목차', needs: '준비할 것', faq: '자주 묻는 질문' };

export function guideMeta({ updated }: Guide): string {
  const [year, month, day] = updated.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일 수정`;
}

export const GUIDES: Guide[] = [
  {
    path: '/guide/api-key',
    topic: 'connect',
    title: 'Claude·GPT·Gemini API 키 받는 법',
    line: 'OpenRouter, OpenAI, Anthropic, Google에서 API 키를 받아 헤이젤에 연결해요.',
    updated: '2026-11-06',
    needs: ['키를 받을 제공자 계정', '유료 모델을 쓰려면 결제 수단'],
    sections: [
      {
        id: 'pick',
        title: '제공자 선택하기',
        blocks: [
          {
            table: {
              columns: ['제공자', '쓸 수 있는 모델'],
              rows: [
                ['OpenRouter', 'Claude, GPT, Gemini 등 여러 제공자 모델'],
                ['OpenAI', 'GPT'],
                ['Anthropic', 'Claude'],
                ['Google', 'Gemini'],
              ],
            },
          },
          '키 하나로 여러 모델을 쓰려면 OpenRouter, 특정 제공자 모델만 쓰려면 해당 제공자에서 받아요.',
          { tip: '헤이젤의 키 입력 화면에도 각 제공자의 키 페이지 링크가 있어요.' },
        ],
      },
      {
        id: 'openrouter',
        title: 'OpenRouter에서 받기',
        blocks: [
          {
            steps: [
              'openrouter.ai에 로그인하고 openrouter.ai/settings/keys를 열어요.',
              { text: "'Create API Key'를 눌러 이름과 금액 한도(Credit limit)를 정하고 키를 만들어요.", note: '한도를 정해 두면 키가 유출되어도 한도 이상 결제되지 않아요.' },
              "유료 모델을 쓰려면 'Credits'에서 크레딧을 충전해요.",
            ],
          },
          '무료 모델은 하루 50번까지, 크레딧을 10달러 이상 충전한 계정은 하루 1,000번까지 쓸 수 있어요.',
        ],
      },
      {
        id: 'openai',
        title: 'OpenAI에서 받기',
        blocks: [{ steps: ['platform.openai.com에 로그인하고 platform.openai.com/api-keys를 열어요.', "'Create new secret key'를 눌러 키를 만들어요.", "'Billing'에서 크레딧을 충전해요."] }],
      },
      {
        id: 'anthropic',
        title: 'Anthropic에서 받기',
        blocks: [
          {
            steps: [
              'platform.claude.com에 로그인하고 platform.claude.com/settings/keys를 열어요.',
              "'Create Key'를 누르고 이름을 입력해 키를 만들어요.",
              { text: 'sk-ant-로 시작하는 키를 복사해요.', note: '키는 만들 때 한 번만 보여 줘요. 잃어버리면 새로 만들어요.' },
            ],
          },
          "'Billing'에서 크레딧을 충전해요.",
        ],
      },
      {
        id: 'google',
        title: 'Google에서 받기',
        blocks: [
          { steps: [{ text: 'aistudio.google.com/apikey를 열어요.', note: '처음 열면 약관 동의 후 기본 프로젝트와 키가 만들어져요.' }, "키를 더 만들려면 'Create API key'를 눌러요."] },
          '결제 수단을 연결하지 않으면 일일 한도가 있는 무료 등급으로 쓸 수 있어요.',
        ],
      },
      {
        id: 'connect',
        title: '헤이젤에 키 연결하기',
        blocks: [
          {
            steps: [
              '첫 화면이나 설정 › API 연결에서 「새 연결」을 눌러요.',
              { text: '위쪽 입력 칸에 키를 붙여 넣고 「이 키로 연결하고 모델 선택」을 눌러요.', note: '어느 제공자 키인지 자동으로 인식해요. 목록에서 제공자를 선택해 키를 입력하고 「모델 선택」을 눌러도 돼요.' },
              '모델 목록에서 쓸 모델 오른쪽의 「+」를 눌러 추가해요.',
            ],
          },
          { tip: '키는 암호화해서 저장하고, 서버에는 남기지 않아요.' },
          { warn: '키는 비밀번호처럼 다뤄요. 유출되었다면 제공자의 키 페이지에서 삭제하고 새로 만들어요.' },
        ],
      },
    ],
    faq: [
      { question: '무료로 쓸 수 있나요?', answer: 'OpenRouter의 무료 모델과 Google의 무료 등급은 결제 없이 일일 한도 안에서 쓸 수 있어요.' },
      { question: '키를 잃어버렸어요.', answer: '제공자의 키 페이지에서 새로 만들고, 헤이젤의 연결 메뉴(「⋯」)에서 「키 변경」을 눌러 바꿔요.' },
      { question: '키를 입력했는데 연결이 안 돼요.', answer: '키를 끝까지 복사했는지, 크레딧이 남아 있는지 확인해요.' },
    ],
    end: { title: '키를 받았으면 연결해요', line: '키를 연결하고 모델을 추가하면 대화할 수 있어요.', link: '/connections/new', label: 'API 키 연결하기' },
  },
  {
    path: '/guide/move-from-risu',
    topic: 'move',
    title: 'RisuAI·포켓리스 백업 옮기는 법',
    line: 'RisuAI와 포켓리스의 캐릭터, 채팅, 페르소나, 프롬프트, 모듈을 백업 파일로 헤이젤에 옮겨요.',
    updated: '2026-11-06',
    needs: ['RisuAI나 포켓리스에서 받은 백업 파일'],
    sections: [
      {
        id: 'backup',
        title: '백업 파일 받기',
        blocks: [
          { list: ["RisuAI 앱에서 '로컬 백업 저장'으로 받아요.", "포켓리스에서 '로컬 백업 다운로드'로 받아요.", "risuai.xyz에서 '부분 로컬 백업 저장'으로 받아요. 캐릭터·채팅 이미지까지 옮기려면 '로컬 백업 저장'(전체 백업)도 함께 받아요."] },
          { tip: "risuai.xyz의 전체 백업은 고급 설정에서 'Skip Saving Assets on Web Sync'를 꺼야 이미지가 들어 있어요. 전체 백업만으로는 가져올 수 없어요." },
        ],
      },
      {
        id: 'open',
        title: 'Risu에서 이사 열기',
        blocks: [
          {
            steps: [
              '첫 화면이나 캐릭터 목록의 「+」(추가) 메뉴에서 「Risu에서 이사」를 눌러요.',
              '처음 가져올 때 나오는 안내를 읽고 「확인했어요」를 눌러요.',
              { text: '「파일 가져오기」로 백업 파일을 선택하고 「백업 읽기」를 눌러요.', picture: { src: '/guide/move-dialog.png', alt: 'Risu에서 이사 창의 백업 파일 칸', caption: 'Risu에서 이사 창. 백업 파일 칸에서 파일을 선택해요.' } },
            ],
          },
          { warn: '제작자가 RisuAI에서만 쓰도록 배포한 봇은 가져오지 마세요.' },
        ],
      },
      {
        id: 'pick',
        title: '가져올 항목 선택하기',
        blocks: ['캐릭터, 페르소나, 프롬프트, 모듈에서 빼고 싶은 항목만 선택을 해제하고 「가져오기」를 눌러요.', "가져온 적 있는 캐릭터와 모듈은 '이미 있음'으로 표시되어, 새 백업을 열면 새 항목만 가져와요.", { tip: '중간에 끊겨도 「다시 시도」를 누르면 멈춘 곳부터 이어서 가져와요.' }],
      },
      {
        id: 'what',
        title: '옮겨지는 것과 아닌 것',
        blocks: [
          {
            table: {
              columns: ['항목', '옮겨지나요'],
              rows: [
                ['캐릭터, 채팅, 기본 장기 기억(HypaV2·V3, SupaMemory), 페르소나', '옮겨져요'],
                ['프롬프트, 모듈', '옮겨져요'],
                ['HypaPlus, LIBRA 같은 장기 기억 플러그인이 쌓은 기억', '안 옮겨져요'],
                ['포켓리스의 모델·메모리 프리셋과 키 풀', '안 옮겨져요'],
              ],
            },
          },
          'Risu 기본 장기 기억이 있던 채팅은 켜진 채로 옮겨지고, 없던 채팅은 꺼진 채로 시작해요.',
        ],
      },
    ],
    faq: [
      { question: '중간에 끊기면 처음부터 다시 해야 하나요?', answer: '「다시 시도」를 누르면 멈춘 곳부터 이어서 가져와요.' },
      { question: '가져온 적 있는 캐릭터를 다시 가져오면 어떻게 되나요?', answer: "'이미 있음'으로 표시되어 건너뛰고, 새로 추가된 항목만 가져와요." },
      { question: '옮긴 채팅의 장기 기억은요?', answer: 'Risu 기본 장기 기억이 있던 채팅은 켜진 채로 옮겨지고, 없던 채팅은 꺼진 채로 시작해 켤 때 요약해요.' },
    ],
    end: { title: '옮긴 다음에는 모델을 연결해요', line: '대화하려면 모델을 연결해야 해요.', link: '/connections/new', label: 'API 키 연결하기' },
  },
];
