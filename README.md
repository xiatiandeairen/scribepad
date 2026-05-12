# scribepad

**English** | [中文](./README.zh-CN.md)

scribepad is a local review panel for vibe coding plans. It turns long Markdown plans into a focused browser review surface where you can inspect sections, lock checkpoints, and hand an approved document back to Codex or Claude Code.

![scribepad demo](./docs/assets/scribepad-review-demo.gif)

## Why

AI coding agents are good at drafting plans, but the handoff is easy to lose:

- important decisions are buried in a long Markdown file;
- repeated rewrites make it unclear what is final;
- the agent may continue before the human has reviewed the plan;
- the next agent needs a clean, approved document to execute.

scribepad acts as a local review gate between plan generation and implementation.

## Core Workflow

```bash
scribepad docs/plan.md --wait
```

The command opens a browser review session and waits until you click `Done`.

After `Done`, stdout contains exactly one line: the approved exported Markdown path.

```bash
APPROVED_PLAN=$(scribepad docs/plan.md --wait)
cat "$APPROVED_PLAN"
```

That makes it simple for Codex, Claude Code, or another shell-driven agent to pause for human review and then continue from the approved document.

## Features

- Review outline extracted from Markdown plans.
- Checkpoints can be toggled between default and locked.
- Unknown plan structure can be normalized from the review panel.
- `--wait` blocks CLI execution until the user clicks `Done`.
- Done exports an agent-readable Markdown file under XDG state.
- Runtime, config, review state, and exports are stored outside the repo using XDG paths.
- Works locally with Codex CLI and Claude Code CLI configuration.

## Install

This repository is currently private/local-first. From the repo root:

```bash
npm install
npm run build
npm link
```

Then run:

```bash
scribepad docs/plan.md
```

For agent handoff:

```bash
scribepad docs/plan.md --wait
```

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run lint
npm run test:e2e:session
```

## Storage

scribepad keeps project files clean by using XDG locations:

- Config: `$XDG_CONFIG_HOME/scribepad/...`
- Runtime registry: `$XDG_RUNTIME_DIR/scribepad/...`
- Review state and exports: `$XDG_STATE_HOME/scribepad/...`

The source Markdown stays in your repo. Review state and exported agent handoff documents stay outside it.

## Project Docs

- Roadmap: [docs/roadmap.md](./docs/roadmap.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Tech selection: [docs/tech-selection.md](./docs/tech-selection.md)
