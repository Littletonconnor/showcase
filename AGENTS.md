# showcase — agent guide

A personal fork of [sideshow](https://github.com/modem-dev/sideshow), stripped to
the local-only engine. `CLAUDE.md` symlinks here.

## What this is

A live visual surface for terminal coding agents: agents publish surfaces
(multi-part cards — html, markdown, diff, terminal, image, mermaid, json, code,
chart, trace) over CLI/MCP/HTTP; the user watches them render and comments back.
The two-way loop — publish → live render → comment → revise/reply — is the
product. When in doubt, optimize for the loop.

## Map

A **pnpm workspace** (`pnpm-workspace.yaml`): five packages under `packages/*`
behind enforced boundaries. `core` ← everyone; `cli` talks to `server` over HTTP
(not an import); `viewer`'s build output is read by `server` at boot.

- `@showcase/core` (`packages/core/`) — runtime-agnostic data model +
  string-builder renderers + MCP spec. **No `node:` imports** (CI-enforced by
  `scripts/check-core-boundary.mjs`). Key files: `types.ts` (data model + `Store`
  interface — a surface is an ordered list of parts; a snippet is sugar for one
  html part), `surfacePage.ts` / `themes.ts` / `kits.ts` (sandboxed rendering,
  theme registry, opt-in html-part style bundles `issues`/`slides`/`animate`/
  `review`/`mockup`), `blueprints.ts` (explainer blueprints), `events.ts`, `mcpSpec.ts`
  (the single MCP tool-schema source both transports import), `export.ts`,
  `lesson.ts` / `telemetry.ts` / `mastery.ts` (the learn form factor: lesson
  wire types + the deterministic lesson renderer, the closed telemetry union,
  the spaced-review scheduler — see `docs/learn-form-factor.md`).
- `@showcase/server` (`packages/server/`) — Node HTTP runtime. `app.ts` (Hono
  app: all routes, SSE `/api/events`, long-poll `/api/comments`, renderer
  `/s/:id`, asset upload/serve, and the shared flow functions both REST and MCP
  call), `mcpHttp.ts` (streamable-HTTP MCP at `/mcp`), `storage.ts`
  (`JsonFileStore`, the only store in this fork — Cloudflare SqlStore removed),
  `index.ts` (Node wiring), `userConfig.ts` (local-config loader layering
  user/repo themes/kits/blueprints over the built-ins — see
  `docs/themable-explainers.md`), `presetRenders.ts`, `masteryStore.ts`
  (learner mastery persistence at `~/.showcase/mastery.json`, JsonFileStore
  pattern), `public.ts`.
- `@showcase/mcp` (`packages/mcp/server.ts`) — the stdio MCP server (a thin
  client over the HTTP API; imports the shared schema from core).
- `@showcase/cli` (`packages/cli/`) — `bin/showcase.js` is a thin launcher; the
  CLI proper is a command registry (`registry.ts`, one `Command` per subcommand
  under `commands/`) over shared helpers — `http.ts` (API client + error→exit
  mapping), `errors.ts`, `session.ts`, `output.ts` (human by default, raw JSON
  under `--json`), `command.ts` (per-command parse + help). **Strictly zero
  runtime deps**; type-stripped like the server; must not pull the viewer tree.
- `@showcase/viewer` (`packages/viewer/`) — React + TypeScript (zustand store,
  Tailwind, vendored shadcn/ui), Vite-built into a single self-contained
  `dist/index.html`. Imports part/surface _types_ from `@showcase/core` so the
  wire contract is type-checked. `server-entry.js` resolves the built html for
  the server to read across the workspace boundary.
- `guide/` — runtime agent instructions (repo-level, not a package). `test/`,
  `e2e/`, `scripts/`, `docs/` stay repo-level too.

## Invariants worth keeping

- **Agent-authored content that becomes HTML MUST render inside a sandboxed,
  opaque-origin iframe — never as `innerHTML` in the trusted viewer origin.** The
  viewer shares an origin with the authenticated API and the comment→agent
  channel. Two safe paths: build a STRING and hand it to a sandbox iframe
  (`SandboxedPart` for viewer-rendered parts, `renderHtmlPage` at `/s/:id` for
  html parts), or keep it as data and render with React text nodes / attributes
  (image, trace). Never a third way. The full trust model — sandbox attribute,
  CSP, the host bridge, auth, and the CSRF guard — is `docs/SECURITY.md`.
- **`@showcase/core` stays runtime-agnostic — no `node:` imports.** This is the
  package boundary the workspace makes checkable: `scripts/check-core-boundary.mjs`
  fails the lint gate on any `node:` import in core. Node wiring lives in
  `@showcase/server` (`index.ts` / `storage.ts`).
- core/server/mcp/cli TypeScript runs directly on Node ≥22.18 via type stripping:
  erasable syntax only (no enums, no parameter properties), `.ts` extensions in
  relative imports, no build step. Cross-package imports use `@showcase/*` package
  names (per-package `exports` map `./*: ./*.ts`), which Node type-strips across
  the workspace symlink. The viewer is the one Vite-built exception.
- The server reads the viewer's built `dist/index.html` at boot (via
  `@showcase/viewer`'s `server-entry`), so viewer changes need a rebuild +
  restart. **`pnpm dev`** is the one command for this: it builds the viewer,
  watches both halves, auto-restarts on every save, and shuts down cleanly on
  Ctrl-C (frees the port, no orphaned watchers). `pnpm stop` kills whatever is on
  the port; `pnpm restart` is a one-shot stop + build + start. For a manual
  one-off, `pnpm build:viewer` then restart the server.

## Validation

```sh
pnpm test             # node --test (unit/API + store contract)
pnpm typecheck        # root test program + `pnpm -r typecheck` (per package)
pnpm lint             # oxlint (warnings = errors) + core no-node: boundary
pnpm format:check     # oxfmt
```

`pnpm install` once after cloning. The repo is on **pnpm** (not npm); the old
`npm run …` muscle memory maps 1:1 to `pnpm …`.

## Conventions

- **Comments explain why, not what.** A comment earns its place only when the
  code can't say it itself: a non-obvious constraint, a "why this and not the
  obvious thing", a gotcha. Don't narrate what the next line plainly does, don't
  write multi-line essays atop functions or sections, and delete a comment rather
  than let it drift out of date. Prefer a clear name over a comment; prefer one
  terse line over a paragraph. If you're tempted to explain the design at length,
  that's docs (TODO.md / a `docs/` file), not a code comment.
- Default Node (nvm) here is older than 22.18; use a pinned v24 binary to run.
- Port is **8229** (sideshow's default 8228, shifted to avoid collision).
- Env vars are prefixed `SHOWCASE_` (`SHOWCASE_URL`, `SHOWCASE_TOKEN`,
  `SHOWCASE_DATA`, `SHOWCASE_AGENT`, ...).
