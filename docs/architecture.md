# scribepad Architecture

> 模块结构 + 依赖方向规则。本文档定义"代码长在哪里",不定义功能行为(那是 PRD / tech 文档的事)。
>
> 结构为 **Ports & Adapters(六边形)**:一份无框架的 `core/` 内核,既是独立产品的心脏,也能被 PM 项目 import 集成。

## 顶层结构

```
scribepad/
├── core/          # 可移植内核(无框架)
├── types/         # 跨端共享契约 + 端口接口(无运行时,single source of truth)
├── server/        # Hono delivery + 驱动适配器 + composition root + CLI 入口
├── client-next/   # 无构建 React 审阅面板(UMD + Babel standalone),由 server 挂在 /next/*
├── tests/         # {unit,e2e}
├── docs/          # 项目文档
└── 配置           # tsconfig{,.server,.core}.json / eslint / prettier / vitest / playwright
```

旧的 `src/` React SPA 与 vite 构建链已退休:面板改由 `client-next/` 无构建方案承载,`npm run build` 只编 server(含 core)。

## 层次边界(六边形)

| 层                   | 目录                                            | 职责                                                  | 运行时       |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------- | ------------ |
| **Driving Adapters** | `server/routes`、`server/index.ts`、`client-next/` | 谁驱动 core:HTTP / CLI / 浏览器面板(未来 集成 lib/MCP) | Node / 浏览器 |
| **Composition Root** | `server/index.ts`、`server/app.ts`              | 唯一装配点:构造并注入具体适配器                       | Node         |
| **CORE(内核)**      | `core/`                                          | 领域用例 + 数据模型 + agent 编排 —— **无框架**        | 无关(可移植) |
| **Driven Ports**     | `types/ports.ts`                                | core 对外的需求接口                                    | 无运行时     |
| **Driven Adapters**  | `server/adapters/`                              | 端口实现(标准品)                                      | Node         |

**核心不变量**:`core/` 只 import `types/`、`zod` 与 mdast 解析栈(`mdast-util-from-markdown` / `mdast-util-gfm` / `micromark-extension-gfm`);**绝不** import 框架 / `server` / `src` / `adapters`。这是"内核可被集成"的前提,由 ESLint(E0 边界规则,黑名单制)+ 独立 `tsconfig.core.json` typecheck 双重强制。

## 模块分层

### Core (`core/`) — 可移植内核

```
core/
├── result.ts             # ok / err 构造(Result 原语)
├── schema.ts             # Zod schema,satisfies 绑定 types/domain(编译期防漂移)
├── annotation-state.ts   # 批注生命周期状态机(纯函数)
├── rewrite.ts            # rewriteItems(注入 LlmRunner) + applyRewrites(源码 splice + 漂移守卫)
├── section-insert.ts     # 定位新条目插入点 + 下一个稳定 label(D/R/Q)
├── extract/              # markdown → ExtractResult(8 节结构事实)
│   ├── index.ts          # extract():分节 → points + decisions + meta
│   ├── sections.ts       # H2 分节 + 8 InfoKind 分类
│   ├── points.ts         # 非决策节 → ExtractedItem(cells / group / ordinal)
│   ├── decisions.ts      # 决策节 → DecisionCard(chosen / pick / question / core / cost / facts)
│   ├── labels.ts         # grounding:标签 G/D/R/P/Q/B + 引用图扫描 / 导航
│   └── text.ts           # mdast → 文本工具
├── verify/               # ExtractResult → Problem[](v2 四层模型)
│   ├── index.ts          # verify():presence + form + graph 规则,合并可选 AI findings
│   ├── rules/            # presence / form / graph / context / types
│   ├── severity.ts       # 机制 × 置信度 → severity(仅 rule + conf 1.0 可为 blocker)
│   └── judge.ts          # emptyJudge —— LlmJudge seam(设计好、暂闲置)
└── agent/
    ├── task.ts           # TaskSpec / AgentError(任务描述 = prompt + schema + retry)
    ├── runner.ts         # runTask:build → run → 剥 fence → 校验 → 重试
    └── tasks/            # 具体 agent 任务(chat / selectionEdit)
```

**核心能力**:

