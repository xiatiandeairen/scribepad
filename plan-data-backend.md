# Plan 场景数据后端落地：三模型收敛 + core 抽取

> 状态：待 review | 分支：接 `refactor/core-ports-foundation` 之后 | 本文档 8 节，核心决策在 §3。本文档自身按新 8 节模型书写，落地后作为抽取器的 fixture 之一（§4.6）。

## 目标

**为什么做**：plan 场景内部并存三套重叠模型，记的是同一件事——"文档里这条信息定了没"：

| 模型 | 位置 | kind 分类 | 状态机 | 现状 |
|---|---|---|---|---|
| `PlanItem` | `types/plan.ts`，由 `src/lib/plan-inspector.ts`（687 行，跑在前端）从 mdast 解出 | 5 类：goal / scope / behavior / verification / open-question | open / locked / stale | 在用（现有前端 Review 面板） |
| `ExtractedItem` / `Gap` / `ConfirmState` / `ContextPack` | `types/domain.ts` + `core/schema.ts` | 7 类（InfoKind，带 confidence） | open / confirmed / rejected | 死 seam：全仓无 producer / consumer（grep 证实 `ConfirmState` 仅出现在 types 三文件、`core/schema.ts`、`store-sidecar.ts` 及其单测；core 侧抽取从未实现） |
| `Annotation.state` | `types/annotation.ts` | — | draft / discussed / decided | 在用（批注生命周期） |

三套 kind 分类 + 三套状态机并行，新前端（Claude Design 另行设计中）对接时无从选择，卡死。同时已核实两个真 bug（均在锁-防漂移线上）：

- **B1**：`core/rewrite.ts` 的防漂移过滤只认 `state === 'decided'` 的 annotation id（L60-63）；`session-manager.rewrite()` 只 load annotations（L221），locked 的 `PlanItem`（planState）根本不进过滤——"锁定即防改写"从未对 PlanItem 生效。
- **B2**：过滤按 annotation id 匹配 `RewriteItem.id`。同一段文字重新划选会生成新 annotation（新 id），旧 decided 保护即被绕过。

旧模型渗透面（收敛为什么不能原地拆换的依据）：旧 plan 模型标识符在 `src/` 6 个文件约 140 处命中（App.tsx 25 / PlanPanel.tsx 12 / Reader.tsx 8 / lib/api.ts 4 / plan-inspector.ts 91 / review-normalize-validation.ts 2），另有 8 个 e2e spec 中 4 个断言 locked / plan-state 行为。

**成功约束（硬约束，方案取舍与验收都以此为准）**：

| # | 约束 | 可判定标准 |
|---|---|---|
| G1 | 迁移期 app 任何时刻可开可审 | 每个 commit 五道闸全绿：`npm run typecheck`（3 tsconfig）/ `lint`（含 E0）/ `test` / `build` / `test:e2e` |
| G2 | 内核可移植性不破 | `core/` 依赖白名单 = `types/` + zod + mdast 解析库（见 D2 / P3）；`tsconfig.core.json` 独立 typecheck 绿 |
| G3 | 新模型达到标杆解析力 | `core/extract` 解出 `plan-auth-soc2.md` 全部 8 节 + 3 张决策卡三段 + 标签交叉引用（量化断言见 §5） |
| G4 | 旧路径迁移期不回归 | 现有前端 5 类抽取 / 批注 / rewrite / 锁持久化行为不变；`plan-inspector.test.ts` 与现有 e2e 断言不改仍绿（唯一例外：D3 主动砍除的服务端 decided 过滤，配套 e2e 同步调整） |
| G5 | 持久化迁移不丢用户数据 | sidecar load→save round-trip 后 annotations 逐字段相等；文件中既有 planState / 未知字段字节保留（单测锁定） |

## 边界

