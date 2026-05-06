# scribepad v0.1 执行计划

> **状态**:locked  · **生成日期**:2026-05-02
> **范围**:在 foundation skeleton 上落地"评论交互修改 + 拍板 + 防漂移"7 大功能,同步修复 prod static serving。
> **scope 来源**:`docs/decision/v0.2-scope.md`(本计划仅落地,不引入新 scope。22Q 浮现的 audit dashboard / 5-component sidebar / inline edit / 版本归档 等仍 deferred)。

---

## 1. 架构 · 数据流 · 设计模式

### 1.1 架构层级(分层职责,foundation 已就位)

```
┌─────────────────────────────────────────────────┐
│ 浏览器 SPA(Vite + React + TS)                  │
│ ┌─ Reader ─────┬─ Sidebar ─┬─ DiffModal ──┐    │
│ │ 渲染 + 选区   │ 4 状态卡  │ deciding 弹窗 │    │
│ └──────────────┴───────────┴───────────────┘    │
│ ┌─ App(coordinator)─────────────────────────┐ │
│ │ annotations / activeModal / selection state │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─ src/lib ──┬─ markdown ─┬─ anchor ─┬─ api ─┐  │
│ └────────────┴────────────┴──────────┴───────┘  │
└────────────────────────────┬────────────────────┘
                             │ HTTP /api/*
┌────────────────────────────┴────────────────────┐
│ 后端 Hono(Node + TS)                            │
│ ┌─ routes ──────┬─ services ─────┬─ adapters ─┐ │
│ │ file/anno/rwt │ doc/anno/rewrite │ claude-cli │
│ └───────────────┴────────────────┴────────────┘ │
│        在 prod 启动时同时 serve dist/client     │
└────────────────────────────┬────────────────────┘
              types/(共享 TS 类型)
              sidecar JSON .{file}.annotations.json
              本机 `claude -p` CLI 子进程
```

### 1.2 数据流(7 个核心 flow)

| flow | 触发 | 路径 | 持久化 |
|------|------|------|------|
| 加载文档 | 启动 / 刷新 | `GET /api/file` → `DocumentService.read(filePath)` → `fs.readFile` → `FileResponse` | — |
| 加载批注 | 启动 | `GET /api/annotations` → `AnnotationsService.read(filePath)` → 读 sidecar JSON | — |
| 创建批注(draft) | popover 点 [💬 批注] | client App 推一条 `Annotation` → `POST /api/annotations`(full list)→ sidecar 写 | sidecar |
| AI 改写(draft → discussed/thinking → discussed/deciding) | card 内回车提交 | `POST /api/rewrite` → `RewriteService.rewrite(items, fullDoc)` → **过滤掉 state=decided 的 annotation id**(防漂移)→ ClaudeCli adapter → `claude -p` → JSON 解析 → `RewriteResponse` → client 进 deciding 状态(modal 默认不弹) | — |
| 看 diff(deciding) | mark / card 点击 [查看 →] | client 弹 modal,展示 instruction + diff + delta + reprompt 框 | — |
| 接受(deciding → applied) | modal 内 [↵ 接受] / [⌘↵ 接受+拍板] | client 通过 sentence span 的 `data-src-start/end` 解析源码范围 → splice → 重新渲染并重建其余 open annotations 的 anchor → `POST /api/save` → `DocumentService.write` → 同步更新 annotation.status=applied; `[⌘↵]` 额外把 annotation.state 置为 `decided` → sidecar 写 | .md + sidecar |
| 拍板(任意 → decided) | card 上 [拍板] / popover [拍板] / `⌘↵` | client 改 annotation.state='decided' → `POST /api/annotations` 写 sidecar | sidecar |

### 1.3 设计模式

