# 新前端 ↔ 数据后端接入：抽取保真 + 落盘闭环 + AI 通道

> 状态：已拍板 · 执行中 | 前端源：Downloads/spec-plan（Claude Design 产出）| 本文档 8 节，核心决策在 §3

## 目标

**为什么做**：产品负责人用 Claude Design 产出了一套新前端（无构建静态 React），要把它接到真实数据后端，让「打开 plan 文档 → 结构化 8 节视图 → AI 协作（对话/选区改文档/改写）→ 持久化」整条流程通起来。主矛盾经 fable 核验重新定位：**不是缺接口，是抽取的结构保真度不够**——前端 fixture 里 90% 的「UI 扩展字段」其实是真实 markdown 里存在、但被 `core/extract` 抽取时丢弃的结构事实（GFM 表格列、加粗分组、决策卡小标题结构）。

**成功约束（硬约束，方案取舍与验收都以此为准）**：

| # | 约束 | 可判定标准 |
|---|---|---|
| G1 | 迁移期五道闸全绿 | 每个 commit：typecheck×3 / lint / test / build / test:e2e 全绿，旧路径 e2e 断言不改 |
| G2 | 六边形不破 | UI 展示语义零泄漏进 core；DTO 三层分离（domain 结构事实 → API DTO 透传 → 前端 ViewModel 派生）；E0 边界绿 |
| G3 | 活文档成立 | 任意规范书写的 8 节 plan.md 经 `GET /api/sessions/:id/extract` → 前端派生层，无需 per-doc 手写 overlay 即渲染成 8 节视图 |
| G4 | 改到源文档 | 选区改写 / 选区转决策卡等写操作落盘到 markdown 源、可 round-trip、刷新不丢 |
| G5 | 抽取泛化不 over-fit | 结构保真字段在 ≥3 个不同形态 fixture 上验证（含退化样本），降级不 throw |

## 边界

**范围内（v1 打通）**：

- 抽取结构保真：`core/extract` 增通用结构事实字段（表格 cells / 分组 group / 决策卡 heading 结构 / doc-level meta），additive optional
- 标签契约收敛（D-2）+ 前端 ViewModel 派生层实装（adaptExtract）
- 多文档 extract 路由 + 改写落盘闭环（rewrite-apply）+ 选区真改文档（选区转决策卡/提风险/提待确认，D-3 用户抬高的范围）
- AI 通道：SSE 骨架 + 规则型 ai-review/ai-refs（复用 core/verify，零 LLM）+ chat/解释（LlmRunner）
- 批注接线（结构化锚点）+ 前置拍板 signoffs 持久化（D-4）+ 新前端入仓托管（D-5）

**范围外（v2，non-goals，本期不碰）**：

- **不做** 富块保真渲染（§1 模型对照表、§4 模块树这类节内非信息点富块）—— 本期接受降级为通用列表
- **不做** 批注批量分析（analyze-notes）—— 等批注有真数据再做
- **不做** 会话/历史持久化 —— 非打通链路必要件
- **不做** LlmRunner 流式端口演进 —— chat 用诚实的阶段粗粒度 progress
- **不做** LLM 增强版 ai-review —— 本期规则型足够出真结果

## 决策

### D1（前置）：接入排在干净基线之后 ✅ 已定

**选了什么**：先把在途工作（core/extract·verify·refine）提交，再做 plan-data-backend §4.4 的持久化瘦身（S4a-c），最后才做接入。

**为什么**：`core/*` 三模块仍 untracked、`types/domain.ts` 等已改未提交、S4a-c 未执行（ports 仍带 planState/confirmStates）。前置拍板 signoffs（D-4）依赖 S4b 之后的端口形态；无干净基线接入无法 bisect。

### D2：标签前缀收敛为 5 + B 归目标节 ✅ 已定

