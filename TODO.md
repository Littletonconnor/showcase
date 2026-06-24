# showcase — project guide & roadmap

The single doc to read before working on showcase — especially in a background
session. Sections 1–5 are "how it works / how to work here" (stable reference);
section 6 is the roadmap (what to build); sections 7–8 are open decisions and
how to pick up work autonomously. Architecture detail lives in `AGENTS.md`.

---

## 1. What it is

A live visual surface for AI: an agent publishes **surfaces** (cards built from
typed parts — html, markdown, mermaid, diff, terminal, image, json, code, trace)
and they render in a browser you watch and comment on. Today the agent lives in
your editor (Cursor / Claude Code) and reaches _out_ to showcase. The roadmap
(section 6, Pillar A) turns showcase into a **local Claude chat app** where the
AI runs server-side and surfaces are its inline visual artifacts.

**Stack:** runtime-agnostic Hono server (`server/`) + a React 19 / zustand /
Tailwind v4 / shadcn viewer (`viewer/`, Vite → one self-contained
`index.html`) + a stdio/HTTP MCP server (`mcp/`) + a zero-dep CLI (`bin/`).
Local JSON-file store. `server/themes.ts` is the single color source for both
the chrome and the sandboxed part-iframes.

---

## 2. Operating guide

**Run it** (needs Node ≥ 22.18 — the nvm default here is v20, too old; use v24):

```sh
cd ~/personal/showcase
npm run serve            # API + viewer on http://localhost:8229  (keep running)
# rebuild the viewer + restart after viewer changes:
npm run build:viewer
node bin/showcase.js demo   # seed example sessions to look around
```

**Create a surface** — in Cursor/Claude Code, ask "diagram X on showcase" /
"sketch this on showcase"; the agent calls `publish_surface` and a card appears.
Or directly: `node bin/showcase.js mermaid flow.mmd --title "Flow"` (also
`publish`, `diff`, `markdown`, `code`, `image`, …).

**Iterate** — the agent calls `update_surface {id, parts}` → _same card, new
version_ (the `v2 ⌄` Select flips versions). You comment under any card → it
reaches the agent (section 4).

**Both editors are wired** to the same `showcase` MCP server (stdio, proxies the
local API), pinned to the v24 node binary:

- Claude Code — user scope in `~/.claude.json`, `SHOWCASE_AGENT=claude-code`.
- Cursor — global `~/.cursor/mcp.json`, `SHOWCASE_AGENT=cursor`.
  Only requirement: keep `npm run serve` running, then talk to either agent.
  Restart the editor after MCP config changes.

---

## 3. Architecture map

- `server/app.ts` — Hono app (runtime-agnostic): routes, SSE `/api/events`,
  long-poll `/api/comments`, the `/s/:id` sandboxed renderer, and the shared
  flow functions REST + MCP both call.
- `server/types.ts` — data model + `Store` interface. `server/storage.ts` —
  `JsonFileStore` (the only store; the Cloudflare SqlStore was removed).
- `server/surfacePage.ts` / `themes.ts` / `kits.ts` — sandboxed rendering, the
  theme registry (single color source), and opt-in html-part style bundles.
- `viewer/` — React 19 + zustand store (`state.ts`) + Tailwind v4 + shadcn
  (`components/ui/`). `index.css` bridges shadcn/Tailwind tokens to the theme
  vars; `styles.css` is just the `:root` design tokens now.
- `mcp/server.ts` — stdio MCP (thin client over the HTTP API).
  `server/mcpHttp.ts` — streamable HTTP MCP at `/mcp`.
- **Core invariant:** agent-authored HTML renders ONLY inside sandboxed,
  opaque-origin iframes — never `innerHTML`/`dangerouslySetInnerHTML` in the
  trusted viewer origin. Two safe paths: build a string → sandbox iframe
  (`SandboxedPart`, `renderHtmlPage`), or keep it data → render with React text
  nodes (image/trace). When adding a part kind, pick one.

---

## 4. The agent feedback loop (contract)