| 模式 | 应用 | 收益 |
|------|------|------|
| **Adapter** | `ClaudeCli` 包装 `claude -p` 子进程,实现接口 `runAgent(prompt) → string`。v0.3 加 cursor / aider 时同接口加同级 adapter | agent-中立护城河预备(v0.3 不重构) |
| **Service / Route 分层** | routes 只做参数校验 + HTTP I/O;services 含全部领域逻辑(状态转移、prompt 构造、anchor 匹配) | services 可纯单测(mock adapters) |
| **Annotation 双轴模型** | 持久化 `state` 只有 3 态:`draft / discussed / decided`; `thinking / deciding` 是 `discussed` 的 UI 子态,由 `ai_suggestion` 是否存在区分。终态由 `status=applied / dismissed` 表示 | 单测覆盖,不在 UI 层散落 |
| **Optimistic UI** | client 立即更新本地 state(如点拍板段立即变绿),持久化 fetch 异步;失败 rollback + 提示 | 操作零延迟 |
| **Single Source of Truth (types/)** | `Annotation`、`Anchor`、`Sidecar` 等类型在 types/ 共享,前后端 import 同一份 | schema 演进改一处全栈生效 |
| **Component Decoupling** | Reader / Sidebar / DiffModal 不互相 import,只通过 App 传递 props | 单组件可单独迭代 / 测试 |

### 1.4 状态机(state + status)

```
                  [创建批注]
                       │
                       ▼
                  ┌─ draft ─┐
       [拍板]    │           │   [输入指令 + ↵]
   ◀──────────────┤           ├──────────────▶
                  │           │          discussed(thinking)
                  │           │                │
   ┌── decided ───┘           │  [⌘↵ 接受+拍板]│ [AI 返回]
   │              [Esc 取消]  │              ◀──────┐
   │              ◀───────────┤                     │
   │              ┌─────────  └──◀────[↵ 接受]      ▼
   │ [↵ 解锁]     │                         discussed(deciding)
   ▼              ▼                                  │
draft      applied(status,从 sidebar 隐藏)           │ [点 mark / card]
                                                     ▼
                                                   modal
                                                   开/关
```

防漂移规则:**`RewriteService.rewrite()` 入口过滤 `items` 中所有命中 `state=decided` annotation id 的请求项,直接 return error**(`all selected items are state=decided; cannot rewrite`)。接受改写后,前端会基于新旧渲染结果按 `anchor.text` 近邻匹配重建其余 open annotations 的 anchor,修复跨 splice 漂移。

---

## 2. 变更内容(从 foundation skeleton → v0.1)

### 2.1 前端实现(`src/`)

| 文件 | 当前状态 | v0.1 改动 |
|------|---------|---------|
| `src/main.tsx` | 已就位 | 不动 |
| `src/App.tsx` | placeholder | **重写** — 状态协调器:annotations / selectionAnchor / activeModal / busyIds |
| `src/components/Reader.tsx` | 不存在 | **新建** — mdast 渲染 + 选区监听 + mark 渲染(4 态色 + 边框 + 徽章) |
| `src/components/Sidebar.tsx` | 不存在 | **新建** — 批注列表 + 2 行卡片 × 4 状态 |
| `src/components/DiffModal.tsx` | 不存在 | **新建** — deciding modal(指令回显 + diff + delta + reprompt + 3 action) |
| `src/lib/markdown.ts` | 不存在 | **新建** — mdast → HTML 渲染器 + data-src 偏移 |
| `src/lib/anchor.ts` | 不存在 | **新建** — 选区 ↔ 源码 offset 双向算法(参考已删 MVP 的 reader.js) |
| `src/lib/api.ts` | 不存在 | **新建** — fetch 封装,使用 types/api.ts |
| `src/styles/main.css` | 仅 foundation | **扩展** — 4 状态 mark + card + modal + popover 全样式(参考 preview/style-preview.html) |
| `index.html` | 已就位 | 不动 |

### 2.2 后端实现(`server/`)

