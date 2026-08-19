# scribepad

给 vibe coder 的研发文档协作面板。它把 plan、design、research、analysis 等 Markdown
文档变成段落级有状态、AI 改写可追溯、agent 中立的活文档。

![scribepad 演示](./docs/assets/scribepad-review-demo.gif)

## 使用

```bash
npx --yes github:xiatiandeairen/scribepad <document.md> --open --wait
```

`--wait` 会阻塞当前进程，直到用户在面板中完成审阅。完成后 stdout 只输出核准文档的
导出路径，适合直接交回 coding agent：

```bash
APPROVED_DOC=$(scribepad <document.md> --open --wait)
```

## 开发

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

## 数据位置

- 配置：`$XDG_CONFIG_HOME/scribepad/`
- 运行时 registry：`$XDG_RUNTIME_DIR/scribepad/`
- 审阅状态与导出：`$XDG_STATE_HOME/scribepad/`

源 Markdown 不迁移，运行数据不写入项目仓库。

## 项目文档

- [架构设计](docs/design/architecture.md)
- [文档模型](docs/design/document.md)
- [目录规范](docs/specs/directory.md)
- [文档规范](docs/specs/documentation.md)
- [测试规范](docs/specs/testing.md)
