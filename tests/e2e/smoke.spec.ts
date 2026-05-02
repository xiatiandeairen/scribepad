import { test, expect } from '@playwright/test'

test('smoke: dev server boots and renders foundation page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-header strong')).toHaveText('scribepad')
  await expect(page.locator('.badge')).toContainText('foundation')
})
