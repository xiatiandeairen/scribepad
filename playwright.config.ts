import { defineConfig, devices } from '@playwright/test'

process.env.XDG_CONFIG_HOME ??= '/private/tmp/scribepad-playwright/config'
process.env.XDG_STATE_HOME ??= '/private/tmp/scribepad-playwright/state'
process.env.XDG_RUNTIME_DIR ??= '/private/tmp/scribepad-playwright/runtime'

// Each spec spawns its own production server (`node dist/server/index.js`) — the
// /next browser smoke and the API-driven session-server test both manage their
// own child process, so there is no shared webServer here.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
