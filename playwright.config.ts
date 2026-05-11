import { defineConfig, devices } from '@playwright/test'

process.env.XDG_CONFIG_HOME ??= '/private/tmp/scribepad-playwright/config'
process.env.XDG_STATE_HOME ??= '/private/tmp/scribepad-playwright/state'
process.env.XDG_RUNTIME_DIR ??= '/private/tmp/scribepad-playwright/runtime'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