**选了什么**：`PREFIX_KIND` 收敛为 `G/D/R/P/Q`（pattern `^[GDRPQ]\d+$`）+ `B` 定义为目标节的「已核实 bug」标签；删除没人用的 `S`（scope）/ `V`（verification）映射；同步改 plan 文档 D4 措辞。

**为什么**：`labels.ts` 现实现 8 前缀超出 plan D4 定的 5 前缀，`B` 前缀后端当 behavior、前端/真实文档当 bug，语义直接相撞——不收敛前端 bug 区块落空。代码未发布未提交，现在改零破坏成本。

**否掉了谁**：

| 候选 | 否掉理由 |
|---|---|
| 维持 8 前缀 | B1/B2 bug 永远抽不出 label，前端 bug 区块落空 |
| 纯 5 前缀不给 B 归属 | bug 仍无 label，问题只解一半 |

**代价**：目标节例外允许两个前缀（G + B），REF-03「一前缀一 kind」规则要加显式例外并测试锁死。

### D3：选区操作 v1 全做真改文档，但落盘闭环先行 ✅ 已定（产品负责人抬高范围）

**选了什么**：四个选区 op 中 explain 只读；dcard/risk/open 在 v1 做真改文档。执行次序硬约束：**先做通 #12 选区改写落盘闭环，验证稳后 #10 选区转决策卡/提风险复用同一落盘机制做定点插入**（LLM 只产片段 + 目标节，服务端按节 anchor 定点插入，不让 LLM 重写全文，防漂移）。

**为什么**：产品负责人判断新前端若选区操作不改文档，活文档核心价值不成立。fable 曾建议 #10 延后 v1.5，产品负责人抬高到 v1。

**否掉了谁**：

| 候选 | 否掉理由 |
|---|---|
| 四 op 全做且并发两个写场景 | 落盘机制未验证稳先并发写，漂移风险高——故拆为 #12 先行、#10 复用 |
| 选区操作全部只回话 | 新前端沦为只读 viewer + 聊天窗，活文档价值不成立 |

### D4：前置拍板存 ReviewStore 新增 signoffs ✅ 已定

**选了什么**：不复用要退休的 plan-state；S4b 完成后 `ReviewState` 演进为 `{ annotations, signoffs }`（`signoffs: [{pointId, label, signedAt}]`），走 sidecar additive 字段 + spread-existing 保真机制；新增 `GET/POST /api/sessions/:id/signoffs`。

**为什么**：ReviewStore 端口语义就是「persisted user state」，signoff 精确匹配；排在 S4b 后避免端口二次返工。

### D5：新前端静态入仓 + server 静态挂载 ✅ 已定

**选了什么**：Claude Design 产出（无构建静态文件）原样入仓（如 `client-next/`），server 加一条静态挂载（如 `/next/*`），不引入构建、不动旧 SPA 路由。

**为什么**：保留 Claude Design 迭代通道，零构建耦合；构建化挂到 Q3 旧路径退休 checklist 再议。

## 做法

按序执行；每步（含子步）单独 commit、五道闸绿（G1）。commit 排序遵循 chore(deps) → refactor → feat → test。落盘闭环（P4）先于选区真改文档（P6）。

### P0：干净基线（前置，refactor）

- 提交在途工作（core/extract·verify·refine + types/domain·api + schema + session-manager + extract 路由 + fixtures/单测），按 §5.3 拆分
- 做 plan-data-backend §4.4：S4a（ConfirmState 全链摘除）/ S4b（ReviewState 去 planState + 加 signoffs 字段，legacy shim）/ S4c（core/rewrite.ts decided 过滤删除）
- **验收**：既有 extract.test / store-sidecar round-trip 全绿；`rg "ConfirmState|confirmStates"` 0 命中；ReviewState = `{annotations, signoffs}`

### P1：标签契约收敛（refactor · D2）

