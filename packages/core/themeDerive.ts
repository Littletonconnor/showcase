// Theme derivation — turn a handful of brand colors into a full theme.
//
// A Theme (themes.ts) is 24 color slots × 2 schemes: bg/panel/surface, three
// text tiers, two border tiers, hover, and four semantic accents — light AND
// dark. Hand-authoring all of that is the friction a new engineer hits ("I just
// have my logo color; now I owe you 48 hex values, half of them dark-mode").
//
// This engine inverts that: you supply 1–4 SEEDS (a brand accent, optionally a
// neutral/paper hue and branded semantic colors) and it computes a complete,
// contrast-checked light + dark palette. The agent's job is the part a machine
// is bad at — looking at a screenshot and naming the brand colors; this module
// is the part a machine is good at — the color math that expands them into a
// coherent, legible palette in both schemes.
//
// Runtime-agnostic (no `node:` imports): same constraint as themes.ts, so it can
// run server-side (POST /api/themes), in the CLI, or in a test unchanged.

import { escapeHtml } from "./surfacePage.ts";
import type { Accent, Palette, Theme } from "./themes.ts";

// The minimal description a person (or the agent reading a screenshot) provides.
// Only `accent` is required — a single brand color yields a full theme.
export interface ThemeSeed {
  id: string;
  label: string;
  // The brand color: links, focus rings, the accent. Hex (#rgb or #rrggbb).
  accent: string;
  // The paper/ink hue. A neutral that sets the chrome's warmth. Omitted → a
  // near-gray derived from the accent's hue at low saturation, so one accent
  // still reads as a coherent, on-brand theme rather than accent-on-flat-gray.
  neutral?: string;
  // Semantic accents. Default to conventional green/amber/red (tinted to the
  // palette); override to brand them. Hex.
  success?: string;
  warning?: string;
  danger?: string;
  // Shiki code/diff syntax themes. Default to the neutral GitHub pair — they sit
  // under any chrome without fighting the diff (same call themes.ts makes).
  shiki?: { light: string; dark: string };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(clamp(n, 0, 255));

// Parse #rgb / #rrggbb (a leading # optional). Returns null for anything else so
// callers can fall back rather than render a broken color.
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

const toHex = ({ r, g, b }: Rgb): string => {
  const h = (n: number) => round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
};

// Translucent fill (used for dark-scheme accent backgrounds, matching the
// rgba(...) the hand-authored dark palettes use).
const rgba = ({ r, g, b }: Rgb, a: number): string =>
  `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${a})`;

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const channel = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return { r: channel(hk + 1 / 3) * 255, g: channel(hk) * 255, b: channel(hk - 1 / 3) * 255 };
}

// Linear blend in sRGB space: t=0 → a, t=1 → b. Cheap and good enough for the
// tinting here (mixing toward white/black/surface), where perceptual exactness
// matters far less than the contrast clamp below.
const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

// WCAG relative luminance + contrast ratio — the legibility backbone. Used to
// guarantee an accent stays readable as text on its scheme's surface, the one
// place a derived palette can quietly fail.
function luminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

const contrast = (a: Rgb, b: Rgb): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// Walk a color's lightness toward the readable end (down on light backgrounds,
// up on dark) until it clears `target` contrast against `bg`, preserving hue and
// saturation so the brand color stays recognizable — just legible. Bounded, so
// an impossible target (a pure-yellow link on white) just lands at the best
// reachable value instead of looping.
function ensureContrast(fg: Rgb, bg: Rgb, target: number, darken: boolean): Rgb {
  const hsl = rgbToHsl(fg);
  let best = fg;
  let bestC = contrast(fg, bg);
  for (let i = 0; i < 24 && bestC < target; i++) {
    hsl.l = clamp(hsl.l + (darken ? -0.04 : 0.04), 0.04, 0.96);
    const next = hslToRgb(hsl);
    const c = contrast(next, bg);
    if (c > bestC) {
      best = next;
      bestC = c;
    }
  }
  return best;
}

// One semantic accent (info/success/warning/danger) for a given scheme. The bg
// is a soft wash of the hue, the text is the hue pushed to legibility on the
// surface, and the border sits between. Dark uses a translucent wash + a lighter
// text, mirroring the hand-authored palettes.
function accentFor(base: Rgb, surface: Rgb, dark: boolean): Accent {
  if (dark) {
    return {
      bg: rgba(base, 0.18),
      text: toHex(ensureContrast(base, surface, 4.2, false)),
      border: toHex(mix(base, surface, 0.3)),
    };
  }
  return {
    bg: toHex(mix(base, surface, 0.88)),
    text: toHex(ensureContrast(base, surface, 4.2, true)),
    border: toHex(mix(base, surface, 0.45)),
  };
}

// Conventional semantic hues, used when a seed doesn't brand its own. Run
// through the same accentFor pipeline, so a warning still reads as amber but
// tuned to the palette's surface.
const DEFAULT_SUCCESS = "#3f9142";
const DEFAULT_WARNING = "#b07a14";
const DEFAULT_DANGER = "#c0392b";

const seedRgb = (hex: string | undefined, fallback: string): Rgb =>
  parseHex(hex ?? "") ?? parseHex(fallback) ?? { r: 0, g: 0, b: 0 };

