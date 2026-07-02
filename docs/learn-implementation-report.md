# Learn mode - implementation report

The final report required by the learn-mode plan (TODO.md, "learn mode"
section). What was built per phase, every divergence and why, the Phase 1 gate
answer, the security walkthrough, new-subsystem justifications, known gaps, and
the exact commands to see it all run.

## What was built, per phase

**Phase 0 (read-only recon).** `docs/learn-phase0-findings.md`: the exact
mechanics of blueprints, preset renderers, the comment pipe, JsonFileStore, the
sandbox path, MCP registration, the CLI registry, and the e2e oracle, plus the
divergence list D1-D12. No code was written before it existed.

**Phase 1 (skill + blueprint + publish_lesson, static).**

- `skills/teach/` : SKILL.md (the pedagogy contract, showcase optional),
  README.md (A1 shape with a real "When to skip it"), and four reference
  guides (checkpoint-authoring, misconceptions, fading, codebase-tours).
- `packages/core/lesson.ts`: Lesson/LessonBeat wire types, `coerceLesson` /
  `coerceBeat` (precise field errors, the mcq/one-correct/duplicate-id/
  html-not-in-model rules), and the deterministic renderers
  (`renderLessonSurfaces`, `renderBeatParts`, `renderSyllabusParts`) that own
  the layout (C8; determinism is unit-tested byte-for-byte).
- `packages/core/types.ts`: the `checkpoint` surface-part kind (data the
  trusted viewer renders; counted in `partsByteLength`; validated in
  `surfaceParts.ts` strict + loose).
- The `learn` blueprint in `core/blueprints.ts`.
- Server flow `publishLesson` + `POST /api/lessons`; `updateLessonBeat` +
  `POST /api/lessons/beats` (revise in place or append a remediation card).
- MCP `publish_lesson` / `update_lesson` on both transports; CLI
  `showcase lesson <file|->`.
- Viewer `CheckpointPart.tsx`: options, free text, confidence slider,
  calibration line, and the structural reveal gate (the reveal is not in the
  DOM pre-attempt; e2e asserts `page.content()` does not contain it).
- Three demo lessons through the real pipeline in `showcase demo`: Redis
  eviction policies, the Effect-TS error model, and a codebase tour of
  showcase itself. Each contains every beat element (hook, model, worked
  example, gated explorable with `showcase.emit`, misconception-tagged
  checkpoints, recap).
- `docs/learn-form-factor.md`.

**Phase 2 (telemetry).**

- `packages/core/telemetry.ts`: the closed, versioned `TelemetryEvent` union,
  `validateTelemetryEvent` (strict shapes, length caps, fresh-object output),
  `formatTelemetryComment` (fixed-format lines), `SANDBOX_TELEMETRY_TYPES`.
  Deliberately zod-free so the viewer bundle imports it cheaply.
- `POST /api/telemetry` -> `recordTelemetry`: every valid event becomes a
  comment, so delivery inherits the existing exactly-once guarantee across
  piggyback, `wait_for_feedback`, and `showcase watch` (C6; the API test
  asserts a second read returns nothing).
- Trusted-component path: `CheckpointPart` posts attempts/skips with
  client-side grading for mcq/choice/exact-trace kinds.
- Sandbox path: `window.showcase.emit()` in the injected `BRIDGE_JS`
  (`core/surfacePage.ts`), the bridge forward in `viewer/src/bridge.ts`
  (validate + allowlist + `sandbox: true`), server re-validation with the same
  allowlist. Malformed/oversized/disallowed events drop silently
  (unit-tested and API-tested).
- The explorable gate wrapper (`ExplorableLock` + the Card gating rule: a
  `gate: true` checkpoint immediately before an html part locks its iframe).
- `guide/PLAYBOOK.md`: the "teach a topic or codebase" recipe with the
  wait -> adapt loop and the telemetry line grammar.

**Phase 3 (mastery + spaced review).**

