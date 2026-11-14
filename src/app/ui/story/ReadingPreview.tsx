import { Avatar } from '../foundation/Avatar';
import { readingScope, type Reading } from '../layout/ChatFrame';
import styles from './ReadingPreview.module.css';
import { Story } from './Story';
import { StoryMessage } from './StoryMessage';

export type PreviewRow = { name: string; mine: boolean; html: string };

// The reading width is the chat column's, so it does not show here.
export function ReadingPreview({ label, reading, rows }: { label: string; reading: Reading; rows: PreviewRow[] }) {
  const scope = readingScope(reading);
  return (
    <div className={`${styles.preview} ${scope.className}`} style={scope.style} role="group" aria-label={label} inert>
      {rows.map(({ name, mine, html }, index) => (
        <StoryMessage key={index} avatar={<Avatar size="story" face={name} tone={mine ? 'you' : 'plain'} />} name={name} time="" mine={mine} id={String(index)}>
          <Story html={html} />
        </StoryMessage>
      ))}
    </div>
  );
}
