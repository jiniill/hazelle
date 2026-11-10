import { sandbox } from './scripts/sandbox';
import { compressedAssets } from './scripts/compress';
import { tokenTable } from './scripts/token-table';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), sandbox(), compressedAssets()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  // The server swaps this placeholder for each page load's own nonce (server/static NONCE).
  html: { cspNonce: 'HAZELLE_NONCE' },
  // Emit assets as files: CSP rejects data URLs. Explicit ?inline is code-read text, never a loaded URL.
  // Build sandbox stylesheet only; scripts/sandbox emits a classic script to avoid opaque-frame module CORS fetches.
  // package.json sideEffects names CSS alone (build:server's esbuild reads it too), so the ui barrel's unused components
  // and their CSS stay out of the entry. A module imported only to run its top level would be dropped: import it by
  // name, or list it there.
  build: { assetsInlineLimit: 0, outDir: 'dist/client', rollupOptions: { tsconfig: false, input: { main: 'index.html', sandbox: 'sandbox.html' } } },
  // Workers are module workers (runtime/worker moduleWorker), so a worker's dynamic import stays its own chunk: the
  // evaluation worker starts small and loads the tokenizer apart (runtime/evaluation/tokenizer).
  worker: { format: 'es', plugins: () => [tokenTable()], rollupOptions: { tsconfig: false } },
  assetsInclude: ['**/*.risup'],
});
