# scribepad 深度清洁 + 结构重整计划

> 状态:待 review · 只出计划不改代码 | 基线:main @ edfc366 | 审计日期:2026-07-05
> 方法:全部"删/移"候选逐一 grep 核实引用(证据附在每张表);typecheck×3 / lint / unit(239) / build 四道闸已在基线上实测全绿(e2e 未跑,按 G1 惯例每阶段收尾跑)。

## 0. 总判断

仓库整体是干净的:六边形边界(core 无框架 import、types 无运行时、routes 不碰 adapters)**零违规**;ConfirmState/锁线摘除**彻底**(生产代码 0 残留);旧 adapter claude-cli/codex-cli **无孤儿引用**(只剩 2 处注释措辞)。真正的死代码很少——最该清的不是代码,是**三类漂移**:

1. **孤儿文件**:`preview/`(104K 设计稿)、`docs/assets/*.webm`(1.6M)、`sample.agent.md`、`types/document.ts`,全部 grep 0 引用,可无脑删。
2. **文档撒谎**:`docs/architecture.md` 的 core 模块树缺 extract/verify/refine/section-insert、还把已删除的 ConfirmState 写成"待实现 seam";14 处注释指向已不存在的 `docs/refactor-plan.md` / `docs/plan.md`。注释撒谎比无注释更糟,应优先修。
3. **root 活文档被单测锁死**:`plan-auth-soc2.md` / `plan-data-backend.md` 是产品负责人可编辑的真实 plan,却被 extract/verify/session/client-next-integration 四个单测直接断言内容——编辑活文档会打破测试。fixture 应快照进 `tests/fixtures/` 冻结,root 副本解锁。

**旧路径退休(D0)**:我的建议是**拍板退休、分三个 PR 渐进执行**。Q3 触发条件("新前端接上稳定后")实质已满足:client-next 走真实后端、next-smoke 绿、CLI 已把 `/next/` 面板设为默认入口(edfc366 / 3d15cd3)。"UI 后续还会改造"改的是 client-next,不是回到 src/——旧 SPA 不是新 UI 的 fallback,它的独有价值(plan-state 锁 UI)承载的正是 D3 已砍掉的概念。留着它的持续成本:10 个旧 e2e 拖慢每次 G1、react/vite 双前端依赖链、legacy shim 复杂度。详见 §2。

计划按风险从低到高分 P0–P4 五阶段;P0–P3 与 D0 决策**无关**,可立即执行;P4 等拍板。

---

## 1. 审计范围与基线

- 范围:`git ls-files` 全量 141 文件(core/ server/ types/ src/ client-next/ tests/ docs/ scripts/ preview/ + 根目录)。
- 基线核验(2026-07-05 实测):`npm run typecheck`(三 tsconfig)✅ · `npm run lint` ✅ · `npm test` 22 文件 239 用例 ✅ · `npm run build` ✅。
- 判断依据:以当前生效决策为"真"(六边形已落地 / 活文档 D-1 / 锁线已砍 D3 / client-next 入仓 D5 / signoffs 走 ReviewStore),Strangler seam 一律**不当死代码**(清单见 §8)。

---

## 2. D0(顶层拍板):旧路径现在退休吗?

**这是本计划唯一的大决策,§3–§6 都不依赖它;§7 依赖它。**

旧路径 = `src/`(13 文件 ~4.5k 行)+ root `index.html` + vite 构建链 + 10 个旧 SPA e2e(~2.7k 行)+ 4 个旧 SPA 单测 + legacy planState shim + `/api/plan-state` + `types/plan.ts` 大部分。

### 路 A:现在拍板退休(推荐)

