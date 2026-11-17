// A Risu plugin's root document as a layer of its own, inside its frame (design §6.10). The app lays the frame over
// the chat and takes nothing from it but where its boxes are and that a pointer missed them.

type Box = Hazelle.LayerBox;
type Listed<T> = (items: T[]) => unknown;
type Trimmed = Record<string, string | number | boolean>;
const NODE = Symbol('node');
type Safe = { [NODE]: Element; querySelector(selector: string): Promise<unknown>; querySelectorAll(selector: string): Promise<unknown> } & Record<string, (...args: never[]) => Promise<unknown>>;

const REFUSED = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base']);
// What Risu hands a listener: where and which key, never what was under it.
const trimmed = (event: Event): Trimmed => {
  if (event instanceof MouseEvent) return { type: event.type, clientX: event.clientX, clientY: event.clientY, button: event.button, buttons: event.buttons, altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey };
  if (event instanceof KeyboardEvent) return { type: event.type, key: event.key, code: event.code, repeat: event.repeat, altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey };
  return { type: event.type };
};

const within = (a: Box, b: Box) => b[0] <= a[0] && b[1] <= a[1] && b[2] >= a[2] && b[3] >= a[3];
const outer = (boxes: Box[]) => boxes.filter((box, at) => !boxes.some((other, index) => index !== at && within(box, other) && (index < at || !within(other, box))));
// The layer's region from every box found: a box inside another of its kind is that other's, and one that only shows
// inside one that takes input is taken with it.
export function regionOf(takes: Box[], shows: Box[]) {
  const taken = outer(takes);
  return { takes: taken, shows: outer(shows).filter((box) => !taken.some((other) => within(box, other))) };
}

// The frame's words of the pointers on nothing of its own, each with whether it is a mouse and whether it is on a box
// that takes input. A pointer there is the app's, which hears of it only from here: the frame is one surface to the
// browser, and what a box that only shows lets through would end at the frame.
export function misses(say: (what: Hazelle.LayerMiss) => void) {
  let touching = false;
  let off = false;
  return {
    pressed(mouse: boolean, ours: boolean) {
      if (mouse || ours) return;
      touching = true;
      say('down');
    },
    lifted() {
      if (!touching) return;
      touching = false;
      say('up');
    },
    moved(mouse: boolean, ours: boolean) {
      if (!mouse) return;
      if (!ours && !off) say('over');
      off = !ours;
    },
    // Laid anew, a mouse that stays off its boxes is said again.
    laid() { off = false; },
  };
}

