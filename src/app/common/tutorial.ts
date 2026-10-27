import type { Route } from '../shell/routes';

// The controls a tutorial points at; each screen wraps its control in a GuideMark of the name (design §6.17).
export const MARKS = {
  connectNew: 'connect-new',
  connectType: 'connect-type',
  connectKey: 'connect-key',
  modelAdd: 'model-add',
  modelAdded: 'model-added',
} as const;
type Mark = (typeof MARKS)[keyof typeof MARKS];

// What the steps read. connection: the account's first connection, null while it has none.
export type Facts = { route: Route; connection: string | null; added: boolean };

// Completion reads state, never clicks, so already-done steps skip and resume correctly.
// at locates the control for resumption; above prevents the note from covering following content.
export type Step = { mark: Mark; label: string; text: string; done: (facts: Facts) => boolean; at: (facts: Facts) => Route; go?: { label: string; route: Route }; above?: boolean };
export type Tutorial = { id: string; title: string; description: string; steps: Step[]; finish: { title: string; text: string } };

const ADD: Route = { kind: 'add-connection' };
const NEW_CHAT: Route = { kind: 'new-chat', character: null };
const on = (facts: Facts, ...kinds: Route['kind'][]) => kinds.includes(facts.route.kind);

export const TUTORIALS: Tutorial[] = [
  {
    id: 'first-reply',
    title: 'AI 연결하고 대화 시작하기',
    description: 'API 키를 넣고 모델을 골라 대화를 시작해요',
    steps: [
      { mark: MARKS.connectNew, label: '새 연결', text: 'AI를 쓰려면 먼저 연결해요. 여기를 눌러요.', done: (facts) => facts.connection !== null || on(facts, 'add-connection', 'connect', 'connect-direct'), at: () => ADD },
      { mark: MARKS.connectType, label: '제공자 선택', text: '쓸 제공자를 골라요. 키가 있거나 로그인할 수 있는 곳이면 돼요.', done: (facts) => facts.connection !== null || on(facts, 'connect', 'connect-direct'), at: () => ADD },
      { mark: MARKS.connectKey, label: '키 넣기', text: 'API 키를 붙여 넣고 모델 선택을 눌러요. 로그인하는 곳은 안내대로 로그인해요.', done: (facts) => facts.connection !== null, at: () => ADD, above: true },
      { mark: MARKS.modelAdd, label: '모델 추가', text: '쓸 모델 옆의 +를 눌러 추가해요. 처음 추가한 모델로 대화해요.', done: (facts) => facts.added, at: (facts) => ({ kind: 'connection', id: facts.connection! }), above: true },
      { mark: MARKS.modelAdded, label: '대화 시작', text: '모델을 추가했어요. 이제 대화를 시작해 봐요.', go: { label: '대화 시작하기', route: NEW_CHAT }, done: (facts) => on(facts, 'new-chat', 'chat'), at: (facts) => ({ kind: 'connection', id: facts.connection! }) },
    ],
    finish: { title: '튜토리얼 완료', text: '대화할 준비가 끝났어요. 아무 말이나 보내 보거나, 봇을 가져와 대화해 봐요.' },
  },
];

// The step to show, or null once every step is done: the tutorial's end.
export function stepAt(tutorial: Tutorial, facts: Facts): number | null {
  const at = tutorial.steps.findIndex((step) => !step.done(facts));
  return at === -1 ? null : at;
}
