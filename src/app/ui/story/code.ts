import { useEffect, useReducer } from 'react';

type Draw = (html: string) => string;

// A fence with a language, as engine/display.ts renders it.
const MARK = '<pre><code class="language-';

const asWritten: Draw = (html) => html;

// Undefined until the highlighter loads; null when it could not.
let highlight: typeof import('./highlight') | null | undefined;
let loading: Promise<unknown> | null = null;

// Lazy-load highlighting only for named-language fences, and each fence's mode with the first that names it; retain the
// highlighter's promise until it resolves.
function codeFor(html: string): Draw | Promise<unknown> {
  if (!html.includes(MARK) || highlight === null) return asWritten;
  if (highlight) return highlight.modesFor(html) ?? highlight.drawCode;
  return (loading ??= import('./highlight').then(
    (module) => (highlight = module).modesFor(html),
    () => (highlight = null),
  ));
}

// null while the highlighter loads; the component draws again once it has.
export function useCode(html: string): Draw | null {
  const [, loaded] = useReducer((count: number) => count + 1, 0);
  const code = codeFor(html);
  useEffect(() => {
    if (!(code instanceof Promise)) return;
    let live = true;
    void code.then(() => live && loaded());
    return () => {
      live = false;
    };
  }, [code]);
  return code instanceof Promise ? null : code;
}