| 维度 | 内容 |
|---|---|
| 删除范围 | §7 的 R1–R3 全部(src/、vite/react npm 依赖、旧 e2e×10 + helpers、旧单测×4、shim、plan-state 路由×2、types/plan.ts 收缩、app.ts SPA serving 块) |
| 收益 | 每 commit 的 e2e 闸从 ~13 spec 降到 3;删 react/react-dom/@vitejs 等依赖(client-next 用 CDN UMD,npm 里的 react 只有旧 SPA 在用);shim/双路由复杂度归零;仓库行数 -7k+ |
| 风险 | ① 新前端若发现关键缺口(如 review-normalize UI 只有旧 SPA 有),无回退 UI;② `scribepad --wait` 的 legacy URL(`/s/:id`)行为要重新定义;③ README demo gif 脚本驱动的是旧 SPA(:5173),退休后 gif 生成链断 |
| 缓解 | 分 R1(冻结)→R2(删前端)→R3(删 shim/契约)三个 PR,R1 期间用新前端全流程 dogfood 一轮;gif 脚本改录 /next 或列 v2 |

### 路 B:继续保留到新 UI 定稿

| 维度 | 内容 |
|---|---|
| 删除范围 | 仅 §3–§6(孤儿文件 + 文档 + fixture 治理 + 2 个无消费者 API) |
| 收益 | 零功能风险;新 UI 改造期间保留一个"曾经全绿"的参照实现 |
| 成本 | 10 个旧 e2e 继续在每次改动上花时间且测的是"已砍概念的 UI"(锁徽章、plan-state 交互);react/vite 依赖继续背;每个新人/agent 都要重新分辨"哪套是真的" |

**推荐:路 A。** 判断依据:旧 SPA 已不在任何默认入口上(CLI 打印/打开的是 /next),它守护的锁语义是 D3 明确砍掉的死概念,"参照价值"随新前端 e2e+单测(client-next-integration 301 行逐字段断言)的存在而趋零。唯一实质缺口是 review-normalize UI(§11 决策 3 单独拍)。

---

## 3. P0 —— 无争议安全清洁(grep 0 引用,立即可做)

每项均已全仓 grep(含 tests/ client-next/ 配置/ md 文本),排除法见"证据"列。

| # | 路径 | 谁引用(grep 证据) | 安全性 | 动作 |
|---|---|---|---|---|
| P0-1 | `preview/`(5 个 HTML,104K) | 0 引用。唯二命中是假阳性:`src/App.tsx:1347` 的 CSS 类名 `review-normalize-preview`、`review-ui.spec.ts:166` 测试标题里的 "previews" | 安全 | **删目录**;同步删 `.prettierignore` 的 `preview` 行 |
| P0-2 | `docs/assets/scribepad-review-demo.webm`(1.6M) | 0 引用。README×2 与 `package.json files` 只用 `.gif`;`generate-readme-demo-gif.py` 无 webm 字样 | 安全(git 历史仍可找回) | **删**(若想留源录屏素材 → §11 决策 4) |
| P0-3 | `sample.agent.md` | 0 引用(grep `sample.agent` 全仓仅自身)。且匹配 `.gitignore` 的 `*.agent.md` 规则,靠已跟踪才存活——是 sessions 功能早期提交的导出示例,README 未引用 | 安全 | **删** |
| P0-4 | `types/document.ts`(仅 `DocumentFile`) | 全仓 grep `DocumentFile` / `types/document` 均 0 命中(唯一命中是定义自身) | 安全(纯类型,删后 typecheck 即验) | **删文件** |
| P0-5 | `server/adapters/llm-execa.ts:4,50,58` 注释 | 引用已删除的 `claude-cli.ts` / `codex-cli.ts` 文件("Replicates…" / "Mirrors claude-cli.ts:") | 安全(纯注释) | **改措辞**为描述行为本身,不指向死文件 |
| P0-6 | 14 处指向不存在文档的注释:`docs/refactor-plan.md`(eslint.config.js:18 / types/result.ts:6 / types/ports.ts:8 / core/schema.ts:5)、`docs/plan.md`(core/annotation-state.ts:9 / src/App.tsx:12 / Sidebar.tsx:5 / annotation-state.test.ts:8 / e2e draft·persistence·rewrite·decided 各 1) | 目标文档已从仓库删除(git 历史确认 `docs/plan.agent.md` 等曾存在) | 安全(纯注释) | **改指向** `docs/architecture.md` 或删该句;src/ 与旧 e2e 里的若走路 A 可留给 R2 一起删 |
| P0-7 | `server/services/session-manager.ts:499` `outputPathFor` | 纯转发 `exportPathFor` 的一行 wrapper;外部消费仅 `session.test.ts:30` | 安全(改 2 处调用) | **inline 删除**,测试直接用 `exportPathFor`(删抽象) |

