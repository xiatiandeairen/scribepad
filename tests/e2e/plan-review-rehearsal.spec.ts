/**
 * Plan-review rehearsal — the full "Claude Code ↔ scribepad" story in one spec.
 *
 * Earlier batches of e2e coverage each pinned one slice of the automated
 * handoff: URL timing (session-server.spec.ts's wait-mode tests), the doc-
 * outside-repo export path (session-doc-outside-repo.test.ts), and the write
 * path selection → rewrite → persist (next-g4.spec.ts). This spec chains all
 * of those slices into a single rehearsal, because the skill protocol depends
 * on them composing into one coherent flow, not just each holding in
 * isolation:
 *
 *   P4  — `scribepad <plan.md> --wait` prints a `/next/` panel URL on stderr
 *         *before* blocking on Done.
 *   P7  — the approved export differs from Claude's original draft, because a
 *         human reviewer actually changed something in the panel.
 *
 * The document lives outside the repo (a temp dir standing in for wherever
 * Claude Code keeps its plan files) — this exercises the same "doc not under
 * repoRoot" path the outside-repo unit test covers, but end to end through a
 * real spawned CLI + HTTP session instead of calling exportPathFor directly.
 *
 * The "human reviewing in the panel" step is simulated by driving the same
 * HTTP endpoints the /next panel itself calls (annotations, rewrite-apply,
 * done) — mirroring how session-server.spec.ts drives Done without a browser.
 * rewrite-apply needs a real LlmRunner; the provider CLI isn't available in
 * CI, so the server is spawned with SCRIBEPAD_STUB_LLM=1 (server/adapters/
 * llm-stub.ts), the same deterministic stub next-g4.spec.ts uses.
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportPathFor, runtimeRegistryPath } from '../../server/paths'
import { STUB_REVIEWED_MARK } from '../../server/adapters/llm-stub'
import type { Annotation } from '../../types/annotation'
import type { ExtractResponse, RewriteApplyResponse } from '../../types/api'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')

// The decision this rehearsal "reviews": a human swaps 方案 A for 方案 B in the
// panel, which is exactly what P7 needs to be a true statement (approved !=
// draft). Uses the section aliases + `D<n>` label syntax core/extract expects
// (core/extract/sections.ts, core/extract/labels.ts).
const PLAN_BODY = `# Rehearsal Plan — 会话存储选型

> 状态：待 review | 本文档用于 scribepad 端到端彩排

## 目标

- **G1** 验证 Claude Code 与 scribepad 之间的审阅通路完整可用，可判定标准：核准导出内容体现人工改写。

## 决策

### D1（核心）：会话存储选 **方案 A（内存存储）** ✅ 已定

**选了什么**：采用方案 A（内存存储），暂不引入外部依赖。

**为什么**：现阶段并发量小，内存存储足够，且实现简单、上线快。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| 方案 B（Redis 持久化） | 增加运维复杂度，当前规模无必要 |

## 验收

- [ ] **G1** 导出文件中体现审阅批注与改写结果。
`

test.describe('plan review rehearsal: Claude Code --wait ↔ human review ↔ approved export', () => {
  test.beforeEach(async () => {
    await cleanupRegistryServer()
  })

  test.afterEach(async () => {
    await cleanupRegistryServer()
  })

  test('URL before Done, review actions land, Done gates on the approved (not draft) content', async () => {
    test.setTimeout(45_000)

    // Step 1: a plan doc outside the repo — stands in for wherever Claude Code
    // keeps its plan files (an XDG plans dir), not anywhere under repoRoot.
    const plansDir = await mkdtemp(join(tmpdir(), 'scribepad-rehearsal-plans-'))
    const planPath = join(plansDir, 'session-storage-plan.md')
    await writeFile(planPath, PLAN_BODY, 'utf8')

    const runtimeTmp = await mkdtemp(join(tmpdir(), 'scribepad-rehearsal-runtime-'))
    const configPath = join(runtimeTmp, 'config.json')
    await writeFile(
      configPath,
      JSON.stringify({ activeIdleMs: 10_000, initialIdleMs: 600_000 }),
      'utf8',
    )
    const env = {
      SCRIBEPAD_CONFIG: configPath,
      XDG_CONFIG_HOME: join(runtimeTmp, 'xdg-config'),
      XDG_STATE_HOME: join(runtimeTmp, 'xdg-state'),
      XDG_RUNTIME_DIR: join(runtimeTmp, 'xdg-runtime'),
      // Provider CLIs aren't available in CI; the stub speaks the rewrite task
      // deterministically (server/adapters/llm-stub.ts) so rewrite-apply below
      // exercises the real rewrite → splice → save → re-extract path.
      SCRIBEPAD_STUB_LLM: '1',
    }

    try {
      // Step 2: background `scribepad <plan.md> --wait`, exactly what Claude Code
      // spawns and blocks on.
      const child = spawnCli([SERVER_ENTRY, planPath, '--wait'], env)

      // Step 3: the URL must land on stderr *before* Done — this is the P4
      // contract. Assert its exact shape, not just "some URL showed up".
      const panelUrl = await waitForPanelUrl(child)
      expect(panelUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/next\/$/)
      const origin = panelUrl.replace(/\/next\/$/, '')

      // Step 4: recover the sessionId the CLI opened for this doc (idempotent —
      // same pattern as session-server.spec.ts's resolveCliServer).
      const sessionId = await openSessionId(origin, planPath)

      // registry: exactly one server alive, and it is this child's own pid — no
      // second server sneaked in while opening the session.
      await assertSingleLiveServer(child.pid, env)

      // Step 5a: simulate the human opening the panel — extract must resolve the
      // document's structure, including the D1 decision this rehearsal reviews.
      const extractRes = await fetch(`${origin}/api/sessions/${sessionId}/extract`)
      expect(extractRes.ok).toBe(true)
      const { result: extracted } = (await extractRes.json()) as ExtractResponse
      const decision = extracted.decisions.find((d) => d.label === 'D1')
      expect(decision?.status).toBe('decided')
      const decisionPoint = extracted.points.find((p) => p.label === 'D1')
      expect(decisionPoint?.anchor).toBeDefined()
      const anchor = decisionPoint!.anchor!

      // Step 5b: simulate the human leaving a review note on that decision.
      const annotation: Annotation = {
        id: 'ann-d1-review',
        anchor: { srcStart: anchor.srcStart, srcEnd: anchor.srcEnd, text: decisionPoint!.text },
        target: { type: 'plan-item', planItemId: 'D1', kind: 'goal', title: 'D1' },
        instruction: '把方案 A 换成方案 B，内存存储在这个体量下站不住',
        state: 'draft',
        status: 'open',
        history: [{ ts: new Date().toISOString(), action: 'create' }],
        created_at: new Date().toISOString(),
      }
      const annotateRes = await fetch(`${origin}/api/sessions/${sessionId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [annotation] }),
      })
      expect(annotateRes.ok).toBe(true)
      const savedAnnotations = await fetch(`${origin}/api/sessions/${sessionId}/annotations`)
      const { annotations } = (await savedAnnotations.json()) as { annotations: Annotation[] }
      expect(annotations.map((a) => a.id)).toContain('ann-d1-review')

      // Step 5c: simulate the human actually rewriting D1 in the panel — the
      // selection sent is the exact raw slice at the anchor (the drift guard in
      // core/rewrite.ts requires doc.slice(srcStart, srcEnd) === selection), so
      // read it back off the live document rather than trusting item.text
      // (which is mdast plain text, not the raw markdown span).
      const { content: draftContent } = (await (
        await fetch(`${origin}/api/sessions/${sessionId}/file`)
      ).json()) as { content: string }
      const rawSelection = draftContent.slice(anchor.srcStart, anchor.srcEnd)
      expect(rawSelection).toContain('方案 A')

      const rewriteRes = await fetch(`${origin}/api/sessions/${sessionId}/rewrite-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              id: 'rw-d1',
              srcStart: anchor.srcStart,
              srcEnd: anchor.srcEnd,
              selection: rawSelection,
              instruction: '把方案 A 换成方案 B',
            },
          ],
        }),
      })
      expect(rewriteRes.ok).toBe(true)
      const rewriteBody = (await rewriteRes.json()) as RewriteApplyResponse
      expect(rewriteBody.content).toContain(STUB_REVIEWED_MARK)
      expect(rewriteBody.content).not.toBe(draftContent)

      // Step 6: simulate the human clicking Done — this is the same gate the
      // `--wait` block and the /next Done button both hang on.
      const exited = waitForStdoutOnExit(child, 20_000)
      const doneRes = await fetch(`${origin}/api/sessions/${sessionId}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(doneRes.ok).toBe(true)
      const stdout = await exited

      // Step 7: after Done, stdout must be exactly the approved export path —
      // one line, nothing else (this is what a Claude Code background task
      // parses to find the reviewed file).
      const outputPath = stdout.trim()
      expect(stdout).toBe(`${outputPath}\n`)
      expect(outputPath).toBe(exportPathFor(REPO_ROOT, planPath, env))

      // Step 8: the review actually changed the outcome — the exported file
      // carries the rewrite marker and the pre-review draft text is gone. This
      // is the P7 assertion: approved != Claude's original draft.
      const exported = await readFile(outputPath, 'utf8')
      expect(exported).toContain(STUB_REVIEWED_MARK)
      expect(exported).not.toBe(PLAN_BODY)
      expect(exported).not.toBe(draftContent)
    } finally {
      await rm(plansDir, { recursive: true, force: true })
      await rm(runtimeTmp, { recursive: true, force: true })
    }
  })
})

/**
 * The registry file (`server/registry.ts`) records the one server a repo may
 * have live at a time — opening a session must reuse it, never spin up a
 * second. Asserting the registry's pid equals this spawned child's pid is
 * exactly that "only one process is alive" check (mirrors session-server.spec.ts's
 * registry cleanup/reuse assertions, made explicit here as a rehearsal step).
 */
