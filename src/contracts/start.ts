// The first visitor's page: the server writes these words for crawlers (static.ts) and the app draws the same words
// around its live parts (app/start), so what a search engine reads is what a person reads.
export const START_PAGE = {
  title: '헤이젤 · 내 API 키로 웹에서 하는 AI 캐릭터 챗, RisuAI 봇까지',
  line: '설치나 가입 없이 브라우저에서 GPT, Claude, Gemini를 API 키로 연결해요.',
  heading: '내 API 키로 바로 시작하는 AI 캐릭터 챗',
  example: { title: '이런 대화를 나눠요', line: '하고 싶은 말을 눌러 보세요.' },
  keys: { title: 'API 키는 여기서 받아요', line: 'GPT, Claude, Gemini가 대표적이에요. 쓰고 싶은 곳에서 키를 만들어 오면 돼요. 요금은 쓴 만큼 제공자에게만 내요.' },
  trial: {
    title: '지금 연결해 봐요',
    line: '여기서 연결한 키는 자동 저장돼요.',
    steps: ['API 키 붙여 넣기', '모델 선택', '대화하기'],
    privacy: '키는 이 브라우저에만 저장하고, 제공자에게 바로 보내요.',
  },
  features: {
    title: '대화가 길어져도, 봇이 복잡해도',
    points: ['로어북, 정규식, Lua, CBS를 지원해요', '장기 기억, 번역, 삽화까지 한 곳에서 써요', '대화는 브라우저에서 암호화한 뒤 저장해요'],
  },
  move: { label: 'RisuAI·포켓리스 백업 옮기는 법', path: '/guide/move-from-risu' },
  finish: { title: '지금 바로 시작해 봐요' },
} as const;

// The same walk for someone who already uses the app. It has no live part: its trial runs on this browser's guest, which would add to a guest's data or wait to be merged into an account.
export const START_AGAIN = {
  path: '/welcome',
  open: '첫 페이지 다시 보기',
  back: '앱으로 돌아가기',
  line: '키 연결은 앱에서 바로 할 수 있어요.',
  connect: '연결 화면 열기',
} as const;
