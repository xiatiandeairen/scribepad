# 架构设计

## 范围

本文定义系统层级、唯一职责、依赖方向和扩展边界，不维护文件清单、HTTP 路由清单或
可从代码推导的实现细节。

## 层级模型

```text
Browser / CLI
  → Delivery
  → Application
  → Core → Port → Adapter
```

| 层级 | 唯一职责 |
| --- | --- |
| Browser / CLI | 发起审阅、展示状态、收集人的决定 |
| Delivery | 把 HTTP、SSE 和 CLI 输入转换为应用调用 |
| Application | 管理文档会话并编排用例 |
| Core | 抽取、验证、改写和稳定标签等平台无关规则 |
| Port | 定义 Core/Application 需要的外部能力 |
| Adapter | 实现文件、状态、导出与 LLM 等外部边界 |

浏览器只通过 HTTP 契约访问服务端；Core 不依赖 Delivery、具体 Adapter 或 UI。
Composition Root 是唯一知道具体实现并完成依赖组装的位置。

## 文档状态

Markdown 源是内容事实源，抽取结果每次从源文档重算。持久化只保存用户产生的审阅状态，
例如批注和签字；改写必须先写回 Markdown，再重新抽取。

文档会话是唯一运行入口。每个面板 URL 指向明确的 session，不维护“当前文档”全局
fallback，也不提供离线数据双轨。

## 扩展约束

- 新外部能力通过 Port/Adapter 接入，不把平台条件带进 Core。
- 新用例复用同一会话、抽取、写回和导出生命周期，不建立旁路。
- 同一概念只保留一个实现形状；迁移完成后直接删除旧路径和兼容层。
- 类型契约位于无运行时依赖的共享层，浏览器与服务端不直接引用彼此实现。

## 变更门禁

- 新职责具有唯一所有者，依赖保持单向。
- Core 边界由 ESLint 和独立 TypeScript 配置共同验证。
- 产品行为变化同步更新对应 Design；实现细节由代码与测试维护。
- 目录迁移一次完成，不保留兼容 import、旧路由或双写逻辑。
