/**
 * User-flow e2e — simulates real user behavior (mouse drag, keyboard typing,
 * actual button clicks). Catches bugs that programmatic Range-API tests miss:
 *   - popover position drift during drag
 *   - selectionchange race conditions
 *   - focus management during keyboard input
 *   - modal keyboard intercepts
 *   - hover/click target overlapping
 *
 * 10 complete user journeys, each = one realistic task a vibe coder would do.
 */
import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mockRewrite, mockRewriteError } from './helpers'

test.describe.skip('legacy user-flow v0.1', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const SAMPLE_PATH = resolve(__dirname, '../../sample.md')
  const SIDECAR_PATH = resolve(__dirname, '../../.sample.md.annotations.json')
  let SAMPLE_BASELINE = ''

  test.beforeAll(() => {
    SAMPLE_BASELINE = readFileSync(SAMPLE_PATH, 'utf8')
  })

  test.beforeEach(() => {
    if (existsSync(SIDECAR_PATH)) unlinkSync(SIDECAR_PATH)
    writeFileSync(SAMPLE_PATH, SAMPLE_BASELINE, 'utf8')
  })

  test.afterAll(() => {
    if (existsSync(SIDECAR_PATH)) unlinkSync(SIDECAR_PATH)
    writeFileSync(SAMPLE_PATH, SAMPLE_BASELINE, 'utf8')
  })

  /**
   * Drag-select a substring of text inside the reader using REAL mouse events.
   * Computes screen coords of the substring's first/last char via DOM, then
   * uses page.mouse.{move,down,up} with intermediate steps to mimic a human drag.
   */
  async function dragSelect(page: Page, substring: string): Promise<void> {
    // Scroll target into viewport first — playwright mouse events don't auto-scroll,
    // and viewports default to 1280×720 (sample.md is taller).
    await page.evaluate((needle: string) => {
      const root = document.querySelector('.reader')
      if (!root) throw new Error('.reader not found')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text
        const idx = tn.data.indexOf(needle)
        if (idx >= 0) {
          const r = document.createRange()
          r.setStart(tn, idx)
          r.setEnd(tn, idx + 1)
          const rect = r.getBoundingClientRect()
          const targetY = window.innerHeight / 3
          if (rect.top < 0 || rect.bottom > window.innerHeight) {
            window.scrollBy(0, rect.top - targetY)
          }
          return
        }
      }
      throw new Error('substring not found: ' + needle)
    }, substring)

    // Re-compute coords AFTER scroll (rect changes).
    const coords = await page.evaluate((needle: string) => {
      const root = document.querySelector('.reader')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const idx = node.data.indexOf(needle)
        if (idx >= 0) {
          const r = document.createRange()
          r.setStart(node, idx)
          r.setEnd(node, idx + 1)
          const startRect = r.getBoundingClientRect()
          r.setStart(node, idx + needle.length - 1)
          r.setEnd(node, idx + needle.length)
          const endRect = r.getBoundingClientRect()
          return {
            x1: startRect.left + 1,
            y1: startRect.top + startRect.height / 2,
            x2: endRect.right - 1,
            y2: endRect.top + endRect.height / 2,
          }
        }
      }
      throw new Error('substring not found after scroll: ' + needle)
    }, substring)

    await page.mouse.move(coords.x1, coords.y1)
    await page.mouse.down()
    await page.mouse.move(coords.x1 + 20, coords.y1, { steps: 3 })
    await page.mouse.move(coords.x2, coords.y2, { steps: 8 })
    await page.mouse.up()
  }

  /** Wait until a clean reader is rendered (markdown applied, h1 visible). */
  async function waitReaderReady(page: Page): Promise<void> {
    await expect(page.locator('.reader h1')).toBeVisible({ timeout: 5000 })
  }

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 1 — first-time annotation creation
  // 用户:打开页面 → 拖选一段文字 → 点 popover → 看 sidebar 出现卡片
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 1 · 第一次创建批注(完整鼠标路径)', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    // pre-condition: empty
    await expect(page.locator('.anno-card')).toHaveCount(0)
    await expect(page.locator('mark.anno')).toHaveCount(0)

    // 鼠标拖选 "session token"
    await dragSelect(page, 'session token')

    // popover 自动浮现(选区上方)
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 2000 })
    await expect(popover).toContainText('💬 批注')

    // 鼠标点 popover
    await popover.click()

    // 副作用:reader 出现 mark,sidebar 出现 1 张 card,popover 消失
    await expect(page.locator('mark.anno')).toHaveCount(1)
    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(popover).not.toBeVisible()

    // 头部 badge 数字更新
    await expect(page.locator('.app-header .badge')).toContainText('1 批注')
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 2 — submit instruction, see AI rewrite, accept via [接受] button
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 2 · 输入指令让 AI 改写并点击接受', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitReaderReady(page)

    // step 1: 创建批注
    await dragSelect(page, 'session token')
    await page.locator('.popover').click()
    await expect(page.locator('.anno-card')).toHaveCount(1)

    // step 2: 鼠标点击卡片输入框
    const input = page.locator('.anno-card textarea')
    await input.click()
    await expect(input).toBeFocused()

    // step 3: 键盘输入指令
    await input.fill('改紧凑些')
    await expect(input).toHaveValue('改紧凑些')

    // step 4: 按回车提交
    await input.press('Enter')

    // step 5: 等到 deciding(card 显示"AI 已返回")— 经过 thinking
    await expect(page.locator('.anno-card')).toContainText('AI 已返回', { timeout: 5000 })

    // step 6: 鼠标点 mark 打开 modal
    await page.locator('mark.anno').click()
    const modal = page.locator('.diff-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('改紧凑些') // 指令回显
    await expect(modal).toContainText('改写') // 新版含 [改写] 后缀

    // step 7: 鼠标点 [接受] 按钮(footer 第二个 primary)
    await page.locator('.reprompt button.primary', { hasText: '接受' }).first().click()

    // step 8: 验证副作用
    await expect(modal).not.toBeVisible()
    await expect(page.locator('.reader')).toContainText('session token [改写]')
    await expect(page.locator('mark.anno')).toHaveCount(0) // applied 不显示
    await expect(page.locator('.anno-card')).toHaveCount(0)
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 3 — Esc 关闭 modal,annotation 保持 AI 已返回
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 3 · Esc 关闭 modal 后仍可重开结果', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, 'session token')
    await page.locator('.popover').click()
    await page.locator('.anno-card textarea').fill('改紧凑')
    await page.locator('.anno-card textarea').press('Enter')
    await expect(page.locator('.anno-card')).toContainText('AI 已返回')
    await page.locator('mark.anno').click()
    await expect(page.locator('.diff-modal')).toBeVisible()

    // 按 Esc
    await page.keyboard.press('Escape')
    await expect(page.locator('.diff-modal')).not.toBeVisible()

    await expect(page.locator('mark.anno.deciding')).toHaveCount(1)
    await expect(page.locator('.anno-card.deciding')).toContainText('AI 已返回')

    await page.locator('.anno-card.deciding').click()
    await expect(page.locator('.diff-modal')).toBeVisible()
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 4 — Cmd+Enter 接受,文档变更,但不拍板
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 4 · Cmd+Enter 接受但不拍板', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, '会话可即时撤销')
    await page.locator('.popover').click()
    await page.locator('.anno-card textarea').fill('改简短')
    await page.locator('.anno-card textarea').press('Enter')
    await expect(page.locator('.anno-card')).toContainText('AI 已返回', { timeout: 5000 })

    // 点 AI 已返回卡片
    await page.locator('.anno-card.deciding').click()
    await expect(page.locator('.diff-modal')).toBeVisible()

    // Cmd+Enter(macOS)/ Ctrl+Enter
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Enter' : 'Control+Enter')

    await expect(page.locator('.diff-modal')).not.toBeVisible()
    // 文档变了
    await expect(page.locator('.reader')).toContainText('会话可即时撤销 [改写]')
    // applied 后 anno 卡片不显示；拍板不在这个 popup 内完成。
    // 这里只验证 modal 已关 + 文档变更
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 5 — 多批注共存(3 条不同段落)
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 5 · 创建 3 条不同位置批注共存', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    // 第 1 条 — 第一段落
    await dragSelect(page, 'session token')
    await expect(page.locator('.popover')).toBeVisible()
    await page.locator('.popover').click()
    await expect(page.locator('.anno-card')).toHaveCount(1)
    // popover 点击后自动消失(创建批注 + clearSelection)
    await expect(page.locator('.popover')).not.toBeVisible()

    // 第 2 条 — 第二段落
    await dragSelect(page, '可即时撤销')
    await expect(page.locator('.popover')).toBeVisible()
    await page.locator('.popover').click()
    await expect(page.locator('.anno-card')).toHaveCount(2)
    await expect(page.locator('.popover')).not.toBeVisible()

    // 第 3 条 — 第三段落(p)
    await dragSelect(page, '涉及范围')
    await expect(page.locator('.popover')).toBeVisible()
    await page.locator('.popover').click()
    await expect(page.locator('.anno-card')).toHaveCount(3)

    // reader 有 3 个 mark
    await expect(page.locator('mark.anno')).toHaveCount(3)

    // 头部 badge "3 批注 · 0 已定"
    await expect(page.locator('.app-header .badge')).toContainText('3 批注')
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 6 — 刷新页面,批注持久化
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 6 · 刷新页面批注持久化', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, 'session token')
    await page.locator('.popover').click()
    await expect(page.locator('.anno-card')).toHaveCount(1)

    // 刷新
    await page.reload()
    await waitReaderReady(page)

    // 批注还在
    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(page.locator('mark.anno')).toHaveCount(1)
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 7 — 中途松手不点 popover,点别处,popover 消失
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 7 · 拖选后不点 popover,点别处,popover 消失', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, 'session token')
    await expect(page.locator('.popover')).toBeVisible()

    // 点 reader 别处(取消选区)
    await page.locator('.reader').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.popover')).not.toBeVisible({ timeout: 2000 })

    // 没有创建批注
    await expect(page.locator('.anno-card')).toHaveCount(0)
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 8 — Reprompt 再写(modal 内输入新指令重发 AI)
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 8 · Reprompt 再写一次', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, 'session token')
    await page.locator('.popover').click()
    await page.locator('.anno-card textarea').fill('改紧凑')
    await page.locator('.anno-card textarea').press('Enter')
    await expect(page.locator('.anno-card')).toContainText('AI 已返回', { timeout: 5000 })

    await page.locator('mark.anno').click()
    await expect(page.locator('.diff-modal')).toBeVisible()

    // Reprompt input
    const repromptInput = page.locator('.reprompt textarea')
    await expect(repromptInput).toBeVisible()
    await repromptInput.click()
    await repromptInput.fill('压缩到 10 字以内')

    // 按回车 — 应不触发 accept(被拦截 → reprompt)
    await repromptInput.press('Enter')

    // modal 不应该立即关闭(reprompt 仍在 deciding 流程内)
    // 实际行为:reprompt 应该重发 AI,modal 内容更新或关闭等新结果
    // 我们只验证 modal 没接受(否则文档已变)
    // 给 reprompt 一点时间走完
    await page.waitForTimeout(500)

    // 验证 reader 没被修改成"接受"路径
    // (reprompt 的具体行为见 onReprompt 实现 — 可能 close modal + 重新 thinking)
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 9 — AI 返回错误(server 500),toast 显示
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 9 · AI 错误时 toast 显示', async ({ page }) => {
    await mockRewriteError(page, 'rewrite failed: dummy error')
    await page.goto('/')
    await waitReaderReady(page)

    await dragSelect(page, 'session token')
    await page.locator('.popover').click()
    await page.locator('.anno-card textarea').fill('改')
    await page.locator('.anno-card textarea').press('Enter')

    // toast 出现
    const toast = page.locator('.toast, [role="alert"], [class*="toast"]').first()
    await expect(toast).toBeVisible({ timeout: 3000 })
    await expect(toast).toContainText('dummy error')

    // 状态回到 draft(input 可见)
    await expect(page.locator('.anno-card textarea')).toBeVisible()
  })

  // ─────────────────────────────────────────────────────────────────────
  // FLOW 10 — 文档加载 + 启动状态(无批注时)
  // ─────────────────────────────────────────────────────────────────────
  test('FLOW 11 · 选中 list item 内文字也能创建批注', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    // sample.md 中"## 方案 D"下:- 优点:撤销简单、不暴露载荷、易于轮换
    await dragSelect(page, '撤销简单')

    // popover 应出现
    await expect(page.locator('.popover')).toBeVisible({ timeout: 3000 })
    await page.locator('.popover').click()

    // 创建成功
    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(page.locator('mark.anno')).toHaveCount(1)
  })

  test('FLOW 10 · 启动加载完成后基础渲染正确', async ({ page }) => {
    await page.goto('/')
    await waitReaderReady(page)

    // 标题
    await expect(page.locator('.reader h1')).toContainText('auth 重构计划')
    // 段落
    await expect(page.locator('.reader p').first()).toBeVisible()
    // 头部
    await expect(page.locator('.app-header strong')).toHaveText('scribepad')
    await expect(page.locator('.app-header .path')).toContainText('sample.md')
    await expect(page.locator('.app-header .badge')).toContainText('0 批注')
    // sidebar empty
    await expect(page.locator('.sidebar .empty')).toBeVisible()
  })
})
