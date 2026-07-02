# Theme building — from a few seeds to a full palette

A **theme** is the palette layer a preset (blueprint) pins. A full theme is 21
color slots × two schemes — `bg`/`panel`/`surface`, three text tiers, two border
tiers, hover, and four semantic accents (info/success/warning/danger, three values
each), in light **and** dark (`packages/core/themes.ts`). Hand-authoring all of
that is the friction a new engineer hits: "I just have my brand color; now I owe
you 42 hex values, half of them dark-mode."

The **derivation engine** (`packages/core/themeDerive.ts`) inverts that. You supply 1–4
**seeds**; it computes the rest, contrast-checked, in both schemes. The division
of labor is deliberate:

- **Vision (the agent)** — look at a screenshot the user drops and name the brand
  colors. A machine is bad at this; an agent reading the image is good at it.
- **Color science (the engine)** — expand those seeds into a coherent, legible
  palette. A machine is good at this; it's tedious and error-prone by hand.

## Seeds

```ts
interface ThemeSeed {
  id: string;
  label: string;
  accent: string; // the brand color — links, focus, the accent. The one required seed.
  neutral?: string; // the paper/ink hue. Omitted → a low-saturation tint of the accent.
  success?: string; // semantic overrides. Default to conventional green/amber/red,
  warning?: string; // tinted to the palette.
  danger?: string;
  shiki?: { light; dark }; // code/diff syntax theme. Default github-light/dark.
}
```

A single `accent` already yields a complete theme. `neutral` sets the chrome's
temperature (warm vs cool paper). Semantic colors default to conventional hues so
a warning still reads as a warning, but you can brand them.

## What the engine guarantees

- **Legibility.** The accent used as text (links, `--color-text-info`) is walked
  toward the readable end of its lightness — darker on light surfaces, lighter on
  dark — until it clears a WCAG contrast threshold against the surface, preserving
  hue and saturation so the brand color stays recognizable, just legible.
- **Two real schemes.** Light and dark are derived from the same seeds, never one
  flipped; dark accents use translucent washes + lightened text, matching the
  hand-authored built-ins.
- **Totality.** An unparseable seed degrades to a sensible default rather than
  throwing — a typo gives a duller theme, never a crashed publish.

## Authoring a theme at runtime

`POST /api/themes` derives + registers a theme live, and optionally persists it:

```
POST /api/themes
{ "seed": { "id": "acme", "label": "Acme", "accent": "#5c46e6", "neutral": "#5a6b8a" },
  "persist": true }
```

- **Registered live** — immediately resolvable, so a surface published with
  `theme: "acme"` renders in it (html parts render server-side via `/s/:id`,
  which sees the new theme).
- **`persist: true`** — writes `~/.showcase/themes/acme.json` so it survives a
  restart. The viewer chrome and the card theme picker read the _bundled_ built-in
  set, so they pick a persisted theme up after the next restart; the live preview
  before that works through a published html surface.

You can also drop the JSON directly under `~/.showcase/themes/` (user) or
`<repo>/.showcase/themes/` (committed) — same loader, no endpoint needed.

## Tie it to a preset

A theme on its own just recolors. To make a whole format match a product, point a
blueprint's `theme` at your palette:

```jsonc
// <repo>/.showcase/blueprints/acme-demo.json
{
  "id": "acme-demo",
  "label": "Acme demo",
  "summary": "Our product-demo, branded",
  "extends": "product-demo",
  "theme": "acme",
}
```

Now every surface in an `acme-demo` session carries the product-demo structure in
Acme's palette. See [themable-explainers.md](themable-explainers.md) for the
blueprint model and the `session-presets` skill for the end-to-end loop.