验证:五道闸;`rg "DocumentFile|refactor-plan|docs/plan\.md"` 生产代码 0 命中。

---

## 4. P1 —— 根目录 / fixture 治理(需改引用,低风险)

**发现(本次审计核心之一)**:root 的 `sample.md`、`plan-auth-soc2.md` 与 `tests/fixtures/` 同名文件今天 byte-identical(diff=0),但单测**混读两处**,且 `plan-data-backend.md`(无 fixtures 副本)被单测断言到 D2/D3 引导词、`### N.` 序号等内容细节——**root 活文档实质被测试锁死,编辑真实 plan 会打破单测**。

| # | 路径 | 谁引用(grep 证据) | 动作 |
|---|---|---|---|
| P1-1 | root `sample.md` | `package.json dev:server`、README 教程(`scribepad sample.md`)、5 个旧 e2e(`resolve ../../sample.md`)、gif 脚本、**extract.test.ts:10(读 root!)** | **保留**(demo/dev 默认文档);仅把 extract.test 改读 `tests/fixtures/sample.md` |
| P1-2 | root `plan-auth-soc2.md` | next-smoke e2e(demo 语义,OK)、**extract.test:9 / verify.test:23 / session.test:234,345,382 / client-next-integration.test:195(均读 root!)** | **保留** root 作演示文档;4 个单测改读 `tests/fixtures/plan-auth-soc2.md`(副本已存在且 identical) |
| P1-3 | root `plan-data-backend.md` | `package.json start`、next-smoke、CLAUDE 上下文;**extract.test:13 / client-next-integration.test:89(读 root 且断言内容细节)** | **快照** `tests/fixtures/plan-data-backend.md`,2 个单测改读快照;root 活文档解锁可自由编辑 |
| P1-4 | `tests/fixtures/{sample,plan-auth-soc2}.md` | extract(部分)/verify(部分)/refine/agent-dispatch/agent-route/section-insert 等 | **保留为唯一测试真源**;完成 P1-1~3 后单测对 root 的读取应为 0(`rg "readFixture\('(sample|plan-)" tests/unit` 全部带 `tests/fixtures/` 前缀) |
| P1-5 | root `index.html` | vite 隐式入口(`src/main.tsx`);build 产出 dist/client | **保留**(旧路径件,归 §7 R2) |
| P1-6 | `scripts/generate-readme-demo-gif.py` | 0 代码引用;产出 README 的 gif;**驱动的是旧 SPA(:5173)** | **保留**;标注:随 D0 路 A 需改录 /next(§7 R2 遗留项) |
| P1-7 | `plan-frontend-integration.md`(root) | store-sidecar.ts / session-manager.ts 的 HACK 注释指向它(Q3) | **保留**(它是 shim 删除触发条件的锚点);D0 执行完后归档或删,注释随 R3 一起清 |

验证:`npm test` 全绿后,手动改一行 root `plan-data-backend.md` 再跑 `npm test` 仍绿(证明活文档解锁)——改完记得还原。

---

## 5. P2 —— 文档对齐现状(零代码风险)