**The server never pushes to your editor — the agent pulls.** A comment you type
is `POST /api/comments` with `author=user`, stored on the surface → its session.
The agent receives it when it next touches showcase:

1. **Piggyback** — its next publish/update response carries `userFeedback[]`.
2. **Blocking wait** — `wait_for_feedback` long-polls its session for
   `author=user` comments.
3. Background watch (CLI).
   Per-session, exactly-once (an `agentSeq` cursor). **Gotcha:** after a turn the
   agent isn't listening — the reliable pattern is _comment → tell the agent to
   check_. Reducing this friction is a roadmap item (Pillar E). Surface URLs handed
   to humans are the viewer deep link (`/session/:sid/s/:id`), not `/s/:id`.

---

## 5. How to work in this repo (read before any change)

- **Branch gate.** Don't commit redesign/feature work on `main`. Branch first;
  merge (fast-forward) when a chunk is green and reviewed.
- **The oracle is the merge gate.** `e2e/loop.spec.ts` (Playwright) drives a real
  browser through publish → render → comment. Run `npx playwright test`. It
  asserts only on trusted-origin DOM hooks (`.card[data-id]`, per-part
  `<iframe>`s, and `.thread .cmt.user` carrying the comment text) so it survives
  a restyle but catches a broken change. **Keep these hooks intact.** (Gap: desktop-chromium
  only — see Pillar E.)
- **Verify before reporting done** (all must pass): `npm run typecheck`
  (node + viewer tsc), `npm run lint` (oxlint, warnings = errors),
  `npm run build:viewer`, `npx playwright test`. For UI, screenshot via a headless
  Playwright script and look at it. `npm run format` last.
- **Node:** prefix shells with
  `export PATH=/Users/connorlittleton/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin:/usr/local/bin`.
  This shell aliases `cat`→a missing tool (use Read/`sed`) and lacks `lsof`
  (kill servers via `ps ax | grep server/index.ts | awk | xargs kill`).
- **Styling:** Tailwind utilities + shadcn on the JSX — do NOT add rules to
  `styles.css`. New palette needs go through the `index.css` `@theme` bridge.
- **Commits:** Conventional Commits; end with the Co-Authored-By line. One
  logical change per commit; verify before each.
- **LLM code:** anything calling Claude must use `@anthropic-ai/sdk`, model
  `claude-opus-4-8`, `thinking:{type:"adaptive"}`, and streaming. Consult the
  `claude-api` skill before writing it. Never hardcode keys — read
  `ANTHROPIC_API_KEY` from env.

---

## 6. Roadmap

Each pillar is scoped enough to execute solo: **problem → approach → acceptance
→ effort (AI time)**. Pillars are independent; do them in any order. Effort is a
rough first-cut estimate, not a commitment.

### Pillar A ⭐ — In-browser chat (turn showcase into a local Claude app)

The flagship direction. A polished, claude.ai-style chat in the viewer where the
AI runs **server-side** and emits surfaces as inline artifacts.

- **Problem:** today you can only _watch_ an editor agent. You want to _talk_ to
  an AI in the browser — create chats, see history, delete them — with a
  beautifully designed interface, and have surfaces be its visual output.
- **Approach (server-hosted agent):**
  - Server runs the agent loop with `@anthropic-ai/sdk` (model `claude-opus-4-8`,
    adaptive thinking, `client.messages.stream`), OR the **Claude Agent SDK**
    (`@anthropic-ai/claude-agent-sdk` — Claude Code's engine, with bash/file/MCP
    tools) for a real "local Claude Code in the browser." Decide which — see §7.
  - Reuse the data model: a **chat = a session** (sidebar create/delete/history
    already exists), turns stored as messages, **`publish_surface` is a tool the
    agent calls** so cards render inline as the AI's artifacts.
  - Stream tokens to the browser over the existing SSE channel (`/api/events`)
    or a new `/api/chat` SSE; the composer posts a user turn.
  - Tools to expose: `publish_surface`/`update_surface` (always), then optionally
    web search/fetch (research) and bash/edit (local work — heed the security
    notes in the `claude-api` tool-use docs; sandbox/allowlist).
  - **The injection caveat is real:** this does NOT drive your Cursor/Claude Code
    _app_ session — it's its own local Claude. (A separate, lesser "bridge to the
    editor agent via the comment loop" is possible but constrained; not this.)