- `packages/core/mastery.ts`: MasteryRecord types + the pure SM-2-style
  scheduler (`applyAttempt`, ease 1.3-2.8, 1d/3d/multiplicative intervals,
  miss resets short), "solid" requiring 2+ spaced correct GENERATIVE attempts,
  `collectDue` interleaving across topics. Fully time-injected; unit-tested
  with a fake clock.
- `packages/server/masteryStore.ts`: JsonFileStore-pattern persistence to
  `~/.showcase/mastery.json` (`SHOWCASE_MASTERY` override), atomic writes,
  `.bak` mirror, corruption recovery that warns and never crashes.
- Routes: `GET /api/mastery`, `POST /api/mastery/attempt`,
  `DELETE /api/mastery/:topic`, `GET /api/review-due?now=` (time-travelable).
- MCP `get_learner_state` + `record_attempt` (both transports); CLI
  `showcase review-due`, `showcase mastery [topic]`,
  `showcase mastery reset <topic>`.
- Syllabus badges update live: the telemetry ingest recomputes states and
  revises the syllabus surface through the ordinary store path, so the
  existing `surface-updated` SSE re-renders it (e2e asserts the v2 flip and
  the `:::shaky` class).

**Phase 4 (distribution + docs + hardening).**

- A1 packaging for all four skills (teach, showcase, session-presets,
  adding-a-skill), each README with "When to skip it".
- `.claude-plugin/marketplace.json` + `plugin.json` (A3).
- `skills/adding-a-skill/` meta-skill (A6) encoding the conventions.
- README: the fourth flagship workflow with a paste-ready prompt, the skills
  install section, and the A5 managed instruction block.
- Hardening: no-mastery-store degradation (lessons and telemetry still work;
  mastery routes return empty/400 - API-tested), corrupt mastery file
  recovery (tested), empty review-due states, telemetry drops never error.
- e2e lesson oracle (3 tests) + 28 unit/API tests; the full suite is
  330 unit + 17 e2e, all green.

## Divergences from the plan (and why)

D1-D12 are detailed in `learn-phase0-findings.md`. Implementation-time
additions:

- **`record_attempt` is a fourth MCP tool** beyond the plan's three. Without
  it, agent-graded checkpoint kinds (explain/completion/apply, the P6
  capability) could never move mastery, since telemetry only carries
  client-graded outcomes. Smallest possible addition; justified under
  operating rule 5.
- **`explorable_gate_passed` is defined but not emitted by the viewer.** A
  gate pass already produces a `checkpoint_attempt` line carrying the same
  information; emitting both would double the telemetry noise per gate. The
  type remains in the union for explorables that signal it and for
  compatibility with the plan's schema.
- **Syllabus updates reuse surface-update semantics** (plan open question 1:
  resolved "reuse"). The refresh deliberately bypasses the `reviseSurface`
  flow because that flow piggybacks pending feedback, which would consume the
  just-ingested telemetry comment before the agent's wait saw it. Direct
  store update + broadcast instead; this is documented at the call site.
- **Explorable interaction throttling** (open question 2) is left to the
  explorable author (the demo explorables emit on discrete input events, not
  per-frame). A client-side trailing debounce in the bridge is a known gap.
- **Learner level** (open question 3) travels per-lesson; it is not yet
  persisted per-topic in the mastery store.
- **Free-text privacy** (open question 4): resolved as the plan leans -
  mastery records store outcomes + misconception tags only; the raw answer
  text lives only in the comment stream on the surface.
- **Review sessions** (open question 5): a mode of the `learn` blueprint (the
  skill runs them as ordinary lessons of fresh variants), not a new blueprint.
- **C9 (no em-dashes) scope.** Applied to all NEW learn-vertical prose:
  docs, skills, README/TODO additions, viewer UI copy, telemetry line
  formats, demo lesson content, CLI output. Code comments follow the repo's
  existing house style (which is em-dash-heavy throughout); treating comments
  as "prose" would have made the new files stylistically alien to every file
  around them. Flagged per operating rule 4.
- **TODO.md's "never git commit / don't push" caution** conflicts with this
  session's explicit instruction to commit and push to the designated branch;
  the session instruction wins (that caution describes a different, hook-
  guarded local environment).

