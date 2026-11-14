import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { Wrench } from 'lucide-react';
import { expect, it } from 'vitest';
import { ChatRow } from '../collections/ItemRow';
import { Composer } from '../controls/Composer';
import { IconButton } from '../controls/IconButton';
import { SchemeContext, type Scheme } from '../foundation/scheme';
import { Divider } from '../foundation/Divider';
import { BASE, ThemeContext } from '../foundation/theme';
import { ChatTitle } from '../layout/ChatFrame';
import { Rail, Sidebar } from '../layout/Sidebar';
import { toolsShown } from '../story/StoryMessage';
import { THEMES } from '.';

const drawn = (theme: (typeof THEMES)[keyof typeof THEMES], node: ReactNode) => renderToStaticMarkup(<ThemeContext value={theme}>{node}</ThemeContext>);
const order = (markup: string, ...words: string[]) => words.map((word) => markup.indexOf(word));
const rising = (places: number[]) => places.every((place, at) => place >= 0 && (at === 0 || place > places[at - 1]!));

it('leads a topic header with the chat and a plain one with the character, both pressable in the order drawn', () => {
  const title = <ChatTitle name="미라" description="첫 채팅" onClick={() => {}} onRename={() => {}} />;
  expect(rising(order(drawn(BASE, title), '미라', '첫 채팅'))).toBe(true);
  const topic = drawn(THEMES.discord, title);
  expect(rising(order(topic, 'lucide-hash', '첫 채팅', '미라'))).toBe(true);
  expect(topic.match(/<button/g)).toHaveLength(2);
});

it('draws a bare header as the chat alone, the character named by the mark that opens it, and as plain with no chat to name', () => {
  const bare = drawn(THEMES.claude, <ChatTitle name="미라" description="첫 채팅" onClick={() => {}} onRename={() => {}} />);
  expect(bare).toContain('aria-label="미라"');
  expect(bare).not.toContain('>미라<');
  expect(bare.match(/<button/g)).toHaveLength(2);
  expect(drawn(THEMES.claude, <ChatTitle name="미라" onClick={() => {}} />)).toContain('>미라<');
});

it('puts the faces of a servers rail over its actions, and the fold last of them in both', () => {
  const rail = (
    <Rail fold={{ open: true, onToggle: () => {} }} actions={<i>둘러보기</i>} places={<i>설정</i>}>
      <i>얼굴</i>
    </Rail>
  );
  expect(rising(order(drawn(BASE, rail), '둘러보기', 'aria-label="접기"', '얼굴', '설정'))).toBe(true);
  expect(rising(order(drawn(THEMES.discord, rail), '얼굴', '둘러보기', 'aria-label="접기"', '설정'))).toBe(true);
});

it('draws a chat as a channel by its name alone, with what was said and where it is kept under one a search found, its star in both, a title as a channel without its mark, and a people row led by the face', () => {
  const row = (sought: boolean, place?: string) => <ChatRow title="첫 채팅" time="2일 전" typing={false} preview="어서 와요." sought={sought} face={<i>얼굴</i>} place={place} onClick={() => {}} />;
  const card = drawn(BASE, row(true, '여관'));
  expect(card).toContain('여관 · 어서 와요.');
  expect(card).toContain('2일 전');
  const channel = drawn(THEMES.discord, row(false));
  expect(rising(order(channel, 'lucide-hash', '첫 채팅'))).toBe(true);
  expect(channel).not.toContain('어서 와요.');
  expect(channel).not.toContain('2일 전');
  expect(rising(order(drawn(THEMES.discord, row(true, '여관')), '첫 채팅', '여관', '어서 와요.'))).toBe(true);
  expect(drawn(THEMES.discord, <ChatRow title="첫 채팅" time="" typing preview="" sought={false} face={<i>얼굴</i>} onClick={() => {}} />)).toContain('생성 중');
  const starred = <ChatRow title="첫 채팅" time="2일 전" typing={false} starred="즐겨찾기" preview="어서 와요." sought={false} face={<i>얼굴</i>} place="여관" onClick={() => {}} />;
  expect(rising(order(drawn(BASE, starred), 'aria-label="즐겨찾기"', '2일 전'))).toBe(true);
  expect(rising(order(drawn(THEMES.discord, starred), 'aria-label="즐겨찾기"', '여관'))).toBe(true);
  expect(rising(order(drawn(THEMES.kakaotalk, row(true, '여관')), '얼굴', '첫 채팅', '여관 · 어서 와요.'))).toBe(true);
  const titled = drawn(THEMES.claude, row(false));
  expect(titled).toContain('첫 채팅');
  for (const left of ['lucide-hash', '어서 와요.', '2일 전']) expect(titled).not.toContain(left);
  expect(rising(order(drawn(THEMES.claude, row(true, '여관')), '첫 채팅', '여관', '어서 와요.'))).toBe(true);
  expect(card).not.toContain('얼굴');
});

