import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { awaited, useCode } from './code';

function drawOf(html: string) {
  let draw: ReturnType<typeof useCode> = null;
  const Probe = () => {
    draw = useCode(html);
    return null;
  };
  renderToStaticMarkup(<Probe />);
  return draw as ReturnType<typeof useCode>;
}

it('keeps the colours of the fences whose modes have come while another mode is on its way, then draws again with it', async () => {
  const ts = '<pre><code class="language-ts">const a = 1\n</code></pre>';
  const both = `${ts}<pre><code class="language-py">def f(): pass\n</code></pre>`;
  expect(drawOf('<p>plain</p>')!(ts)).toBe(ts);
  expect(drawOf(ts)).toBeNull();
  await awaited(ts);

  const waiting = drawOf(both)!;
  expect(waiting(both)).toContain('<span class="code-keyword">const</span>');
  expect(waiting(both)).not.toContain('<span class="code-keyword">def</span>');
  await awaited(both);
  const whole = drawOf(both)!;
  expect(whole).not.toBe(waiting);
  expect(whole(both)).toContain('<span class="code-keyword">def</span>');
});
