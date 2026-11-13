import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { StoryMessage, ToolsFollowContext } from './StoryMessage';
import styles from './StoryMessage.module.css';

vi.mock('../foundation/media', async (actual) => ({ ...(await actual()), useHover: () => true }));

test('the tools follow the reader unless 메시지 도구 따라오기 is off', () => {
  const message = <StoryMessage avatar={null} name="하젤" time="12:00" mine={false} id="m" tools="도구">본문</StoryMessage>;
  expect(renderToStaticMarkup(message)).toContain(styles.follows);
  expect(renderToStaticMarkup(<ToolsFollowContext value={false}>{message}</ToolsFollowContext>)).not.toContain(styles.follows);
});
