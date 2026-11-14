import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ThemeContext } from '../foundation/theme';
import { THEMES } from '../themes';
import { BubblesContext, StoryMessage, ToolsFollowContext } from './StoryMessage';
import styles from './StoryMessage.module.css';

vi.mock('../foundation/media', async (actual) => ({ ...(await actual()), useHover: () => true }));

test('the tools follow the reader unless 메시지 도구 따라오기 is off', () => {
  const message = <StoryMessage avatar={null} name="하젤" time="12:00" mine={false} id="m" tools="도구">본문</StoryMessage>;
  expect(renderToStaticMarkup(message)).toContain(styles.follows);
  expect(renderToStaticMarkup(<ToolsFollowContext value={false}>{message}</ToolsFollowContext>)).not.toContain(styles.follows);
});

test('a bubble message sets its words a bubble a block, or in one box where told, with the time after them, but one told to be plain; prose keeps the time by the name and boxes mine alone', () => {
  const message = (mine: boolean) => <StoryMessage avatar={null} name="미라" time="오후 9:39" mine={mine} id="m">본문</StoryMessage>;
  const bubble = (node: React.ReactNode) => renderToStaticMarkup(<ThemeContext value={THEMES.kakaotalk}>{node}</ThemeContext>);
  const each = bubble(message(false));
  expect(each.indexOf('본문')).toBeLessThan(each.indexOf('오후 9:39'));
  expect(each).toContain(styles.fit);
  expect(each).not.toContain(styles.box);
  expect(bubble(<BubblesContext value={false}>{message(false)}</BubblesContext>)).toContain(styles.box);
  const edited = bubble(<StoryMessage avatar={null} name="미라" time="오후 9:39" mine={false} plain id="m">본문</StoryMessage>);
  for (const name of [styles.fit, styles.line]) expect(edited).not.toContain(name);
  const mine = renderToStaticMarkup(message(true));
  expect(mine.indexOf('오후 9:39')).toBeLessThan(mine.indexOf('본문'));
  expect(mine).toContain(styles.box);
  const theirs = renderToStaticMarkup(message(false));
  for (const name of [styles.box, styles.fit, styles.line]) expect(theirs).not.toContain(name);
});

test('a page message draws no face and no name but still says who spoke, with the time after the tools; a bubble does so for mine alone', () => {
  const message = (mine: boolean) => <StoryMessage avatar={<i>얼굴</i>} name="미라" time="오후 9:39" mine={mine} id="m" tools="도구">본문</StoryMessage>;
  const drawn = (theme: (typeof THEMES)[keyof typeof THEMES], mine: boolean) => renderToStaticMarkup(<ThemeContext value={theme}>{message(mine)}</ThemeContext>);
  for (const mine of [false, true]) {
    const page = drawn(THEMES.claude, mine);
    expect(page).not.toContain('얼굴');
    expect(page).toContain(`<span class="${styles.unseen}">미라</span>`);
    expect(page.indexOf('도구')).toBeLessThan(page.indexOf('오후 9:39'));
  }
  expect(drawn(THEMES.kakaotalk, false)).toContain('얼굴');
  expect(drawn(THEMES.kakaotalk, true)).toContain(styles.unseen);
  expect(drawn(THEMES.base, true)).toContain('얼굴');
});
