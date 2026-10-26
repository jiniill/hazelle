import { botSheets } from './Story';

// A drawn subtree, shadow roots included, as HTML whose whole look rides in style attributes: what a board that strips
// <style>, classes and scripts (arca.live) still draws. What a style attribute cannot carry is counted, never hidden.
export type Look = {
  style: (element: Element) => Pick<CSSStyleDeclaration, 'getPropertyValue'>;
  // An element of that name in a root no sheet styles: what an unstyled one computes to.
  reference: (name: string) => Element;
  // The rules of a shadow root's bot sheets that no style attribute carries.
  lost: (shadow: ShadowRoot) => readonly CSSRule[];
};
export type Snapshot = { html: string; rules: number };

// Inherited, so written where they differ from the parent's.
const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'white-space', 'overflow-wrap'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
// Written where they differ from what an unstyled element of the tag computes to. No width or height: a computed one is
// the off-screen page's pixels, which would overflow a narrower column.
const OWN = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'row-gap', 'column-gap', 'max-width',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'box-shadow', 'text-shadow', 'opacity', 'overflow-x', 'overflow-y',
  'position', ...SIDES, 'transform', 'fill', 'stroke', 'stroke-width',
  ...SIDES.flatMap((side) => [`margin-${side}`, `padding-${side}`, `border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
  ...CORNERS.map((corner) => `border-${corner}-radius`),
];
// A picture's drawn width, which max-width still bounds; its height follows from it.
const REPLACED: Record<string, string[]> = { img: ['width'], video: ['width', 'height'], svg: ['width', 'height'] };
// A video keeps how the story plays it: Story.tsx has already left autoplay only on a muted one.
const ATTRIBUTES = new Set(['src', 'alt', 'href', 'title', 'colspan', 'rowspan', 'controls', 'autoplay', 'muted', 'loop', 'playsinline']);
// What an SVG shape is drawn from; without them it draws nothing.
const SVG = 'http://www.w3.org/2000/svg';
const SVG_ATTRIBUTES = new Set(['viewBox', 'preserveAspectRatio', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'fill', 'stroke', 'stroke-width', 'opacity', 'text-anchor', 'offset', 'stop-color']);
const MATHML = 'http://www.w3.org/1998/Math/MathML';
// The ones KaTeX writes (math.ts); without them a bold letter is plain and a matrix loses its spacing.
const MATHML_ATTRIBUTES = new Set(['mathvariant', 'stretchy', 'fence', 'accent', 'notation', 'displaystyle', 'scriptlevel', 'mathcolor', 'columnalign', 'columnspacing', 'rowspacing', 'width', 'lspace', 'minsize']);
// A grid's computed tracks are the off-screen page's pixels, like a computed width, so its template is counted as lost.
const TEMPLATES = ['grid-template-columns', 'grid-template-rows'];
const SKIPPED = new Set(['script', 'style', 'template', 'slot', 'link', 'meta']);
const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'wbr']);
// Only sources that load on any page: blob: ones end with this one.
const LOADS = /^(?:https?|data):/i;

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', '&quot;');

export function staticHtml(root: Element, look: Look): Snapshot {
  const out: string[] = [];
  const lost = new Set<CSSRule | Element>();
  const write = (node: Element, parent: Pick<CSSStyleDeclaration, 'getPropertyValue'> | null) => {
    const name = node.localName;
    // Story.tsx's copy button (data-copy) answers nothing on a board.
    if (SKIPPED.has(name) || [...node.attributes].some(({ name: attribute }) => attribute === 'data-copy')) return;
    const style = look.style(node);
    if (style.getPropertyValue('display') === 'none') return;
    const plain = look.reference(name);
    const unstyled = look.style(plain);
    const declarations = [
      ...INHERITED.filter((property) => parent === null || style.getPropertyValue(property) !== parent.getPropertyValue(property)),
      ...OWN.filter((property) => style.getPropertyValue(property) !== unstyled.getPropertyValue(property)),
      ...(REPLACED[name] ?? []),
    ].flatMap((property) => {
      // Empty for a property this browser does not have.
      const value = style.getPropertyValue(property);
      return value ? [`${property}:${value}`] : [];
    });
    const kept = node.namespaceURI === SVG ? SVG_ATTRIBUTES : node.namespaceURI === MATHML ? MATHML_ATTRIBUTES : ATTRIBUTES;
    const attributes = [...node.attributes].filter(({ name: attribute, value }) => kept.has(attribute) && (!(attribute === 'src' || attribute === 'href') || LOADS.test(value)));
    if (TEMPLATES.some((property) => !['', 'none'].includes(style.getPropertyValue(property)))) lost.add(node);
    out.push(`<${name}${attributes.map(({ name: attribute, value }) => ` ${attribute}="${escapeAttribute(value)}"`).join('')}${declarations.length ? ` style="${escapeAttribute(declarations.join(';'))}"` : ''}>`);
    if (node.shadowRoot) for (const rule of look.lost(node.shadowRoot)) lost.add(rule);
    for (const child of (node.shadowRoot ?? node).childNodes) {
      if (child.nodeType === 3) out.push(escapeText((child as Text).data));
      else if (child.nodeType === 1) write(child as Element, style);
    }
    if (!VOID.has(name)) out.push(`</${name}>`);
  };
  write(root, null);
  return { html: out.join(''), rules: lost.size };
}

export const snapshotPage = (title: string, html: string, background: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title></head><body style="margin:0;background-color:${escapeAttribute(background)}">${html}</body></html>`;

// The page's own computed styles. host: an element in the drawn page, where the unstyled references are drawn too.
export function pageLook(host: HTMLElement): Look {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const references = new Map<string, Element>();
  return {
    style: (element) => getComputedStyle(element),
    reference: (name) => {
      let element = references.get(name);
      if (!element) references.set(name, (element = shadow.appendChild(document.createElement(name))));
      return element;
    },
    lost: (root) => botSheets(root).flatMap((sheet) => lostRules(sheet.cssRules)),
  };
}

// Pseudo-elements and states the reader brings about: no computed style of the drawn page holds them. Structural
// pseudo-classes such as :nth-child or :host() did apply, and their effect is read like any other.
const UNDRAWN = /::|:(?:hover|focus|active|checked|target|visited|link|before|after|first-line|first-letter)\b/i;

function lostRules(rules: CSSRuleList): CSSRule[] {
  return [...rules].flatMap((rule): CSSRule[] => {
    // A nested rule (CSS nesting) is lost by its own selector; older browsers give a style rule no cssRules.
    if (rule instanceof CSSStyleRule) return UNDRAWN.test(rule.selectorText) ? [rule] : rule.cssRules ? lostRules(rule.cssRules) : [];
    if (rule instanceof CSSMediaRule || rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) return [rule];
    return rule instanceof CSSGroupingRule ? lostRules(rule.cssRules) : [];
  });
}
