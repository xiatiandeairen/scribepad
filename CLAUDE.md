# scribepad

给 vibe coder 的研发文档协作面板。把 plan / design / research / analysis 这类长上下文 markdown 文档变成段落级有状态、AI 改写可追溯、agent 中立的活文档。

## 处理反馈会话建议

> ⚠️ **这不是强制流程，只是给未来会话的上下文提示**。实际操作时请根据需要调整。

反馈汇总在 `$XDG_STATE_HOME/scribepad/feedback/inbox.jsonl`（面板与 CLI 共享）。建议处理流：读 inbox → 按文档/症状聚类去重 → 有源文档副本（`attachments/<id>/doc.md`）和 extract 输出的问题可直接复现，转成 `tests/fixtales/` + failing test → UI 类问题可用现有 Playwright e2e 基建从文档副本还原当时截图验证 → 处理完的条目挪出 inbox（比如移到 `archive/<date>.jsonl`；若 archive 机制还未实现，按需自建）。

## docs

- architecture: docs/architecture.md
