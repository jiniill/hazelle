import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { ChatRow } from '../collections/ItemRow';
import { Composer } from '../controls/Composer';
import { SchemeContext, type Scheme } from '../foundation/scheme';
import { BASE, ThemeContext } from '../foundation/theme';
import { ChatTitle } from '../layout/ChatFrame';
import { Rail, Sidebar } from '../layout/Sidebar';
import { toolsFloat } from '../story/StoryMessage';
import { THEMES } from '.';

const drawn = (theme: (typeof THEMES)[keyof typeof THEMES], node: ReactNode) => renderToStaticMarkup(<ThemeContext value={theme}>{node}</ThemeContext>);
const order = (markup: string, ...words: string[]) => words.map((word) => markup.indexOf(word));
const rising = (places: number[]) => places.every((place, at) => place >= 0 && (at === 0 || place > places[at - 1]!));

it('leads a topic header with the chat and a plain one with the character, both pressable in the order drawn', () => {
  const title = <ChatTitle name="미라" description="첫 채팅" onClick={() => {}} onRename={() => {}} />;
  expect(rising(order(drawn(BASE, title), '미라', '첫 채팅'))).toBe(true);
  const topic = drawn(THEMES.channel, title);
  expect(rising(order(topic, 'lucide-hash', '첫 채팅', '미라'))).toBe(true);
  expect(topic.match(/<button/g)).toHaveLength(2);
});

it('puts the faces of a servers rail over its actions, and the fold last of them in both', () => {
  const rail = (
    <Rail fold={{ open: true, onToggle: () => {} }} actions={<i>둘러보기</i>} places={<i>설정</i>}>
      <i>얼굴</i>
    </Rail>
  );
  expect(rising(order(drawn(BASE, rail), '둘러보기', '사이드바 접기', '얼굴', '설정'))).toBe(true);
  expect(rising(order(drawn(THEMES.channel, rail), '얼굴', '둘러보기', '사이드바 접기', '설정'))).toBe(true);
});

it('draws a chat as a channel by its name alone, with what was said and where it is kept under one a search found', () => {
  const row = (sought: boolean, place?: string) => <ChatRow title="첫 채팅" time="2일 전" typing={false} preview="어서 와요." sought={sought} place={place} onClick={() => {}} />;
  const card = drawn(BASE, row(true, '여관'));
  expect(card).toContain('여관 · 어서 와요.');
  expect(card).toContain('2일 전');
  const channel = drawn(THEMES.channel, row(false));
  expect(rising(order(channel, 'lucide-hash', '첫 채팅'))).toBe(true);
  expect(channel).not.toContain('어서 와요.');
  expect(channel).not.toContain('2일 전');
  expect(rising(order(drawn(THEMES.channel, row(true, '여관')), '첫 채팅', '여관', '어서 와요.'))).toBe(true);
  expect(drawn(THEMES.channel, <ChatRow title="첫 채팅" time="" typing preview="" sought={false} onClick={() => {}} />)).toContain('생성 중');
});

it('writes a bar composer as its menu, its field and its send button, what stands all the same under them', () => {
  const composer = <Composer value="" onChange={() => {}} onKeyDown={() => {}} placeholder="메시지" inputRef={{ current: null }} compact={false} onOpen={() => {}} tools={<i>서 있는 것</i>} more={<i>도구 메뉴</i>} actions={<i>보내기</i>} />;
  expect(rising(order(drawn(BASE, composer), '<textarea', '서 있는 것', '도구 메뉴', '보내기'))).toBe(true);
  expect(rising(order(drawn(THEMES.channel, composer), '도구 메뉴', '<textarea', '보내기', '서 있는 것'))).toBe(true);
});

it('floats a row message\'s tools only under a pointer that hovers, and never ones told to stay', () => {
  expect(toolsFloat('row', true, false)).toBe(true);
  expect(toolsFloat('row', false, false)).toBe(false);
  expect(toolsFloat('row', true, true)).toBe(false);
  expect(toolsFloat('prose', true, false)).toBe(false);
});

it('draws the rail and the sidebar in a side\'s scheme under the page\'s mode that has one, but not a sidebar that is the page, nor under a 배경 pick', () => {
  const worn = (scheme: Partial<Scheme>, node: ReactNode) => drawn(THEMES.work, <SchemeContext value={{ mode: 'light', bg: 'base', ink: 'base', accent: 'base', dialogue: 'base', ...scheme }}>{node}</SchemeContext>);
  const rail = <Rail actions={null} places={null}>{null}</Rail>;
  const side = 'data-mode="dark" data-bg="base" data-ink="base" data-accent="base" data-dialogue="base" data-theme="work/light"';
  expect(worn({}, rail)).toContain(side);
  expect(worn({}, <Sidebar actions={null}>{null}</Sidebar>)).toContain(side);
  expect(worn({}, <Sidebar page actions={null}>{null}</Sidebar>)).not.toContain('data-theme');
  expect(worn({ mode: 'dark' }, rail)).not.toContain('data-theme');
  expect(worn({ bg: 'blue' }, rail)).not.toContain('data-theme');
});