| # | 文件 | 过时点(核实) | 动作 |
|---|---|---|---|
| P2-1 | `docs/architecture.md` | ① core 树缺 `extract/ verify/ refine/ section-insert.ts、agent/tasks/*`;② "core 只依赖 types/+zod"——实际还有 mdast 三库(fromMarkdown/gfm,E0 黑名单制下合法);③ "已就位未实现 seam:ExtractedItem/Gap/ConfirmState/ContextPack"——ConfirmState/Gap/ContextPack 已删、extract 已实现;④ 顶层结构无 `client-next/`、无 `/next/*` 挂载;⑤ routes 列表缺 extract/sessions-agent(SSE),services 缺 agent-dispatch;⑥ ReviewState 已是 `{annotations, signoffs}` 未反映 | **重写**(以本审计的实测 import 图为准) |
| P2-2 | `client-next/接入说明.md` | 入口写 "Spec Plan.html"(实为 index.html);"接入待办"(替换 fixture / 替换 agent mock)已全部完成;面向的 "writ 项目 GET /api/extract" 契约已变为 sessions-scoped | **精简改写**为 client-next 模块职责说明(index.html:37 注释引用它,保留价值在加载顺序表);或并入 docs/。不建议直接删 |
| P2-3 | `AGENTS.md` / `CLAUDE.md` | 内容一致且极简,无过时 | 保留不动 |

---

## 6. P3 —— 有证据的死代码 / 死 API(低风险,但涉 HTTP 面需产品负责人点头)

| # | 项 | 证据 | 疑点 | 动作(建议) |
|---|---|---|---|---|
| P3-1 | `GET /api/extract`(routes/extract.ts 整文件) | 仓内 0 消费:src/lib/api.ts 无 wrapper、client-next 走 `sessions/:id/extract`(plan-net.jsx:31)、tests 0 命中(`rg "api/extract" tests/` 空)。plan-fixture.jsx 文本提它是历史决策,后被 sessions-scoped 取代 | 是公开 HTTP 面,外部脚本理论可用(README 未记载) | **删**路由文件 + app.ts 挂载行(需点头,§11 决策 5) |
| P3-2 | `POST /api/session/export` 链:routes/session.ts export 端点 + `src/lib/api.ts exportSession` + `types/api.ts ExportSessionResponse` | 仓内 0 调用(UI 的 Done 走 done/close;tests 0 命中 `rg "session/export|exportSession" tests/` 空) | 同上,HTTP 面 | **删**三处(需点头,§11 决策 5) |
| P3-3 | `core/schema.ts` 4 个 export(extractedItemSchema 等) | 全仓 0 import(types/domain.ts、types/verify.ts 的命中是注释)。但 `satisfies z.ZodType<…>` 的编译期防漂移 guard 在 tsconfig.core 下真实生效 | **不是死代码**,是 guard;但文件头声称"validating at boundaries (LLM output, sidecar reads)"是谎言——无任何运行时消费者 | **保留 + 修头注释**为"编译期 type↔schema 防漂移 guard,暂无运行时消费者";不建议为消灭它而给 sidecar 接校验(加抽象,违反删抽象倾向)(§11 决策 6) |
| P3-4 | `core/refine/loop.ts` | 消费者仅 refine.test.ts(215 行,质量高) | **不是死代码**:extract→verify→refine 是已拍板的产品能力,缺的是 driving adapter(路由/CLI 未接线) | **保留**,在 architecture.md 标注"implemented, delivery 未接线" |
| P3-5 | 一批"export 但仅文件内使用"的符号(rewriteTask / prefixMatchesKind / normalizeReviewPlan / xdg×3 / resolveUserConfigPath / resolveProjectConfigPath / isCandidateText / candidateKeyOf / SelectionOpResult 等) | 逐个核实均有同文件内真实使用 | 非死代码,只是 export 面偏大 | **不动**(降 export 是纯噪音改动,无收益) |

**pivot 残留复核结论(第 4 目标的"证明")**:

