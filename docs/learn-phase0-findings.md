# Learn mode - Phase 0 findings

Read-only recon of the codebase before implementing the learn vertical. Maps the
plan doc's assumptions (TODO.md section "Learn mode") to how the repo actually
works, and lists every divergence with the correction taken forward.

## How the existing mechanics actually work

### Blueprint registration

Blueprints live in `packages/core/blueprints.ts` (not a server module). The
built-ins ship inline in `BLUEPRINTS`; user config layers over them via
`registerBlueprints` at boot (`server/userConfig.ts`). A blueprint is defaults
only (theme, kits, structure skeleton, default badge); `resolveBlueprint`
gap-fills at publish and the resolved theme/kits are baked into the stored
surface. Adding `learn` means one more entry in `BLUEPRINTS` - nothing else.

### Typed preset renderers

`packages/server/presetRenders.ts` maps preset id to a renderer:
`(input: unknown) -> { title, parts, badge }` - defensive coercers (`s()`,
`arr()`, `obj()`), every agent string escaped, ONE surface out. The publish flow
(`publishPreset` in `app.ts`) pins the matching blueprint. `publish_postmortem`
is the closest analog, but it emits a single html part; a lesson cannot be one
html part because checkpoints must be interactive trusted-viewer components.
See divergence D4.

### Comment persistence and the three delivery channels

Comments are rows in `JsonFileStore` with a global `seq`. Delivery to the agent
is exactly-once via the per-session `agentSeq` cursor, serialized under
`withCursorLock` in `app.ts`:

1. **Piggyback** - `collectFeedback` runs on every agent write (publish, update,
   reply) and attaches unseen `author === "user"` comments.
2. **Blocking wait** - `waitForComments` (GET `/api/comments?wait=N` /
   `wait_for_feedback`) long-polls with settle-window batching.
3. **Watch stream** - the CLI `watch` re-arms the same long-poll forever.

All three advance the same server-side cursor, which is what makes riding
telemetry on comments (rather than a parallel channel) the correct C6 move.

Crucially, `author: "user"` is a **reserved trust label**: the sandbox bridge
(`viewer/src/bridge.ts`) deliberately stamps sandbox-originated `sendPrompt`
messages `author: "surface"` so agent-authored content cannot impersonate the
user. Telemetry must respect this boundary - see divergence D7.

### JsonFileStore contract

Whole board in memory, rewritten to one JSON file per mutation with coalesced
flushes, `.tmp` rename + `.bak` mirror, corruption recovery from `.bak`.
`test/storeContract.ts` holds the interface honest; `test/jsonFileStore.test.ts`
runs it plus persistence-specific cases. The MasteryStore copies this pattern
(atomic write, backup, corrupt-file recovery) as its own small class - it does
NOT extend the board `Store` interface (review data stays untouched, C4).

### Sandbox rendering path and where the bridge attaches

Two paths, both ending in an opaque-origin `sandbox="allow-scripts"` iframe:
html parts load `/s/:id?part=N` (server-rendered `renderHtmlPage`); rich parts
(markdown/mermaid/diff/code) render to a string in the viewer and load via
`srcdoc` (`renderSandboxedPart`). Both docs embed `BRIDGE_JS` from
`core/surfacePage.ts` - the one trusted script injected into every sandbox doc.
That is where `showcase.emit()` goes. The host side is `onBridgeMessage` in
`viewer/src/bridge.ts`, which already gates on `__showcase` + frame identity
(`frameForSource` / `isOwnFrame`). The telemetry forward hooks in there. CSP in
the sandbox has no `connect-src`, so postMessage → trusted bridge → server POST
is the only route out - exactly the design the plan wants.

### MCP tool registration

`packages/core/mcpSpec.ts` is the single schema source: `HTTP_MCP_TOOLS` (JSON
Schema, served by `tools/list`), `HTTP_MCP_TOOL_SCHEMAS` (zod, validates
`tools/call`), `STDIO_MCP_INPUT_SCHEMAS` (zod raw shapes for the SDK), and
`MCP_TOOL_DESCRIPTIONS`. The HTTP transport dispatches in
`server/mcpHttp.ts:callTool`; the stdio transport (`packages/mcp/server.ts`) is
a thin HTTP client that posts to the REST routes. New tools touch all four
tables plus both transports.

### CLI command registry

One `Command` per subcommand under `packages/cli/commands/`, aggregated in
`registry.ts`. `defineCommand` derives parseArgs config + help + completions
from one option spec. Session resolution (`session.ts`) walks the process tree;
`http.ts#api` maps errors and auto-starts the server. Zero runtime deps. New
commands are a `commands/learn.ts` module in the registry.

### e2e oracle structure

Playwright on port 8231 with `SHOWCASE_DATA=/tmp/showcase-e2e.json`, seeding via
`request.post` against the REST API and asserting on light-DOM card chrome
(sandboxed content is unreachable by design). The lesson oracle follows the same
shape. The webServer env needs a `SHOWCASE_MASTERY` temp path so e2e runs don't
touch a real mastery file.

### `showcase demo`

`commands/board.ts` `demo` posts sessions/surfaces from `cli/demoData.js`
(dependency-free). Demo lessons ride the same command, posting to the new
`POST /api/lessons` route.