- **Acceptance:** type a message in the browser → streamed Claude response →
  agent publishes a surface that renders inline in the thread → you reply and it
  revises. Chats persist, list in the sidebar, delete cleanly. Oracle still green.
- **Effort:** large — break into (1) server chat loop + streaming, (2) chat UI
  (message list, streaming composer), (3) tools wiring, (4) polish. ~a few
  focused sessions; do behind a flag so the existing publish/watch flow keeps
  working.

### Pillar B — Showing other people

- **Static export** — `showcase export <session>` → one self-contained read-only
  `.html` to send anyone. The viewer is already single-file; bake a session
  snapshot in via the `host.ts` seam, disable the live/comment bits.
  _Acceptance:_ the file opens offline and renders the session. _Effort:_ ~1–2h.
- **Present mode** — full-bleed, arrow-key deck nav over a session's cards (builds
  on the `slides` kit). _Effort:_ ~1–2h.
- **Live share** — re-add a Cloudflare Workers deploy, or a `cloudflared` tunnel,
  so others watch live / it works on a phone. _Effort:_ Workers ~2–3h; tunnel ~20m.

### Pillar C — Richer explainers (mostly kits)

Kits are the cheap extension point: a registry entry in `server/kits.ts` + a
guide bullet, no new part kind. The html-part CSP already allowlists
jsdelivr/cdnjs/unpkg, so CDN libs work today.

- **KaTeX kit** (math) and a **chart kit** (Vega-Lite / Chart.js). _Effort:_
  ~30–45m each.
- **Drill-down loop** — html parts can already call `sendPrompt()`; make
  "explain this deeper" buttons idiomatic so an interactive explainer asks the
  agent to go further in place. _Effort:_ ~1–2h + a guide pattern.

### Pillar D — Personal knowledge base

- **Persistent / pinned surfaces** — a "library" of diagrams that survives the
  session; a visual wiki for "understand a system." _Effort:_ ~2–4h (store +
  a pinned view).
- **Reading/learning mode** — focused, one-explainer-at-a-time view. _Effort:_ ~2h.

### Pillar E — Loop + foundation (keeps everything else safe)