- **extract** — markdown → 8 节结构事实。每个信息点带 `kind` / `label?` / `refs` / `anchor?` / `role`,并保留结构事实 `cells`(GFM 表格逐列)、`group`(粗体子组 / H3)、`ordinal`(有序序号);决策节另出 `DecisionCard`(chosen / pick / question / core / cost / facts);文档级出 `meta`(H1 + 引言 blockquote)。degrade 而不 throw。
- **verify** — 在 extract 结果上跑 v2 四层模型(L1 presence / L2 form / L3 graph;L4 = 机制 + 置信度贯穿全程)出 `Problem[]`。本期只发确定性规则(mechanism='rule');AI 半边(LlmJudge)是留好的 seam,接入后其 findings 经引文校验 + severity 推导,永不产生 blocker。
- **grounding** — 稳定标签 `^[GDRPQB]\d+$`(G 目标闸 / D 决策 / R 风险 / P 前置 / Q 待确认;B = 目标节里的已核实 bug),扫描引用图并支持按标签导航;`S`/`A`/`§` 是前端由 ordinal 派生的伪标签,不是后端标签。

### Driven Ports (`types/ports.ts`)

```
LlmRunner    run(req) → Result<string, LlmError>        # 跑 agent 任务,返回原始文本
ReviewStore  load / save(docId, ReviewState)            # 持久化用户状态(不落抽取结果)
DocSource    exists / read / write?(docId)              # 供文档内容(write 可选:只读源可省)
ExportSink   export(outputPath, content)                # 导出最终文档为独立产品(与源文档写互相独立)
FeedbackSink submit(entry, attachment?)                 # 反馈报告的自含式采集,携带可复现上下文
```

`ReviewState = { annotations, signoffs }` —— 只存"用户决定了什么",抽取结果从不持久化(每次重算)。ExportSink 将通过核准文档导出到 `outputPath`(独立于源文档是否可写,集成可路由到自己的存储)。

### Driven Adapters (`server/adapters/`)

```
llm-execa.ts           # 实现 LlmRunner:execa spawn LLM CLI(codex-cli / claude-code-cli)
store-sidecar.ts       # 实现 ReviewStore:sidecar JSON(工厂注入 repoRoot/env)
docsource-fs.ts        # 实现 DocSource:文件系统
export-sink-fs.ts      # 实现 ExportSink:写到 XDG state home(工厂注入 env)
feedback-sink-fs.ts    # 实现 FeedbackSink:追加到 inbox.jsonl 及可选的 attachments 目录(工厂注入 env)
```

**单一 spawn 路径**:全应用只有 `llm-execa` 用 execa。

### Backend delivery (`server/`)

```
server/
├── index.ts / app.ts   # composition root + CLI 入口:构造 SessionManager(默认注入 3 适配器);
│                         client-next/ 静态挂载 /next/*;/api 优先于静态兜底
├── routes/             # HTTP 边界
│   ├── sessions.ts     # sessions-scoped 路由族(主面,见下)
│   ├── session.ts      # /api/session 单会话 fallback(CLI one-shot:get,经 getFallbackSession 复用会话中枢)
│   ├── feedback.ts     # 全局非会话路由:接收面板 / CLI 反馈并做服务端富化
│   └── ai.ts           # AI 配置 / 状态 / 自测
└── services/
    ├── session-manager.ts   # 会话中枢:经注入端口做 doc / annotations / signoffs /
    │                          extract / rewrite / rewrite-apply / selection-op
    ├── agent-dispatch.ts    # AgentRequest → AgentEvent 流(纯 async generator,无 IO)
    └── ai-status.ts         # AI 健康探针(execa runner,可注入)
```

### Shared types (`types/`)

```
types/   ports.ts · domain.ts · verify.ts · annotation.ts · api.ts · result.ts
```

无运行时,只有手写契约类型;`core/schema.ts` 的 Zod schema 用 `satisfies` 绑定 `types/domain`,类型/schema 漂移即编译错。

### Frontend (`client-next/`)

无构建 React 面板:浏览器直接加载 React UMD + Babel standalone,server 把目录挂在 `/next/*`。各 `.jsx` 不进 tsc、不打包;只在运行时消费 `types/api.ts` 定义的 HTTP 契约(sessions-scoped)。模块职责与加载顺序见 `client-next/接入说明.md`。

## HTTP 面

**sessions-scoped 路由族(`routes/sessions.ts`,主面)**:

```
POST /api/sessions/open                     # 打开文档 → { sessionId, url }
GET  /api/sessions/:id                       # 会话状态
POST /api/sessions/:id/connect|heartbeat|disconnect
GET  /api/sessions/:id/file                  # 读源;POST .../save 写源
GET  /api/sessions/:id/annotations           # 读;POST 整表替换
GET  /api/sessions/:id/signoffs              # 读;POST 整表替换
GET  /api/sessions/:id/extract               # 重算,从不持久化
POST /api/sessions/:id/rewrite               # 改写草稿(不落盘)
POST /api/sessions/:id/rewrite-apply         # 改写 + splice + save + 重抽(冲突 → 409)
POST /api/sessions/:id/agent                 # 单一 AI 通道(SSE:progress* → final)
POST /api/sessions/:id/done                  # 合闸导出;GET .../wait 阻塞到合闸
```

