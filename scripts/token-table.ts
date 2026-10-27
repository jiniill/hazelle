import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

const TABLE = '/node_modules/gpt-tokenizer/esm/bpeRanks/o200k_base.js';

// Keep o200k strings inside JSON.parse, not minified template-literal arrays: iOS Safari workers overflow evaluating
// the ~100k-element chunks. Reproduce with WebKit JSC_maxPerThreadStackUsage=512000; desktop defaults hide it.
export function tokenTable(): Plugin {
  return {
    name: 'hazelle-token-table',
    async load(id) {
      if (!id.endsWith(TABLE)) return null;
      const { default: ranks } = (await import(pathToFileURL(id).href)) as { default: (string | number[])[] };
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(ranks))});`;
    },
  };
}
