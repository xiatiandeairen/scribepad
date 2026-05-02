# scribepad Technology Selection

> 锁定 scribepad v0.2-v1.0 演进期的技术选型。**只决定"用什么"(tech),不决定"怎么用"(architecture / interface / schema design)** — 后者留给迁移 sprint。
>
> 状态:**18 项 accepted**(2026-05-01)。3 个 deferred 项有显式触发条件,未来 sprint 重新评估。

## 范围

| 决定 | 不决定 |
|------|-------|
| 各层用什么 tech / 库 / 协议 | 怎么组织代码(模块切分、目录结构) |
| 版本约束 | 怎么设计接口(adapter / MCP tool 形态) |
| 拒绝其他候选的理由 | 怎么设计数据 schema(具体字段) |
| deferred 项的触发条件 | lint / prettier / CI 的 config 内容 |
| | 迁移步骤 / 顺序 / 风险 |

## 共享原则(所有决策的隐含约束)

- **不破坏 36 条 e2e 测试**(产品规格的可执行表达)
- **多 agent 中立**(不绑死某个 LLM vendor)
- **local-first + git friendly**(产品 DNA)
- **业余每周 5-10h 投入**(低投入约束)
- **作品集质感**(代码 / 工具链 / CI 是对外信号)

## 1. 前端层

### F1 · 构建系统 → **Vite 5**

**版本**:Vite ^5.x(latest stable)
**为什么**:F3 选 TS 后必须有编译流程。Vite HMR 快(<100ms)、配置默认就够、与 React + TS 生态成熟。
**拒绝其他**:
- esm.sh 无构建 — 不能跑 TS;选 F3 后必淘汰
- esbuild 单用 — 是 bundler 不是 dev server,自己包就是重造 Vite
- Webpack — 配置文件长度劝退

**已知风险**:Vite 引入意味着 `npx scribepad` 依赖构建产物。**对策**:发布前 build,用户运行的是产物。

---

### F2 · UI 框架 → **React 18 + JSX**

**版本**:react ^18.3 / react-dom ^18.3。**htm 移除,改用 JSX(由 Vite + TypeScript 处理)**。
**为什么**:既有 5 个 React 组件 + 36 条 e2e 测试针对当前实现。换框架 = 重写组件 + 重写测试,收益不抵成本。React 18 + JSX 是 TS 生态最成熟路径。
**拒绝其他**:
- Solid — fine-grained reactivity 是真优势,但 scribepad 不是 perf-bound 场景
- Svelte — 与 Vite 强耦合,迁移更深;e2e 全要重写
- Preact — bundle 小一点,本地工具不在意 bundle size

**已知风险**:几乎无。

---

### F3 · 类型系统 → **TypeScript 5 strict**

**版本**:typescript ^5.x。`tsconfig.json` 启用 `strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitOverride`。
**为什么**:scribepad 的核心是数据 schema(Annotation / Anchor / RewriteRequest 等)。这些字段会在 v0.2-v1.0 演进。TS 让 schema 变更是"编译报错"而非"运行时崩"。
**拒绝其他**:
- JSDoc — 类型推断弱(嵌套 generics、conditional types 表达力差),作品集质感低于真 TS
- 纯 JS — 短期省事,但 v0.2 schema + v0.3 adapter 接口都需要类型契约;补 TS 时成本是现在的 3-5 倍

**已知风险**:TS 编译 + 类型推导引入的开发摩擦,可能拖慢 1-2 周。**这是真成本**,但作品集动机下值得。

---

### F4 · 状态管理 → **useState + useReducer(不引库)**

**版本**:React 内置 hooks。
**为什么**:当前 App 组件 ~9 个 useState,v0.2 加状态机后 ~12 个。仍在单组件 hooks 范围内。判定阈值:全局共享、跨组件状态 ≥10 个,或 prop drilling ≥3 层 → 才上状态库。当前两个都不满足。
**拒绝其他**:
- Zustand — 简洁但仍是依赖 + API 表面;defer
- Jotai / Recoil — 编程模型变化大
- Redux — boilerplate 灾难

