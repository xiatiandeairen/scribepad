# scribepad 重构计划 — 纯地基重构(0.1.0 foundation)

> **状态**:**已落地**(branch `refactor/core-ports-foundation`,8 commits,5 闸全绿)。
> **生成日期**:2026-07-03
> **前置**:承接 reframe(产品从"文档可视化"→"场景化交互层")。场景清单 = GitHub issues #2–#15(label `scenario`)。

## 交付状态(诚实盘点)

**已完成**:六边形地基(WI0 端口/内核 · WI2 execa agent runner · WI4 ReviewStore/sidecar · WI6 护栏)+ **存量功能全量 cutover**(document/annotations/plan-state/rewrite/AI-status/review-normalize 全走端口,旧 `services/{document,annotations,rewrite,ai}.ts` 与旧 cli 适配器已删,收敛到单一 spawn 路径)。

**已就位但未实现(下一步功能工作)**:`types/domain.ts` 的 `ExtractedItem`/`Gap`/`ConfirmState`/`ContextPack` 契约 + `core/schema.ts` 已备好,但——
- **WI1 抽取(规则→LLM)** 未建:`core/extract` 尚不存在。
- **WI3 置信度确认状态机** 未建(仅类型)。
- **WI5 eval + gold-set** 未建。

即:地基 + 采用完成;新能力(抽取/缺口/置信度/eval)是接在新地基上的后续功能,契约与端口已就绪,补实现即可,不需再动 core 结构。

## 0. 决策记录(已拍板)

| # | 决策 | 结论 |
|---|---|---|
| D1 | 本次范围 | **B:纯地基改造**,不含前端场景视图切片 |
| D2 | 0.1.0 锚定场景 | **先不做**,地基先行 |
| D3 | 抽取上 LLM | **做**,规则化降级为 fallback |
| D4 | LLM 接入方式 | **execa 统一 spawn 任意 LLM CLI**,不锁 SDK |
| D5 | gold-set 标注 | **我标你审** |
| **双路线** | 演进路线 | **独立产品 + 集成到 PM 项目**,两条都要支撑 → 架构按 Ports & Adapters 设计 |

**范围**:本轮 = 后端可移植内核(core)+ 端口/适配器 + eval + 护栏。**前端 UI、上下文包实现、集成适配器全部后置**,但架构须让它们"接入时不改 core"。

## 1. 边界

