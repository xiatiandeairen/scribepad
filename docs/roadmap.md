# scribepad Product Roadmap

## 1. Product Vision

### Product Essence

- **Positioning**: 给 vibe coder(用 AI agent 做研发的开发者)的研发文档协作面板,把 plan / design / research / analysis 这类长上下文 markdown 文档变成段落级有状态、AI 改写可追溯、agent 中立的活文档
- **Motivation**: vibe coder 让 AI 起草 plan/design 文档后,反复改三轮就分不清哪些定了哪些还在飞;Cursor 没专门的文档面板、Notion/Obsidian 不针对研发场景、HackMD 不本地 — 现有工具没人解决"AI 生成的研发文档怎么读懂、怎么敲定、怎么不丢"
- **Long-term Vision**: vibe coder 与 AI 共建研发文档时,文档像一份跟项目一起长大的活档案 — 决定段落锁住不被 AI 漂移、每次改写有迹可循、任意 agent 都能挂上来读写状态

### Value System

| Tier | Value | Metric |
|------|-------|--------|
| **Immediate value** | 用户能在浏览器里清晰阅读 plan,选段批注,让 AI 改写并接受 diff | 单次批注→AI 返回耗时(target value, pending validation: <30s);单条批注→AI 改写写回原文的操作步数(target value, pending validation: ≤3 步) |
| **Cumulative value** | 文档随时间累积"决定 + 改写历史 + 执行结果",变成一份有记忆的项目档案 | 单文档累积批注数(target value, pending validation: ≥10 条/月);plan 文档中"已决定"段落比例(target value, pending validation: ≥30%) |
| **Strategic value** | AI 与人共建研发文档,从"AI 一次性生成,改完就丢"变成"段落级有状态的持续协作" | 跨 session 重读旧 plan 找回决定的耗时(no data, no measurement method yet);单份 plan 被重用次数(no data) |

### Core Problem

| Problem | Occurrence Frequency | Per-occurrence Cost | Reach | Existing Workaround |
|---------|----------------------|---------------------|-------|---------------------|
| AI 生成的 200+ 行 plan 在 terminal/editor 里翻不顺,信息层级丢失 | 每次起新 plan(estimated: 每周 2-5 次,based on 作者使用频率) | 5-15 分钟读懂(estimated, 无精确计时) | 用 Claude Code/Cursor/Aider 起 plan 的所有开发者 | 在 IDE 里凑合用 markdown preview 看,没有段落级状态视图 |
| 反复 AI 改写后,搞不清哪些段落定了哪些还在飞 | 每个 plan 进入"敲定"阶段时(estimated: 每个 plan 反复 3-5 次) | 5-10 分钟重新讨论"上次到底定了啥"(estimated) | 同上 | 没有 — 靠记忆或翻 git log |
| AI 在下一轮 rewrite 时悄悄把上次定的改回去(context drift) | 反复 ≥2 次时几乎必发(estimated, 作者高频遇到) | 重新解释决定 + 风险被悄默改写 | 同上 | 无对策 |
| plan 与 execution 脱节,写完散落在 repo,过段时间回来不知道为啥定成这样 | 每个项目周期(estimated: 几周一次) | 10-30 分钟逆向工程决定背景(estimated) | 同上 | 翻 git history + AI session 历史(碎片化) |

### Target Users

| Role | Typical Scenario | Before | After | Estimated Productivity Gain |
|------|------------------|--------|-------|----------------------------|
| 用 Claude Code/Cursor/Aider 做研发的独立开发者(vibe coder) | 让 AI 起草 plan/design/research 文档,反复打磨,然后基于 plan 写代码;过几周回来重读 | terminal 里翻 200 行 plan 头大;改 3 轮分不清谁定了哪些;一周后回来不知道为啥定成这样(estimated, 无精确计时) | 浏览器里清晰阅读、段落级状态(决定/讨论中/草稿)、AI 改写有 diff 可追溯、任意 agent 中立挂载(early prototype, partially validated through dogfood) | pending validation(expected: 每个 plan 周期省 30-60 分钟,决定不再丢失) |

### Competitive Comparison