**范围内**：新数据模型 types（8 类信息点 + 决策卡 + 锚点原语 + source/confidence 字段位）、core 抽取（`core/extract`，mdast 8 节 + 决策卡 + GFM 表格/checkbox）、grounding 标签 + 交叉引用解析、持久化瘦身（ReviewStore 端口只留 annotations）、新 API 契约（`types/api.ts` + `GET /api/extract`）、单测锁行为。

**范围外（non-goals，agent 不得触碰）**：

- **不做** 前端——新前端由产品负责人用 Claude Design 另行产出，本期只交付其消费的数据层与 HTTP 契约
- **不做** AI 抽取——纯规则化解析；`source` / `confidence` 只留字段位，本期不产出不消费
- **不做** 质量缺陷的工具处理（缺节提示 / 自动补全）——全 defer，旧 `Gap` 类型随死 seam 一并移除，需要时再立
- **不设计** 价值度 / 置信度的具体逻辑——只留字段位（Q2，⚠ TBD by design）
- **不删** 旧路径——`plan-inspector.ts`、`/api/plan-state`、旧前端锁 UI 原样保留（Strangler），等新前端接上后按退休条款删（Q3）

## 决策

### D1（核心）：三套模型收敛采用 **Strangler 分层收敛（新旧并存）** ✅ 已定（并存细节见 P2）

**选了什么**：新数据层（新 types + `core/extract`）加在旁边；现有前端、`plan-inspector.ts`、`/api/plan-state` 旧路径不动。新前端接上新模型后再按退休条款删旧路径。

**为什么（对齐硬约束）**：G1——旧模型在 `src/` 有约 140 处标识符引用、4 个 e2e spec 断言其行为，原地拆换当场编译失败 + e2e 全红，app 中途不可用；G4——旧路径不动即不回归；新前端产出时机不受本期控制（P4），并存是唯一让两侧都不阻塞的方式。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| 大爆炸原地拆换 | 违反 G1/G4：140 处前端引用 + e2e 断言当场全红，迁移期 app 不可用 |
| 维持三套并行 | 现状即卡死：新前端无模型可接，B1/B2 两个 bug 永久悬置 |

### D2：抽取逻辑从前端移入 **`core/extract`** ✅ 已定（E0 白名单扩展见 P3）

**选了什么**：`plan-inspector.ts` 的 mdast 解析迁入 `core/extract/`，扩到 8 节 + 决策卡 + GFM 表格。core 无框架、浏览器可同构（mdast 系解析库已在前端生产运行），前端将来可直接 import，不伤编辑体验。

**为什么**：六边形架构下领域逻辑归 core——集成路线（PM 项目 import core）拿不到留在 `src/` 的抽取；新 API（§4.5）也需要服务端跑同一份解析。

**依赖面事实**：ESLint E0 是黑名单制（禁 hono / react / execa / server / src / adapters），`mdast-util-from-markdown` 不在禁止列表，lint 无需改；需改的是 `docs/architecture.md` 中"core 只 import types/ 与 zod"的白名单措辞（P3）。需新增 devDeps→deps：`mdast-util-gfm` + `micromark-extension-gfm`（`plan-auth-soc2.md` 的约束/风险/待确认全是 GFM 表格，现有 `fromMarkdown` 裸调不解析表格）。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| 留在前端 `src/lib` | 违背六边形依赖规则；seam 集成方与服务端 API 都拿不到抽取 |
| markdown parser 做成注入端口 | 单实现抽象（arch-design §2）；mdast 库本身无框架、同构，无注入必要 |

### D3：砍掉"锁 / 防漂移"整条线 ✅ 已定

**选了什么**：新模型不带锁概念；同时摘除三处存量：(a) `ConfirmState` 死 seam 全链删除；(b) `ReviewState` 端口去 planState（旧锁持久化改走显式 legacy shim，行为不变，随旧路径退休删除）；(c) `core/rewrite.ts` 的 decided 过滤删除。

