# Review: dogfood 闭环——plan-review skill、反馈双入口与审阅面板接线全部交付

> plan: $XDG_STATE_HOME/scribepad/plans/-Users-taoxia-Workspace-self-scribepad/20260709-dogfood-loop.md · commits: 1695f6c..4ebb161（18 个）· 日期: 2026-07-09
> 门禁: typecheck ✅ · lint ✅ · unit 248 ✅ · e2e 12 ✅ —— 复核: `npm run typecheck && npm run lint && npm test && npm run test:e2e`
> 建议路径: §1 裁决(5min) → §2 对账(3min) → §4 签字(2min)；§3/§5 供抽查

## 1. 需要你裁决（按风险降序，≤7 项）

### D1. [擅自决策] feedback CLI 子命令与同名文件冲突时，让真实文件优先

- **背景**：实现 `scribepad feedback` 时发现 cwd 下若存在字面名为 `feedback` 的文件，`scribepad feedback` 语义歧义，plan 未覆盖
- **我选了**：`existsSync(resolve('feedback'))` 为真时按打开文档处理，子命令让位
- **备选**：加 `--` 分隔符强制区分——对用户多一层记忆负担
- **为什么没停下来问**：两条路径都可逆，且文件优先与 `scribepad <path>` 主语义一致
- **若否决**：回退成本低，影响仅 CLI 入口一个分支
- **证据**：1beeee6 / server/index.ts:31

### D2. [对外行为] 反馈附件写入顺序改为 attachments 先、inbox 行最后

- **背景**：review 发现附件写一半失败时会留下指向空目录的 inbox 孤行
- **我选了**：inbox 行作为"报告存在"的持久信号，必须最后落盘
- **备选**：写入失败后回滚删除 inbox 行——多一次 IO 且窗口内仍可见脏行
- **为什么没停下来问**：不改变对外 API 形状，仅调整持久化顺序
- **若否决**：回退成本低，影响 feedback-sink-fs 单文件
- **证据**：d03159c / server/adapters/feedback-sink-fs.ts:44

### D3. [性能] DOM 快照截断改为代理对安全的字符边界回退

- **背景**：`slice(0, MAX)` 可能切在 UTF-16 代理对中间产出非法半字符
- **我选了**：截断点若落在高位代理上则回退一位
- **备选**：按字节截断后整体重编码——复杂度不成比例
- **为什么没停下来问**：纯防御性修正，无行为争议
- **若否决**：回退成本低，影响 client-next 截断函数一处
- **证据**：4ebb161 / client-next/review-net.jsx:149

## 2. 计划对账

| plan 条目 | 状态 | 说明 |
| --- | --- | --- |
| plan-review skill（XDG 路径编码 + --wait 桥接） | ✅ 按计划 | — |
| 面板反馈弹层 + 快捷键 | ✅ 按计划 | — |
| feedback CLI 子命令 | ⚠ 有偏差 | 同名文件冲突处理 → D1 |
| 附件 extractSnapshot 字段 | ❌ 未做 | 无消费方，砍掉 → L3 |
| （plan 外）console 环形缓冲上限 20 条 | ➕ 新增 | UI 反馈需要现场错误 → D2 |

> 承诺：本表逐条覆盖批准稿全部条目，无遗漏。

## 3. 声明与证据

| # | 声明 | 证据 | 核验方式 |
| --- | --- | --- | --- |
| C1 | 全部 248 个单测通过 | vitest run 输出 | `npm test` → 248 passed |
| C2 | 反馈附件写失败时不留 inbox 孤行 | tests/unit/feedback-sink-fs.test.ts | `npx vitest run tests/unit/feedback-sink-fs.test.ts` → 全绿 |
| C3 | e2e 彩排覆盖"审阅改变执行"全链路 | tests/e2e/plan-review-rehearsal.spec.ts | `npm run test:e2e` → 12 passed |
| C4 | skill 在多 worktree 下路径不冲突 | ⚠ unverified | 需要两个真实 worktree 场景，本轮未搭建 |

## 4. 遗留与假设（需签字："我知道这些没做"）

- **L1 [deferred]** 独立核验 agent（对冲执行者自述偏差） —— 触发条件：抽查发现 ≥1 次证据错误
- **L2 [假设]** 面板 DOM 快照 20k 字符足够还原 UI 问题现场 —— 验证方式：连续 3 条 UI 反馈都无需追问上下文
- **L3 [已知限制]** 反馈附件不含 extract 结果快照，分析会话需自行重算

## 5. 变更明细（下钻用，可整节跳过）

- `1beeee6` fix(cli): 同名文件优先于 feedback 子命令 — server/index.ts
- `d03159c` fix(server): 附件先写、inbox 行后写 — server/adapters/feedback-sink-fs.ts
- `4ebb161` fix(client): 代理对安全截断 — client-next/review-net.jsx