| Solution | Positioning | Target Users | Core Features | Strengths | Limitations |
|----------|-------------|--------------|---------------|-----------|-------------|
| **scribepad** | 给 vibe coder 的研发文档协作面板 | 用 AI agent 做研发的独立开发者 | 选区批注、AI 改写 + diff、段落级状态(规划中)、多 agent 中立(规划中)、本地 markdown + sidecar JSON | 多 agent 中立、本地优先 + git native、开源 | 个人维护、4 场景模板尚未完整、社区尚未启动 |
| Cursor + .cursorrules + 自写 plan.md | IDE 内 AI 协作开发环境 | Cursor 用户 | 文件感知、agent 改写、规则文件、内嵌 chat | IDE 集成最便利、用户基数大 | 锁定 Cursor、无文档级状态视图、无侧栏批注 |
| Anthropic Claude Code skills + agents | Claude 生态的 markdown 驱动 agent 工作流 | Claude Code 用户 | skills 包封装、subagents、output styles | Anthropic 官方、生态深 | 锁定 Claude、无可视化文档形态 |
| GitHub Copilot Workspace | 微软的 spec→plan→code IDE 工作面板 | 企业 Copilot 用户 | 任务计划编辑器、agent 执行、PR 集成 | 微软全集成、企业向资源 | 闭源、IDE 内、锁定 Copilot、private beta |
| Heptabase | 视觉研究画布 + AI 协作 | 做 research/synthesis 的知识工作者 | 卡片白板、双向链接、AI per card(已接 Claude) | 画布形态成熟、商业化路径清晰 | 卡片不是 markdown、不 git native、闭源 |

## 2. Version Plan

> **Cadence: dogfood-driven**。v0.3 起的版本不预设功能;每版完成后跑 dogfood / alpha gate,通过才进下一版,不通过则停或 pivot。这是低投入路线 + 命题验证优先的诚实兑现。

### Version Summary Table

| Version | Core Direction | Core-Metric Delta | Status | Cycle | Milestones |
|---------|----------------|-------------------|--------|-------|------------|
| v0.1 | 跑通选区批注 + AI 改写 + diff 的端到端闭环 | ↑ 端到端选区批注 0→1;↑ 跨段/跨格式锚点 0→1;↑ e2e 测试 0→36 条(measured) | released | 2026.05.01 - 2026.05.01 | M1-M2 |
| v0.2 — 评论 + 拍板 + 防漂移 | 重建 MVP 评论交互修改 + 拍板锁定 + AI 改写跳过已决定段;dogfood gate | TBD | planning | TBD | M3 |
| v0.3 — TBD by dogfood | 由 v0.2 dogfood gate 反馈决定;候选见 v0.3 详情 | TBD | planning | TBD | M4 |
| v0.4 — alpha 邀请 | 邀请 ≥3 名非朋友 vibe coder 试用 1-2 周;v0.4 末跑 alpha gate | TBD | planning | TBD | M5 |
| v0.5 — 公开发布 | 范围由 alpha gate 反馈定;README + demo + 一次集中曝光 | TBD | planning | TBD | M6 |
| v1.0 — 稳定承诺 | 数据格式 / API / 协议进入稳定承诺,可被第三方建工具 | TBD | planning | TBD | M7 |

### Version Details

#### v0.1 — 核心闭环验证

- **Strategic intent**: 验证核心假设 — 能否在浏览器里给 vibe coder 提供选区批注 + AI 改写 + diff 接受的端到端体验,且选区与 markdown 源码偏移可靠对应。这是后续所有版本的地基,跑不通则项目不成立
- **Input/Output**: Invest 个人时间 ~3 天(actual)→ 跑通选区批注→AI 改写→diff→写回原文的端到端闭环;支持跨段、跨内联格式选区(actual,通过 mdast 源码 offset 锚点实现)
- **Priority rationale**: 核心闭环未跑通时,后续所有版本都没意义;无外部依赖,可立即开干
- **Risks and dependencies**: Dependencies: claude CLI 可用;risks: 选区→源码 offset 在 markdown 渲染态下的稳定定位 — 通过引入 mdast-util-from-markdown + data-src 偏移已解决
- **Success metric**: e2e 端到端跑通 ≥30 条用例;dogfood 跑过 ≥1 份真实 plan;跨段、跨内联格式选区均可创建批注
- **Core value**:
  1. 第一次能在浏览器里干净阅读 markdown,选区驱动批注
  2. 第一次 AI 改写有 diff 可视化,可接受 / 取消
  3. 第一次跨段、跨内联格式选区也能批注