**为什么**：产品负责人 dogfood 已验证锁没必要——只要改写足够准（grounding 方向，D4），就不需要冻结文字。B1/B2 两个漂移 bug 随功能消失，不需单独修补。`ConfirmState` 有存储无 producer/consumer，纯负债。

**代价（显式接受）**：(c) 删除后，迁移期内直连 `POST /api/rewrite` 提交 decided id 不再被服务端拦截（旧前端 Sidebar 本就不提交 decided 项，用户可见行为几乎不变）；`tests/e2e/decided.spec.ts` 中"server blocks rewrite"断言随功能同步删除——这是砍功能的配套调整，不算 G4 回归。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| 修 B1/B2 保留锁 | 在已决定砍掉的功能上返工；B1 修复还要把 planState 接进 rewrite 链路，是反方向投入 |
| 锁线保留到旧路径退休再砍 | `ConfirmState` 零消费无保留价值；rewrite 过滤留着就得继续背 B1/B2 的"假保护"语义 |

### D4：grounding 地基用 **标签 + 交叉引用** 轻量实现 ✅ 已定

**选了什么**：信息点带稳定标签（`G1` / `D2` / `R3` / `P1` / `Q4`，pattern `^[GDRPQ]\d+$`），从标题前缀 / 表格首列 / 列表加粗前缀识别；各点正文扫描 `\b[GDRPQ]\d+\b` 得 `refs`（引用即"依据"）；core 提供纯函数把引用解析成可导航关系（上下文包雏形）。有标签的点 `id = label`（重排不换 id），无标签回退 `plan-inspector` 现有结构 id 算法。

**为什么**：改写要准就得先让"依据"可机读；标签 + 引用是最小可用的 grounding 结构，`plan-auth-soc2.md` 已验证这种写法可读可写。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| 本期上 AI 抽取 / 语义 grounding | 未验证、工程量大；违背"先规则化"的范围外约定，留 `source: 'ai'` 字段位即可 |
| `ContextPack`（itemIds 列表）照旧实现 | 静态 id 列表是 refs 图的降级形态；被 D4 的引用图取代，类型一并删除 |

## 做法

按序执行；每步（含子步）单独 commit、五道闸绿。commit 排序遵循 chore(deps) → refactor → feat → test。

### 1. 新模型类型（`types/domain.ts` 原地演进 + `core/schema.ts` 同步）

`types/domain.ts` 的旧 seam 无外部消费方（`ExtractedItem`/`Gap` 仅 `core/schema.ts` 引用），原地演进不构成大爆炸：

- `InfoKind` 7 类 → 8 类：新增 `'precondition'`（前置）。8 类与 8 节一一对应：goal（目标）/ scope（边界）/ decision（决策）/ behavior（做法）/ verification（验收）/ risk（风险）/ precondition（前置）/ open-question（待确认）。
- `ExtractedItem` 演进：新增 `label?: string`（稳定标签）、`refs: string[]`（引用的标签，可悬空）、`textHash: string`（沿用 plan-inspector 的 31-乘子 base36 hash）、`source: 'rule' | 'ai'`（字段位，本期恒 `'rule'`）；`confidence` 改 optional（字段位，本期不赋值）；`anchor?: SrcAnchor` 保留 optional（规则抽取恒有值，optional 留给 AI seam）。
- 新增 `DecisionCard`：`{ pointId: string; label?: string; chosen: string; rationale: string; rejected: Array<{ option: string; reason: string }>; status: 'decided' | 'pending' }`（`✅ 已定` 标记 → decided）。
- `ExtractResult` 改为 `{ points: ExtractedItem[]; decisions: DecisionCard[] }`。
- 删除 `Gap` / `GapKind` / `ContextPack`（死类型，见 §2 范围外与 D4）。`ConfirmState` 本步不动（§4.4a 原子摘除，保持每个 commit 可编译）。
- `core/schema.ts` 同步重写各 schema，保持 `satisfies z.ZodType<...>` 编译期防漂移绑定。

