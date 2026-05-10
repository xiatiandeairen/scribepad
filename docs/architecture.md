# scribepad Architecture

> 模块结构 + 依赖方向规则。本文档定义"代码长在哪里",不定义功能行为(那是 PRD / tech 文档的事)。

## 顶层结构

```
scribepad/
├── src/                      # React SPA (client)
├── server/                   # Hono backend (Node)
├── types/                    # 跨前后端共享类型 (single source of truth)
├── tests/{e2e,unit}/         # Playwright + Vitest
├── docs/                     # 项目文档
└── 配置文件                   # tsconfig*.json / vite.config / eslint / prettier / vitest / playwright
```

## 三个顶层目录的边界

| 目录 | 运行时 | 入口 | 编译产物 |
|------|------|------|--------|
| `src/` | 浏览器 | `src/main.tsx` (经 `index.html`) | `dist/client/` (Vite build) |
| `server/` | Node 22+ | `server/index.ts` | `dist/server/` (tsc build) |
| `types/` | 无运行时 | 纯类型,任意一端 import | 无产物(被消费时编译) |

**前端永不 import 后端,反之亦然**。两端只通过 `types/` 共享契约。

## 模块分层

### Frontend (`src/`)

```
src/
├── main.tsx              # createRoot 入口
├── App.tsx               # 顶层组件 + 状态协调
├── components/           # React 组件
│   ├── Reader.tsx        # markdown 渲染 + 选区交互
│   ├── Sidebar.tsx       # 批注列表 + 状态展示
│   ├── DiffModal.tsx     # AI 改写 diff 预览
│   └── PlanPanel.tsx     # plan review 右栏
├── lib/                  # 纯函数,无 React,无 IO
│   ├── markdown.ts       # mdast 渲染 / anchor 计算
│   ├── plan-inspector.ts # plan 信息点抽取 + readiness summary
│   ├── anchor.ts         # 选区 ↔ 源码 offset
│   └── api.ts            # fetch 封装
└── styles/main.css
```

### Backend (`server/`)

```
server/
├── index.ts              # CLI 解析 + listen()
├── app.ts                # Hono app + 路由 mount
├── routes/               # HTTP 边界(参数校验,调 services)
│   ├── file.ts
│   ├── annotations.ts
│   ├── plan-state.ts
│   └── rewrite.ts
├── services/             # 领域逻辑(可单测)
│   ├── document.ts
│   ├── annotations.ts
│   └── rewrite.ts
└── adapters/             # 外部副作用(进程、文件、网络)
    └── claude-cli.ts
```

### Shared types (`types/`)

```
types/
├── annotation.ts         # Annotation, Anchor, AuditEntry, Sidecar
├── plan.ts               # PlanItem / PlanItemState / ReviewMode / readiness summary
├── document.ts           # DocumentFile
└── api.ts                # FileResponse / RewriteRequest / etc.
```

## Dependency Rules

**强制约束**(违反 = 设计 bug,immediately fix):

| 模块 | 允许 import | 禁止 import |
|------|----------|----------|
| `types/**` | (无 — 仅纯类型) | 任何运行时模块 |
| `src/lib/**` | `types/**` | React、`server/**` |
| `src/components/**` | `src/lib/**`、`types/**`、React | `server/**`、`src/App` |
| `src/App.tsx`、`src/main.tsx` | `src/components/**`、`src/lib/**`、`types/**` | `server/**` |
| `server/adapters/**` | `types/**` | `server/services/**`、`server/routes/**` |
| `server/services/**` | `types/**`、`server/adapters/**` | `server/routes/**` |
| `server/routes/**` | `types/**`、`server/services/**` | `server/adapters/**`(直接) |
| `server/app.ts`、`server/index.ts` | `server/routes/**` | — |

**核心原则**:
- **依赖方向单向**(routes → services → adapters)— 测试时 mock adapters,services 可纯单测
- **types 是桥梁**,运行时无依赖,任何端可消费
- **前后端互不可见**,只通过 HTTP API 协议(在 `types/api.ts` 定义)

## v0.2 加什么、加在哪

| v0.2 工作项 | 加在哪 |
|------------|------|
| 段落状态机(state field) | `types/annotation.ts` 已定义,需在 `server/services/annotations.ts` 实现状态转移 + 校验;前端 `src/components/Sidebar.tsx` 加 state badge UI |
| 已决定段防漂移 | `server/services/rewrite.ts` 在 prompt 构造前过滤 `state=decided` 的段落 |
| AuditEntry 历史 | `server/services/annotations.ts` 在每次 rewrite/state-change 时 append |
| Reader / Sidebar / DiffModal 组件 | 新建 `src/components/*.tsx`,从 v0.1 MVP 重构思路恢复(不复制代码) |

## v0.2.0 新增 Plan Readiness

| 工作项 | 加在哪 |
|---|---|
| plan 信息点抽取 | `src/lib/plan-inspector.ts`，纯函数，不做 IO |
| readiness 结构化展示 | `src/components/PlanPanel.tsx`，由 `App.tsx` 注入信息点、mode 和状态回调 |
| 正文状态栏 | `src/components/Reader.tsx` 根据 `PlanItem` 在原文块左侧渲染 status rail |
| 信息点状态持久化 | sidecar `planState` 字段，类型在 `types/plan.ts` |
| plan state API | `server/routes/plan-state.ts` + session-scoped `/api/sessions/:id/plan-state` |

约束：0.2.0 的状态表示用户对信息点的处理状态，不是 AI 判断真伪；AI auto-audit 仍放 v0.3+。文档结构较弱时必须降级到 lightweight 或 annotation-only，避免把轻量 plan 当完整执行计划检查。

## v0.3 候选方向(由 v0.2 dogfood gate 决定)

- 多 agent adapter:`server/adapters/cursor-cli.ts` / `aider-cli.ts` 与现有 `claude-cli.ts` 平级
- MCP server:新增 `server/mcp/` 目录,暴露 read_doc / list_annotations / propose_rewrite 等 tool
- 批注线程:`types/annotation.ts` 加 thread 字段
- 场景模板:`templates/` 目录(项目根),配置驱动

## 命名约定

- 文件:小写连字符(`claude-cli.ts`)— 但 React 组件用 PascalCase(`Reader.tsx`)
- 导出:命名导出优先(`export function readDocument`)— 默认导出仅在 main entry 用
- 类型导入:用 `import type` 标记(由 ESLint `consistent-type-imports` 强制)

## 编译 / 运行

```
npm run dev         # 同时启 vite (:5173) + hono (:3000)
npm run build       # vite build → dist/client + tsc → dist/server
npm run start       # node dist/server/index.js sample.md
npm run typecheck   # 双 tsconfig 各跑一遍
npm run lint        # eslint + prettier --check
npm run test        # vitest (单测)
npm run test:e2e    # playwright (e2e,自动起 dev server)
```

## 决策溯源

- 选型:[`docs/tech-selection.md`](./tech-selection.md) — 18 项 tech 决策 + deferred 列表
- 路线:[`docs/roadmap.md`](./roadmap.md) — v0.1 → v1.0,dogfood-driven 节奏