- **User coverage**: author dogfood
- **Core metric**(无前版 → v0.1):

| Metric | (无前版) | v0.1 | Delta | Source |
|--------|----------|------|-------|--------|
| e2e 测试用例数 | — | 36 条 | 新基线(measured) | e2e.mjs |
| 跨段选区可用 | — | 是 | 新基线(measured via test 2.6) | e2e.mjs |
| sidecar JSON 锚点格式 | — | { srcStart, srcEnd, text } | 新基线(measured) | reader.js |

#### v0.2 — 评论 + 拍板 + 防漂移

- **Strategic intent**: 验证 wedge — "拍板锁定 + AI 改写时跳过已决定段"是否真能解决 vibe coder "AI 反复改飞、决定丢失"的痛点。**这是项目的核心命题**;若 dogfood gate 不通过则停或重做,不硬上 v0.3。**v0.2 范围严格收敛至此 — 22 轮探索性讨论中浮现的 audit dashboard / AI 摘要 / 5 sidebar 组件 / inline 编辑 / 版本归档等富功能,全部 defer 到 v0.3+(详见 [docs/decision/v0.2-scope.md](./decision/v0.2-scope.md))**
- **Input/Output**: Invest 工程量 ~4 天(estimated, 业余每周 5-10h, 日历 4-6 周)→ 重建 MVP 核心(选区评论 + AI 改写 + diff modal + sidebar 批注列表)+ 拍板状态机(2 态 draft/decided)+ AI 改写时 prompt 自动 exclude state=decided 段
- **Priority rationale**: v0.1 已删 MVP 代码,foundation 已就绪;dogfood 中作者高频遇到"AI 把上次定的改回去"的痛点 — 这是 scribepad 区别于通用 markdown 工具的核心区分点;无外部依赖
- **Risks and dependencies**: Dependencies: 无外部依赖;risks: 用户感知不到"拍板防漂移"的真实价值,wedge 失效命题被否(预案:停或重做);risks: 22Q 讨论中浮现的更宏大产品方向被压回 v0.3+,可能事后被证明 v0.2 太瘦
- **Success metric**: 7 个功能(基础 5 + 新加 2)端到端可用;**Gate(dogfood ≥1 个月):作者写 ≥1 份真实 plan(scribepad 项目自身的下版 plan 即可),使用"拍板" ≥10 次,self-report"AI 漂移焦虑"显著下降。Gate 不通过 → 停或重做 v0.2,不进 v0.3**
- **Core value**:
  1. 第一次能在新底座(Vite + TS)上完成 v0.1 baseline 功能(评论交互修改可用)
  2. 第一次段 / 选区有显式状态(draft / decided)
  3. 第一次已决定段被 AI 改写时显式跳过,**这是 scribepad 与通用 markdown 工具的核心区分点**
- **User coverage**: author dogfood
- **Core metric**(v0.1 → v0.2):

| Metric | v0.1 | v0.2 | Delta | Source |
|--------|------|------|-------|--------|
| 状态枚举数 | 0 | 2(draft/decided) | 新基线(target value, pending validation) | TBD |
| 已决定段防漂移成功率 | n/a | 100% | 新基线(target value, pending validation) | TBD |
| dogfood 中"AI 漂移"投诉次数(self-report) | 高(estimated) | <1/周 | 显著下降(target value, pending validation) | dogfood log |
| 拍板使用次数 | 0 | ≥10/月 | 新基线(target,gate 阈值) | sidecar log |

#### v0.3 — TBD by v0.2 dogfood gate

