import { configDefaults, defineConfig } from 'vitest/config';

// Separate plain-Node test config from client plugins; preserve ?raw CSS for media.test.ts.
// Exclude agent worktrees/Playwright suites and cap workers at four: unbounded runs exhausted this machine's memory.
export default defineConfig({ assetsInclude: ['**/*.risup'], test: { maxWorkers: 4, setupFiles: ['src/runtime/testing/object-codec-setup.ts'], exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**', 'shots/**', 'selfhost/**'], css: { include: [/\.css\?raw$/] } } });
