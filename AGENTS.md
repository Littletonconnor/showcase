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

- `server/app.ts` — runtime-agnostic Hono app: all routes, SSE `/api/events`,
  long-poll `/api/comments`, renderer `/s/:id`, asset upload/serve, and the shared
  flow functions both REST and MCP call.
- `server/types.ts` — data model + `Store` interface (no runtime imports). A
  surface is an ordered list of parts; a snippet is sugar for a single html part.
- `server/storage.ts` — `JsonFileStore`, the local Node store (the only store in
  this fork; the Cloudflare SqlStore was removed).
- `server/mcpHttp.ts` / `mcp/server.ts` — streamable-HTTP MCP at `/mcp` and the
  stdio MCP server (a thin client over the HTTP API).
- `server/surfacePage.ts` / `server/themes.ts` / `server/kits.ts` — sandboxed
  rendering, theme registry, opt-in html-part style bundles (`issues`, `slides`,
  `animate`, `review`).
- `viewer/` — React + TypeScript (zustand store, Tailwind, vendored shadcn/ui),
  Vite-built into a single self-contained `viewer/dist/index.html`.
- `bin/showcase.js` — zero-dependency CLI. `guide/` — runtime agent instructions.

## Invariants worth keeping

- **Agent-authored content that becomes HTML MUST render inside a sandboxed,
  opaque-origin iframe — never as `innerHTML` in the trusted viewer origin.** The
  viewer shares an origin with the authenticated API and the comment→agent
  channel. Two safe paths: build a STRING and hand it to a sandbox iframe
  (`SandboxedPart` for viewer-rendered parts, `renderHtmlPage` at `/s/:id` for
  html parts), or keep it as data and render with React text nodes / attributes
  (image, trace). Never a third way.
- `server/{app,events,mcpHttp,surfacePage,types}.ts` stay runtime-agnostic (no
  `node:` imports). Node wiring lives in `server/index.ts` / `server/storage.ts`.
- Server/CLI TypeScript runs directly on Node ≥22.18 via type stripping: erasable
  syntax only (no enums, no parameter properties), `.ts` extensions in relative
  imports, no build step. The viewer is the exception (Vite-built).
- The server reads `viewer/dist/index.html` at boot, so viewer changes need a
  rebuild + restart. **`npm run dev`** is the one command for this: it builds the
  viewer, watches both halves, auto-restarts on every save, and shuts down cleanly
  on Ctrl-C (frees the port, no orphaned watchers). `npm run stop` kills whatever
  is on the port; `npm run restart` is a one-shot stop + build + start. For a
  manual one-off, `npm run build:viewer` then restart the server.

## Validation

```sh
npm test             # node --test (unit/API + store contract)
npm run typecheck    # node + viewer tsc programs
npm run lint         # oxlint, warnings are errors
npm run format:check # oxfmt
```

## Conventions

- Default Node (nvm) here is older than 22.18; use a pinned v24 binary to run.
- Port is **8229** (sideshow's default 8228, shifted to avoid collision).
- Env vars are prefixed `SHOWCASE_` (`SHOWCASE_URL`, `SHOWCASE_TOKEN`,
  `SHOWCASE_DATA`, `SHOWCASE_AGENT`, ...).