- **Strategic intent**: 由 v0.2 dogfood gate 反馈决定本版主题;不预设承诺,这是 dogfood-driven cadence 的诚实兑现
- **Input/Output**: TBD,见候选方向 — 每个候选自身有独立投入产出评估,v0.2 完成后再选定
- **Priority rationale**: 前置依赖 v0.2 gate 通过;v0.2 不通过则 v0.3 不存在(项目停或重做)
- **Risks and dependencies**: Dependencies: v0.2 gate 通过;risks: 候选方向之间互相挤占,选择哪个会影响 v0.4 alpha 范围
- **Success metric**: TBD — 由 v0.3 选定方向时定义;不允许事后定义
- **Core value**: TBD pending v0.2 dogfood feedback。**候选方向**(v0.2 完成后选 1 个,不堆叠):
  1. **多 agent + MCP server**(若 dogfood 中"想换 agent 试试"频次高)
  2. **plan→exec 闭环**(若"决定段没法直接发任务给 agent"成痛点)
  3. **批注线程 / 多轮对话**(若"批注一来一回不够"频繁)
  4. **场景模板深化**(若 plan 用熟想做 design / research 模板)
- **User coverage**: author dogfood
- **Core metric**(v0.2 → v0.3):

| Metric | v0.2 | v0.3 | Delta | Source |
|--------|------|------|-------|--------|
| 选定方向 | n/a | TBD | 新基线 | v0.2 dogfood log |
| 该方向核心指标 | TBD | TBD | TBD | TBD |
| dogfood 累积批注数 | TBD | TBD | TBD | sidecar |

#### v0.4 — alpha 邀请

- **Strategic intent**: 验证项目第二个核心命题 — "vibe coder 真的需要这种工具"。作者样本 n=1,需要 ≥3 个非朋友用户的真实使用反馈才能决定是否进 v0.5 公开发布
- **Input/Output**: Invest 工程量 ~1 周打磨可邀测体验 + ~2 周观察期(estimated, 4-6 周日历)→ 邀请 ≥3 名非朋友 vibe coder 安装 + 使用 1-2 周;收集反馈
- **Priority rationale**: v0.5 公开发布前必须有外部验证,否则发布无意义;前置依赖 v0.3 完成
- **Risks and dependencies**: Dependencies: v0.3 完成 + 找到愿意试用的 ≥3 名 vibe coder;risks: 邀请到的用户不真实使用(只看一眼),反馈无意义
- **Success metric**: **Gate(1-2 周):≥2 个用户在 1 周内有真实 dogfood 使用记录(查 sidecar 文件)+ 提 ≥3 条可执行反馈(不是礼貌话)。Gate 不通过 → 停或 pivot,不进 v0.5**
- **Core value**:
  1. 第一次有外部用户验证项目命题
  2. 第一次有非朋友的真实反馈数据
  3. 第一次基于真实使用决定 v0.5 范围
- **User coverage**: 邀请 ≥3 名非朋友 vibe coder(预期通过个人渠道 / 社群)
- **Core metric**(v0.3 → v0.4):

| Metric | v0.3 | v0.4 | Delta | Source |
|--------|------|------|-------|--------|
| 邀请用户数 | 0 | ≥3 | 新基线(target) | invitation log |
| 真实使用用户数 | 0 | ≥2 | 新基线(target) | sidecar 文件检查 |
| 可执行反馈条数 | 0 | ≥3 | 新基线(target) | feedback log |

#### v0.5 — 公开发布

- **Strategic intent**: 完成项目从"作品集 demo"到"有真用户的开源项目"的过渡;在 12-18 个月时间窗内出曝光节点
- **Input/Output**: Invest 工程量 ~2-3 周(estimated, 4-6 周日历) → 完整 README + demo gif + docs 站 + alpha 反馈采纳的功能;一次集中曝光(HN / Twitter / V2EX)。**范围由 alpha gate 反馈决定**:哪些场景模板进 v0.5、demo 围绕哪个使用场景、文档强调哪些差异化
- **Priority rationale**: alpha 通过 = 命题已外部验证,可发布;时间窗 12-18 个月,需在窗内出节点;前置依赖 v0.4 alpha gate 通过
- **Risks and dependencies**: Dependencies: v0.4 alpha 通过;risks: 曝光后 issue 量超过个人可处理范围;risks: alpha 邀测用户与公开用户群差异大,反馈不具代表性
- **Success metric**: 公开发布完成;HN / Twitter / V2EX 各 1 次推文;GitHub stars ≥100 或 ≥1 名非邀测用户提 issue / PR
- **Core value**:
  1. 第一次面向更广用户群曝光
  2. 第一次有完整对外文档
  3. 第一次接受外部 issue / PR