// Build one scheme's palette. `toneHue/toneSat` are the neutral the chrome is
// built from; the `tone(l)` helper paints bg/panel/surface/text/borders at that
// hue so the whole UI shares one temperature, while the accents bring the color.
function buildPalette(
  accent: Rgb,
  neutral: Hsl,
  semantic: { success: Rgb; warning: Rgb; danger: Rgb },
  dark: boolean,
): Palette {
  const tone = (l: number): string => toHex(hslToRgb({ h: neutral.h, s: neutral.s, l }));
  // The "ink" used for translucent hover, kept at the neutral hue.
  const inkRgb = hslToRgb({ h: neutral.h, s: neutral.s, l: dark ? 0.9 : 0.1 });

  if (dark) {
    const surface = hslToRgb({ h: neutral.h, s: neutral.s, l: 0.17 });
    return {
      bg: tone(0.105),
      panel: tone(0.145),
      surface: tone(0.17),
      text: tone(0.95),
      muted: tone(0.66),
      faint: tone(0.46),
      border: tone(0.26),
      border2: tone(0.34),
      hover: rgba(inkRgb, 0.07),
      info: accentFor(accent, surface, true),
      success: accentFor(semantic.success, surface, true),
      warning: accentFor(semantic.warning, surface, true),
      danger: accentFor(semantic.danger, surface, true),
    };
  }
  const surface = hslToRgb({ h: neutral.h, s: neutral.s, l: 0.995 });
  return {
    bg: tone(0.965),
    panel: tone(0.95),
    surface: tone(0.995),
    text: tone(0.12),
    muted: tone(0.42),
    faint: tone(0.58),
    border: tone(0.89),
    border2: tone(0.82),
    hover: tone(0.95),
    info: accentFor(accent, surface, false),
    success: accentFor(semantic.success, surface, false),
    warning: accentFor(semantic.warning, surface, false),
    danger: accentFor(semantic.danger, surface, false),
  };
}

// Expand seeds into a full Theme. Pure and total: an unparseable seed falls back
// to a sensible default rather than throwing, so a typo degrades to a duller
// theme instead of a crashed publish.
export function deriveTheme(seed: ThemeSeed): Theme {
  const accent = seedRgb(seed.accent, "#5c46e6");
  const accentHsl = rgbToHsl(accent);

  // Neutral: the supplied paper hue, or a low-saturation tint of the accent hue
  // so a one-color seed still feels intentional (paper faintly warmed toward the
  // brand) rather than a flat gray that ignores the brand entirely.
  const neutralRgb = parseHex(seed.neutral ?? "");
  const neutralHue = neutralRgb ? rgbToHsl(neutralRgb) : { h: accentHsl.h, s: 0.5, l: 0.5 };
  const neutral: Hsl = { h: neutralHue.h, s: clamp(neutralHue.s, 0, 0.14), l: 0.5 };

  const semantic = {
    success: seedRgb(seed.success, DEFAULT_SUCCESS),
    warning: seedRgb(seed.warning, DEFAULT_WARNING),
    danger: seedRgb(seed.danger, DEFAULT_DANGER),
  };

  return {
    id: seed.id,
    label: seed.label,
    shiki: seed.shiki ?? { light: "github-light", dark: "github-dark" },
    light: buildPalette(accent, neutral, semantic, false),
    dark: buildPalette(accent, neutral, semantic, true),
  };
}

// A ready-to-publish preview surface for a theme: a labeled swatch of every
// token tier plus a small mockup (callouts, buttons, a status tree) so a person
// SEES the palette working in both schemes instead of reading hex. Returns an
// html body fragment authored against the `--color-*` tokens — publish it with
// `theme: <id>` and kits `["mockup","issues"]` and it renders in the new theme.
// One source for the CLI's `--preview` and the skill's preview step.
export function themePreviewHtml(theme: Theme): string {
  const sw = (token: string, name: string) =>
    `<div class="stack sm"><div class="pv-sw" style="background:var(${token})"></div><span class="faint" style="font-size:11px">${name}</span></div>`;
  const swatches = [
    sw("--color-background-primary", "surface"),
    sw("--color-background-secondary", "panel"),
    sw("--color-background-tertiary", "bg"),
    sw("--color-text-primary", "text"),
    sw("--color-text-secondary", "muted"),
    sw("--color-text-info", "accent"),
    sw("--color-text-success", "success"),
    sw("--color-text-warning", "warning"),
    sw("--color-text-danger", "danger"),
  ].join("");
  return `
<style>
  .pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:12px}
  .pv-sw{height:40px;border-radius:var(--border-radius-md);border:1px solid var(--color-border-secondary)}
</style>
<div class="panel stack lg">
  <div class="stack sm">
    <span class="eyebrow">Theme preview</span>
    <span class="title">${escapeHtml(theme.label)} <span class="faint mono">${escapeHtml(theme.id)}</span></span>
  </div>
  <div class="pv-grid">${swatches}</div>
  <div class="callout ok stack sm"><span class="label">Success</span><p>A confirming message reads in the success tone.</p></div>
  <div class="callout warn stack sm"><span class="label">Warning</span><p>A caution reads in the warning tone.</p></div>
  <div class="callout danger stack sm"><span class="label">Danger</span><p>An error reads in the danger tone.</p></div>
  <div class="row">
    <button class="btn primary">Primary</button>
    <button class="btn">Secondary</button>
    <button class="btn ghost">Ghost</button>
    <span class="badge info">Info</span>
    <span class="badge ok">OK</span>
    <span class="badge warn">Warn</span>
    <span class="badge danger">Danger</span>
  </div>
  <ul class="tree">
    <li class="row"><span class="dot ok"></span> Built check <span class="faint">2s</span></li>
    <li class="row"><span class="dot info"></span> Linked accent <span class="faint">links + focus</span></li>
    <li class="row"><span class="dot danger"></span> Failing check <span class="faint">flaky</span></li>
  </ul>
</div>`.trim();
}