### 会做
- **可移植内核 core/**:抽取(信息点/缺口/**置信度**)、置信度确认状态机、改写/防漂移、批注、agent(tasks+runner)。只依赖 `types/`,无框架。
- **端口 + 适配器**:定义 3 个 driven 端口(LlmRunner/ReviewStore/DocSource),各建 1 个标准品实现(execa/sidecar/fs)。
- **数据契约**:领域类型 + Zod schema;sidecar 兼容演进承载确认状态。
- **eval + gold-set**:抽取质量离线 eval。
- **护栏**:characterization test、Strangler Fig、5 闸、分步 commit。

### 设计但本轮不实现(架构留位,接入不改 core)
- 🟡 **上下文包** `core/context-pack`:定类型 + 依赖端口就位,实现后置。
- 🟡 **置信度确认 UI**:状态机 + API 本轮建,交互 UI 属前端,后置。
- 🟡 **集成路线适配器**(PM 的 store/docsource/agent):端口就位,实现由 PM 侧接入。

### 不做
- ❌ 前端 / `App.tsx` 拆分(无场景驱动)
- ❌ 场景插件框架 / 多场景切换(rule of three,等场景 #2)
- ❌ 图表 / 画布 / 代码沙盘
- ❌ 多 agent 运行时切换(execa 已给 provider 中立)

## 2. 技术选型增量(成熟库优先)

| 需求 | 选型 | 理由 |
|---|---|---|
| spawn 任意 LLM CLI | **execa** | agent 中立(D4),统一子进程 |
| schema 校验 | **Zod** | 边界校验,替代 `as`/正则 |
| 抽取质量 eval | **promptfoo** | 开源 LLM eval |
| markdown | 保留 **mdast/remark** | 已在用 |
| 前端 | 保留 **React18+Vite**,本轮不动 | 无场景驱动 |

## 3. 目标架构:Ports & Adapters(承载双路线)

> **核心命题**:同一份 `core/` 既是独立产品的心脏,也是集成进 PM 时被 import 的"数据层能力"。做法 = 六边形:**core 只认端口接口,不认框架/存储/传输;具体实现在装配点注入**。

### 3.1 三环结构

```
   驱动侧 Driving Adapters               被驱动侧 Driven Ports → Adapters
   (谁调用 core)                          (core 需要谁,只认接口)

标准品│ server/routes (HTTP) ─┐        ┌─ LlmRunner ─► adapters/llm-execa ─► LLM CLI
标准品│ server/index  (CLI)  ─┤        │              └(集成: PM 自带 agent)
      │                      ├──►┌─────┴──────────┐
集成  │ integration (lib)   ─┤   │     CORE        │─ ReviewStore ─► adapters/store-sidecar
集成  │ integration (MCP)   ─┘   │  (portable·无框架)│              └(集成: PM 数据库)
      │                          │  extract         │
      │                          │  confidence      │─ DocSource ─► adapters/docsource-fs
      │                          │  context-pack    │              └(集成: PM 文档/决策源)
      │                          │  rewrite/annot   │
      │                          │  agent(tasks+run)│
      │                          │  数据模型+schema  │
      │                          └─────────────────┘
                                         ▲
                                  Composition Root
                             (唯一知道"具体 adapter"的地方,注入进 core)
                             标准品 = server/index.ts   集成 = PM 侧 / integration/
```

### 3.2 双路线对照(同一 core,只换外环)

| 关注点 | 独立产品 | 集成到 PM 项目 |
|---|---|---|
| 驱动入口 | Hono HTTP + CLI | PM 直接 import core / MCP |
| `LlmRunner` | execa CLI | execa 或 PM 自带 agent |
| `ReviewStore` | sidecar JSON | PM 数据库 |
| `DocSource` | 文件系统 | PM 文档/决策源 |
| UI | scribepad React(后续) | PM 自己的 UI |
| **`core/`** | **同一份** | **同一份,不改一行** |

### 3.3 端口定义(core 对外的需求,只认接口)

| 端口 | 职责 | 标准品实现 | 关键约束 |
|---|---|---|---|
| `LlmRunner` | 跑一个 agent 任务,返回原始文本 | execa spawn CLI | 只 IO,不解析业务 |
| `ReviewStore` | 持久化**用户状态**(确认/批注/pack 定义) | sidecar JSON | 抽取结果不落盘 |
| `DocSource` | 提供文档内容 + 元信息 | 文件系统 | 写仅当源可变 |

### 3.4 模块职责明细(逐模块:负责 / 不负责 / 本轮)

| 模块 | 环 | ✅ 负责 | ❌ 不负责 | 本轮 |
|---|---|---|---|---|
| `types/domain.ts` | 类型 | 领域类型(Item/Gap/Confidence/Pack/ConfirmState) | 逻辑 | 🟢 |
| `types/ports.ts` | 类型 | 3 端口接口 | 实现 | 🟢 |
| `core/agent/tasks/*` | core | 任务描述(prompt+Zod schema,**纯数据**) | spawn/IO | 🟢 |
| `core/agent/runner.ts` | core | 编排:校验+重试,调 `LlmRunner` 端口 | spawn 本身/领域语义 | 🟢 |
| `core/extract.ts` | core | 抽取编排 + **gap 纯核算** + 置信度 | 持久化/渲染 | 🟢 |
| `core/confidence.ts` | core | **置信度确认状态机**(open/confirmed/rejected)+ 防漂移规则 | 抽取/UI | 🟢 状态机+API,UI 后置 |
| `core/context-pack.ts` | core | 组装 pack(信息点+confirmed 决策+片段) | 喂 agent 执行/UI | 🟡 类型+端口就位,实现后置 |
| `core/rewrite.ts` | core | 改写编排 + 防漂移 | — | 🟡 改(prompt 迁 task) |
| `core/annotations.ts` | core | 批注领域逻辑 | — | ⚪ 现有迁入 |
| `adapters/llm-execa.ts` | adapter | 实现 `LlmRunner`:execa → stdout | 解析业务 | 🟢 |
| `adapters/store-sidecar.ts` | adapter | 实现 `ReviewStore`:sidecar 读写 | 抽取 | 🟢 |
| `adapters/docsource-fs.ts` | adapter | 实现 `DocSource`:fs 读写文档 | — | 🟢 |
| `server/routes/*` | driving | HTTP 边界,驱动 core use-case | 领域逻辑/直接 adapter | 🟢 瘦 |
| `server/index.ts` | root | CLI + session + **装配注入 adapter** | 领域逻辑 | 🟡 改 |
| `src/**`(client) | driving | React UI | — | 🔴 本轮不动 |
| `integration/`(facade) | driving | 集成路线:lib API / MCP 暴露 core | — | 🟡 仅设计 |
| `eval/**` | dev | gold-set + harness,调 `core/extract` 纯核 | 运行时 | 🟢 |

### 3.5 依赖方向规则(强制,违反 = 设计 bug)

| 模块 | import 允许 | 禁止 |
|---|---|---|
| `types/**` | (纯类型) | 任何运行时 |
| `core/**` | `types/**` only | **adapters / server / src / 框架(hono/react/execa)** |
| `adapters/**` | `types/**`、外部库(execa) | core / server / src |
| `server/routes/**` | `types`、`core`(use-case) | 直接 `adapters`(经注入) |
| **composition root**(`server/index.ts` / `integration/`) | `core`、`adapters`、`types` | —(**唯一**知道具体 adapter 处) |
| `eval/**` | `types`、`core` 纯核 | server / src / 启动 server |

**铁律**:`core/` 绝不 import `execa`——runner 只调 `LlmRunner` 端口,execa 在 `adapters/llm-execa`。这是"可被集成"的前提。

### 3.6 为什么后续接入不改 core
- **上下文包**:core 模块,依赖已就位的 `ReviewStore`/`DocSource` 端口 → 补实现即可。
- **UI 升级**:全在 `src/`(driving),隔离于 core → UI 迭代永不触 core。
- **集成路线**:PM 侧加 `store-pmdb`/`docsource-pm`/自带 agent 三个 adapter + 一个装配点 → core 不改一行。

## 4. 重构工作项(逐点:现状/要做什么/验证/不做)

### WI0 — core 抽出 + 端口定义(结构地基,先做)
- **现状**:领域逻辑在 `server/services`,与 Hono 耦合;无端口。
- **要做什么**:把领域逻辑迁到顶层 `core/`(可脱离 server import);定义 `types/ports.ts`;`server` 降为 driving adapter + 装配点。
- **验证**:core 单测不 import server/hono/react/execa(用依赖 lint 卡)。
- **判断**:这是本轮最大结构改动,由"双路线"硬需求驱动(集成需 import 无框架的 core),非投机。

### WI1 — 抽取层:规则 → LLM 结构化抽取
- Zod 抽取 schema(Item/Gap + **confidence**);`core/extract` 纯核算 gap + 壳经 agent 调 LLM;Strangler Fig(规则 fallback);anchor 回填(low-confidence 不硬定位)。验证:gold-set precision/recall。

### WI2 — agent 层(execa runner)
- `adapters/llm-execa`(execa,收敛旧双 adapter);`core/agent/runner` 校验+重试→Result;task 描述迁 `core/agent/tasks`;provider 从 config 读。验证:runner 单测喂畸形输出。

### WI3 — 置信度确认状态机
- `core/confidence`:抽取给 confidence → 重要且低置信标"待确认" → 确认/否决 → 经 `ReviewStore` 落盘;confirmed 防漂移。验证:状态转移单测(纯函数)。**交互 UI 后置**。

### WI4 — 数据契约 + ReviewStore(sidecar)
- `types/domain` 与旧 `PlanItem` 解耦;`adapters/store-sidecar` 加字段承载确认状态,不改旧,version bump;抽取结果不落盘。验证:旧 sidecar 兼容读测。

### WI5 — eval + gold-set
- `eval/` ≥10 份多格式文档(≥3 domain)我标你审;`harness` 算 gap precision(重点)/recall + 记方差;promptfoo 回归。验证:harness 出分。

### WI6 — 护栏(贯穿)
- characterization test 先行;Strangler Fig;commit 顺序 `chore(deps)→refactor(抽 core)→feat→test→docs`,每步可编译可测;5 闸全绿。

## 5. 质量 / 维护性 / 扩展性要求(可强制、可验证)

### 质量
| Q1 gap 计算纯函数,单测不 spawn LLM | Q2 边界一律 Zod,禁跨界 `as` | Q3 agent/extract 失败返 `Result` 不 throw | Q4 LLM 输出剥 fence→校验→带错重试(≤N) | Q5 5 闸 + 新分支必有单测 |

### 维护性
| M1 prompt 即数据集中 `core/agent/tasks` | M2 换 LLM 改 config 零代码 | M3 已知债 `App.tsx` 1394/`plan-inspector` 686 本轮不动,标触发门 | M4 public 边界 doc comment | M5 execa 收敛双 adapter |

### 扩展性
| E0 **core 零框架依赖**(可被集成)—— 依赖 lint 强制 | E1 加 LLM=加 provider 配置 | E2 加 AI 任务=加 task 描述 | E3 加场景(未来)只定 `ScenarioSpec` 占位,不建 registry | E4 sidecar 加字段不改旧+version bump | E5 换存储/文档源=换 adapter,不改 core |

## 6. 分步顺序与 gate
1. `chore(deps)`:execa/Zod/promptfoo
2. **WI0** 抽 core + 端口(结构先立)
3. WI5 gold-set 骨架
4. WI2 agent runner → WI1 抽取 → WI3 置信度
5. WI4 契约 + store
6. WI6 贯穿

**完成 gate**:5 闸全绿 + core 零框架依赖(lint 过)+ gap precision 达标 + ≥3 domain 稳定跑出结构化结果。

## 7. 风险
| execa 结构化输出不如 SDK 稳 🔴 | Q4 重试;trade-off 换 agent 中立/可集成 |
| anchor 回填不准 🔴 | low-confidence 不硬定位 |
| core 抽取牵动现有 services 🟡 | characterization test 先行 + 小步可 revert |
| gold-set 标注成本 🟡 | 先 5 份跑通再补 10 |

## 8. 与上游文档关系
- 本文档取代 `docs/plan.md`(v0.2)地位(旧 plan 归档)。
- `docs/architecture.md` 三顶层将升级为 core/adapters/server/src/types 五顶层 + Ports & Adapters —— **待本重构落地后**同步(现在改会让 arch 文档撒谎)。
- 场景清单权威来源:GitHub issues #2–#15。
