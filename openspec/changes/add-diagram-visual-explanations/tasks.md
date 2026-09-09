## 1. Package Resources and Contracts

- [x] 1.1 Add the selected `diagram-design` skill, references, templates, and required license notices to the Pi package manifest; verify Pi discovers the skill and package paths resolve without copying unrelated host-plugin files.
- [x] 1.2 Define TypeBox schemas and shared result contracts for supported diagram types, HTML artifacts, validation status, diagram IDs, versions, and review events; verify `pnpm typecheck` and schema rejection tests pass.

## 2. Diagram Generation and Storage

- [x] 2.1 Register the Agent-facing diagram tool with `promptSnippet` and `promptGuidelines`; verify Pi exposes the tool and its guidance tells the Agent when to choose a diagram, how to apply `diagram-design`, and when to prefer prose or tables.
- [x] 2.2 Implement diagram artifact validation for accessible SVG metadata, safe references, script restrictions, supported type metadata, and complexity limits; verify valid representative fixtures pass and malformed or unsafe fixtures fail with actionable diagnostics.
- [x] 2.3 Implement project-scoped version storage under `.pi/diagram/<safe-id>/vN.html` with atomic writes and no overwrite; verify traversal IDs are rejected or normalized, versions increment, and files remain under the project directory.
- [x] 2.4 Return bounded tool results containing diagram ID, type, version, path, validation status, simplification notes, and preview status; verify large HTML is not echoed into the Pi transcript.

## 3. Glimpse Review Panel

- [x] 3.1 Add optional runtime loading and capability checks for Glimpse, `ctx.hasUI`, and supported Pi modes; verify missing Glimpse, headless mode, and print/json mode preserve generation and return a usable path.
- [x] 3.2 Build the Glimpse review panel using `glimpse-design` conventions for native sizing, adaptive appearance, accessibility, keyboard controls, reduced motion, and escaped dynamic content; verify the panel renders the HTML artifact without executing diagram text.
- [x] 3.3 Implement the fixed review event protocol for confirm, request changes, submit feedback, version selection, and close; verify invalid actions, oversized feedback, and stale versions are rejected without state corruption.
- [x] 3.4 Implement same-window version updates and review state persistence; verify Confirm records the selected version without triggering an Agent turn, Close does not confirm, and Submit feedback sends diagram ID plus version to the active Pi session.

## 4. Configuration Command

- [x] 4.1 Implement fail-closed loading and writing of `.pi/xpi-diagram.json` with preview enabled by default and project trust enforcement; verify absent, malformed, unsupported, and untrusted-project cases use safe defaults.
- [x] 4.2 Upgrade `/xpi-diagram` into the native Pi configuration and latest-diagram command; verify users can view status, toggle Glimpse auto-preview, and reopen the latest saved diagram without manually editing JSON.
- [x] 4.3 Apply configuration to automatic preview while keeping file generation independent; verify disabled preview still saves artifacts and enabled preview opens Glimpse after successful validation.

## 5. Verification and Documentation

- [x] 5.1 Add focused tests for storage, validation, configuration, tool results, and panel protocol; verify `pnpm test` passes.
- [x] 5.2 Run representative `diagram-design` fixture checks and the package lint/type checks; verify `pnpm typecheck`, `pnpm -w run lint`, and `pnpm test` all pass.
- [x] 5.3 Run a TUI integration smoke test covering generation, `.pi/diagram/` persistence, automatic Glimpse preview, in-panel confirmation, feedback round-trip, and version update; verify headless fallback separately and document any unavailable platform coverage.