| 文件 | 当前状态 | v0.1 改动 |
|------|---------|---------|
| `server/index.ts` | 启动 + CLI 解析 | **加 file 不存在时的友好错误** |
| `server/app.ts` | hono + 3 routes 挂载 | **修 prod static serving**(`review G3 #1`):用 `serveStatic` middleware serve `dist/client/`,prod 下与 `/api/*` 同 server |
| `server/routes/file.ts` | skeleton(已 wire 到 service) | **不动**(service 内部完成) |
| `server/routes/annotations.ts` | skeleton | **不动** |
| `server/routes/rewrite.ts` | skeleton | **不动** |
| `server/services/document.ts` | skeleton(read/write) | **不动**(已实现) |
| `server/services/annotations.ts` | skeleton(read/write) | **加状态机校验**:写入时拒绝非法 state 转移(如 decided → discussed) |
| `server/services/rewrite.ts` | skeleton(prompt + parse) | **加防漂移过滤**:在 prompt 构造前剔除 state=decided 的 items |
| `server/adapters/claude-cli.ts` | 已实现 | 不动 |

### 2.3 共享类型(`types/`)

| 文件 | 当前状态 | v0.1 改动 |
|------|---------|---------|
| `types/annotation.ts` | v2 schema 已定义 | **收敛**到 sentence-level anchor + `state/status` 双轴模型 |
| `types/api.ts` | 已定义 | **加** RewriteRequest 增加可选 `mode: 'standard' \| 'force'` 字段(供未来覆盖防漂移使用,v0.1 暂不开放) |
| `types/document.ts` | 已定义 | 不动 |

### 2.4 测试(`tests/`)

| 文件 | 当前状态 | v0.1 改动 |
|------|---------|---------|
| `tests/e2e/smoke.spec.ts` | 已就位(只测 dev server 启动) | **保留作 sanity** |
| `tests/e2e/draft.spec.ts` | 不存在 | **新建** — 选区 → popover → 创建 → draft 卡片 |
| `tests/e2e/rewrite.spec.ts` | 不存在 | **新建** — 输入指令 → thinking → deciding → 看 diff → 接受 → applied |
| `tests/e2e/decided.spec.ts` | 不存在 | **新建** — 拍板 → state 流转 + 防漂移(decided 段尝试改写时拒绝) |
| `tests/e2e/persistence.spec.ts` | 不存在 | **新建** — 刷新页面 sidecar 恢复 |
| `tests/unit/state-machine.test.ts` | 不存在 | **新建** — 状态转移合法性 |
| `tests/unit/rewrite-prompt.test.ts` | 不存在 | **新建** — prompt 构造 + 防漂移过滤逻辑 |
| `tests/unit/anchor.test.ts` | 不存在 | **新建** — selection ↔ srcOffset 双向(借用 MVP 已验证场景) |

### 2.5 配置 / 文档

| 文件 | v0.1 改动 |
|------|---------|
| `package.json` | 可能加 1 个依赖:`diff` 包用于 modal diff 渲染(也可自己写,优先自己写,**保持依赖最小**) |
| `CLAUDE.md` | 加 docs/plan.md 到 index |
| `docs/architecture.md` | **更新**(本 sprint 末)— 反映实际落地的模块边界 |

### 2.6 不改的(明确 anti-scope)

- ❌ 任何 `defer` 列表的功能(详见 `docs/decision/v0.2-scope.md`)
- ❌ `tests/unit/markdown.test.ts`(渲染逻辑由 e2e 兜底)
- ❌ `tsconfig*.json`、`vite.config.ts`、`eslint.config.js`、`vitest.config.ts`、`playwright.config.ts`(foundation 已 ok,不动)
- ❌ Adapter 抽象(只有 ClaudeCli 一个,不为单实现做接口)

---

## 3. 任务拆分 + 模型选择

12 个 task,每个独立可验证,顺序串行(部分可并行,但单 agent 顺序成本极低)。