async function assertSingleLiveServer(
  childPid: number | undefined,
  env: Record<string, string>,
): Promise<void> {
  const registry = JSON.parse(readFileSync(runtimeRegistryPath(REPO_ROOT, env), 'utf8')) as {
    pid: number
  }
  expect(registry.pid).toBe(childPid)
}

async function openSessionId(origin: string, filePath: string): Promise<string> {
  const res = await fetch(`${origin}/api/sessions/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  })
  if (!res.ok) throw new Error(`POST /api/sessions/open failed: ${res.status}`)
  const body = (await res.json()) as { sessionId?: string }
  if (!body.sessionId) throw new Error('open response missing sessionId')
  return body.sessionId
}

function spawnCli(
  argv: string[],
  extraEnv: Record<string, string>,
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, argv, {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
  })
}

function waitForPanelUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('timed out waiting for panel URL')), 10_000)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const match = buffer.match(/(http:\/\/127\.0\.0\.1:\d+\/next\/)/)
      if (match) {
        clearTimeout(timer)
        child.stderr.off('data', onData)
        resolvePromise(match[1]!)
      }
    }
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`CLI exited before URL, code=${code}`))
    })
  })
}

function waitForStdoutOnExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`CLI exited with code=${code}: ${stderr}`))
        return
      }
      resolvePromise(stdout)
    })
  })
}

async function cleanupRegistryServer(): Promise<void> {
  const registryFile = runtimeRegistryPath(REPO_ROOT)
  if (existsSync(registryFile)) {
    try {
      const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as { pid?: number }
      if (typeof registry.pid === 'number') {
        try {
          process.kill(registry.pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
    } catch {
      // Invalid registry; remove below.
    }
  }
  await rm(registryFile, { force: true })
}
