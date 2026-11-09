import { expect, it } from 'vitest';
import { cleanCss, formFields, groundRules, setStylesAside } from './Story';
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
  expect(unlayered).not.toMatch(/\bem\b|mark\[|margin|max-width/);
});

const rule = (selectorText: string, declarations: Record<string, string>, important: string[] = []) => {
  const values = new Map(Object.entries(declarations));
  const priorities = new Map(important.map((name) => [name, 'important']));
  const style = {
    getPropertyValue: (name: string) => values.get(name) ?? '',
    getPropertyPriority: (name: string) => priorities.get(name) ?? '',
    setProperty: (name: string, value: string, priority = '') => void (values.set(name, value), priorities.set(name, priority)),
    removeProperty: (name: string) => (values.delete(name), ''),
  };
  return { selectorText, style, values, priorities };
};

it('hides a drawer parked off the screen by its own width until the rule that slides it in, across the message, and leaves a peeking tab shown', () => {
  const panel = rule('.settings-panel', { position: 'fixed', top: '0', width: '33%', height: '100vh', right: '-33%' });
  const opened = rule('.settings-panel[class*="opened"]', { right: '0' });
  const tab = rule('.tab', { position: 'fixed', top: '64%', right: '-23px' });
  groundRules([panel, { cssRules: [opened] }, tab]);
  expect(Object.fromEntries(panel.values)).toEqual({ position: 'relative', display: 'none' });
  expect(Object.fromEntries(opened.values)).toEqual({ right: '0', display: 'block' });
  expect(Object.fromEntries(tab.values)).toEqual({ position: 'relative' });
});

it('lays a screen backdrop over the message, and reads vw against the message in widths only', () => {
  const backdrop = rule('.sys-backdrop', { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', 'z-index': '980' });
  const dialog = rule('.dialog', { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', width: '300px' });
  const box = rule('.box', { width: 'min(94vw, 700px)', 'max-width': '.5vw', 'min-width': 'var(--width-100vw, 80vw)', 'font-size': '2vw' }, ['width']);
  const drawer = rule('.drawer', { position: 'fixed', top: '0', right: '-100vw', width: '100vw', height: '100vh' });
  groundRules([backdrop, dialog, box, drawer]);
  expect(Object.fromEntries(backdrop.values)).toEqual({ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', 'z-index': '980' });
  expect(Object.fromEntries(dialog.values)).toEqual({ position: 'relative', width: '300px' });
  expect(Object.fromEntries(box.values)).toEqual({ width: 'min(94cqw, 700px)', 'max-width': '.5cqw', 'min-width': 'var(--width-100vw, 80cqw)', 'font-size': '2vw' });
  expect(Object.fromEntries(drawer.values)).toEqual({ position: 'relative', display: 'none' });
  expect(box.priorities.get('width')).toBe('important');
});

it("reads a form's fields as Risu does, a name given again as a list, and __proto__ as a field", () => {
  const fields = formFields([['who', 'Jin'], ['pick', 'a'], ['pick', 'b'], ['pick', 'c'], ['__proto__', 'x']]);
  expect(fields).toEqual({ who: 'Jin', pick: ['a', 'b', 'c'], ['__proto__']: 'x' });
  expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
});