**已知风险**:v0.3 选了"批注线程"或"多 agent 横评"后,状态可能爆炸,需要回头加状态库。可接受 — defer 决策好于过早抽象。

---

### F5 · Markdown 引擎 → **mdast-util-from-markdown(继续)**

**版本**:^2.x(继续现版本)。
**为什么**:已工作 + 36 条 e2e 通过 + 跨段/跨格式选区核心机制依赖于此。换 = 重写锚点系统。
**拒绝其他**:
- unified + remark plugins — 当前不需要 footnote/GFM table 等扩展;需要时直接加 plugin,不需换底层

**已知风险**:几乎无。

---

### F6 · CSS → **CSS variables + 单文件(继续)**

**版本**:无依赖,纯 CSS。
**为什么**:当前 ~150 行 CSS,简洁可读,维护成本极低。
**拒绝其他**:
- Tailwind — utility-first 学习曲线 + build 复杂度,与 vibe coder OSS 美学错位
- CSS-in-JS — runtime 开销 + 与 git friendly 文本工具链冲突
- CSS Modules — Vite 默认支持,可未来加,defer

**已知风险**:CSS 涨到 ~500 行难维护时再考虑 CSS Modules。

---

## 2. 后端层

### B1 · Runtime → **Node 22+ LTS(继续)**

**版本**:Node `>=22 <23` LTS。
**为什么**:目标用户(vibe coder)绝大多数已装 Node(Cursor / Claude Code 自身依赖)。再加 Bun/Deno = 增加用户安装成本 = 损失潜在用户。
**拒绝其他**:
- Bun — 启动快、内置 TS。但生态成熟度未到 LTS,某些 npm 包行为不一致
- Deno — npm 兼容性历史遗留 + 用户基数小
- Rust 重写 — 单二进制分发是真优势,但 1-2 周成本严重违背低投入

**已知风险**:几乎无。

---

### B2 · HTTP 框架 → **Hono 4(继续)**

**版本**:hono ^4.x、@hono/node-server ^1.x。
**为什么**:已工作。Hono API 简洁、TS 友好、性能好。
**拒绝其他**:
- Express — 类型生态弱、middleware 模型老
- Fastify — 同档无收益换框架
- Bare http — 自己写路由是反模式

**已知风险**:几乎无。

---

### B3 · 后端类型 → **TypeScript 5(与前端统一)**

**版本**:同 F3。dev 用 tsx 或 ts-node;生产 build 时编译为 JS。
**为什么**:数据 schema 跨前后端共享(annotation 在 server 读写、client 渲染)。前端 TS、后端 JS = 类型契约割裂,schema 改一处不能全栈生效。
**拒绝其他**:保持 JS — 严重违背"统一栈"价值。

**已知风险**:dev workflow 配置(tsx vs ts-node)。Hono 官方文档 TS 优先,标准路径走通。

---

## 3. Agent 层

### A1 · LLM 调用方式 → **CLI 子进程(继续 `claude -p`)**

**版本**:仍走 `child_process.spawn('claude', ['-p', prompt])`。
**为什么**:用户已装 Claude Code 即可用,无需配 API key。符合"用用户已有 agent"原则。
**拒绝其他**:
- 直接调 Anthropic SDK / OpenAI SDK — 要求用户配 API key,违背 local agent 原则
- HTTP API gateway 自建 — 自己运维,违背 local-first

**已知风险**:几乎无(短期)。

---

### A2 · 多 agent 协议 → **deferred 到 v0.3**

**当前实现**:仅 ClaudeCli 单实现。
**触发条件**(满足任一即在 v0.3 重启决策):
1. v0.2 dogfood gate 通过 + dogfood 中真出现"想换 agent 试试"的需求
2. 用户社区提出明确的多 agent 需求

