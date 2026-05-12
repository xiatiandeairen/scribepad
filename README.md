# scribepad

**English** | [中文](./README.zh-CN.md)

Review and approve AI-generated engineering plans before your coding agent starts changing files.

scribepad is a local-first Markdown review workspace for developers using Codex, Claude Code, Cursor, Aider, or other AI coding agents. It turns long `plan.md`, design docs, research notes, and implementation proposals into a browser review surface where you can read the plan, lock decisions, add comments, inspect AI rewrites, and hand an approved document back to the agent.

![scribepad demo](./docs/assets/scribepad-review-demo.gif)

## The Problem

AI coding agents can draft useful plans quickly, but the review handoff is still messy:

- a 200-line plan is hard to scan in a terminal or plain editor;
- after a few rewrites, it is unclear which parts are final and which are still open;
- an agent can silently change a decision you already approved;
- the next agent run needs a clean plan, not a pile of chat history.

scribepad gives you a review gate between "AI wrote the plan" and "AI starts implementation".

## What You Can Do

- Open any local Markdown plan in a focused browser UI.
- Review the generated outline and lock important checkpoints.
- Select text, leave comments, and ask an AI CLI to rewrite a section.
- Inspect a diff before accepting the rewrite into the source Markdown.
- Use `--wait` so shell-driven agents pause until you click `Done`.
- Export an agent-readable approved Markdown file from XDG state.

## Who It Is For

scribepad is useful if your workflow looks like this:

- you ask Claude Code, Codex, Cursor, or Aider to write a plan before coding;
- you keep specs, plans, design docs, or research notes as Markdown in your repo;
- you want a human review step before an agent implements the plan;
- you want decisions to stay visible instead of being buried in chat history.

## Keywords

AI coding plan review, Claude Code plan review, Codex workflow, vibe coding plan, Markdown review tool, local-first AI development workflow.

## Workflow

```bash
scribepad docs/plan.md --wait
```

This opens a browser review session and waits until you click `Done`.

After `Done`, stdout prints exactly one line: the approved exported Markdown path.

```bash
APPROVED_PLAN=$(scribepad docs/plan.md --wait)
cat "$APPROVED_PLAN"
```

That makes it easy for Codex, Claude Code, or any shell-driven agent to pause for human approval and continue from the approved document.

## Install

From the repo root:

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