- `core/extract/labels.ts`：`PREFIX_KIND` 收敛为 G/D/R/P/Q + B（B 归 goal 节 own）；删 S/V
- REF-03「一前缀一 kind」加 goal 节 G+B 例外
- 同步 plan-data-backend.md D4 措辞
- **验收**：`extract(plan-data-backend.md)` 的 B1/B2 有 label；G3 既有断言不回归；`S1` 作正文 token 不再被误 own

### P2：抽取结构保真（feat · D1 核心 · TDD）

- `ExtractedItem` 增 optional：`cells?: [{header, text}]`（表格行保留表头×单元格）、`group?: string`（最近加粗引导段/H3）
- `ExtractResult` 增 doc-level `meta?`（H1 标题 + 引导 blockquote 原文，供前端 PLAN_META）
- `decisions.ts`：heading 内 strong ⇒ `pick?`、`（核心）` ⇒ `core?`、heading 余文 ⇒ `question?`；LEADS 词表扩 `代价` ⇒ `cost?`、`依赖…事实` ⇒ `facts?`
- **不加任何 UI 语义字段进 domain**（G2）
- **验收（先写测试）**：risk 表行 cells=[#,风险,影响,缓解]×值；open 表 owner/卡什么/截止列齐全；scope 点 group∈{范围内,范围外}；无表格文档 cells 缺省；D1 解析出 pick/core/question；≥3 fixture + 退化样本回归（G5）

### P3：服务端路由（feat）

- `GET /api/sessions/:sessionId/extract`（沿 sessions.ts 形态）
- `POST /api/sessions/:sessionId/rewrite-apply`（落盘闭环 P4 的服务端）
- `POST /api/sessions/:sessionId/agent`（SSE，Hono streamSSE）
- `GET/POST /api/sessions/:sessionId/signoffs`（D4）
- 事件/请求 schema 进 types/api.ts
- **验收**：双 session 各返回各自 ExtractResult；非 8 节 200 降级；SSE 事件序列 progress*→final→关闭；404 on 未知 session

### P4：改写落盘闭环（feat · core 纯函数 + 服务端 · 先于 P6）

- core 纯函数：按 srcAnchor splice markdown（校验 anchor 与当前文档 textHash 一致，防并发漂移；多 item 按 srcStart 倒序应用；越界/重叠/hash 不匹配拒绝）
- 服务端 rewrite-apply：read → rewriteItems → splice → save → 返回新 ExtractResult
- 前端：选区 `data-pt` 容器 → point.anchor + 点内偏移换算 srcAnchor（换算失败降级整点范围）
- **验收**：core 单测覆盖越界/重叠/textHash 拒绝；e2e 改写后刷新文本仍在、重抽取点 id 稳定

### P5：AI 通道（feat）

- `core/agent/tasks/chat`（TaskSpec schema=`{paragraphs, actions[]}`，复用 runTask fence-strip+zod+retry；上下文用 D4 relatedPoints + 全文）
- ai-refs ⇒ verify graph 规则（REF-01 悬空引用）+ relatedPoints 统计；ai-review ⇒ verify 全量 Problem[] → paragraphs/actions（Problem.pointLabel ⇒ act.pt），**零 LLM**
- progress 用诚实阶段粗粒度（组装上下文/调用中/解析中）
- **验收**：含悬空引用 fixture → ai-refs final 事件 actions 带正确 pt；干净文档报 0 悬空；mock LlmRunner chat 上下文含 relatedPoints、非法 JSON 重试后 Err

### P6：选区真改文档（feat · D3 · 复用 P4，后于 P4）

- selection-op dcard/risk/open：LLM 产 markdown 片段 + 目标节 → 服务端按节 anchor 定点插入 → save → 重抽取 → final 携新 extract 提示前端刷新
- **验收**：core 单测插入片段落在目标节尾、二次 extract 出新点（label 顺延）；e2e 划选→提为风险→§6 出现新行

### P7：前端接线 + 入仓 + 收尾（feat · D1/D5）

- adaptExtract 实装（DTO 三层派生：G-label⇒gate、B⇒bug、group⇒in/out、cells 表头映射 lvl/fix/owner/due、`（卡 §4.x）`⇒blocks、behavior 序号⇒num、cells[1]⇒title；每点注入 `ui:{}` 默认防裸访问；kicker/lead 用 SECTION_DEFS 静态默认）；删 per-doc fixture
- createRealAgent 改 fetch+ReadableStream（EventSource 仅 GET，chat quote/notes 塞 URL 不成立；agent.send 签名不动）
- 批注接现有 API + 结构化锚点（pointId + 点内偏移 ⇒ srcStart/srcEnd）
- 前置拍板接 signoffs API
- 新前端原样入仓 `client-next/` + server 静态挂载 `/next/*`
- **验收**：真实 `/api/sessions/:id/extract` → buildPlanModel 后 8 节徽标/图例计数与文档一致；无标签点走 GenericSection 不白屏；拍板/批注刷新仍在；`/next/` smoke e2e 绿

## 验收

全部可勾选，逐条对应硬约束：

- [ ] **G1** 每个 commit 五道闸全绿；旧路径 e2e（review-ui / p0 / comprehensive / decided 保留断言）不改仍绿
- [ ] **G2** core 内无 UI 语义字段/无框架 import；ESLint E0 绿；DTO 三层可指认
- [ ] **G3** 打开 plan-data-backend.md 与 plan-auth-soc2.md 两份不同文档，无 per-doc overlay 即渲染 8 节，徽标/图例计数正确
- [ ] **G3** B1/B2 渲染进目标节 bug 区块（标签收敛生效）
- [ ] **G4** 选区改写 + 选区转决策卡/提风险落盘，刷新后仍在，重抽取点 id 稳定
- [ ] **G5** 抽取结构保真单测覆盖 ≥3 fixture + 退化样本，全绿，降级不 throw
- [ ] ai-review/ai-refs 对含悬空引用文档出真 Problem + 正确 act.pt（零 LLM）
- [ ] SSE 通道 progress→final→关闭、client 断开取消在跑任务

## 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 抽取结构保真规则 over-fit（真实样本仅 2 份） | 中 | ≥3 fixture 含退化样本；降级不 throw；写作规范文档兜底（v2）+ verify 报 Problem |
| R2 | 落盘 splice 并发漂移（多端/AI 同时改） | 中 | anchor 校验 textHash 一致才 apply，不匹配拒绝；#12 先行验证稳再上 #10 |
| R3 | D3 抬高范围致两个写场景并发不稳 | 中 | 硬约束 P4 先于 P6，复用同一落盘机制不另起 |
| R4 | 前端 adapter 映射依赖表头文案 | 低 | 写作规范兜底；表头缺失时 ViewModel 降级默认 |
| R5 | SSE EventSource 仅 GET，接入说明示例代码不成立 | 低 | 改 fetch+ReadableStream，agent.send 接口签名不动 |

## 前置

不满足则对应步骤不得开工：

- **P0 前置**（卡全部）：干净基线 —— 在途工作提交 + S4a-c 完成
- **落盘先行**（卡 P6）：P4 改写落盘闭环验证稳，P6 选区真改文档才开工

## 待确认

核心决策（D1–D5）不依赖以下，均不卡开工：

| # | 问题 | owner | 卡什么 | 截止 |
|---|---|---|---|---|
| Q1 | 决策卡三段引导词表是否固定 vs 开放别名 | 产品 | decisions.ts 词表（P2） | P2 开发中（先固定词表 + 降级） |
| Q2 | plan 写作规范文档定稿（表头文案约定） | 产品+AI | 富块 v2 + adapter 表头映射稳定性 | v2 立项前 |
| Q3 | 旧路径退休时点 + 新前端构建化 | 产品 | 旧 SPA / plan-state / legacy shim 删除 | 新前端接上稳定后 |