- `ConfirmState/confirmStates`:生产代码 **0 命中**。仅存 ① store-sidecar.test.ts:115-141——故意往磁盘塞 stale `confirmStates` 验证"未知字段字节保真"机制,**是保护网不是残留**;② store-sidecar.ts:111 注释举例;③ plan-fixture.jsx 的文档文本。S4a 判定:摘除彻底。
- `claude-cli.ts / codex-cli.ts`:文件不存在、无孤儿 import;剩余 `'codex-cli' | 'claude-code-cli'` 是活的 AiProvider 配置枚举,非残留。
- `core/annotation-state.ts`:活——session-manager.ts:263 用 `validateStateTransition` 做写入护栏(新前端批注也走这条路),不随旧路径退休。
- B1/B2 / 锁概念:`PlanItemStatus 'locked'` 仅存于 types/plan.ts + shim + 旧 SPA——全部是 §8 有意 seam。

---

## 7. P4 —— 旧路径退休执行方案(D0 拍板"路 A"后才启动)

三个 PR,每个独立五道闸绿,可 bisect、可单独 revert:

### R1:冻结(1 个 commit)
- 旧 SPA 10 个 e2e 移入 `playwright` 的独立 project 或加 `test.describe.configure` 标记,退出默认 `npm run test:e2e` 闸(保留可手动跑)。
- 新前端 dogfood 一轮真实 plan 审阅(G4 全流程:批注/签核/改写落盘/刷新)。发现缺口 → 回到 D0 重议,零沉没成本。

### R2:删前端(1 个 PR)
| 删 | 引用清理 |
|---|---|
| `src/` 全部 13 文件 | — |
| root `index.html`、`vite.config.ts` | `package.json`:删 dev:client/dev 并联、build 改纯 `tsc -p tsconfig.server.json`;tsconfig.json include 去 src |
| 旧 e2e ×10 + `tests/e2e/helpers.ts` | playwright.config.ts 的 webServer(vite)改为起 dist server 或删 |
| 旧 SPA 单测 ×4:anchor / markdown / plan-inspector / review-normalize-validation | — |
| npm 依赖:react、react-dom、@types/react×2、@vitejs/plugin-react、vite、concurrently(核实 dev 脚本重排后)| `npm run build` 产物不再含 dist/client;app.ts 的 SPA serving 块 + `serveClient` 一并删 |
| 遗留项 | gif 脚本改录 /next(或 README 换新前端截图);`/s/:id` legacy URL в CLI 输出去掉 |

### R3:删服务端契约尾巴(1 个 PR)
| 删 | 证据锚点 |
|---|---|
| `server/adapters/store-sidecar.ts` 的 `createPlanStateShim` + `PlanStateShim`(HACK 块) | HACK(delete with old-path retirement) 自我标注 |
| session-manager `planStateShim` 字段 + `readPlanState/writePlanState` + HACK 注释 | 同上 |
| `server/routes/plan-state.ts` + `sessions.ts` 的 GET/POST `/sessions/:id/plan-state` | 消费者只剩已删的 src/lib/api.ts |
| `types/api.ts` PlanStateRequest/Response;`types/plan.ts` 收缩(PlanItemState 及锁相关;注意 `types/annotation.ts` import 了 PlanItemKind/PlanItemState——AnnotationTarget 用 PlanItemKind,需保留该枚举或迁移) | grep `types/plan` 消费面在 R2 后重新核实 |
| store-sidecar.test 中 planState shim 相关用例改写(保留未知字段字节保真用例) | — |
| 待拍板项随行:review-normalize 整条线去留(§11 决策 3)、fallback 单例路由组(file/annotations/rewrite——R2 后唯一消费者是否还存在,重新 grep 再定)、`/api/session*`(client-next plan-net.jsx:30 用 `GET /api/session`,**保留**) | — |
| 收尾 | `plan-frontend-integration.md` 归档;`package.json files` 加 `client-next`(或走构建化,§11 决策 7);architecture.md 二次更新 |

---

## 8. 分层边界审计结论 + 有意保留 seam 清单

### 边界核验(实测 import 图,全绿)

