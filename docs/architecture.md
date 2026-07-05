# scribepad Architecture

> 模块结构 + 依赖方向规则。本文档定义"代码长在哪里",不定义功能行为(那是 PRD / tech 文档的事)。
>
> 结构为 **Ports & Adapters(六边形)**:一份无框架的 `core/` 内核,既是独立产品的心脏,也能被 PM 项目 import 集成。

## 顶层结构

```
scribepad/
├── core/       # 可移植内核(无框架;只依赖 types/ + zod)
├── server/     # Hono delivery + 驱动适配器 + composition root
├── src/        # React SPA (client)
├── types/      # 跨端共享契约 + 端口接口 (single source of truth)
├── tests/      # {unit,e2e}
├── docs/       # 项目文档
└── 配置        # tsconfig{,.server,.core}.json / vite / eslint / prettier / vitest / playwright
```

## 层次边界(六边形)

| 层 | 目录 | 职责 | 运行时 |
|---|---|---|---|
| **Driving Adapters** | `server/routes`、`server/index.ts`、`src/` | 谁驱动 core:HTTP / CLI / (未来 UI、集成 lib/MCP) | Node / 浏览器 |
| **Composition Root** | `server/index.ts`、`server/app.ts` | 唯一装配点:构造并注入具体适配器 | Node |
| **CORE(内核)** | `core/` | 领域用例 + 数据模型 + agent 编排 —— **无框架** | 无关(可移植) |
| **Driven Ports** | `types/ports.ts` | core 对外的需求接口 | 无运行时 |
| **Driven Adapters** | `server/adapters/` | 端口实现(标准品) | Node |

**核心不变量**:`core/` 只 import `types/` 与 `zod`;**绝不** import 框架 / `server` / `src` / `adapters`。这是"内核可被集成"的前提,由 ESLint(E0 边界规则)+ 独立 `tsconfig.core.json` typecheck 双重强制。

## 模块分层

### Core (`core/`) — 可移植内核

```
core/
├── result.ts            # ok / err 构造(Result 原语)
├── schema.ts            # Zod schema,satisfies 绑定 types/domain(编译期防漂移)
├── annotation-state.ts  # 批注生命周期状态机(纯函数)
├── rewrite.ts           # rewrite 用例:防漂移过滤 + rewriteTask(注入 LlmRunner)
└── agent/
    ├── task.ts          # TaskSpec / AgentError(任务描述 = prompt + schema + retry)
    └── runner.ts        # runTask:build → run → 剥 fence → 校验 → 重试
```

**已就位但未实现的 seam**(下一步功能工作,类型/端口已备好):`types/domain.ts` 的 `ExtractedItem` / `Gap` / `ConfirmState` / `ContextPack` —— 抽取、缺口检测、置信度确认、上下文包的领域契约已定,core 侧实现待建。

### Driven Ports (`types/ports.ts`)

```
LlmRunner    run(req) → Result<string, LlmError>        # 跑 agent 任务,返回原始文本
ReviewStore  load/save(docId, ReviewState)              # 持久化用户状态(不落抽取结果)
DocSource    read/write(docId)                          # 供文档内容
```

### Driven Adapters (`server/adapters/`)

```
llm-execa.ts      # 实现 LlmRunner:execa spawn 任意 LLM CLI(claude/codex/…)
store-sidecar.ts  # 实现 ReviewStore:sidecar JSON(工厂注入 repoRoot/env)
docsource-fs.ts   # 实现 DocSource:文件系统
```
**单一 spawn 路径**:全应用只有 `llm-execa` 用 execa。

### Backend delivery (`server/`)

```
server/
├── index.ts / app.ts    # composition root:构造 SessionManager(默认注入 3 适配器)
├── routes/              # HTTP 边界(file / annotations / rewrite / ai / session[s])
└── services/            # 服务端用例
    ├── session-manager.ts   # 会话中枢:经注入端口做 doc/annotations/signoffs/rewrite
    └── ai-status.ts         # AI 健康探针(execa runner,可注入)
```

### Frontend (`src/`) 与 Shared types (`types/`)

```
src/     main.tsx · App.tsx · components/{Reader,Sidebar,DiffModal,PlanPanel} · lib/{markdown,plan-inspector,anchor,api} · styles
types/   ports.ts · domain.ts · result.ts · annotation.ts · plan.ts · document.ts · api.ts
```

## Dependency Rules

**强制约束**(违反 = 设计 bug):

| 模块 | 允许 import | 禁止 import |
|---|---|---|
| `types/**` | (纯类型) | 任何运行时 |
| `core/**` | `types/**`、`zod` | **框架 / `server` / `src` / `adapters`**(E0,lint 强制) |
| `server/adapters/**` | `types/**`、`core/result`(仅 Result 原语)、外部库(execa) | `core` 领域模块 / `server/services` / `routes` |
| `server/services/**` | `types/**`、`core/**`、`server/adapters/**` | `server/routes/**` |
| `server/routes/**` | `types/**`、`server/services/**` | 直接 `adapters` |
| composition root(`server/app.ts`、`index.ts`) | `core`、`server/**`、`types` | —(唯一知道"具体适配器"处) |
| `src/lib/**` | `types/**` | React、`server/**` |
| `src/components/**` | `src/lib/**`、`types/**`、React | `server/**` |

**核心原则**:
- **依赖方向单向**;core 只认端口接口,具体适配器由 composition root 注入 → 测试可注入 fake,集成可注入 PM 的实现。
- **前后端互不可见**,只通过 `types/api.ts` 的 HTTP 契约。
- **两条演进路线共用同一 `core/`**:独立产品 = server + 标准品适配器;集成到 PM = PM import core + 提供自己的 `ReviewStore`/`DocSource`/`LlmRunner`,不改 core 一行。

## 命名约定

- 文件:小写连字符(`llm-execa.ts`)— React 组件用 PascalCase(`Reader.tsx`)
- 导出:命名导出优先;默认导出仅 main entry
- 类型导入:`import type`(ESLint `consistent-type-imports` 强制)

## 编译 / 运行

```
npm run dev         # 同时启 vite (:5173) + hono (:3001)
npm run build       # vite build → dist/client + tsc → dist/server(含 core)
npm run start       # node dist/server/index.js sample.md
npm run typecheck   # 三 tsconfig:client / server / core(隔离)
npm run lint        # eslint(含 E0 边界) + prettier --check
npm run test        # vitest (单测)
npm run test:e2e    # playwright (e2e,自动起 dev server)
```