**候选**(到时再选):
- a) 多 CLI Adapter(claude / cursor / aider 各一个 cmd 包装)
- b) MCP 协议(如 A3 通过)
- c) LLM Provider SDK 直连

**已知风险**:延迟决策意味着 v0.3 启动时需要重构。**这是好事** — 真实驱动设计胜过想象中设计。

---

### A3 · MCP Server → **deferred 到 v0.3**

**当前实现**:无 MCP server。
**触发条件**(同时满足):
1. v0.2 gate 通过
2. MCP 协议进入 RC 或 stable
3. 用户社区有"想从 Claude Code 反向读 scribepad 状态"的真实需求

**已知风险**:不做 MCP = 当下不能讲"多 agent 中立"的强故事,但可以讲"adapter 抽象 + CLI 调用"的弱故事。

---

## 4. 数据层

### D1 · 主存储 → **sidecar JSON(继续)**

**版本**:`.{filename}.annotations.json`。
**为什么**:git friendly + local-first 是产品 DNA。SQLite 是二进制 blob,git diff 看不懂。SQLite 能给的(查询、索引)scribepad 不需要(单文档批注 ≤100 条)。
**拒绝其他**:
- SQLite — 破坏 git friendly
- 云数据库 — 违背 local-first

**已知风险**:几乎无。

---

### D2 · Schema Source of Truth → **TypeScript types**

**版本**:TS interface / type 直接作为 schema 来源;运行时校验工具(若加)从 TS 派生(如 zod)。
**为什么**:TS 表达力强(conditional types、infer、generic),JSON Schema 单向可生成。一份 source of truth,前后端共用。
**拒绝其他**:
- JSON Schema 主导 — 表达力弱
- 无 schema — 类型混乱

**已知风险**:几乎无。

---

### D3 · 运行时 Schema 校验 → **deferred**

**当前实现**:无运行时校验,信任前端发出 JSON 形态正确。
**触发条件**:scribepad 开始接受非自家代码写入(如 MCP server 暴露写接口给外部 client)。
**候选**(到时再选):
- a) zod(主流,生态最强)
- b) valibot(更轻量,新)
- c) 不做(若 MCP 不开写)

**已知风险**:不加校验 = 数据格式被外部工具污染时无 fail-fast。**单机单用户场景下风险低**。

---

### D4 · 缓存 / 索引 → **不引入**

**为什么**:单文档 ≤100 批注,JSON.parse <1ms,引索引层是过度优化的标本案例。
**拒绝其他**:
- SQLite 索引层 — 违反 D1 + 过度优化

**已知风险**:几乎无。

---

## 5. 测试 + 工具链

### T1 · E2E → **Playwright(继续)**

**版本**:playwright ^1.x。
**为什么**:36 条用例 = 产品规格的可执行表达。重构期跑绿 = 迁移 sprint 的 sanity gate,绝对不能丢。
**拒绝其他**:换框架(Cypress / WebdriverIO)= 重写测试,损失 spec 资产。

**已知风险**:几乎无。

---

### T2 · 单元测试 → **Vitest**

**版本**:vitest ^2.x(latest stable)。
**为什么**:Vite 生态原生,API 与 Jest 兼容,TS native,启动快(<1s)。v0.2 状态机有逻辑(状态转移、防漂移条件、history 记录),逻辑单测胜过 e2e 跑全栈。
**拒绝其他**:
- Jest — 配置重(尤其 TS),启动慢
- Node test runner — 内置但生态弱(snapshot、watch、UI 都不如 Vitest)

**已知风险**:若 v0.2 逻辑极简(就 4 个 state 转移),Vitest 单测可能 <10 条。**仍值得有**(作品集质感),但不为凑数硬写。

---

### T3 · Lint → **ESLint 9 + Prettier**