| 规则 | 结果 |
|---|---|
| core 只 import types/zod(+mdast 三库) | ✅ 实测 core 全部外部 import = zod、mdast×4、types/*;E0 lint 绿。architecture.md 措辞需补 mdast(P2-1) |
| types 无运行时 import | ✅(`grep "^import " types/*.ts` 除 `import type` 外 0) |
| adapters 只碰 types + core/result + 外部库(+server/paths) | ✅;paths.ts 是 server 内共享纯函数,不在禁列 |
| routes 不直接 import adapters | ✅(grep 0) |
| src 不 import server/core | ✅ |
| services→routes 反向依赖 | ✅ 无 |

### 结构小结(该拆/该合)
- 无需要新增的抽象;唯一删抽象项已列 P0-7(outputPathFor)。
- `client-next/plan-contract.jsx` 与 `types/api.ts` 的"双契约"是 D5 无构建方案的既定代价,由 client-next-integration.test 逐字段锁住,**不合并**。
- 结构性尾巴(非清洁,记录在案):npm 发布包 `files` 不含 client-next → `npx scribepad` 用户拿到的 `/next/` 面板 404,而 CLI 默认打印/打开的恰是它(index.ts:118-122)。归 §11 决策 7。

### ⚠ 有意保留 seam(本次审计明确“不删”,防止后续误清)

| Seam | 锚点 |
|---|---|
| planState legacy shim 全链(store-sidecar HACK 块 / session-manager / 2 组路由 / types) | 删除触发 = D0 路 A 的 R3 |
| `src/` + 10 旧 e2e + 4 旧单测 | 同上(R2) |
| `client-next/plan-fixture.jsx` | plan-app.jsx:364 消费 `PLAN_FALLBACK_SOURCE`(离线兜底) |
| `client-next/plan-mock-data.jsx` | plan-app.jsx:49-61,320 消费 SESSIONS/HIST0/CMDS(会话/历史是 v2 non-goal) |
| `core/refine/loop.ts` | 已实现待接线的产品能力(P3-4) |
| `core/schema.ts` | 编译期防漂移 guard(P3-3) |
| store-sidecar.test 的 stale confirmStates 用例 | 字节保真机制的保护网 |
| sidecar `version: 4` 不 bump + spread-existing 机制 | G5 承诺 |

---

## 9. 测试最小质量集(UI 后续会改造为前提)

### 单测(22 文件 239 用例,1.4s)——核心/后端全留

| 分类 | 文件 | 处置 |
|---|---|---|
| core + 后端(16):extract / verify / refine / section-insert / core-rewrite / agent-chat / agent-dispatch / agent-route / agent-runner / annotation-state / ai-status / config / docsource-fs / llm-execa / session / store-sidecar | 稳定高价值,是产品心脏的规格 | **全留** |
| 新前端接线(2):client-next-integration / client-next-agent-net | 逐字段锁 adaptExtract 派生 + SSE 消费,是 UI 改造期间的真正安全网 | **全留**(UI 改的是渲染层,这两个测的是数据层,不波动) |
| 旧 SPA-only(4):anchor / markdown / plan-inspector / review-normalize-validation | 只被 src/ 消费 | **随 R2 删**;D0 前保留(它们快且绿,提前删无收益) |

### e2e(13 spec)——留 3,余随退休

| 处置 | spec | 理由 |
|---|---|---|
| **留(最小质量集)** | `next-smoke`(133 行) | 新前端冒烟:真 prod server + 双文档 8 节渲染 + console error 守卫 |
| **留** | `session-server`(348 行,独立 config) | `--wait` 闸 + registry 复用,是 CLI 契约的唯一 e2e |
| **留(暂)→R2 删** | `smoke`(9 行) | 旧 SPA 壳冒烟,成本趋零,冻结期陪跑 |
| **随 R1 冻结、R2 删** | comprehensive(854) / user-flow(404) / p0(318) / review-ui(236) / rewrite(232) / draft(229) / decided(74) / persistence(42) / thread(42) + helpers.ts | 全部断言旧 SPA 的 CSS 类/中文按钮文案/锁徽章——高波动、且守护的锁语义已被 D3 砍掉;后端行为已被 session/store-sidecar/agent-* 单测覆盖,e2e 层无独立价值 |
| **建议补 1 条(v-next)** | next 侧 G4 回归:划选→改写(或提为风险)→落盘→刷新仍在 | 当前 next-smoke 只读;这是删旧 rewrite.spec 后唯一真缺口。放 R2 同 PR 补 |

不建议新增其他 e2e:后端契约级验证已由单测走真 SessionManager/真路由(agent-route.test、client-next-integration.test 直接 `app.request()`)承担,再加 e2e 是重复。

---

## 10. 执行顺序与验证

```
P0 孤儿文件+注释   → 五道闸 + rg 复核(半天)
P1 fixture 治理    → npm test + 活文档改动实验(半天)
P2 文档重写        → review 即可
P3 死 API(点头后) → 五道闸
—— D0 拍板 ——
P4 R1 冻结 → dogfood → R2 删前端 → R3 删契约尾巴(每步独立 PR、独立可 revert)
```

Strangler 承诺:P0–P3 期间旧路径 e2e 断言一行不改、全绿;R1 起旧 e2e 退出默认闸但保留可跑,R2 才删。

---

## 11. 需产品负责人拍板的决策清单

| # | 决策 | 选项 | 推荐 | trade-off |
|---|---|---|---|---|
| 1 | **D0 旧路径退休** | A 现在拍板、分 R1–R3 执行 / B 保留到新 UI 定稿 | **A**(§2) | A 省 ~7k 行与每次提交的 e2e 时间,代价是失去旧 UI 回退;B 零风险但持续背双前端 |
| 2 | e2e 最小集边界 | 留 next-smoke+session-server(+新补 G4 一条) / 另留部分旧 spec 改造 | **前者**;旧 spec 改造成本>重写 | 删旧 rewrite.spec 后 G4 有窗口期缺口,靠 R2 同 PR 补齐 |
| 3 | review-normalize 功能去留 | 保留(给 client-next 补 UI)/ 随旧路径退休删整条线(service+2 路由+类型) | **倾向删**:新前端的 verify/ai-review(零 LLM)已覆盖"文档不规范"场景;但这是功能取舍不是清洁,必须你拍 | 删则 CLI/API 少一个整形入口;留则 R3 后它是无 UI 的孤儿 API |
| 4 | `docs/assets/*.webm`(1.6M 源录屏) | 删 / 留作素材 | **删**(git 历史可找回;gif 脚本可随时重录) | 无 |
| 5 | 两个无消费者 HTTP 端点:`GET /api/extract`、`POST /api/session/export`(+wrapper/类型) | 现在删 / 归 R3 一起删 | **现在删**(仓内外均无已知消费者,README 未记载) | 若有仓外脚本在用会断——你最清楚是否存在 |
| 6 | `core/schema.ts` guard | 保留+修谎言注释 / 给 sidecar/LLM 边界接真校验 / 删 | **保留+修注释** | 接线=加抽象无当前需求;删=丢编译期防漂移 |
| 7 | npm 包 `/next` 404(files 不含 client-next,CLI 却默认指向它) | `files` 加 client-next(CDN 依赖照旧) / 构建化(Q3 原议题) | **短期加 files**,构建化放 v2 | 加 files 后包体 +~100K 且依赖 unpkg 可用性;构建化才是终局 |
| 8 | `client-next/接入说明.md` | 精简改写 / 并入 docs/ / 删 | **精简改写**(加载顺序表仍有独享价值) | 无 |

---

*附:本计划所有 grep 证据可用以下命令复核:`rg -n "ConfirmState|confirmStates" --type ts`(生产 0)、`rg -ln "DocumentFile"`(仅定义)、`rg -ln "preview/" -g '!preview'`(0)、`diff sample.md tests/fixtures/sample.md`(空)、`rg "api/extract" tests/ src/`(0)。*
