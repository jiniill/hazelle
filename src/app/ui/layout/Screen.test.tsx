import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Screen } from './Screen';

it('closes the page with its foot after the actions, so nothing stands between the fields and their button', () => {
  const page = renderToStaticMarkup(
    <Screen actions={<button type="submit">로그인</button>} foot={<p>라이선스</p>}>
      <input aria-label="비밀번호" />
    </Screen>,
  );
  expect(page.indexOf('비밀번호')).toBeLessThan(page.indexOf('로그인'));
  expect(page.indexOf('로그인')).toBeLessThan(page.indexOf('라이선스'));
});