- **Tighten feedback** — structured approve/reject/revise buttons via the
  `sendPrompt` bridge; element-level annotations (click a diagram box → ask about
  it); reduce the "comment doesn't reach the agent until I nudge it" gotcha
  (esp. once Pillar A's server agent can be actively listening).
- **Harden the oracle** — add WebKit + a mobile viewport + a per-part-kind render
  check; consider a CI workflow (none today) so background changes are gated
  automatically.

### Pillar F ⭐ — Design polish (background-agent backlog)

A deep visual-polish pass to bring showcase up to **claude.ai-grade**. Built as
an ordered list of small, independent tasks so a background agent can work
through them one at a time. Reference target: the claude.ai sidebar — calm,
content-first, a collapsible rail, hover affordances, per-item overflow menus,
generous-but-tight spacing, restrained type.

**North star (the taste to hold across every task):** refined-minimal. The
chrome recedes; surfaces are the star. Hairline borders + soft shadows, not
heavy lines. One accent (the theme `--accent`). Tabular-ish calm. Motion is
subtle and fast (120–180ms) and respects `prefers-reduced-motion`. When unsure,
look at how claude.ai does it.

**Rules every task in this backlog follows** (don't restate them per task):

- One task = one branch off `main` = one commit; merge (fast-forward) when green.
- Style with Tailwind utilities + shadcn components on the JSX. **Never** add
  rules to `styles.css`; new palette tokens go through the `index.css` `@theme`
  bridge. Add shadcn components with `npx shadcn@latest add <name>` (they land in
  `viewer/src/components/ui` via the `@/` alias).
- **Keep the oracle hooks intact:** `.card[data-id="…"]`, `.card-title`, per-part
  `<iframe>`s, and `.thread .cmt.user` carrying the comment text. Keep the sandbox
  invariant (§3).
- Verify before merging: `npm run typecheck` + `npm run lint` + `npm run
build:viewer` + `npx playwright test`, then screenshot **desktop and a 480px
  mobile viewport** with a headless Playwright script and actually look at both.
  `npm run format` last.

#### Foundation (do first, in order — later tasks build on these)

- [x] **F1 — Adopt the shadcn `Sidebar` primitive.** Replace the hand-rolled
      `<aside>` + the bespoke `max-[700px]` mobile-drawer logic in `App.tsx` with
      shadcn's `Sidebar` (collapsible rail + built-in mobile offcanvas + a11y +
      persisted collapsed state). `npx shadcn@latest add sidebar` (pulls
      `Sheet`/`Tooltip`/`Skeleton`/`Separator`/`useIsMobile`). Wrap the app in
      `<SidebarProvider>`; build `<Sidebar collapsible="icon">` with
      `SidebarHeader` (wordmark + `SidebarTrigger`), `SidebarContent`
      (the session groups), `SidebarFooter` (the links). Map `sessionGroups` →
      `SidebarGroup`/`SidebarGroupLabel`/`SidebarMenu`/`SidebarMenuItem`/
      `SidebarMenuButton`. Remove the old `navOpen`/body-drawer code it replaces.
      _Acceptance:_ a toggle collapses the sidebar to an icon rail and the state
      persists across reload; mobile offcanvas opens/closes; the session list,
      groups, and active highlight all render; oracle green; desktop + mobile +
      collapsed screenshots look right.
- [x] **F2 — Per-session overflow menu (rename / delete / copy link).** Replace
      the hover `✕` with a shadcn `DropdownMenu` on a `SidebarMenuAction` (`⋯`)
      revealed on hover/active, like claude.ai. `npx shadcn@latest add
dropdown-menu`. Items: **Rename** (inline edit or a small `Dialog` →
      `PUT /api/sessions/:id` title), **Delete** (confirm → existing
      `DELETE /api/sessions/:id`), **Copy link** (the session deep link).
      _Acceptance:_ hover a chat → `⋯` appears → menu works; delete confirms and
      removes; rename persists; keyboard-accessible; oracle green.
- [x] **F3 — Search / filter chats.** A search affordance in `SidebarHeader`
      (icon that expands to an `Input`, or a `Command` palette on Cmd/Ctrl-K)
      that live-filters sessions by title, with a "no matches" empty state.
      _Acceptance:_ typing filters the list; clearing restores; focus management
      and Escape behave.

#### Sidebar refinement

- [x] **F4 — Session row polish.** On the `SidebarMenuButton`: calm hover/active/
      focus-visible states, the agent mark, title truncation with the
      surface-count as a quiet parenthetical, a refined unread dot, vacant-session
      dimming. Match claude.ai spacing/type. _Acceptance:_ rows feel responsive
      and quiet; active state is unmistakable but not loud.
- [x] **F5 — Group headers & density.** Refine the Today/Yesterday/Earlier labels
      (size, tracking, spacing); tune row density and the scroll area
      (`ScrollArea` if it improves the look). _Acceptance:_ the list reads as a
      calm, scannable history.
- [x] **F6 — Sidebar header & footer.** Polish the `showcase` wordmark + live
      dot; place the collapse `SidebarTrigger` cleanly; fold the footer links
      (design guide / agent setup / connect Claude Code) into a tidy cluster or a
      footer `DropdownMenu`/settings affordance. _Acceptance:_ header and footer
      feel intentional, not leftover.

#### Broader viewer polish

- [x] **F7 — Top header bar.** The session-title row (`SessionView` head):
      typography for the editable title, the meta line, spacing, and a home for
      per-session actions if they move here. Make it a proper app header.
- [x] **F8 — Surface card refinement.** Tune card elevation/radius/spacing, the
      `card-head` (title + version `Select` sizing + timestamp), and the spacing
      between parts. Keep `.card`/`.card-title` hooks.
- [x] **F9 — Chat thread micro-polish.** Enter-to-send affordance + a send
      **icon** button (lucide) instead of the "Comment" label; group consecutive
      same-sender bubbles (tighter stack); auto-scroll to the newest message;
      refined optimistic/pending bubble; timestamps on hover. Keep
      `.thread .cmt.user` carrying the comment text (no sender label).
- [x] **F10 — Empty & loading states.** `Skeleton` placeholders for the session
      list and the stream while loading; a polished empty board, empty session,
      and the onboarding/connect card. _Acceptance:_ nothing ever looks blank or
      janky on first paint.

#### Systemic polish (apply across the app)

- [x] **F11 — Icon consistency.** Replace ad-hoc glyphs (`✕`, `⧉`, `☰`, the
      comment/link/open/trash inline SVGs in `icons.tsx`) with a consistent
      `lucide-react` set (already a dep). Uniform sizing/stroke/alignment.
- [x] **F12 — Motion pass.** Subtle, fast enter animations for cards and chat
      messages (use `tw-animate-css`, already imported), hover transitions, and
      the sidebar collapse easing. Gate everything behind
      `motion-reduce:` / `prefers-reduced-motion`.
- [x] **F13 — Toasts → shadcn `Sonner`.** Replace the hand-rolled `#toast` in
      `App.tsx` + the `toast()` in `state.ts` with shadcn `Sonner`
      (`npx shadcn@latest add sonner`). _Acceptance:_ same call sites, nicer toasts.
- [x] **F14 — Type & spacing system.** A consistent type scale and spacing rhythm
      across sidebar, header, cards, and chat — the unifying pass once F1–F13 land.
- [x] **F15 — Dark-mode review.** Walk every screen in dark (`prefers-color-
scheme: dark`) after the above and fix contrast/elevation. The theme bridge
      means most adapts automatically — this catches the gaps.

#### Tech-debt sweeps (independent, low-risk; good warm-ups)

- [x] **F16 — Guide freshness.** Sweep `guide/AGENT_HOWTO.md` + `DESIGN_GUIDE.md`
      for stale wording left by the theming/timeline removal (e.g. the trace part
      described as a "timeline").
- [x] **F17 — Multi-theme engine deleted.** Collapsed to one fixed theme
      (GitHub light/dark): removed the 6 other presets, the `/api/theme` routes +
      `theme-changed` event + viewer switcher plumbing, and the now-dead
      board-settings store. The single palette still feeds chrome vars, sandboxed
      part tokens, and shiki/mermaid theming.

**Running this backlog autonomously:** go top-to-bottom (F1 first — it's load-
bearing). For each: branch, implement, run the verify suite, screenshot desktop

- mobile and look, fix until it's genuinely polished (not just functional), then
  merge to `main` and move on. Pause and ask the user only on the items marked
  "confirm with the user" (F17) or if a task can't keep the oracle green.

---

## 7. Open decisions (flag to the user before building the affected pillar)

- **Pillar A engine:** plain `@anthropic-ai/sdk` agent loop (full control, build
  the tool surface ourselves) vs the **Claude Agent SDK** (Claude Code's engine,
  bash/file/MCP/subagents out of the box). The Agent SDK is the strongest fit for
  a "local Claude Code in the browser"; the plain SDK is leaner for an
  explainer-focused assistant. Confirm which.
- **Pillar A tool surface:** explainer-only (publish_surface + web tools) vs
  full coding agent (also bash/edit). Affects the security posture.
- **API key handling:** read `ANTHROPIC_API_KEY` from env; confirm where it lives
  (`.env`, shell). Never commit it.
- **Auth/sharing for Pillar B live share:** the one-board/one-user stance means
  shared views should default to read-only.

---

## 8. Picking up work in a background session

1. Read sections 1–5 of this file and `AGENTS.md`.
2. `git branch --show-current` — if not on a task branch, branch from `main`.
3. Pick a pillar/item; if it's Pillar A or another "open decision" item, confirm
   the decision in §7 first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