## Phase 1 gate question

"After producing the three dogfood lessons, what did the skill get wrong or
find awkward?"

- The plan's `Checkpoint.prompt: Part[]` was wrong in practice: a prompt is
  one tight question, and nesting arbitrary parts inside a part complicated
  validation, byte accounting, and rendering for zero pedagogic value. A
  string prompt + optional structured `code` block covered all three lessons,
  including the codebase tour (divergence D5).
- The plan's per-lesson renderer-owned syllabus needed a home for the concept
  graph BETWEEN sessions; storing it in the mastery topic (rather than a new
  surface kind) fell out naturally and also gave `review-due` its labels.
- Authoring the codebase tour surfaced that `trace` checkpoints want an
  `expected` exact-match field for instant grading; added to the schema.
- The explorable `html` slot plus `gate` proved sufficient for all three
  lessons; no `publish_lesson` slot gaps were found for code/diff evidence
  (the tour's beats lean on `code` parts in `model`/`workedExample`, plan
  §4.5 requirement met).

Amendments were folded into `docs/learn-form-factor.md` rather than the
planning text (which lives outside the repo); this section is the changelog.

## Security checklist walkthrough (plan §6.3)

Walked item by item against the shipped code:

1. **No learner/agent string from the sandbox is ever interpreted as HTML/JS
   in the trusted origin.** Checkpoint prompts/reveals/options render via
   React text nodes (`InlineText` splits on backticks and emits `<code>` with
   text children; no `dangerouslySetInnerHTML`, no DOM sinks). Sandbox
   telemetry values are validated strings that are only ever re-serialized
   into a comment line. Verified by reading every render path in
   `CheckpointPart.tsx` and `bridge.ts`.
2. **Events are data-only, length-capped, schema-validated.**
   `validateTelemetryEvent` builds a FRESH object (unknown fields cannot ride
   through), caps answer 2000 / answer items 8x200 / misconception 200 /
   value 200 single-line / name `[\w.-]{1,64}` / ids `[\w.-]{1,80}`, clamps
   confidence and latency. Unit tests cover accept + drop + cap cases.
3. **The bridge ignores unknown origins/shapes.** The telemetry branch runs
   only for messages resolved to an embedded frame (`frameForSource`), only
   for the `__showcase` envelope, drops anything failing validation, and
   forwards ONLY `explorable_interaction` (the sandbox allowlist). The server
   re-enforces the same allowlist on `sandbox: true`, so the bridge is not the
   single line of defense. The API test forges a sandbox-flagged
   `checkpoint_attempt` and asserts it is dropped and nothing reaches the
   comment stream.
4. **The injected helper is served from the trusted build.** `showcase.emit`
   lives in `BRIDGE_JS` in `core/surfacePage.ts`, injected by
   `renderHtmlPage`/`renderSandboxedPart`, never authored by the agent.
