import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { NavBar } from './NavBar';

const heading = (markup: string) => /<h1[^>]*>/.exec(markup)![0];

it('keeps a cut title whole in its title attribute, and leaves a title that renames to its field', () => {
  const long = '아주 긴 게시글 제목이 두 줄을 넘어서 잘려도 전부 읽을 수 있어야 해요';
  expect(heading(renderToStaticMarkup(<NavBar title={long} />))).toContain(`title="${long}"`);
  const renamed = renderToStaticMarkup(<NavBar title="채팅" rename={{ label: '이름', placeholder: '채팅', onChange: () => {} }} />);
  expect(heading(renamed)).not.toContain('title=');
  expect(renamed).toContain('value="채팅"');
});