- **User coverage**: 公开发布;HN / Twitter / V2EX 各 1 次推文
- **Core metric**(v0.4 → v0.5):

| Metric | v0.4 | v0.5 | Delta | Source |
|--------|------|------|-------|--------|
| GitHub stars | 0 | ≥100 | 新基线(target value, pending validation) | GitHub |
| 非邀测 issue / PR 数 | 0 | ≥1 | 新基线(target value, pending validation) | GitHub |
| 已纳入的 alpha 反馈条数 | 0 | TBD | 新基线 | release notes |

#### v1.0 — 稳定承诺

- **Strategic intent**: 把数据格式 / API / 协议升级为"承诺稳定",让别人能基于 scribepad 写工具、写文章、迁移工作流。这是项目从"有真用户的开源项目"升级到"基础设施候选"的门槛
- **Input/Output**: Invest 维护型(estimated, 业余每周 1-3h)→ API 稳定承诺、迁移文档、若有真实贡献者 PR 则 merge
- **Priority rationale**: 必须等 v0.5 公开后,有 ≥6 个月真实使用反馈,才能决定 API 稳定形态;前置依赖 v0.5 + ≥6 个月观察期
- **Risks and dependencies**: Dependencies: v0.5 公开后 ≥6 个月观察期 + 真实使用反馈;risks: 公开后无人持续使用,稳定承诺无意义,该停项目
- **Success metric**: 数据格式 / API / MCP tool 集稳定 ≥6 个月无破坏性变更;6 个月内被引用 / 转发 / fork ≥个位数次
- **Core value**:
  1. 第一次 API 进入稳定承诺,第三方可基于其建工具
  2. 第一次有完整迁移指南
  3. 第一次正式接受外部 PR
- **User coverage**: 公开,接受社区贡献
- **Core metric**(v0.5 → v1.0):

| Metric | v0.5 | v1.0 | Delta | Source |
|--------|------|------|-------|--------|
| API 稳定承诺期 | 0 | ≥6 个月 | 新基线(target value, pending validation) | release notes |
| 接受的外部 PR 数 | 0 | ≥1 | 新基线(target value, pending validation) | GitHub |
| 项目持续 ≥12 个月活跃 | n/a | 是 | 新基线(target value, pending validation) | self |

## 3. Milestones

| # | Core Direction | Goal Achievement | Status | Completion Date |
|---|----------------|------------------|--------|-----------------|
| [M1](milestones/m1.md) | 跑通选区批注 + AI 改写 + diff 的端到端闭环 | 端到端可用;sidecar JSON 锚点(before/selection/after 三段匹配)落地;e2e 通过 | completed | 2026-05-01 |
| [M2](milestones/m2.md) | 用 mdast 源码 offset 重写锚点系统,解开跨段/跨格式选区 | 跨段、跨内联格式选区均可创建批注;36 条 e2e 含 cross-element 用例,全部通过 | completed | 2026-05-01 |
| [M3](milestones/m3.md) | 实现段落级状态机(草稿/讨论中/已决定/已执行)及防漂移 + dogfood gate | — | not started | — |
| [M4](milestones/m4.md) | v0.3 by dogfood gate(具体方向 v0.2 后定) | — | not started | — |
| [M5](milestones/m5.md) | alpha 邀请 ≥3 名非朋友 vibe coder + alpha gate | — | not started | — |
| [M6](milestones/m6.md) | 公开发布(README + demo + HN/Twitter/V2EX 曝光) | — | not started | — |
| [M7](milestones/m7.md) | API 稳定承诺 + 接受社区贡献 | — | not started | — |