export function pageLayer(list: Listed<unknown>, report: (takes: Box[], shows: Box[]) => void, missed: (what: Hazelle.LayerMiss) => void) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  // What a plugin finds as html and body. It takes no input itself; what is put on it does, unless it says otherwise.
  const body = document.createElement('div');
  body.className = 'hazelle-layer-body';
  const base = document.createElement('style');
  base.textContent = '.hazelle-layer-body{position:fixed;inset:0;pointer-events:none}.hazelle-layer-body>*{pointer-events:auto}';
  root.append(base, body);
  const mode = document.createElement('style');
  mode.textContent = 'html[data-hazelle-layer]>body{display:none!important}html[data-hazelle-layer]{background:transparent!important}';
  document.head.append(mode);
  document.documentElement.append(host);
  let on = false;

  const listeners = new Map<string, { target: EventTarget; type: string; run: EventListener; options?: boolean | AddEventListenerOptions }>();
  const wraps = new WeakMap<Element, Safe>();
  const safe = (node: Element | null | undefined): Safe | null => {
    if (!node) return null;
    let wrapped = wraps.get(node);
    if (!wrapped) wraps.set(node, wrapped = wrap(node as HTMLElement));
    return wrapped;
  };
  const all = (nodes: Iterable<Element>) => list([...nodes].map(safe));
  const own = (name: string) => { if (!name.startsWith('x-')) throw new Error("Can only set attributes starting with 'x-' for security reasons. for other attributes, use dedicated methods."); };
  const listen = (target: EventTarget, type: string, listener: (event: Trimmed) => void, options?: boolean | AddEventListenerOptions) => {
    const id = crypto.randomUUID();
    const run: EventListener = (event) => listener(trimmed(event));
    listeners.set(id, { target, type, run, options });
    target.addEventListener(type, run, options);
    return id;
  };
  const unlisten = (id: string) => {
    const held = listeners.get(id);
    if (!held) return;
    held.target.removeEventListener(held.type, held.run, held.options);
    listeners.delete(id);
  };
  const find = (scope: ParentNode, selector: string) => (scope === root && /^(html|body)$/i.test(selector.trim()) ? body : scope.querySelector(selector));

  const wrap = (element: HTMLElement, scope: ParentNode = element): Safe => ({
    [NODE]: element,
    appendChild: async (child: Safe) => { element.appendChild(child[NODE]); },
    removeChild: async (child: Safe) => { element.removeChild(child[NODE]); },
    replaceChild: async (next: Safe, old: Safe) => { element.replaceChild(next[NODE], old[NODE]); },
    replaceWith: async (next: Safe) => { element.replaceWith(next[NODE]); },
    cloneNode: async (deep = false) => safe(element.cloneNode(deep) as Element),
    prepend: async (child: Safe) => { element.prepend(child[NODE]); },
    remove: async () => { if (element !== body) element.remove(); },
    innerText: async () => element.innerText,
    textContent: async () => element.textContent,
    setTextContent: async (value: string) => { element.textContent = value; },
    setInnerText: async (value: string) => { element.innerText = value; },
    setAttribute: async (name: string, value: string) => { own(name); element.setAttribute(name, value); },
    getAttribute: async (name: string) => { own(name); return element.getAttribute(name); },
    setStyle: async (property: string, value: string) => { element.style.setProperty(property, value); },
    getStyle: async (property: string) => element.style.getPropertyValue(property),
    getStyleAttribute: async () => element.getAttribute('style') ?? '',
    setStyleAttribute: async (value: string) => { element.setAttribute('style', value); },
    addClass: async (name: string) => { element.classList.add(name); },
    removeClass: async (name: string) => { element.classList.remove(name); },
    setClassName: async (name: string) => { element.className = name; },
    getClassName: async () => element.className,
    hasClass: async (name: string) => element.classList.contains(name),
    focus: async () => { element.focus(); },
    getChildren: async () => all(element.children),
    getParent: async () => (element === body ? null : safe(element.parentElement)),
    getInnerHTML: async () => element.innerHTML,
    getOuterHTML: async () => element.outerHTML,
    clientHeight: async () => element.clientHeight,
    clientWidth: async () => element.clientWidth,
    clientTop: async () => element.clientTop,
    clientLeft: async () => element.clientLeft,
    nodeName: async () => element.nodeName,
    nodeType: async () => element.nodeType,
    querySelectorAll: async (selector: string) => all(scope.querySelectorAll(selector)),
    querySelector: async (selector: string) => safe(find(scope, selector)),
    getElementById: async (id: string) => safe(scope.querySelector(`#${CSS.escape(id)}`)),
    getElementsByClassName: async (name: string) => all(scope.querySelectorAll(`.${CSS.escape(name)}`)),
    getClientRects: async () => [...element.getClientRects()].map((rect) => rect.toJSON() as DOMRect),
    getBoundingClientRect: async () => element.getBoundingClientRect().toJSON() as DOMRect,
    setInnerHTML: async (value: string) => { element.innerHTML = value; },
    setOuterHTML: async (value: string) => { if (element !== body) element.outerHTML = value; },
    scrollIntoView: async (options?: boolean | ScrollIntoViewOptions) => { element.scrollIntoView(options); },
    addEventListener: async (type: string, listener: (event: Trimmed) => void, options?: boolean | AddEventListenerOptions) => listen(scope === root ? root : element, type, listener, options),
    removeEventListener: async (_type: string, id: string) => { unlisten(id); },
  } as Safe);

  // Where the layer is: the boxes that take pointer input, and the ones that only show (a status panel a plugin made
  // pointer-events:none, which the app must still draw and still be pressed through). A box that takes input and
  // clips what is in it ends the walk below it; one that draws nothing of its own (a full-screen holder) is no box.
  const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'PROGRESS', 'svg']);
  const CLEAR = /^(rgba\(.*,\s*0\)|transparent)$/;
  const draws = (element: Element, style: CSSStyleDeclaration) => REPLACED.has(element.tagName) || !CLEAR.test(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none'
    || (parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) > 0 && style.borderStyle !== 'none')
    || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '');
  const region = () => {
    const takes: Box[] = [];
    const shows: Box[] = [];
    const walk = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none') return;
      if (style.visibility === 'visible' && style.opacity !== '0') {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && element.tagName !== 'STYLE') {
          const box: Box = [Math.floor(rect.left), Math.floor(rect.top), Math.ceil(rect.right), Math.ceil(rect.bottom)];
          const taking = style.pointerEvents !== 'none';
          if (taking) takes.push(box);
          else if (draws(element, style)) shows.push(box);
          if (taking && style.overflow !== 'visible') return;
        }
      }
      for (const child of element.children) walk(child);
    };
    if (on) for (const child of body.children) walk(child);
    return regionOf(takes, shows);
  };
  let last = '';
  let taking: Box[] = [];
  const tell = () => {
    const { takes, shows } = region();
    const key = JSON.stringify([takes, shows]);
    if (key === last) return;
    last = key;
    taking = takes;
    report(takes, shows);
  };
  const ours = (event: PointerEvent) => taking.some(([left, top, right, bottom]) => event.clientX >= left && event.clientX < right && event.clientY >= top && event.clientY < bottom);
  const pointers = misses(missed);
  const pressed = (event: PointerEvent) => { if (on) pointers.pressed(event.pointerType === 'mouse', ours(event)); };
  const moved = (event: PointerEvent) => { if (on) pointers.moved(event.pointerType === 'mouse', ours(event)); };
  const heard: [keyof DocumentEventMap, EventListener][] = [['pointerdown', pressed as EventListener], ['pointerup', pointers.lifted], ['pointercancel', pointers.lifted], ['pointermove', moved as EventListener]];
  for (const [type, listener] of heard) document.addEventListener(type, listener, { capture: true, passive: true });
  const watching = new MutationObserver(tell);
  watching.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const sized = new ResizeObserver(tell);
  sized.observe(document.documentElement);

  return {
    document: {
      ...wrap(body, root),
      createElement: async (tag: string) => safe(document.createElement(REFUSED.has(tag.toLowerCase()) ? 'div' : tag)),
      createAnchorElement: async (href: string) => {
        const anchor = document.createElement('a');
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        try { const url = new URL(href); anchor.href = url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#'; } catch { anchor.href = '#'; }
        return safe(anchor);
      },
    },
    // Whether the layer is what the frame shows, in place of the plugin's own page, and in which mode: a frame whose
    // scheme is not the app's is given an opaque backdrop.
    lay(shown: boolean, theme: 'dark' | 'light') {
      on = shown;
      pointers.laid();
      document.documentElement.toggleAttribute('data-hazelle-layer', shown);
      document.documentElement.style.colorScheme = shown ? theme : '';
      host.style.display = shown ? 'block' : 'none';
      // Chromium: a frame the app let go of keeps its own scrollers out of a wheel's and a swipe's aim after the app
      // gives its input back, until it is composited anew. A change of style that composites nothing does not do it.
      if (shown) {
        const page = document.documentElement;
        page.style.opacity = '0.999';
        requestAnimationFrame(() => requestAnimationFrame(() => { page.style.opacity = ''; }));
      }
      tell();
    },
    close() {
      watching.disconnect();
      sized.disconnect();
      for (const id of [...listeners.keys()]) unlisten(id);
      for (const [type, listener] of heard) document.removeEventListener(type, listener, { capture: true });
      host.remove();
      mode.remove();
    },
  };
}