| # | Task | 涉及文件 | 模型 | 工程量 | AI Verify |
|---|------|--------|------|------|---------|
| **后端层** | | | | | |
| 1 | Document & Annotations 服务 + 状态机校验 | services/document.ts, services/annotations.ts | sonnet | 0.3 天 | curl GET/POST /api/file & /api/annotations 跑通 + unit test 状态转移 |
| 2 | Rewrite 服务 + 防漂移过滤 + claude-cli 调通 | services/rewrite.ts, adapters/claude-cli.ts(已实现校对)| sonnet | 0.5 天 | unit test prompt 含/不含 decided + 真调 claude 一次 + curl |
| 3 | Prod static serving fix(`review G3 #1`)| server/app.ts | sonnet | 0.2 天 | `npm run build && node dist/server/index.js sample.md` 浏览器能看到 dist/client + /api 都通 |
| **前端 lib 层** | | | | | |
| 4 | mdast 渲染器 + data-src 偏移 | src/lib/markdown.ts | sonnet | 0.3 天 | unit test 渲染 sample.md 的 HTML 含 data-src-* 属性 |
| 5 | anchor 双向算法(选区 ↔ srcOffset) | src/lib/anchor.ts | sonnet | 0.4 天 | unit test 跨段 / 跨格式选区 case |
| 6 | API client 封装 | src/lib/api.ts | haiku | 0.1 天 | typecheck + 用法在 App 中能 import |
| **前端组件层** | | | | | |
| 7 | Reader 组件(渲染 + 选区监听 + mark + 4 态视觉) | src/components/Reader.tsx | sonnet | 0.5 天 | dev 中浏览器看到正常渲染 + 选区出 popover |
| 8 | Sidebar 组件(4 状态卡片 + 锚点对齐) | src/components/Sidebar.tsx | sonnet | 0.5 天 | 4 个状态卡视觉与 preview 一致 |
| 9 | DiffModal 组件(deciding modal 升级版) | src/components/DiffModal.tsx | sonnet | 0.5 天 | modal 渲染指令 + diff + delta + reprompt + 3 actions |
| 10 | App.tsx 状态协调 + 7 flow 串联 | src/App.tsx | sonnet | 0.6 天 | 7 个用户 flow 端到端可用(手动) |
| **样式 + 测试** | | | | | |
| 11 | main.css 全样式(参考 preview)+ light/dark | src/styles/main.css | haiku | 0.3 天 | 视觉与 preview 一致,light/dark 切换正常 |
| 12 | E2E + Unit 测试套件 | tests/e2e/* + tests/unit/* | sonnet | 1.0 天 | 5 道闸全过(typecheck/lint/test/build/test:e2e) |

**模型选择总则**:
- **sonnet**(默认)— 清晰 spec 的实现;状态机 / 防漂移 / 组件渲染等都用
- **haiku** — 纯机械任务;CSS 大段抄改、API thin wrapper
- **opus** — 不用(本 v0.1 无跨模块复杂决策;有的话 escalate)

**总工程量**:**5.2 天**(单 agent 顺序),业余每周 5-10h → **5-8 周日历**(与 roadmap 估计一致)。

**执行策略**:
1. 先后端三任务(1→2→3),后端通后再做前端
2. 前端 lib 层(4→5→6)→ 组件层(7→8→9)→ 协调(10)
3. 样式(11)与组件并行做(可在每个组件落地时同步加样式)
4. 测试(12)放最后,用 dogfood 反馈调整测试 case

---

## 4. 项目设计原则(简洁 · 高效 · 实用 · 可拓展)

### 4.1 简洁 — Less is More

| 表现 | 例 |
|------|------|
| 4 状态而非 N 状态 | 不引 questioned / open / archived 等;若用户不确定则留 draft |
| 2 行卡片而非 4 行 | 删除 hint 行 / 状态徽章 / 双 CTA 行 |
| 1 个 modal 而非多种弹窗 | 仅 deciding state 弹 modal,其他状态不弹 |
| 1 个 agent 而非多 agent | claude 单实现,多 agent 是部署属性非运行时 |
| 不引依赖 | diff 自己 ~30 行实现,不引 `diff` 包(已实现的 anchor 算法说明可行) |
| sidecar JSON 而非数据库 | 文档级数据 ≤100 条批注,JSON.parse <1ms,不引 SQLite |
| 不做 inline 编辑 | 用户改原文 = 切外部 editor,scribepad 永远 read-only renderer(除 AI 改写写回) |

### 4.2 高效 — 不浪费 cycle

| 表现 | 例 |
|------|------|
| Optimistic UI | 拍板段立即变绿,不等服务器响应 |
| 单文件聚焦 | 不做 vault / project / recent — 单 .md 启动 + 关闭即结束 |
| 防漂移 = 服务端过滤 | 决定段不发给 AI,省 token 省时间 |
| modal 默认关 | AI 返回不打断你审其他段,你决定何时打开 modal |
| sidecar lazy 写 | 持久化是 fire-and-forget |

### 4.3 实用 — dogfood-driven

| 表现 | 例 |
|------|------|
| 自己 dogfood 是 v0.1 gate | 作者写 ≥1 份真实 plan,使用拍板 ≥10 次,焦虑感下降 |
| modal 升级版基于真实需求 | 重写入口 / delta 统计 / 接受+拍板 都解决"已用 MVP 时遇到的真实痛点" |
| 不做未验证功能 | 22Q 探索的 audit dashboard / 5 sidebar 等都 deferred 等 dogfood 反馈 |
| sample.md 是真 plan | 演示用文档就是 vibe coder 真会写的 plan |

### 4.4 可拓展 — 不堵未来路

| 表现 | 例 |
|------|------|
| Adapter pattern | v0.3 加 cursor / aider 只增不改 |
| Annotation 含 history 字段(v2 schema 已定义,v0.1 暂不写) | v0.3 Audit Trail UI 直接读 history |
| Service / Route 分层 | 加新功能(如 MCP server)只在 services 加方法 + 加新 route,不重构 |
| Component decouple | v0.3 加 sidebar 多 component(待审 / 风险 / 已决)只加新组件,不改既有 |
| sidecar v2 schema(state / template_hint / history)foundation 已定义 | v0.3 / v0.4 加场景模板模式无 schema 变更 |
| TS 类型作 source of truth | schema 改一处,前后端 import 同步 |

### 4.5 不可越界(scope discipline)

每个 task 启动前 self-check:
- [ ] 这个改动是否在 v0.1 7 功能内?(否则停)
- [ ] 是否引入了新依赖?(优先自己写;若必须,1 个上限)
- [ ] 是否改了 foundation 的核心配置?(改 = require 决策文档更新)
- [ ] 实现了 defer 列表的某项?(直接拒绝 PR)

---

## 失败信号(命题被否的硬条件)

任意触发即停项目或重做:

1. **dogfood gate 不过**(作者使用拍板 < 10 次/月,无主观焦虑感下降)
2. **状态机使用率 < 50%**(用户主要用 AI 改写,几乎不拍板 → 防漂移 wedge 失效)
3. **5 道闸长期不绿**(typecheck / lint / test / build / e2e 任一持续失败 > 1 周)
4. **claude CLI 不可用率高**(子进程 fail > 30%,需要 fallback)— 已知风险,有兜底则忽略

---

## 与上游决策一致性(re-confirmed)

- ✓ scope 严格 follow `docs/decision/v0.2-scope.md`(7 功能,无新增)
- ✓ tech 选型 follow `docs/tech-selection.md`(18 项决策,无新增)
- ✓ 架构 follow `docs/architecture.md`(三层 + types/ 共享,无变更)
- ✓ roadmap follow `docs/roadmap.md`(v0.2 行已锁定收敛后内容;若改名 v0.1,roadmap 同步)

---

*下一步:启动实施 sprint(可 sprint 内分多次 commit;每个 task 完成跑一次 5 道闸)。*
