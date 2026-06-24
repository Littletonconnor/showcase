# showcase — notes & TODO

Working notes for the project. Architecture lives in `AGENTS.md`; this is the
"how do I think about this / what's next" doc.

## How work is saved & tracked

- **Git is the record.** Branches: `main` (stable) and `redesign` (current UI
  work). Each logical change is its own commit — the commit messages are the
  changelog. Merge `redesign → main` (fast-forward) once a chunk is approved.
- **The oracle is the gate.** `e2e/loop.spec.ts` (Playwright) drives a real
  browser through publish → render → comment. "Still green" = the change didn't
  break the core loop. Run `npx playwright test`. It asserts only on
  trusted-origin DOM hooks (`.card[data-id]`, per-part `iframe`s,
  `.thread .cmt.user`), so it survives a restyle but catches a broken port.
- **No formal plan files yet** — the roadmap is this file + the git history. If
  multi-session plans get heavy, add a `plans/` dir.
- **Running it:** needs Node ≥ 22.18 (nvm default here is v20 — too old; use
  v24). `npm run serve` → http://localhost:8229. Rebuild the viewer
  (`npm run build:viewer`) + restart the server to see viewer changes.

## How interacting with agents actually works (the feedback loop)

The mental model to internalize: **the server never pushes to your editor — the
agent pulls.** There is no connection from showcase into Cursor/Claude Code.

- Each editor runs an **MCP stdio server** (`mcp/server.ts`) that creates **one
  session tagged with that editor** (`SHOWCASE_AGENT` = `cursor` /
  `claude-code`). Every surface it publishes belongs to that session.
- You comment in the viewer → `POST /api/comments` with `author=user` → stored,
  attached to the surface → so to that session.
- The agent receives your comment only when it **next touches showcase**:
  1. **Piggyback** — its next `publish_surface`/`update_surface` response carries
     a `userFeedback[]` of your new comments.
  2. **Blocking wait** — it calls `wait_for_feedback`, which long-polls _its_
     session for `author=user` comments.
  3. **Background watch** (CLI).
- Delivery is **per-session and exactly-once** (an `agentSeq` cursor). Comments
  on a cursor session reach the cursor agent; claude-code → claude-code.
- **The gotcha:** after an agent finishes its turn, it isn't listening. Your
  comment reaches it only if it chose to `wait_for_feedback` before yielding, or
  you nudge it in chat ("I left a comment on showcase — check it"). Reliable
  pattern today: **comment → tell the agent to check.** Making this less manual
  is a future-direction item.
- **MCP tools:** `publish_surface`, `update_surface`, `wait_for_feedback`,
  `reply_to_user`, `list_surfaces`, `upload_asset`, `get_design_guide`.
- The URL the agent hands you is the **viewer deep link**
  (`/session/:sid/s/:id`), not the `/s/:id` embed renderer.

## Architecture quick-map

- `server/` — Hono app (runtime-agnostic): routes, SSE `/api/events`, the shared
  flow functions REST + MCP both call. `JsonFileStore` = local store.
- `viewer/` — React 19 + zustand + Tailwind v4 + shadcn, Vite-built into one
  self-contained `index.html`.
- `mcp/` — stdio MCP, a thin client over the HTTP API. `server/mcpHttp.ts` =
  streamable HTTP MCP at `/mcp`.
- **Theming:** `server/themes.ts` is the single source of truth. `viewer/src/
index.css` bridges shadcn/Tailwind tokens to those theme vars
  (`--color-primary → var(--accent)`, etc.), so every preset + shadcn component
  re-theme together. Sandboxed part-iframes get their CSS server-side
  (`surfacePage.ts`).
- **Core invariant:** agent-authored HTML renders ONLY inside sandboxed,
  opaque-origin iframes — never `innerHTML`/`dangerouslySetInnerHTML` in the
  trusted viewer origin.

## In progress — UI redesign (`redesign` branch, refined-minimal aesthetic)

Migrating `styles.css` → Tailwind utilities + shadcn components.

- [x] Tailwind v4 + shadcn foundation, bridged to the theme system
- [x] Surface-card elevation pass
- [x] Session list rebuilt in Tailwind (clear active state)
- [ ] Card action bar → shadcn `Button` + `Tooltip`
- [ ] Version selector → shadcn `Select`; version chip → shadcn `Badge`
- [ ] Composer buttons → shadcn `Button`
- [ ] Theme picker → shadcn `Select`; view toggle → shadcn-style segmented control
- [ ] Header polish (session title, meta)
- [ ] Finish migrating the rest of `styles.css` → Tailwind; delete dead rules

## Future directions

**Sharing / showing other people**

- **Static export** — `showcase export <session>` → one self-contained,
  read-only `.html` you can send anyone. The viewer is already a single file;
  bake a session snapshot in via the host seam. Highest-leverage unlock.
- **Present mode** — full-bleed, arrow-key deck navigation (builds on the
  `slides` kit) for walking coworkers through a deck.
- **Live share** — re-add the Cloudflare Workers deploy, or a `cloudflared`
  tunnel, so others watch live / it works on your phone.

**Richer explainers** (mostly _kits_ — a registry entry + a guide bullet; the
CDN allowlist already permits jsdelivr/cdnjs/unpkg)

- KaTeX (math), a chart kit (Vega-Lite / Chart.js), maybe maps.
- **Drill-down loop** — html parts can already call `sendPrompt()`; make
  "explain this deeper" buttons idiomatic so an interactive explainer can ask the
  agent to go further in place.

**Personal depth**

- **Persistent library / pinned surfaces** — a personal visual wiki of diagrams
  that survives the session.
- **Reading/learning mode** — focused, one-explainer-at-a-time view.

**Tighter feedback loop**

- Structured feedback (approve / reject / revise buttons via `sendPrompt`).
- Element-level annotations (click a box in a diagram → ask about it).
- Reduce the "comment doesn't reach the agent until I nudge it" gotcha.
