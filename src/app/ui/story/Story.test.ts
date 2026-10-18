import { expect, it } from 'vitest';
import { cleanCss, groundRules, setStylesAside } from './Story';
import shadowCss from './Story.shadow.css?raw';

it("keeps the rule after an @import whose font URL holds a ;", () => {
  const css = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');\n.vp{background:#ffffff;color:#222222}";
  expect(cleanCss(css, false)).toBe('@import none;\n.vp{background:#ffffff;color:#222222}');
});

it('reads the non-breaking spaces a bot indents its CSS with as spaces, as Risu’s parser drops them', () => {
  expect(cleanCss('\u00a0\u00a0.a { color: red }', false)).toBe('  .a { color: red }');
  expect(cleanCss("/* don't */\u00a0.a {}", false)).toBe("/* don't */ .a {}");
  expect(cleanCss('.a { content: "a\\\n\u00a0b" }', false)).toBe('.a { content: "a\\\n\u00a0b" }');
  expect(cleanCss('.a { content: "x\n\u00a0.b {}', false)).toBe('.a { content: "x\n .b {}');
  expect(cleanCss('[title="a\u00a0b"] { content: \'\u00a0\' }', false)).toBe('[title="a\u00a0b"] { content: \'\u00a0\' }');
});

it('takes an url( never closed to the end, in one pass however many follow', () => {
  expect(cleanCss('a{background:url(x.png)} b{background:url(https://e', false)).toBe('a{background:none} b{background:none');
  const start = performance.now();
  expect(cleanCss('url('.repeat(64 * 1024), false)).toBe('none');
  expect(performance.now() - start).toBeLessThan(200);
});

it('sets every style attribute of a tag aside, in one pass over tags never closed', () => {
  expect(setStylesAside('<P STYLE="a" title="x style=y" style =b>style=c</p><br\nstyle=d>')).toBe('<P data-style="a" title="x data-style=y" data-style =b>style=c</p><br\ndata-style=d>');
  const start = performance.now();
  setStylesAside('<div title="' + '<b '.repeat(64 * 1024));
  expect(performance.now() - start).toBeLessThan(200);
});

it("lets any rule of the bot's beat the story's own looks", () => {
  const open = shadowCss.indexOf('@layer {');
  let close = shadowCss.indexOf('{', open);
  for (let depth = 1; depth > 0; ) {
    const char = shadowCss[++close];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  const unlayered = shadowCss.slice(0, open) + shadowCss.slice(close + 1);
  expect(shadowCss.slice(open, close)).toContain('mark[risu-mark]');
  expect(unlayered).not.toMatch(/\bem\b|mark\[|margin|\[data-picture\] > img/);
});

it('hides a drawer parked off the screen by its own width until the rule that slides it in, across the message, and leaves a peeking tab shown', () => {
  const rule = (selectorText: string, declarations: Record<string, string>) => {
    const values = new Map(Object.entries(declarations));
    const style = { getPropertyValue: (name: string) => values.get(name) ?? '', setProperty: (name: string, value: string) => void values.set(name, value), removeProperty: (name: string) => (values.delete(name), '') };
    return { selectorText, style, values };
  };
  const panel = rule('.settings-panel', { position: 'fixed', top: '0', width: '33%', height: '100vh', right: '-33%' });
  const opened = rule('.settings-panel[class*="opened"]', { right: '0' });
  const tab = rule('.tab', { position: 'fixed', top: '64%', right: '-23px' });
  groundRules([panel, { cssRules: [opened] }, tab]);
  expect(Object.fromEntries(panel.values)).toEqual({ position: 'relative', display: 'none' });
  expect(Object.fromEntries(opened.values)).toEqual({ right: '0', display: 'block' });
  expect(Object.fromEntries(tab.values)).toEqual({ position: 'relative' });
});