### 2. core 抽取（`core/extract/`）

新增依赖：`mdast-util-gfm` + `micromark-extension-gfm`（deps；表格与 `- [ ]` checkbox 解析必需）。模块结构：

```
core/extract/
├── sections.ts   # H2 切分 + 8 节分类（迁 splitH2Sections / classifyReviewSection / normalizeHeading，
│                 #   alias 表扩到 8：目标|goal / 边界|范围|scope / 决策|decisions / 做法|方案|approach /
│                 #   验收|acceptance / 风险|risks / 前置|preconditions / 待确认|open questions）
├── points.ts     # 节内容 → ExtractedItem[]（迁 collectDetails / collectListItems / itemFromNode /
│                 #   textOf / hash / slug；新增：GFM 表格数据行→点、checkbox 列表项→点）
├── decisions.ts  # 决策节 H3 → DecisionCard（label 取 /^(D\d+)/ 前缀；✅ 已定 → status；
│                 #   三段取加粗段落引导词 选了什么|为什么|否掉了谁；"否掉"下表格行→rejected[]；
│                 #   三段缺失降级为 chosen=全文、rejected=[]，不报错）
├── labels.ts     # 标签识别（标题前缀 / 表格首列 / **P1** 加粗列表前缀）+ refs 扫描 +
│                 #   byLabel(result) / relatedPoints(result, id, depth=1) 纯函数（出边 refs + 入边反查）
└── index.ts      # extract(source: string): ExtractResult
```

id 规则：`label ?? \`${kind}:${sectionOrder}:${groupKey}:${itemOrder}\``（后者逐字沿用 plan-inspector 现算法）。非 8 节文档（如 `sample.md`）降级返回部分/空结果，不 throw。`src/lib/plan-inspector.ts` 与其单测一行不动。同 commit 更新 `docs/architecture.md`：core 依赖白名单扩为 `types/` + zod + mdast 解析库（P3 拍板后）。

### 3. grounding 交叉引用

已并入 §4.2 的 `labels.ts`（拆出来只是叙述单位）：refs 扫描排除自身 label；悬空引用（引用了不存在的标签）原样保留在 `refs` 中，由消费方决定呈现——本期不做校验告警（属质量工具，范围外）。`relatedPoints` 即上下文包雏形：给定点 id，沿引用图收集依据与被依据点。

### 4. 持久化瘦身（三个独立 commit）

- **4a `ConfirmState` 全链摘除**（一个原子 commit，涉 6 文件）：`types/domain.ts`（类型）、`types/ports.ts`（`ReviewState.confirmStates`）、`types/annotation.ts`（`Sidecar.confirmStates`）、`core/schema.ts`（`confirmStateSchema`）、`server/adapters/store-sidecar.ts`（load/save 两处）、`tests/unit/store-sidecar.test.ts`。零用户可见影响。
- **4b `ReviewState` 去 planState**：端口收敛为 `{ annotations: Annotation[] }`。旧锁持久化改走 legacy shim——`store-sidecar.ts` 内复用 readSidecar/writeSidecar 另出一个非端口 accessor（`loadPlanState` / `savePlanState`，文件头 `HACK(delete with old-path retirement, Q3)` 标注），`session-manager` 的 `readPlanState` / `writePlanState` 与 `routes/plan-state.ts` 改接 shim。旧前端锁行为（含刷新后保留）不变，G4 保住；`Sidecar.planState` 字段保留。sidecar `version: 4` 不 bump——save 先 spread existing 的既有机制保证未知/存量字段字节不丢（G5），用单测锁死该机制。
- **4c rewrite 防漂移过滤删除**：`core/rewrite.ts` 的 `rewriteItems` 去掉 `existingAnnotations` 参数与 decidedIds 过滤及"全部 decided 则 throw"分支；`session-manager.rewrite()` 不再 loadState；`tests/unit/core-rewrite.test.ts` 同步改写；`tests/e2e/decided.spec.ts` 删"server blocks rewrite"断言（保留 decided 卡渲染断言，toast 用例改用与 decided 无关的 mock 错误文案）。B1/B2 随之消亡。

