import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { plainText, Written } from './Written';

it('draws lists, emphasis, headings and web links, draws a picture as its link only, and leaves HTML and other links as text', () => {
  const html = renderToStaticMarkup(<Written text={'# 제목\n\n- **하나**\n- 둘 https://a.example/x.\n\n1. 셋\n\n<b>굵게</b> ![사진](https://a.example/p.png) [몰래](javascript:alert(1))\n줄'} />);
  expect(html).toContain('<h3>제목</h3>');
  expect(html).toContain('<ul><li><strong>하나</strong></li><li>둘 <a');
  expect(html).toContain('href="https://a.example/x"');
  expect(html).toContain('<ol><li>셋</li></ol>');
  expect(html).toContain('<p>&lt;b&gt;굵게&lt;/b&gt; !<a');
  expect(html).toContain('[몰래](javascript:alert(1))<br/>줄</p>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href="javascript');
});

it('reads a text without its marks', () => {
  expect(plainText('## 소식\n\n- **답**을 `빨리` 받아요')).toBe('소식 답을 빨리 받아요');
});

it('reads a line break as a space', () => {
  expect(plainText('첫 줄이에요.\n둘째 줄이에요.')).toBe('첫 줄이에요. 둘째 줄이에요.');
});