**版本**:eslint ^9.x、prettier ^3.x、typescript-eslint ^8.x。
**为什么**:作品集场景陌生人 clone repo 第一眼看格式。ESLint 9 主流 + TS 集成好。Prettier 解决格式无脑化。
**拒绝其他**:
- Biome — Rust 实现速度快,但 plugin 生态边际,某些 ESLint rule 还没等价物。新工具,作品集"不出圈"
- 不做 — 开源代码未 lint 是负作品集信号

**约束**:用 typescript-eslint recommended + prettier 默认 + 不为自定义 rule 花超过 1 小时。
**已知风险**:ESLint config bikeshedding 风险,需自我克制。

---

### T4 · 包管理 → **npm**

**版本**:npm ^10.x(Node 22 LTS 内置)。
**为什么**:目标用户默认有 npm。pnpm/yarn 用户基数远小,降低 clone-and-run 比例。
**拒绝其他**:
- pnpm — 节省磁盘 / 严格依赖。本项目依赖少(≤10 个),收益边际
- yarn — 无明显优势

**已知风险**:几乎无。

---

### T5 · CI → **GitHub Actions**

**版本**:平台 = GitHub Actions(项目托管 GitHub 即用)。
**三道闸**:lint(ESLint + Prettier check)、typecheck(`tsc --noEmit`)、e2e(Playwright headless)。
**为什么**:开源项目无 CI = 代码质量未知信号。三道闸是开源前置。
**拒绝其他**:
- 不做 — 不可接受
- CircleCI / GitLab CI — 项目托管 GitHub,跨平台无意义

**已知风险**:e2e 在 CI 跑可能 flaky。**对策**:启动 server 时显式 wait + retry 配置(到迁移 sprint 落地)。

---

### T6 · Pre-commit Hook → **lefthook(候选)或 不做**

**候选 1**:lefthook(单二进制,轻量)
**候选 2**:不做(个人项目可接受)
**为什么 lefthook 优先**:防格式 / 类型错的代码进 git。lefthook 比 husky 轻(单二进制 vs Node script + git hook chain)。
**拒绝其他**:
- husky — 配置略重(每个 hook 一个 shell script)

**最终决定**:延后到迁移 sprint 末再决定加不加(非 critical)。

---

## Deferred 决策汇总

| ID | 名称 | 触发条件 |
|----|------|---------|
| A2 | 多 agent 协议形态 | v0.2 gate 通过 + 真出现多 agent 需求 |
| A3 | MCP server 上线 | v0.2 gate 通过 + MCP 协议进 RC/stable + 社区需求 |
| D3 | 运行时 schema 校验 | 接受非自家代码写入(如 MCP 暴露写) |
| T6 | Pre-commit hook | 迁移 sprint 末再决定加不加 lefthook |

## 我可能错的(已认知的不确定性)

| 决策 | 我可能错的原因 | 错了怎么办 |
|------|--------------|----------|
| F3 TypeScript | 若优先速度而非作品集质感,TS 拖慢 1-2 周 | 改 JSDoc 折中,保留类型注解能力 |
| F4 不引状态库 | v0.3 状态可能爆炸,需要回头 | 出现 prop drilling ≥3 层 / 状态 ≥10 时引 Zustand |
| T2 Vitest 必要性 | 若 v0.2 逻辑极简,单测沦为凑数 | 实施时若 ≤5 条单测可砍,保留 Vitest 配置但不强制 |
| F2 不换框架 | 若想拿 Solid/Svelte 作作品集亮点 | trade-off 不抵 e2e 重写,但合理选择 |
| A2/A3 全 defer | 可能希望现在硬决一边 | v0.3 启动时基于 dogfood 数据决定,不在选型层面赌 |

---

*Last updated: 2026-05-01*
*Decisions are L2 granularity (specific tech + version + rationale). Architecture / interface / schema design intentionally deferred to migration sprint.*
