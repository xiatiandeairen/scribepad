# Codex / Claude Code Review Workflow Plan

## 目标

- Codex 或 Claude Code 输出 plan 后，可以稳定打开 scribepad Review 页面。
- 用户在 Review 面板中确认、锁定、必要时规范化 plan。
- agent 必须等用户点击 `Done` 后，才能读取确认后的文档继续执行。
- 这个流程必须显式、可控、可重复，不依赖从聊天内容里猜测 plan。

## 范围

包含:

- 使用唯一 CLI 入口 `scribepad <file>`。
- 增加 `scribepad <file> --wait` 作为 agent handoff gate。
- `--wait` 模式下，URL 和日志走 stderr。
- 用户点击 `Done` 后，stdout 只输出一行确认后的 export path。
- 支持复用同一个 repo server。
- 同一个文件多次调用复用已有 active session。
- 不同文件复用同一个 server，创建不同 session。
- Review 页面识别失败时，由用户手动点击“规范化文档”。
- Done 后导出 agent 可读取的 `latest.agent.md`。

不包含:

- 不监听 Codex / Claude Code 聊天输出自动识别 plan。
- 不默认打开浏览器。
- 不在 CLI 中自动规范化文档。
- 不做全局跨 repo daemon。
- 不引入多 workspace 管理。
- 不提供 `review/open/status/export` 等多子命令。

## 方案

### 命令入口

普通打开:

```bash
scribepad docs/plan.md
```

agent handoff:

```bash
scribepad docs/plan.md --wait
```

Codex / Claude Code 使用方式:

```bash
APPROVED_PLAN=$(scribepad docs/plan.md --wait)
cat "$APPROVED_PLAN"
```

### CLI 行为

- 输入文件必须存在。
- 文件路径解析为 absolute path。
- 普通模式 stdout 输出 session URL。
- `--wait` 模式:
  - stderr 输出 session URL 和人类可读日志。
  - 命令保持运行，等待用户点击 `Done`。
  - Done 后 stdout 只输出一行 export path。
  - 成功 exit code 为 `0`。
- 文件不存在时:
  - exit code 非 `0`。
  - stdout 为空。
  - stderr 输出明确错误。

### Server 复用

- 使用 XDG runtime registry:
  - `$XDG_RUNTIME_DIR/scribepad/<repo-id>/server.json`
- registry 字段包含:
  - `pid`
  - `port`
  - `url`
  - `startedAt`
  - `repoRoot`
- 打开前检查:
  - pid 是否存活。
  - `/api/healthz` 是否返回成功。
- 可用则复用 server。
- 不可用则清理 registry 并启动新 server。

### Session 复用

- 沿用 `SessionManager.openSession(filePath)`。
- 同一个 absolute path 已有 active session 时，直接返回旧 session URL。
- 不同文件创建新 session，但共用同一个 repo server。
- `GET /api/sessions/:sessionId/wait` 用于已有 server 下的 `--wait` 复用场景。

### Agent Stage Gate

agent 在需要人工 review 的 stage 必须:

- 将 plan 写入当前任务指定 markdown 文件。
- 调用 `scribepad <file> --wait`。
- 等命令返回。
- 读取 stdout 返回的 export path。
- 以 export path 中的文档作为后续实现输入。

用户未点击 `Done` 前，agent 不应继续执行。

### Review 页面行为

- CLI 不判断文档结构质量。
- Review 页面继续使用现有解析逻辑。
- 如果识别不到目录结构，只显示“规范化文档”按钮。
- 规范化仍由用户手动确认触发。
- 用户锁定检查点后点击 `Done`，服务端导出 agent handoff 文档。

## 验收

### Wait Handoff

- 执行 `scribepad docs/plan.md --wait` 后命令保持阻塞。
- stderr 中能看到 Review URL。
- 用户点击 `Done` 后命令退出 `0`。
- stdout 只包含一行 export path。
- export path 指向存在的 markdown 文件。
- agent 可以直接 `cat "$APPROVED_PLAN"` 读取确认后的文档。

### Server 复用

- server 未启动时，`scribepad docs/plan.md --wait` 会启动 server。
- server 已启动时，`scribepad docs/plan.md --wait` 会复用 server。
- 同一文件重复执行时返回同一个 active session。
- 不同文件执行时返回不同 session，但 server port 不变。

### 失败边界

- 文件不存在时命令失败。
- stdout 为空。
- stderr 包含 `File not found`。

### 规范化

- 非标准文档打开后不自动改写。
- Review 页面识别失败时只显示规范化按钮。
- 用户确认后才写回规范化内容。

## 待确认

- 后续是否需要为 Codex skill / Claude Code command 写专门的安装说明。
- 是否需要增加可配置 timeout，防止 agent 长时间等待无人处理。
- 是否需要增加用户取消 Review 的显式 exit code。
