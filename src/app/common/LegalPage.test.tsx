import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { markSelfHost } from '../../runtime/installation';
import { legalPage } from './LegalPage';

it('shows the terms and the privacy page at their paths with no account, and nothing at any other path', () => {
  expect(renderToStaticMarkup(legalPage('/terms'))).toContain('만 19세 이상만 이용할 수 있습니다.');
  expect(renderToStaticMarkup(legalPage('/privacy'))).toContain('개인정보 보호책임자');
  expect(legalPage('/')).toBeNull();
});

it('opens the app from its head, and its notice links the other pages but not itself', () => {
  const html = renderToStaticMarkup(legalPage('/terms'));
  expect(html).toContain('헤이젤 열기');
  expect(html).not.toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
});

it("shows a self-host what leaves it in place of hazelle.app's terms", () => {
  markSelfHost(true);
  try {
    expect(legalPage('/terms')).toBeNull();
    expect(renderToStaticMarkup(legalPage('/outbound'))).toContain('hazelle.app의 이용약관과 개인정보 처리방침은 이 설치에 적용되지 않습니다.');
  } finally {
    markSelfHost(false);
  }
});