### 5. API 契约（`types/api.ts` + `server/routes/extract.ts`）

- `types/api.ts` 新增：`GET /api/extract` → `ExtractResponse { result: ExtractResult }`；给 `PlanStateRequest/Response` 加 `@deprecated`（随旧路径退休删除，Q3）。
- `server/routes/extract.ts`：沿现有路由形态（参 `plan-state.ts`），经 `ctx.sessionManager.extract(session.id)`；`session-manager` 新增 `extract(id)`：`docSource.read` → `core/extract` 的 `extract(content)`，抽取结果不持久化（每次重算，沿用既有约定）。`server/app.ts` 挂载。
- 新前端消费面就此定稿：`GET /api/extract` + 现有 `/api/annotations`、`/api/rewrite`、`/api/file`（P4 对齐后不再动形状）。

### 6. 单测锁行为

- fixtures（≥3 个不同形态样本，避免 N=1 过拟合）：`tests/fixtures/plan-auth-soc2.md`（标杆全量，复制入库）、`tests/fixtures/plan-data-backend.md`（本文档，第二个 8 节样本）、一个旧 5 节格式样本（取自现有 plan-inspector 测试语料）、一个缺节/无标签退化样本。
- `tests/unit/extract.test.ts`：§5 验收中的全部量化断言 + 决策卡降级、悬空引用、非 8 节降级。
- `tests/unit/store-sidecar.test.ts`：G5 round-trip 断言（annotations 逐字段相等 + 存量 planState / 未知字段字节保留）。
- 旧路径回归：`plan-inspector.test.ts` 与 `review-ui / p0 / comprehensive` e2e 不改断言全绿。

## 验收

全部可勾选，逐条挂硬约束：

- [ ] **G1** 每个 commit 五道闸全绿（typecheck×3 / lint / test / build / test:e2e），迁移全程 `npm run dev` 可开可审
- [ ] **G2** `tsc -p tsconfig.core.json` 绿；`core/` 内 import 仅 `types/`、zod、mdast 解析库；ESLint E0 绿
- [ ] **G3** `extract(plan-auth-soc2.md)`：识别全部 8 节；goal 节含 G1–G4 共 4 个带标签约束点；决策 3 张卡且 D1 解析出 chosen / rationale / 2 条 rejected / status=decided；风险 R1–R5、前置 P1–P4、待确认 Q1–Q5 数量与标签逐一正确；验收节 9 个 checkbox 点且 ≥7 个 refs 命中 G/D 标签
- [ ] **G3/D4** grounding：R2 点的 refs 含 `G1`；`byLabel(result)['D2']` 可导航到对应决策点；悬空引用不报错；有标签点的 id 即 label
- [ ] **G4** 旧路径回归：`plan-inspector.test.ts` 不改一行通过；`review-ui / p0 / comprehensive` e2e 断言不改通过；旧前端锁定后刷新页面锁仍在（`/api/plan-state` 行为不变）
- [ ] **G5** 单测：含 annotations + planState + confirmStates 的存量 v4 sidecar 文件 load→save round-trip 后 annotations 逐字段相等、planState 与未知字段字节仍在文件中
- [ ] **D3** `rg 'ConfirmState|confirmStates'` 全仓 0 命中；`ReviewState` 仅含 annotations；`core/rewrite.ts` 无 decided 过滤且 `rewriteItems` 签名不含 annotations
- [ ] **§4.5** `GET /api/extract` 对 8 节文档返回完整 `ExtractResult`；对 `sample.md` 等非 8 节文档降级返回部分/空结果，不 500
- [ ] **§4.6** 抽取单测覆盖 ≥3 个不同形态 fixture，全绿

