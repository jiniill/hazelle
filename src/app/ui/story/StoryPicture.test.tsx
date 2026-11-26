import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Veil, VeilContext } from '../foundation/veil';
import { FooterSpace } from '../layout/ChatFrame';
import { StoryPicture } from './StoryPicture';

it('puts 가리기 on a picture tapped open only while the veil is on', () => {
  const picture = <StoryPicture src="blob:x" label="삽화" width={2} height={3} />;
  const veil = new Veil();
  veil.open('blob:x');
  const veiled = renderToStaticMarkup(<VeilContext.Provider value={veil}>{picture}</VeilContext.Provider>);
  expect(veiled).toContain('src="blob:x"');
  expect(veiled).toContain('aria-label="이미지 가리기">가리기</button>');
  const shown = renderToStaticMarkup(picture);
  expect(shown).toContain('src="blob:x"');
  expect(shown).not.toContain('가리기');
});

it('makes a shown picture the button that enlarges it, and a veiled one not', () => {
  const picture = <StoryPicture src="blob:x" label="삽화" width={2} height={3} />;
  expect(renderToStaticMarkup(picture)).toContain('aria-label="삽화 크게 보기"><img');
  expect(renderToStaticMarkup(<VeilContext.Provider value={new Veil()}>{picture}</VeilContext.Provider>)).not.toContain('크게 보기');
});

// Several versions draw the stepper's menu, which needs a client render; one draws no foot at all.
it('steps through no versions when its place holds one', () => {
  const picture = <StoryPicture src="blob:x" label="삽화" width={2} height={3} pages={{ at: 0, versions: ['12:00'], onPage: () => {} }} />;
  expect(renderToStaticMarkup(picture)).not.toContain('figcaption');
});

it('takes the composer height off its own frame, from the chat it stands in', () => {
  const picture = <StoryPicture src="blob:x" label="삽화" width={2} height={3} />;
  expect(renderToStaticMarkup(<FooterSpace.Provider value={120}>{picture}</FooterSpace.Provider>)).toContain('--footer-space:120px');
});
