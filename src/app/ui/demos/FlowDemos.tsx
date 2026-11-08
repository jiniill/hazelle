import { ArrowDown, ArrowRight, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import type { Way } from './Demo';
import { appears, join, Line, type Lines, PARAGRAPHS, Unfold, when } from './DemoParts';
import styles from './FlowDemos.module.css';

// A piece of a prompt or a lorebook; added ones are the accent.
function Part({ added = false, motion, at, children }: { added?: boolean; motion?: string | false; at?: number; children: ReactNode }) {
  return (
    <span className={join(styles.part, added && styles.added, motion)} style={when(at)}>
      {children}
    </span>
  );
}

function Turns({ lines }: { lines: Lines }) {
  return (
    <span className={styles.turns}>
      {lines.map((width, turn) => (
        <Line key={turn} width={width} />
      ))}
    </span>
  );
}

// at: when the request is sent, a share of the round. spent: its cost, a share of the first's without a cache.
const REQUESTS = [
  { which: '첫 요청', step: '캐시에 저장', spent: 92, at: 0.05 },
  { which: '다음 요청', step: '캐시에서 읽기', spent: 30, at: 0.35, cached: true },
];

export function PromptCacheDemo() {
  return (
    <span className={styles.flow}>
      {REQUESTS.map(({ which, step, spent, at, cached }) => (
        <span key={which} className={join(styles.request, appears)} style={when(at, { '--spent': `${spent}%` })}>
          <span className={styles.which}>{which}</span>
          <span className={styles.bar}>
            <span className={join(styles.prefix, cached && styles.cached)}>앞부분 · {step}</span>
            <span className={styles.rest}>새 말</span>
          </span>
          <span className={styles.which}>비용</span>
          <span className={styles.cost}>
            <span className={join(styles.spent, cached && styles.saved)} />
          </span>
        </span>
      ))}
    </span>
  );
}

// A message's two versions; way 0 sends the model the one the reader reads, way 1 the original.
const { translated, original } = PARAGRAPHS[1];
// look: the version's own, which its copy sent to the model keeps.
type Version = { label: string; text: string; look?: string };
const VERSIONS: readonly [Version, Version] = [
  { label: '화면', text: translated },
  { label: '원문', text: original, look: styles.original },
];
const PICKED = 0.14;
const SENT = 0.3;

export function ReverseDemo({ way }: { way: Way }) {
  return (
    <span className={styles.lanes}>
      {VERSIONS.map(({ label, text, look }, at) => (
        <span key={label} className={styles.lane}>
          <span className={styles.which}>{label}</span>
          <span className={join(styles.said, look, at === way && styles.marked)} style={when(PICKED)}>
            {text}
          </span>
        </span>
      ))}
      <span className={join(styles.lane, styles.sent, appears)} style={when(SENT)}>
        <span className={styles.which}>
          <Icon icon={ArrowDown} size="sm" />
        </span>
        <span />
        <span className={styles.which}>모델</span>
        <span className={join(styles.said, VERSIONS[way].look, styles.marked)}>{VERSIONS[way].text}</span>
      </span>
    </span>
  );
}

// The keyword and its entry light at once; then the entry's content joins the prompt.
const KEYWORD = '등대';
const ENTRIES = [KEYWORD, '숲'];
const MATCHED = 0.22;

export function LorebookDemo() {
  return (
    <span className={styles.lore}>
      <span className={join(styles.asked, appears)} style={when(0.04)}>
        오늘 밤{' '}
        <span className={join(styles.keyword, styles.marked)} style={when(MATCHED)}>
          {KEYWORD}
        </span>
        에 가 볼까?
      </span>
      <span className={styles.stack}>
        <span className={styles.which}>로어북</span>
        {ENTRIES.map((key) => (
          <Part key={key} motion={key === KEYWORD && styles.marked} at={MATCHED}>
            {key}
          </Part>
        ))}
      </span>
      <span className={styles.stack}>
        <span className={styles.which}>프롬프트</span>
        <Part>캐릭터 설명</Part>
        <Unfold at={0.38}>
          <Part added>
            {KEYWORD}
            <Line width={60} />
          </Part>
        </Unfold>
        <Part>대화</Part>
      </span>
    </span>
  );
}

// The older turns fold into their record in place, so what is sent grows shorter.
const OLDER = [70, 92, 54, 86, 64];
const RECORD = [80, 52];
const RECENT = [88, 60, 80];
const SUMMED = 0.3;

export function MemoryDemo() {
  return (
    <span className={styles.memory}>
      <span className={styles.which}>보내는 내용</span>
      <span className={styles.swap}>
        <span className={join(styles.which, styles.gone)} style={when(SUMMED)}>
          오래된 대화
        </span>
        <span className={join(styles.which, appears)} style={when(SUMMED)}>
          기록
        </span>
      </span>
      <span className={styles.older} style={when(SUMMED)}>
        <Unfold at={SUMMED} away>
          <Turns lines={OLDER} />
        </Unfold>
        <Unfold at={SUMMED}>
          <Turns lines={RECORD} />
        </Unfold>
      </span>
      <span className={styles.which}>최근 대화</span>
      <Turns lines={RECENT} />
    </span>
  );
}

// The device turns dark and back, and the app's preset follows each turn.
export function FollowSystemDemo() {
  return (
    <span className={styles.modes}>
      <span className={styles.side}>
        <span className={styles.device}>
          <span className={styles.knob} />
          <Icon icon={Sun} size="sm" />
          <Icon icon={Moon} size="sm" />
        </span>
        <span className={styles.which}>기기</span>
      </span>
      <Icon icon={ArrowRight} size="sm" />
      <span className={styles.app}>
        <span className={styles.appBar} />
        <Line width={86} />
        <Line width={64} />
        <Line width={78} />
      </span>
    </span>
  );
}
