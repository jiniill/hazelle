import { useEffect, useReducer } from 'react';

type Katex = typeof import('katex').default;
type Draw = (html: string) => string;

// The span src/engine/display.ts wraps each $$…$$ in, its text the formula as written and escaped.
const MARK = '<span data-tex>';
const FORMULA = /<span data-tex>\$\$([^<]*?)\$\$<\/span>/g;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
// Inline MathML, which the browser draws with no stylesheet or font of KaTeX's. strict off: a formula with Korean in it
// is drawn, not warned about.
const OPTIONS = { output: 'mathml', displayMode: false, throwOnError: true, strict: false } as const;

const asWritten: Draw = (html) => html;
const drawWith = (katex: Katex): Draw => (html) =>
  html.replace(FORMULA, (written, tex: string) => {
    try {
      return katex.renderToString(tex.replace(/&(?:amp|lt|gt|quot);/g, (entity) => ENTITIES[entity]!), OPTIONS);
    } catch {
      return written;
    }
  });

// Undefined until KaTeX loads; asWritten when it could not.
let drawFormulas: Draw | undefined;
let loading: Promise<unknown> | null = null;

// Lazy-load KaTeX only when formulas exist; retain the pending promise.
export function mathFor(html: string): Draw | Promise<unknown> {
  if (drawFormulas) return drawFormulas;
  if (!html.includes(MARK)) return asWritten;
  return (loading ??= import('katex').then(
    (module) => (drawFormulas = drawWith(module.default)),
    () => (drawFormulas = asWritten),
  ));
}

// null while KaTeX loads; the component draws again once it has.
export function useMath(html: string): Draw | null {
  const [, loaded] = useReducer((count: number) => count + 1, 0);
  const math = mathFor(html);
  useEffect(() => {
    if (!(math instanceof Promise)) return;
    let live = true;
    void math.then(() => live && loaded());
    return () => {
      live = false;
    };
  }, [math]);
  return math instanceof Promise ? null : math;
}
