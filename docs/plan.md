# scribepad 0.2.0 执行计划

> **状态**:building
> **生成日期**:2026-05-06
> **主题**:自动降级的 Plan Review System。

## 1. 产品焦点

0.2.0 的核心对象不是任意选区，而是稳定的 plan 信息点。它要帮助用户：

1. 看清长 plan 的结构和优先级。
2. 发现真正会影响执行的缺口。
3. 确认或锁定关键范围、决策、验证和风险。
4. 在文档结构较弱时自动降级，不把轻量 plan 硬套成完整执行计划。

## 2. 本期范围

### 会做

- 规则化抽取 plan 信息点：`goal / scope / behavior / verification / open-question`。
- 自动判定 review mode：
  - `structured`：完整 readiness 检查。
  - `annotation-only`：隐藏 plan review，保留批注/改写/拍板。
- 信息点状态：`open / locked / stale`。
- 主阅读区左侧 status rail：在原文位置展示信息点类型和状态。
- 右侧 `Plan Review`：进度、issue、分组信息点、当前信息点详情与操作。
- sidecar 持久化 `planState`，并保留现有 `annotations`。

### 不做

- AI 自动全文审计。
- 完整 dashboard 工作台。
- inline markdown 编辑器。
- 强制阻止保存 / 强制 diff merge。
- 多模板 / 多文档 / 版本归档。

## 3. 设计

### 3.1 数据流

```mermaid
flowchart LR
  MD[markdown source] --> Inspector[plan-inspector]
  State[sidecar planState] --> Inspector
  Inspector --> Mode[ReviewMode]
  Inspector --> Rail[Inline Status Rail]
  Inspector --> Panel[Plan Review]
  Panel --> Action[lock / reopen]
  Action --> API[/api/plan-state]
  API --> Sidecar[.{file}.annotations.json]
```

### 3.2 信息点

信息点由前端规则化解析生成，不直接落盘；落盘的是用户对信息点的状态。

| 字段 | 说明 |
|---|---|
| `id` | 基于 kind + source offset 的稳定 id |
| `kind` | 信息点类型 |
| `text` | 展示文本 |
| `textHash` | 用于 locked 后检测 stale |
| `blockId/srcStart/srcEnd` | 对应原文位置 |
| `status` | 从 sidecar `planState` 合并得出 |

### 3.3 Sidecar

```json
{
  "version": 3,
  "annotations": [],
  "planState": [
    {
      "id": "scope:120",
      "status": "locked",
      "textHash": "abc",
      "updatedAt": "2026-05-06T00:00:00.000Z"
    }
  ]
}
```

写 annotations 时必须保留 planState；写 planState 时必须保留 annotations。

### 3.4 Readiness

强检查只在 `structured` 模式启用。无法识别 Review 目录时进入 `annotation-only`，只提示用户手动触发规范化。

## 4. 实现任务

| # | 任务 | 文件 |
|---|---|---|
| 1 | 定义 plan state 类型与 API 契约 | `types/plan.ts`, `types/api.ts`, `types/annotation.ts` |
| 2 | sidecar planState 读写与路由 | `server/services/annotations.ts`, `server/routes/plan-state.ts`, `server/routes/sessions.ts` |
| 3 | 信息点抽取 / mode 判定 / stale 检测 | `src/lib/plan-inspector.ts` |
| 4 | Calm Review + Inline Status Rail | `src/components/PlanPanel.tsx`, `src/components/Reader.tsx`, `src/App.tsx`, `src/styles/main.css` |
| 5 | 验证覆盖 | `tests/unit/plan-inspector.test.ts`, `tests/unit/state-machine.test.ts`, `tests/e2e/p0.spec.ts` |

## 5. 验证标准

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:e2e -- tests/e2e/p0.spec.ts`

P0 验收：

- 打开 plan 文档能看到 `Plan Review`。
- structured plan 能显示 status rail 和信息点。
- 信息点可锁定，刷新后状态恢复。
- 轻量 plan 不强报缺目标/缺范围。
- locked 信息点文本变化后标记 stale。
- 现有批注、AI 改写、拍板、防漂移 P0 流程不回退。

## 6. 后续机会

- AI auto-audit：基于当前 PlanItem 输入输出建议缺口。
- 信息点点击创建批注。
- locked 信息点强制写回确认。
- 多模板：从 plan 扩展到 design / research / analysis。
