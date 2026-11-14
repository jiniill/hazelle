import { renderToStaticMarkup } from 'react-dom/server';
import { useContext } from 'react';
import { expect, it } from 'vitest';
import { SchemeContext } from '../foundation/scheme';
import { useShape } from '../foundation/theme';
import { THEMES } from '../themes';
import { Swatches, type Swatch } from './Swatches';

const look = { bg: 'base', ink: 'base', accent: 'base', dialogue: 'base', font: 'sans', size: 16, pressed: false, onPick: () => {} } as const;

// What a part of the frame reads inside a card's picture.
function Read() {
  return <button type="button">{`${useShape('message')} in ${useContext(SchemeContext).mode}`}</button>;
}

it("draws a card's picture in the card's theme and mode, outside the pick and inert", () => {
  const items: Swatch[] = [
    { ...look, name: '카카오톡', mode: 'light', theme: THEMES.kakaotalk, picture: <Read /> },
    { ...look, name: '디스코드', mode: 'dark', theme: THEMES.discord, picture: <Read /> },
  ];
  const markup = renderToStaticMarkup(<Swatches label="테마" sample="words" items={items} />);
  expect(markup).toContain('bubble in light');
  expect(markup).toContain('row in dark');
  expect(markup).not.toContain('words');
  const picture = markup.indexOf('bubble in light');
  const pick = markup.indexOf('aria-pressed');
  expect(markup.slice(0, picture)).toMatch(/data-theme="kakaotalk"[^>]*inert/);
  expect(pick).toBeGreaterThan(markup.indexOf('</button>', picture));
});

it('draws the sample words in a card with no picture', () => {
  const markup = renderToStaticMarkup(<Swatches label="프리셋" sample="words" items={[{ ...look, name: '종이', mode: 'light' }]} />);
  expect(markup).toContain('words');
  expect(markup).not.toContain('inert');
});
