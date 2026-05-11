import { test, expect } from '@playwright/test'

test('smoke: dev server boots and renders app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-title strong')).toHaveText('scribepad')
  await expect(page.locator('.reader')).toBeVisible()
  await expect(page.locator('.right-rail')).toBeVisible()
  await expect(page.locator('.plan-panel')).toBeVisible()
})
