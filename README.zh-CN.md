# scribepad

[English](./README.md) | **中文**

scribepad 是给 vibe coding plan 用的本地 Review 面板。它把很长的 Markdown plan 变成一个可检查、可锁定、可交给 Codex / Claude Code 继续执行的浏览器工作台。

<video src="./docs/assets/scribepad-review-demo.webm" controls width="100%"></video>

[查看演示录频](./docs/assets/scribepad-review-demo.webm)

## 为什么需要

AI coding agent 很擅长起草 plan，但真实执行前经常有几个问题：

- 关键决定埋在长文档里，不容易快速确认；
- 多轮改写后，不知道哪些内容已经定了；
- agent 容易在用户确认前继续往下写代码；
- 下一个 agent 需要一份干净、确认过的执行文档。

scribepad 的定位就是：放在“agent 产出 plan”和“agent 开始实现”之间，作为人的确认闸口。

## 核心流程

```bash
scribepad docs/plan.md --wait
```

命令会打开浏览器 Review 页面，并一直等待用户点击 `Done`。

点击 `Done` 后，stdout 只输出一行：确认后的导出 Markdown 路径。

```bash
APPROVED_PLAN=$(scribepad docs/plan.md --wait)
cat "$APPROVED_PLAN"
```

这样 Codex、Claude Code 或任何 shell 驱动的 agent 都可以在这里停住，等用户确认，再读取确认后的文档继续执行。

## 功能

- 从 Markdown plan 中提取 Review outline。
- 检查点支持 default / locked 两态切换。
- 无法识别目录结构时，可在 Review 面板中手动触发规范化。
- `--wait` 会阻塞 CLI，直到用户点击 `Done`。
- Done 后导出 agent 可读取的 Markdown 文档。
- runtime、config、review state、export 全部存放到 XDG 目录，不污染项目仓库。
- 支持配置 Codex CLI 和 Claude Code CLI。

## 安装

当前项目以本地优先为主。从仓库根目录执行：

```bash
npm install
npm run build
npm link
```

打开文档：

```bash
scribepad docs/plan.md
```

作为 agent handoff 闸口：

```bash
scribepad docs/plan.md --wait
```

## 开发

```bash
npm run dev
npm run typecheck
npm test
npm run lint
npm run test:e2e:session
```

## 数据存放

scribepad 使用 XDG 目录，避免把运行态文件散落到项目里：

- 配置：`$XDG_CONFIG_HOME/scribepad/...`
- 运行时 registry：`$XDG_RUNTIME_DIR/scribepad/...`
- Review 状态和导出文档：`$XDG_STATE_HOME/scribepad/...`

源 Markdown 仍留在项目仓库中。Review 状态和 agent handoff 文档存放在仓库外。

## 项目文档

- Roadmap: [docs/roadmap.md](./docs/roadmap.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Tech selection: [docs/tech-selection.md](./docs/tech-selection.md)
