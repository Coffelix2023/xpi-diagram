# xpi-diagram

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

> A lightweight, non-intrusive extension for the Pi Coding Agent (`pi-extension` / `pi-package`).

> No build step. Direct TypeScript source execution. Strict quality gates.

[Quickstart](#quickstart) · [Commands](#commands) · [Configuration](#configuration) · [Development](#development) · [Directory structure](#directory-structure) · [Design baseline](#design-baseline)

---

## What it is

**`@fx-pi/xpi-diagram`** is a Pi Coding Agent extension running inside the Pi main process.

Design principles:

- **No build step** — Pi loads `./src/index.ts` directly; no compilation artifacts (`dist/` or bundles) are committed.
- **Pi-native UI** — Uses `ctx.ui.*` and `@earendil-works/pi-tui` for rendering; never hijacks the terminal or installs conflicting terminal frameworks.
- **Zero heavy runtime dependencies** — Relies on host-provided APIs with strict type safety (`typebox`, TypeScript strict).
- **Strict quality gates** — TypeScript strict + Biome + Vitest; all three checks must pass before any commit.


## Diagram workflow

- `create_diagram` validates and saves a version before opening the configured preview. Both preview modes are read-only: the Glimpse window and the system browser only display the saved diagram. The review itself runs in the Pi editor panel — version selection, confirm, and feedback. Confirming accepts a version; canceling or closing does not. The tool result includes the review status, version, and complete feedback text.
- Choose the diagram type and layout that best communicate the purpose. Apply the selected `diagram-design` type reference and its accessibility, connector, complexity, color, typography, density, and motion rules. The Glimpse window theme is separate from the diagram style; do not add a style selector or invent a brand profile.
- `/xpi-diagram` manages preview configuration (enable/disable, preview mode `glimpse` or `browser`) and reopens the latest saved diagram without waiting for review. Browser preview opens the saved HTML with the platform's native opener (`open`/`xdg-open`/`start`) and returns immediately. When no tool is waiting, feedback is delivered through the host when it is idle or steered when it is busy. Disabled preview, headless mode, an unsupported platform, or a failed launch return the saved result directly — the artifact is never lost.
- A cancelled tool call (Escape while the run is active) dismisses the review prompts and closes that diagram's preview window. Otherwise a preview window lives until its review finishes, and every remaining window is closed on session shutdown.
## Tech stack

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/), versions pinned in [`mise.toml`](./mise.toml)
- [Pi Coding Agent API](https://github.com/earendil-works/pi-coding-agent) (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) — optional peer dependencies; `devDependencies` pin the API surface the extension is developed and tested against (Pi 1.0.2)
- TypeScript strict (`target: ES2024`, `module: NodeNext`)
- [Biome](https://biomejs.dev/) (lint + format)
- [Vitest](https://vitest.dev/) (test runner)

## Quickstart

### Environment

Install the pinned Node.js and pnpm versions with [mise](https://mise.jdx.dev/):

```bash
mise install
```

### Install dependencies

```bash
pnpm install
```

### Smoke test

Run a quick test loading the extension directly into Pi:

```bash
pi -e ./src/index.ts
```

### Local development

Symlink to your local Pi extensions directory for live testing:

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-diagram
```

Inside a running Pi session, use `/reload` to hot-reload the extension.

## Commands

| Command | Description |
| :--- | :--- |
| `/xpi-diagram` | Configure diagram preview (enable/disable, `glimpse`/`browser` mode) or reopen the latest diagram |

## Configuration

Settings live in the Pi agent directory so they survive extension upgrades:

- `~/.pi/agent/xpi-diagram.json` — atomic writes with mode `0600`; keys `preview` (boolean), `previewMode` (`"glimpse"` | `"browser"`), and `language` (`"zh-CN"` | `"en"`). Missing or invalid values fail closed to `preview: true`, `previewMode: "glimpse"`, `language: "zh-CN"` and report a diagnostic.
- Change them with `/xpi-diagram`; that panel is the only writer.

## Development

| Command | Description |
| :--- | :--- |
| `pnpm typecheck` | `tsc --noEmit` — strict type check |
| `pnpm -w run lint` | Biome check across the repository |
| `pnpm test` | Vitest test runner (`vitest run --passWithNoTests`) |

All three gates (`typecheck`, `lint`, `test`) must pass before committing.

## Directory structure

```
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md / README.md / README.zh-CN.md
├── docs/                      # Git workflow, repository guardrails, vendored references
├── openspec/                  # Specs and change records
└── src/                       # Extension source; each module keeps its Vitest suite beside it
    ├── index.ts               # Extension entrypoint (register) and the /xpi-diagram command
    ├── diagram-tool.ts        # create_diagram registration, preview and cancellation flow
    ├── review-panel.ts        # Glimpse review window and review state transitions
    └── config.ts              # User-level configuration (preview, preview mode, language)
```

## Design baseline

This project adopts the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md) tailored for terminal TUI interfaces. See [`DESIGN.md`](./DESIGN.md) for terminal design tokens (colors, monospace typography, spacing, and component definitions).

## Conventions & constraints

- **Glossary** — [`CONTEXT.md`](./CONTEXT.md) defines the repository's unified terminology; terms must not drift in code, docs, or commits.
- **Git discipline** — Read [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) and [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md) before committing or pushing. This repository is in stage 1, so commits and releases go directly to `main`; keep them small and granular Conventional Commits.
- **Token safety** — Credentials and secret tokens are never written into code, logs, examples, or documentation.
