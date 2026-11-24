import { expect, it, vi } from 'vitest';
import { drawCode, modesFor } from './highlight';

const fetched = vi.hoisted(() => new Set<string>());
vi.mock('@codemirror/legacy-modes/mode/python', async (actual) => {
  fetched.add('python');
  return actual();
});
vi.mock('@codemirror/legacy-modes/mode/toml', () => {
  throw new Error('offline');
});

const text = (html: string) => html.replace(/<[^>]*>/g, '');

it('highlights a fence of a known language, keeping its text, and leaves an unknown one and a bot block with markup as written', async () => {
  // As engine/display.ts renders ```ts.
  const fence = '<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot; &amp;&amp; 1; // 끝\n</code></pre>\n';
  await modesFor(fence);
  const drawn = drawCode(fence);
  expect(drawn).toContain('<span class="code-keyword">const</span>');
  expect(drawn).toContain('<span class="code-string">&quot;&lt;b&gt;&quot;</span>');
  expect(drawn).toContain('<span class="code-comment">// 끝</span>');
  expect(text(drawn)).toBe(text(fence));

  const unknown = '<pre><code class="language-klingon">qapla\n</code></pre>\n';
  expect(modesFor(unknown)).toBeUndefined();
  expect(drawCode(unknown)).toBe(unknown);
  for (const inherited of ['constructor', '__proto__', 'valueOf']) {
    const fence = `<pre><code class="language-${inherited}">x\n</code></pre>\n`;
    expect(modesFor(fence)).toBeUndefined();
    expect(drawCode(fence)).toBe(fence);
  }
  const bot = '<pre><code class="language-js"><b>x</b> &nbsp;</code></pre>';
  expect(drawCode(bot)).toBe(bot);
});

it("fetches a language's mode with the first fence that names it, and leaves a fence whose mode could not come as written", async () => {
  const python = '<pre><code class="language-py">def f(): pass\n</code></pre>';
  expect(fetched.has('python')).toBe(false);
  await modesFor('<pre><code class="language-js">let a\n</code></pre>');
  expect(fetched.has('python')).toBe(false);
  await modesFor(python);
  expect(fetched.has('python')).toBe(true);
  expect(modesFor(python)).toBeUndefined();
  expect(drawCode(python)).toContain('<span class="code-keyword">def</span>');

  const toml = '<pre><code class="language-toml">a = 1\n</code></pre>';
  await modesFor(toml);
  expect(modesFor(toml)).toBeUndefined();
  expect(drawCode(toml)).toBe(toml);
});
