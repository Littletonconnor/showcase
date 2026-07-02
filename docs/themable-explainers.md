# Themable explainers — blueprints

_A design north star for making explainers reusable, brand-able, and
user-extensible. An **explainer blueprint** is a named, declarative bundle that
composes the axes showcase already has (theme + kits) and adds two it doesn't
(structure + brand) — loadable from user config so a person can define their own
without touching the binary. If an implementation drifts, come back here._

> **Shipped.** All four phases below are built (`server/blueprints.ts`,
> `server/userConfig.ts`, the `blueprint` field threaded through
> types/storage/app/MCP/CLI, brand injection in `renderHtmlPage`, and the
> `data-section` labelling in the animate kit). Built-in blueprints: `product-demo`
> and `concept`. The doc is the rationale; the code is the source of truth.
>
> **Update (session presets).** Blueprints are now **session-scoped presets**: a
> session carries a `blueprint`/`theme` (`Session` in `types.ts`), pinned by the
> first publish (or the `configure_session` MCP tool / `PATCH /api/sessions/:id`),
> and every later surface inherits it — so a whole session stays in one format.
> Config now layers **repo** (`<cwd>/.showcase`) over **user** (`~/.showcase`),
> and a `config.json` sets a board **default preset** for new sessions. Built-in
> presets expanded to: `design-doc` (the team RFC template), `architecture`,
> `data-viz`, `postmortem` (5-Whys), `status`, `product-demo`, `product-mockup`,
> `concept`. A theme can be derived from seed colors (`server/themeDerive.ts`,
> `POST /api/themes`) — see `docs/theme-building.md`. The `session-presets` skill
> drives the loop. Gallery: `docs/images/presets/`.

---

## The problem

An "explainer" today is not an object — it's a **recipe in prose**
(`guide/PLAYBOOK.md` → "Recipe: animated explainer"). The agent assembles one by
hand each time: an `image` part of the thing, plus an `html` part with
`kits:["animate"]` whose `.step` children build up under a play/scrub bar. Good
result, but everything that makes it _this user's_ explainer is re-derived on
every publish and lives only in the agent's head.

That means "themable" today buys almost nothing. A surface carries `theme`, but a
theme is **palette only** — it flips colors. It cannot:

- pin a **structure** ("a product demo always goes hook → problem → feature →
  proof → CTA");
- carry **brand** (logo, wordmark, product font, a screenshot frame);
- fix a **kit composition** (`animate` alone vs `animate` + a chart vocabulary);
- be **defined by the user** — themes and kits are hardcoded arrays compiled into
  the binary (`THEMES` in `server/themes.ts`, `KITS` in `server/kits.ts`).

The two things the user actually wants sit on opposite ends of one axis:

1. **Product demos** — _"always the same structure and format, visuals that match
   my product."_ Rigid skeleton, brand palette, brand assets. Consistency is the
   point.
2. **General explainers** — _"more basic, more graphs and stuff."_ Loose
   structure, neutral palette, chart-forward. Flexibility is the point.

Both are the same primitive — a parameterized explainer — with different defaults.
What's missing is a place to **name and store those defaults**, compose them from
the pieces that already exist, and let a user **add their own**.

---

## The shape: a blueprint

A **blueprint** is one level _above_ themes and kits — the composition layer. It
doesn't replace anything; it bundles existing primitives and adds structure +
brand on top.

```jsonc
{
  "id": "product-demo",
  "label": "Product demo",
  "summary": "Branded walkthrough — fixed five-beat arc, product palette + logo",
  "extends": null, // optional: inherit another blueprint, then tweak

  "theme": "acme-brand", // a theme id (built-in OR user-defined)
  "kits": ["animate", "mockup"], // default kit composition for the html part

  "structure": [
    // the ordered skeleton — what makes it "always the same"
    { "id": "hook", "label": "Hook", "hint": "Lead with the outcome or the surprise" },
    { "id": "problem", "label": "Problem", "hint": "The pain before the product" },
    { "id": "feature", "label": "Feature", "hint": "Show the thing doing the thing" },
    {
      "id": "proof",
      "label": "Proof",
      "hint": "A number, a before/after, a quote",
      "required": true,
    },
    { "id": "cta", "label": "Next step", "hint": "What the viewer does now" },
  ],

  "brand": {
    // optional: injected into the rendered html head
    "logoAssetId": "asset_…",
    "wordmark": "Acme",
    "fontFamily": "Inter, system-ui",
  },

  "defaults": { "badge": { "tone": "info", "label": "Demo" } },
}
```

The "general explainer" end of the axis is the same primitive, looser:

```jsonc
{
  "id": "concept",
  "label": "Concept explainer",
  "summary": "Teach an idea — neutral palette, charts welcome, free structure",
  "theme": "neutral",
  "kits": ["animate"],
  "structure": [
    { "id": "question", "label": "Question", "hint": "The thing that's confusing" },
    { "id": "mechanism", "label": "Mechanism", "hint": "Reveal it beat by beat" },
    { "id": "payoff", "label": "Payoff", "hint": "Why it now makes sense" },
  ],
}
```

### Why these fields, mapped to the existing system

| Field       | Reuses                                                       | New                                               |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `theme`     | `surface.theme` + the whole token pipeline (`tokenThemeCss`) | —                                                 |
| `kits`      | `htmlPart.kits[]` + `kitAssets()` injection                  | —                                                 |
| `structure` | —                                                            | named, ordered sections the agent authors against |
| `brand`     | `upload_asset` for the logo                                  | head injection of logo/wordmark/font              |
| `extends`   | —                                                            | blueprint inheritance                             |

Two genuinely new ideas — **structure** and a **user config layer** (below).
Everything else is composition of primitives that already ship.

---

## Resolution: defaults, never a straitjacket

A blueprint is **gap-filling defaults**. Explicit values on the surface or part
always win. This keeps the "customizable" promise: a blueprint sets the baseline,
the agent overrides any beat.

At publish/revise time the server resolves in this order (most specific wins):

1. **Theme** — `surface.theme` if set, else `blueprint.theme`, else board default.
   (Mirrors the existing `?theme=` → `surface.theme` → `DEFAULT_THEME_ID` chain in
   `GET /s/:id`.)
2. **Kits** — an html part's own `kits` if it set any, else `blueprint.kits`.
   (Per part, so a chart part can opt out of the demo's `mockup`.)
3. **Brand** — `blueprint.brand` injected into the html head (logo/wordmark/font
   variables) unless the part already declares its own.
4. **Badge / mode** — `blueprint.defaults` fill only when unset.

So `blueprint` joins `theme` as a surface-level field that **expands into**
existing per-surface/per-part fields. Nothing downstream — versioning, comments,
the static export, the sandbox — needs to know blueprints exist; by the time a
surface is stored it's a normal surface with a resolved theme and resolved kits.

```
publish_surface({ blueprint: "product-demo", parts: [...] })
        │
        ▼  resolve (server)
surface.theme   ← "acme-brand"          (blueprint filled the gap)
part.kits       ← ["animate","mockup"]  (part declared none → blueprint's)
head            ← logo + font vars      (brand)
        │
        ▼  store + render — an ordinary themed surface, no special-casing
```

---

## "Customizable and extendable" — the config layer

This is the architectural shift. Today registries are **static**: author in the
array, recompile. To let a user define _their_ product demo, registries become
**layered** — built-ins seed the registry, and user-authored definitions load
from config and win on id collision.

At boot the server reads (under `SHOWCASE_DATA`, or a dedicated `SHOWCASE_CONFIG`):

```
~/.showcase/
  themes/      *.json   →  a Theme (the brand palette)
  kits/        *.json   →  a Kit   ({ id, label, css, js? } — your product's chrome)
  blueprints/  *.json   →  a Blueprint (composes the above + structure + brand)
```

```
registry = [ ...BUILT_IN, ...loadUserDefs(dir) ]   // user id wins on collision
```

One mechanism, three payoffs — and together they deliver exactly the user's two
modes:

- **Brand theme** → _"visuals that match my product."_ A palette is just 21
  color slots × 2 schemes; a user authors one as JSON, no code.
- **Brand kit** → custom visual vocabulary (card frame, product font, a
  screenshot bezel) beyond palette.
- **Brand blueprint** → ties theme + kit + structure + logo into the reusable
  "product demo," referenced by id forever after.

**Extend two ways:**

- _Compose_ — `"extends": "product-demo"` then override a field (swap the theme
  for a sub-brand, add a section). Inheritance, resolved at load.
- _Author fresh_ — drop a new JSON file. No rebuild, no source edit. Picked up at
  boot (optionally hot-watched, like the viewer dev loop).

**Validate before you ship.** A malformed file is skipped at boot with a warning,
but you don't want to discover that by a missing theme. Run **`showcase validate`**
— it checks every `*.json` under the user (`~/.showcase`) and repo
(`<cwd>/.showcase`) dirs against the same schema the server loads them with, and
prints per-file `✓`/`✗` with the exact `path: message` for each error (a bad
palette color, a misspelled slot, an unknown `config.json` key). It exits non-zero
on any failure, so it doubles as a pre-commit / CI gate; `--json` emits the
structured report. The schema lives in `@showcase/core/configSchema.ts`.

### Trust boundary (why user CSS/JS is safe here)

Kits already inject **JS** into rendered html parts — and that's fine, because the
core invariant holds it in a **sandboxed, opaque-origin iframe** (`renderHtmlPage`
at `/s/:id`). A user-defined kit's CSS/JS runs in that same jail; it crosses no new
boundary. Crucially, blueprints/themes/kits load from a **local config dir the user
controls**, _not_ from agent-published surface content — so there is no
remote-injection path. The dangerous direction (agent-authored HTML → trusted
origin) is untouched. State this in the loader so no one later "helpfully" lets a
surface ship its own kit definition inline.

---

## How the agent uses a blueprint

The structure only helps if the agent can _see_ it. Discovery mirrors the existing
`kitSummaries()` / `GET /api/kits` pattern:

- `GET /api/blueprints` → `[{ id, label, summary, structure }]`
- MCP: a `blueprint` param on `publish_surface` / `publish_snippet`, plus the
  blueprint list folded into discovery so the agent authors `.step`s that fill
  each section **in order**. (Optionally tag each step `data-section="hook"` so the
  mapping is explicit and machine-checkable later.)

The agent-facing contract becomes: _"You're authoring a `product-demo`. Its arc is
hook → problem → feature → proof → CTA; `proof` is required. One step per beat."_
That is what makes a product demo "always follow the same structure" — without a
new renderer, on day one.

---

## Why not the obvious alternatives

- **Just add more themes.** Themes are color-only. They can't carry structure,
  kit composition, brand assets, or be user-defined. This is the status quo that
  fails the request.
- **Just add an `explainer` kit.** A kit is CSS/JS for _one part_. It can't pin a
  _surface_ theme, compose multiple kits, hold a section skeleton, or be authored
  by a user. Wrong altitude — a blueprint _uses_ kits, it isn't one.
- **A new monolithic "explainer" object type.** Breaks the part model. The loop,
  versioning, comments, and the static export all assume surfaces-of-parts; a new
  top-level type re-implements all of it. A blueprint composes the primitives
  instead of replacing them, so every invariant in `CLAUDE.md` survives untouched.

The blueprint is deliberately the _thinnest_ thing that works: a resolver that
expands a named bundle into fields the system already has, plus a loader that lets
those bundles come from user config.

---

## Phased rollout (all shipped)

**Phase 0 — authoring core (no breaking change, fully back-compat). ✅**
Two built-in blueprints (`product-demo`, `concept`) + `GET /api/blueprints` + a
`blueprint` param that resolves to `theme` + `kits` defaults. The agent reads the
structure (from the design guide) and authors against it. An old client that
ignores `blueprint` still works unchanged.

**Phase 1 — user config layer. ✅**
`packages/server/userConfig.ts` loads `~/.showcase/{themes,kits,blueprints}/*.json` (override
the dir with `SHOWCASE_CONFIG`) and layers it over the built-ins. This is the unlock
for _"matches my product"_ and for _customizable + extendable_ — a user defines a
brand theme + blueprint and never edits source.

**Phase 2 — brand assets + inheritance. ✅**
`brand.fontFamily` overrides `--font-sans` for the part (zero author effort);
`brand.logoAssetId` / `wordmark` are exposed as `--brand-logo` / `--brand-wordmark`
tokens an author or kit opts into. `extends` is resolved at lookup (one chain,
cycle-guarded). Brand is resolved at _render_ from the surface's stored blueprint
id, so editing a blueprint re-skins every surface using it.

**Phase 3 — render-honored structure. ✅**
The `animate` kit reads `data-section` / `data-label` on each `.step` and shows the
current beat's label in the control bar — turning the product-demo skeleton from a
convention the agent holds in its head into something the rendered explainer shows.

---

## Where it lives (built)

- `packages/core/types.ts` — `blueprint?: string` on `Surface`, `CreateSurfaceInput`,
  `UpdateSurfaceInput` (parallel to `theme`).
- `packages/core/blueprints.ts` — `Blueprint` types, built-in `BLUEPRINTS`,
  `isKnownBlueprint` / `blueprintById` (with `extends` merge) / `blueprintSummaries`,
  the gap-filling `resolveBlueprint`, and `brandCss`. Mirrors `themes.ts` / `kits.ts`.
- `packages/core/themes.ts` / `packages/core/kits.ts` — `registerThemes` / `registerKits` + merged
  lookups, so the built-in arrays gain a user-extensible layer without `node:` leaks
  (the viewer build still sees only the built-ins).
- `packages/server/storage.ts` — persists `blueprint` on create/update (a rendering choice,
  not snapshotted as content — like `theme`).
- `packages/server/app.ts` — resolves the blueprint in the publish/revise flow (fills theme +
  part kits + default badge), serves `GET /api/blueprints` and `/api/themes`, passes
  brand to `renderHtmlPage` at `/s/:id`, and appends a live blueprint listing to
  `/guide`. `createApp` takes `extraThemes/extraKits/extraBlueprints`.
- `packages/core/surfacePage.ts` — `renderHtmlPage` injects `brandCss` last (brand overrides
  the theme's defaults for the part).
- `packages/server/mcpHttp.ts` / `packages/core/mcpSpec.ts` / `packages/mcp/server.ts` —
  `blueprint` param on publish_surface / publish_snippet / update_surface,
  description sourced from `BLUEPRINT_IDS`.
- `packages/server/userConfig.ts` / `packages/server/index.ts` — the Node-only loader and its
  wiring; keeps `@showcase/core` (and the server's `app.ts`) runtime-agnostic.
- `packages/cli/bin/showcase.js` — `--blueprint <id>` on publish + a `showcase blueprints` command.
- `guide/PLAYBOOK.md` — the explainer recipe now starts from a blueprint.
- `test/blueprints.test.ts` — resolution, inheritance, registry layering, brand CSS,
  and the publish → render path end to end.
