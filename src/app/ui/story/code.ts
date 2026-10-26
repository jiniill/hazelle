import { useEffect, useReducer } from 'react';

type Draw = (html: string) => string;

// A fence with a language, as engine/display.ts renders it.
const MARK = '<pre><code class="language-';

const asWritten: Draw = (html) => html;

// Undefined until the highlighter loads; asWritten when it could not.
let drawCode: Draw | undefined;
let loading: Promise<unknown> | null = null;

// What highlights html's code blocks; a promise while the highlighter loads. It is imported only for html that holds a
// fence naming its language, so a story without one never loads it.
export function codeFor(html: string): Draw | Promise<unknown> {
  if (drawCode) return drawCode;
  if (!html.includes(MARK)) return asWritten;
  return (loading ??= import('./highlight').then(
    (module) => (drawCode = module.drawCode),
    () => (drawCode = asWritten),
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