**其它**:`GET /api/session`(单会话 fallback,经 `getFallbackSession`)、`POST /api/feedback`(全局反馈入口)、`/api/ai/{config,status,test}`、`/healthz`,以及 `/next/*` 静态挂载。

## 数据流

**读路径**:`markdown → core/extract → ExtractResult →(前端 adaptExtract 派生 REVIEW_MODEL)→ 渲染`。

**写路径统一为"改 markdown 源 → 重抽取"**:`rewrite-apply` 与 selection-op 真改文档时都复用 `applyRewrites` 做源码 splice(带漂移守卫:锚点 selection 不匹配即 409),save 后重抽,前端重渲染。抽取结果从不持久化。

**AI 通道**(agent SSE,单一入口 `POST /api/sessions/:id/agent`,`agent-dispatch` 分三族):

- `command`(ai-review / ai-refs)—— 复用 `core/verify`,**零 LLM**、确定性。
- `chat` / `selection-op:explain` —— 一轮 LLM(core/agent 的 chat 任务)。
- `selection-op` dcard | risk | open —— 真改文档并落盘(`section-insert` 定位 + LLM 起草 + splice),终态 `final` 带 `mutated:true`。

## CLI

```
scribepad <doc> [--open] [--wait]
scribepad feedback "<text>"
```

同一 repo 内共享一台 server(registry 记录 url/pid);再次 `scribepad` 复用存活的 server 并打开新文档会话。`--open` 打开浏览器面板(`/next/`);`--wait` 是 **agent 审阅闸**:进程阻塞到 `POST /api/sessions/:id/done` 合闸,把导出 `outputPath` 打到 stdout(其余日志走 stderr),然后退出。

`scribepad feedback` 子命令提交格式自由的反馈文本到中央 inbox(无会话上下文),用于非交互式反馈采集。

## 数据存储

持久化存储集中在 `$XDG_STATE_HOME/scribepad/`：

- `$docId/state.json` — 用户注解与核准状态(ReviewState)
- `$docId/export/` — 核准文档导出产物
- `feedback/inbox.jsonl` — 中央反馈入口(面板与 CLI 汇聚)；`attachments/<id>/` 存同步的文档快照与上下文

## Dependency Rules

**强制约束**(违反 = 设计 bug):

| 模块                                       | 允许 import                                             | 禁止 import                                                        |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `types/**`                                 | (纯类型)                                               | 任何运行时                                                        |
| `core/**`                                  | `types/**`、`zod`、mdast 栈                            | **框架 / `server` / `src` / `adapters`**(E0,lint 强制)          |
| `server/adapters/**`                       | `types/**`、`core/result`(仅 Result 原语)、外部库(execa) | `core` 领域模块 / `server/services` / `routes`                    |
| `server/services/**`                       | `types/**`、`core/**`、`server/adapters/**`           | `server/routes/**`                                                |
| `server/routes/**`                         | `types/**`、`server/services/**`                       | 直接 `adapters`                                                   |
| composition root(`server/app.ts`、`index.ts`) | `core`、`server/**`、`types`                        | —(唯一知道"具体适配器"处)                                        |
| `client-next/**`                           | 运行时 HTTP 契约(`types/api` 形状)、React UMD          | `server/**`、`core/**`(浏览器侧只有 HTTP,不 import 服务端代码)   |

**核心原则**:

- **依赖方向单向**;core 只认端口接口,具体适配器由 composition root 注入 → 测试可注入 fake,集成可注入 PM 的实现。
- **前后端互不可见**,只通过 `types/api.ts` 的 HTTP 契约。
- **两条演进路线共用同一 `core/`**:独立产品 = server + 标准品适配器;集成到 PM = PM import core + 提供自己的 `ReviewStore`/`DocSource`/`LlmRunner`,不改 core 一行。

## 命名约定

- 文件:小写连字符(`llm-execa.ts`)— client-next React 组件用 PascalCase(`GoalSection`、`ChatPanel`)
- 导出:命名导出优先;默认导出仅 main entry
- 类型导入:`import type`(ESLint `consistent-type-imports` 强制)

## 编译 / 运行

```
npm run dev         # tsx watch 起 hono server(:3001);面板在 /next/
npm run build       # tsc -p tsconfig.server.json → dist/server(含 core);无 bundler
npm run start       # node dist/server/index.js <doc>
npm run typecheck   # 三 tsconfig:默认 / server / core(隔离)
npm run lint        # eslint(含 E0 边界) + prettier --check
npm run test        # vitest (单测)
npm run test:e2e    # playwright (e2e)
```
