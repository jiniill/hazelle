import { ChevronDown } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import type { Way } from './Demo';
import { appears, Feed, Line, Message, PARAGRAPHS, pressed, top, Unfold, when } from './DemoParts';
import { classNames } from '../foundation/classNames';
import styles from './ReplyDemos.module.css';

const ASKED = <Message lines={[90, 55]} mine />;

// As usageLine draws it: the cost leads, then each part, dot-separated.
const USAGE = { lead: '$0.004', parts: ['입력 1,240', '출력 380', '3.1초'] };
// What the line leaves out, which its details add.
const FACTS = [
  { label: '캐시', value: '62%' },
  { label: '추론', value: '120' },
  { label: '첫 토큰', value: '0.8초' },
];
const PRESSED = 0.54;

// The reply's usage line comes in under it; pressed, its details unfold.
export function UsageDemo() {
  return (
    <span>
      <Feed motion={top}>
        {ASKED}
        <Message lines={[94, 62]} typing={0.04}>
          <span className={classNames(styles.usage, appears)} style={when(0.32)}>
            <span className={classNames(styles.usageLine, pressed)} style={when(PRESSED)}>
              <span className={styles.lead}>{USAGE.lead}</span>
              {USAGE.parts.join(' · ')}
              <span className={styles.flips}>
                <Icon icon={ChevronDown} size="sm" />
              </span>
            </span>
            <Unfold at={PRESSED + 0.02}>
              <span className={styles.facts}>
                {FACTS.map(({ label, value }) => (
                  <span key={label} className={styles.fact}>
                    <span className={styles.factLabel}>{label}</span>
                    {value}
                  </span>
                ))}
              </span>
            </Unfold>
          </span>
        </Message>
      </Feed>
    </span>
  );
}

// The reasoning stays in the reply's text as it was written, before the reply itself.
export function ThoughtsDemo() {
  return (
    <span>
      <Feed motion={top}>
        {ASKED}
        <Message lines={[]}>
          <span className={classNames(styles.thought, appears)} style={when(0.06)}>
            <span className={styles.tag}>&lt;Thoughts&gt;</span>
            <Line width={92} typing={0.1} />
            <Line width={70} typing={0.18} />
          </span>
          <Line width={94} typing={0.36} />
          <Line width={86} typing={0.44} />
          <Line width={58} typing={0.52} />
        </Message>
      </Feed>
    </span>
  );
}

// The bot's status, the same both ways: drawn as the bot styled it, or as its plain text.
const STATUS = [
  { name: 'HP', value: 72 },
  { name: 'MP', value: 40 },
];
const CHOICES = [36, 28];

// way 0 shows the bot's status panel and buttons as the bot styled them; way 1 shows the same as plain text.
export function BotStyleDemo({ way }: { way: Way }) {
  return (
    <span>
      <Feed motion={top}>
        <Message lines={[94, 82]}>
          {way === 0 ? (
            <span className={classNames(styles.panel, appears)} style={when(0.24)}>
              <span className={styles.badge}>STATUS</span>
              {STATUS.map(({ name, value }) => (
                <span key={name} className={styles.stat}>
                  {name}
                  <span className={styles.meter}>
                    <span style={when(undefined, { '--w': `${value}%` })} />
                  </span>
                </span>
              ))}
              <span className={styles.choices}>
                {CHOICES.map((width) => (
                  <span key={width} className={styles.choice}>
                    <Line width={width} />
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span className={classNames(styles.plain, appears)} style={when(0.24)}>
              <span>STATUS</span>
              {STATUS.map(({ name, value }) => (
                <span key={name}>
                  {name} {value}/100
                </span>
              ))}
              {CHOICES.map((width) => (
                <Line key={width} width={width} />
              ))}
            </span>
          )}
        </Message>
      </Feed>
    </span>
  );
}

// The original unfolds under each translated paragraph.
export function TranslateOriginalDemo() {
  return (
    <span className={styles.prose}>
      {PARAGRAPHS.map(({ translated, original }, at) => (
        <span key={at} className={styles.paragraph}>
          <span className={styles.translated}>{translated}</span>
          <Unfold at={0.14 + at * 0.16}>
            <span className={styles.original}>{original}</span>
          </Unfold>
        </span>
      ))}
    </span>
  );
}