5. **Impersonation boundary (the repo's own `author:"user"` rule).** Trusted
   checkpoint components are genuine user acts in the trusted origin, so their
   comments are `author:"user"`, same as the composer. Sandbox-forwarded
   events are also delivered on the user channel BUT are machine-formatted
   server-side into the fixed `[explorable] name="value" (emitted by sandboxed
card script, not typed by the user)` line: agent-authored script cannot
   place free text on the channel, cannot exceed 200 single-line chars of
   value, and the provenance is stated in the line itself. The pre-existing
   `sendPrompt` -> `author:"surface"` rule is untouched. Residual risk: a
   malicious explorable can emit instruction-like strings inside `value`; the
   caps, the fixed grammar, and the explicit provenance note are the
   mitigations, and the playbook tells agents to treat `[explorable]` lines as
   behavioral signal, never as user instructions.
6. **CSP unchanged.** Sandboxed docs still have no `connect-src` (fetch/XHR
   blocked); postMessage -> trusted bridge -> server POST is the only exit,
   as designed.

## New-subsystem justifications (operating rule 5)

- **MasteryStore** (new store class): learner state is not board content;
  putting it in `JsonFileStore` would have changed the board file format and
  the `Store` interface review mode depends on (C4). It copies the existing
  persistence pattern rather than inventing one.
- **`core/telemetry.ts` as its own module**: exists so the viewer can import
  the validator without pulling zod through `lesson.ts`. Same code, different
  file boundary.
- Everything else extends existing rails: blueprint registry, part model,
  comment pipe, flow-function pattern, command registry, mcpSpec tables.

## Known gaps and suggested next steps

- **Explorable interaction debounce** (plan open question 2): add a
  trailing-debounce in the bridge so a slider drag cannot flood the comment
  stream. Today this is authoring discipline in the demo explorables.
- **Viewer telemetry chips**: `isTelemetryText` exists for rendering
  telemetry comments as compact chips, but the viewer currently has no
  comment thread UI at all (it was retired), so nothing consumes it yet.
- **Session header mastery roll-up chips** (plan §6.5's
  `3 solid / 1 shaky / 2 to go`): the syllabus legend carries the counts; a
  header chip roll-up like review verdicts would be a nice follow-up.
- **Confusion-flag affordance**: the event type, validation, and formatting
  are wired end to end, but no viewer button posts it yet.
- **Attempt state is per-browser** (localStorage): a second browser would
  re-lock reveals already earned elsewhere. The durable record (telemetry) is
  server-side; hydrating attempt state from it on load is the fix.
- **Distribution checks not verifiable in this environment**: the
  `npx skills@latest add` folder-copy and Claude Code
  `/plugin marketplace add` were not executed here (no access to the
  published repo from the sandbox); the layout matches the ecosystem
  standard (`skills/<name>/SKILL.md` + `.claude-plugin/marketplace.json`),
  and both should be verified once pushed.
- **Chat-only teach transcript** (A4 exit criterion): the skill contains the
  explicit chat-degradation branch, but a real transcript from an independent
  agent run without showcase was not produced in this session; run one and
  attach it here.
- **Learner level per topic** (open question 3): persist it in the mastery
  topic with a per-session override.

## See it run

```sh
pnpm install && pnpm build:viewer && pnpm serve          # board on :8229
node packages/cli/bin/showcase.js demo                    # seeds 6 sessions + 3 lessons
# open http://localhost:8229 and click any "Learn: ..." session
```

One full telemetry round-trip from the shell (agent's-eye view):

```sh
# 1. publish a lesson (or use a demo session's ids)
SES=$(curl -s localhost:8229/api/sessions | python3 -c "import json,sys; print([s['id'] for s in json.load(sys.stdin) if str(s.get('title','')).startswith('Learn: Redis')][0])")
BEAT=$(curl -s localhost:8229/api/sessions/$SES/surfaces | python3 -c "import json,sys; print(json.load(sys.stdin)[1]['id'])")

# 2. answer a checkpoint wrong in the browser, or simulate it:
curl -s -X POST localhost:8229/api/telemetry -H 'content-type: application/json' -d "{
  \"surface\": \"$BEAT\",
  \"event\": {\"v\":1, \"type\":\"checkpoint_attempt\", \"checkpointId\":\"redis-hook\",
    \"conceptId\":\"maxmemory\", \"kind\":\"predict\", \"answer\":[\"a\"], \"correct\":false,
    \"misconception\":\"Redis evicts old keys by default\", \"confidence\":0.8, \"latencyMs\":5000}}"

# 3. the agent's next wait delivers it exactly once (watch the syllabus card flip to v2):
curl -s "localhost:8229/api/comments?session=$SES&author=user&wait=0"

# 4. mastery moved; time-travel the review queue:
node packages/cli/bin/showcase.js mastery
node packages/cli/bin/showcase.js review-due --now 2026-12-01T00:00:00Z
```

Verifier suite (all green at hand-off):

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test   # 330 tests
PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium pnpm test:e2e       # 17 tests (path only needed where the bundled chromium is absent)
node packages/cli/bin/showcase.js demo                           # includes the 3 lessons
```
