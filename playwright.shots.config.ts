import { defineConfig } from '@playwright/test';
import { FAKE_PROVIDER } from './e2e/helpers';

const PORT = 5180;

// Reuse lasting .data/ accounts/dev server, never wipe like normal E2E.
// A reused server must have matching HAZELLE_LOCAL_PROVIDERS to reach fakeProvider; second processes cannot share data locks.
export default defineConfig({
  testDir: 'shots',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  // A wrong locator fails in 5 s instead of running out the test's 60 s; a longer wait carries its own timeout.
  use: { baseURL: `http://localhost:${PORT}`, actionTimeout: 5_000, navigationTimeout: 15_000 },
  webServer: [
    {
      command: 'npm run -s server',
      env: { HAZELLE_DATA: '.data', HAZELLE_LOCAL_PROVIDERS: FAKE_PROVIDER },
      url: 'http://localhost:8080/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `./node_modules/.bin/vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