## Divergence list (plan doc vs repo)

- **D1 - no `packages/core/src/`.** Core files live at the package root.
  `lesson.ts` and `mastery.ts` land as `packages/core/lesson.ts` /
  `packages/core/mastery.ts`.
- **D2 - no `skills/code-review/` in this repo.** The repo ships
  `skills/showcase/` and `skills/session-presets/` only (the code-review skill
  lives outside this fork). The A1 README retrofit applies to the two skills
  that exist here.
- **D3 - blueprints are core, not server.** "packages/server/blueprints" in the
  plan's delta map is `packages/core/blueprints.ts`.
- **D4 - a lesson is a session of surfaces, not one preset surface.**
  `PRESET_RENDERERS` produce one surface; the lesson form factor is a syllabus
  card plus one card per beat, and checkpoints must be trusted-viewer
  interactive components (not sandboxed html). So `publish_lesson` gets its own
  shared flow (`publishLesson` in `app.ts`) that publishes a surface sequence,
  and the layout owner (C8) is `renderLessonSurfaces`/`renderBeatParts` in
  `core/lesson.ts` - deterministic data/string building, byte-for-byte stable.
- **D5 - a new `checkpoint` part kind instead of `Checkpoint.prompt: Part[]`.**
  Checkpoints are data rendered by trusted React components, so they are a new
  `SurfacePart` kind (`{ kind: "checkpoint", checkpoint }`). `prompt` and
  `reveal` are markdown-ish plain strings (rendered as text nodes) plus an
  optional structured `code` block, not nested `Part[]` - nested arbitrary
  parts would complicate byte accounting, validation, and the viewer for no
  pedagogic gain. Beat `model` / `workedExample` slots DO accept real parts
  (markdown, mermaid, code, diff, chart, image), which is what codebase tours
  need (plan §4.5).
- **D6 - mastery persists to one JSON file, not a directory per topic.**
  `~/.showcase/mastery.json` (override: `SHOWCASE_MASTERY`), topics keyed
  inside - same JsonFileStore pattern (atomic write + `.bak` + corruption
  recovery), far less fs surface. Plainly inspectable/editable as required.
- **D7 - telemetry provenance is two-tier, and the sandbox tier is marked.**
  Telemetry rides the comment pipe literally: each event is persisted as a
  comment with a fixed machine prefix (`[checkpoint] …`, `[explorable] …`) so
  it inherits exactly-once delivery from the `agentSeq` cursor with no second
  channel. Events from trusted viewer components (checkpoint attempts, skips,
  gate passes, confusion flags) are `author: "user"` - they ARE genuine
  trusted-origin user acts, same as the composer. The one sandbox-emitted type
  (`explorable_interaction`) is forwarded by the bridge only after closed-union
  validation with tight caps (name `[\w.-]{1,64}`, value ≤ 200 chars, single
  line) and is formatted server-side into a fixed `[explorable] name=value`
  line - sandbox scripts can never inject free text that reads as the human.
  This is recorded in the §6.3 security checklist walkthrough.
- **D8 - one added MCP tool beyond the plan's three.** `record_attempt` (agent
  grades an `explain`/`completion`/`apply` answer into the mastery store).
  Without it, agent-graded checkpoint outcomes - the P6 capability - could
  never reach mastery, since client-side grading only covers mcq/choice/exact
  kinds. Justified under operating rule 5 in the final report.
- **D9 - syllabus live-updating is server-driven.** Rather than a bespoke
  viewer subscription, the telemetry route recomputes the syllabus mermaid and
  revises the syllabus surface through the ordinary update path, so the
  existing `surface-updated` SSE + viewer refetch machinery animates the badges
  with zero new viewer plumbing. (Plan open question 1: resolved as "reuse".)
- **D10 - session kinds stay `review`/`visual`.** Learn sessions are `visual`
  sessions pinned to the `learn` blueprint; the sidebar needs no third kind for
  the loop to work. Header chip roll-ups (plan §6.5) are driven by the syllabus
  badge counts instead.
- **D11 - `TODO.md` is uppercase** and is a curated roadmap doc; the learn plan
  is added as a new roadmap section rather than replacing it.
- **D12 - e2e/demo env.** Playwright boots the real server with
  `SHOWCASE_DATA`; the mastery store needs the parallel `SHOWCASE_MASTERY`
  override for isolation (added).

## Naming/path conventions confirmed

- Core: flat files, `.ts` relative imports, zod available in core
  (`surfaceParts.ts` already imports it), **no `node:` imports** (CI-enforced).
- Server: flows as plain functions inside `createApp`, routes `app.<verb>`,
  broadcast via `bus.broadcast`, errors as `{ error, status }` unions.
- Tests: `test/*.test.ts`, node:test + assert/strict, `makeApp()` per test with
  a tmpdir store, `app.request(path, init)` (no listening socket).
- Viewer: one component file per part kind (`XPart.tsx`), dispatched in
  `Card.tsx`; zustand for shared state (`state.ts`).
- Ports: 8229 dev, 8231 e2e. Env prefix `SHOWCASE_`.
- No em-dash rule (C9) applies to newly authored prose in skills/README/docs
  copy for the learn vertical.