## 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | mdast + GFM 进 core，扩大内核依赖面，集成方 bundle 增重 | 低 | 均为无框架纯 ESM 解析库，浏览器同构已被 `src/lib/plan-inspector` 生产验证；白名单在 architecture.md 显式化（P3），不再悄悄扩 |
| R2 | 8 节抽取的泛化质量未知——标杆样本只有 1 份，规则可能 over-fit（know：N=1 不足以声明 feasibility） | 中 | §4.6 强制 ≥3 个不同形态 fixture（含退化样本）；解析全程降级不 throw；后续真实文档暴露的缺陷按 fixture 补 case |
| R3 | 砍服务端 decided 过滤后，迁移期直连 API 的 rewrite 无拦截（D3 显式接受的代价） | 低 | 旧前端本就不提交 decided 项，可见行为几乎不变；grounding（D4 起步）是替代防线的正路 |
| R4 | 双模型并存期两套抽取结果并存（旧 5 类面板 vs 新 8 类 API），概念上易混淆 | 低 | 消费方天然隔离（旧前端 vs 新前端/集成方）；随旧路径退休（Q3）自然消解，不做双向同步 |
| R5 | legacy planState shim 成为永久遗留（退休条款不执行则长期背两套持久化语义） | 中 | shim 文件头 `HACK(delete with old-path retirement, Q3)` 标注；退休触发条件在 Q3 显式挂钩新前端落地 |

## 前置

不满足则对应步骤不得开工，均需产品负责人拍板：

- **P1**（卡 §4.1）：确认 8 类信息点体系（goal / scope / decision / behavior / verification / risk / precondition / open-question）为新模型 v1 形态——即"7 类 InfoKind + precondition"，不再另起分类法
- **P2**（卡 §4.4）：确认 Strangler 并存细节——旧锁 UI 与 `/api/plan-state` 迁移期保持原行为（经 legacy shim），退休时点挂新前端切换（Q3）
- **P3**（卡 §4.2）：确认 E0 依赖白名单扩为 `types/` + zod + mdast 解析库（`mdast-util-from-markdown` / `mdast-util-gfm` / `micromark-extension-gfm`），`docs/architecture.md` 措辞随之更新（lint 为黑名单制，无需改规则）
- **P4**（卡 §4.5 定稿）：确认 Claude Design 新前端消费面就是 `GET /api/extract` + 现有 annotations / rewrite / file 契约；对齐前 `types/api.ts` 新增形状不定稿

## 待确认

核心决策（D1–D4）不依赖以下任何一项，均不卡开工，但卡各自标注环节：

| # | 问题 | owner | 卡什么 | 截止 |
|---|---|---|---|---|
| Q1 | 旧 planState 历史数据在旧路径退休时直接弃，还是导出留档 | 产品 | 退休条款执行 | 旧路径退休前 |
| Q2 | 价值度 / 置信度（source / confidence 字段位）的产出逻辑与排期（⚠ TBD by design，本期只留字段位） | 产品 | v-next 立项 | 无 |
| Q3 | 旧路径退休时点与 e2e 迁移排期——依赖 Claude Design 新前端落地；退休 checklist：删 plan-inspector.ts / 锁 UI / `/api/plan-state` / legacy shim / decided 相关 e2e | 产品+AI | R5、§2 "不删旧路径"的解除 | 新前端接上后 |
| Q4 | 新模型类型的最终居所与命名：默认按 `types/domain.ts` 原地演进开工；是否拆独立文件、`ExtractedItem` 是否更名（如 InfoPoint）在 review 时定 | 产品 | §4.1 命名定稿（不卡实现） | §4.1 code review 前 |
| Q5 | 决策卡三段引导词表是否固定为"选了什么 / 为什么 / 否掉了谁"，还是开放别名 | 产品 | `decisions.ts` 词表 | §4.2 开发中（先按固定词表 + 降级实现） |