it('writes a bar composer as its menu, its field and its send button, what stands all the same under them, a toolbar as its tools, its field, then the menu and the send button, and a tray as its field and its send button, then the menu, the tools and the aside, which no other shape draws', () => {
  const composer = <Composer value="" onChange={() => {}} onKeyDown={() => {}} placeholder="메시지" inputRef={{ current: null }} compact={false} onOpen={() => {}} tools={<i>서 있는 것</i>} more={<i>도구 메뉴</i>} actions={<i>보내기</i>} aside={<i>곁에 선 것</i>} />;
  expect(rising(order(drawn(BASE, composer), '<textarea', '서 있는 것', '도구 메뉴', '보내기'))).toBe(true);
  expect(rising(order(drawn(THEMES.discord, composer), '도구 메뉴', '<textarea', '보내기', '서 있는 것'))).toBe(true);
  expect(rising(order(drawn(THEMES.slack, composer), '서 있는 것', '<textarea', '도구 메뉴', '보내기'))).toBe(true);
  expect(rising(order(drawn(THEMES.claude, composer), '<textarea', '보내기', '도구 메뉴', '서 있는 것', '곁에 선 것'))).toBe(true);
  for (const theme of [BASE, THEMES.discord, THEMES.slack, THEMES.kakaotalk]) expect(drawn(theme, composer)).not.toContain('곁에 선 것');
});

it('floats a row message\'s tools and hides a page\'s mine only under a pointer that hovers, and never ones told to stay', () => {
  expect(toolsShown('row', false, true, false)).toBe('float');
  expect(toolsShown('row', false, false, false)).toBe('stand');
  expect(toolsShown('row', false, true, true)).toBe('stand');
  expect(toolsShown('prose', true, true, false)).toBe('stand');
  expect([toolsShown('page', false, true, false), toolsShown('page', true, true, false), toolsShown('page', true, false, false), toolsShown('page', true, true, true)]).toEqual(['stand', 'shy', 'stand', 'stand']);
});

it('draws the rail and the sidebar in a side\'s scheme under the page\'s mode that has one, but not a sidebar that is the page, nor under a 배경 pick', () => {
  const worn = (scheme: Partial<Scheme>, node: ReactNode) => drawn(THEMES.slack, <SchemeContext value={{ mode: 'light', bg: 'base', ink: 'base', accent: 'base', dialogue: 'base', ...scheme }}>{node}</SchemeContext>);
  const rail = <Rail actions={null} places={null}>{null}</Rail>;
  const side = 'data-mode="dark" data-bg="base" data-ink="base" data-accent="base" data-dialogue="base" data-theme="slack/side/light"';
  expect(worn({}, rail)).toContain(side);
  expect(worn({}, <Sidebar actions={null}>{null}</Sidebar>)).toContain(side);
  expect(worn({}, <Sidebar page actions={null}>{null}</Sidebar>)).not.toContain('data-theme');
  expect(worn({ mode: 'dark' }, rail)).not.toContain('data-theme');
  expect(worn({ bg: 'blue' }, rail)).not.toContain('data-theme');
});

it('writes a framed button\'s name under its icon in a labels rail only, and no other button\'s', () => {
  const named = (theme: Parameters<typeof drawn>[0], framed: boolean) => drawn(theme, <IconButton icon={Wrench} label="도구" framed={framed} onClick={() => {}} />).includes('>도구</span>');
  expect([named(THEMES.slack, true), named(THEMES.slack, false), named(BASE, true), named(THEMES.discord, true)]).toEqual([true, false, false, false]);
});

it('draws a day line between two rules, or as a pill with none, and one that says nothing as a rule in both', () => {
  const rules = (markup: string) => markup.match(/class="[^"]*rule/g)?.length ?? 0;
  expect(rules(drawn(BASE, <Divider label="어제" />))).toBe(2);
  const pill = drawn(THEMES.kakaotalk, <Divider label="어제" />);
  expect(rules(pill)).toBe(0);
  expect(pill).toMatch(/class="[^"]*pill[^"]*"><span[^>]*>어제/);
  expect(rules(drawn(THEMES.kakaotalk, <Divider label="" />))).toBe(1);
});
