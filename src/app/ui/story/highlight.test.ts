import { expect, it } from 'vitest';
import { drawCode } from './highlight';

const text = (html: string) => html.replace(/<[^>]*>/g, '');

it('highlights a fence of a known language, keeping its text, and leaves an unknown one and a bot block with markup as written', () => {
  // As engine/display.ts renders ```ts.
  const fence = '<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot; &amp;&amp; 1; // 끝\n</code></pre>\n';
  const drawn = drawCode(fence);
  expect(drawn).toContain('<span class="code-keyword">const</span>');
  expect(drawn).toContain('<span class="code-string">&quot;&lt;b&gt;&quot;</span>');
  expect(drawn).toContain('<span class="code-comment">// 끝</span>');
  expect(text(drawn)).toBe(text(fence));

  const unknown = '<pre><code class="language-klingon">qapla\n</code></pre>\n';
  expect(drawCode(unknown)).toBe(unknown);
  const bot = '<pre><code class="language-js"><b>x</b> &nbsp;</code></pre>';
  expect(drawCode(bot)).toBe(bot);
});
