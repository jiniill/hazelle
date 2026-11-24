import { useEffect, useReducer } from 'react';

type Draw = (html: string) => string;

// A fence with a language, as engine/display.ts renders it.
const MARK = '<pre><code class="language-';

const asWritten: Draw = (html) => html;

// Undefined until the highlighter loads; null when it could not.
let highlight: typeof import('./highlight') | null | undefined;
let loading: Promise<unknown> | null = null;
// The highlighter's draw, made anew as modes land: a story drawn without a mode draws again with it, and until then
// keeps the colours of the fences whose modes have come.
let draw: Draw | null = null;
const landed = () => {
  draw = (html) => highlight!.drawCode(html);
};

// What a story's fences still wait for: the highlighter, loaded only for named-language fences, then each fence's mode
// with the first that names it. Null when nothing is to come.
export function awaited(html: string): Promise<unknown> | null {
  if (!html.includes(MARK) || highlight === null) return null;
  if (highlight) return highlight.modesFor(html)?.then(landed) ?? null;
  return (loading ??= import('./highlight')
    .then(
      (module) => (highlight = module).modesFor(html),
      () => (highlight = null),
    )
    .then(() => highlight && landed()));
}

// null while the highlighter loads; the component draws again once it has, and again as a mode lands.
export function useCode(html: string): Draw | null {
  const [, moved] = useReducer((count: number) => count + 1, 0);
  const coming = awaited(html);
  useEffect(() => {
    if (!coming) return;
    let live = true;
    void coming.then(() => live && moved());
    return () => {
      live = false;
    };
  }, [coming]);
  return !html.includes(MARK) || highlight === null ? asWritten : draw;
}
