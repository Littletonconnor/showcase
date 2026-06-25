// Theme registry — the single source of truth for the board's palette, shared
// by the server (html-part token injection in surfacePage) and the viewer
// (chrome palette + shiki theme for markdown/diff). Runtime-agnostic: no node
// imports, so it bundles into the viewer (vite) and typechecks against workers.
//
// A theme is authored as ONE palette object per color scheme; the viewer-var
// set (--bg, --accent, …) and the html-token set (--color-* injected into the
// sandboxed iframe) are both DERIVED from it, so the two palettes can never
// drift. Mermaid follows the viewer vars (see MermaidPart); the terminal is
// intentionally theme-independent (always a dark terminal window).

export interface Accent {
  // Background fill, text/icon color, and border for a semantic state.
  bg: string;
  text: string;
  border: string;
}

export interface Palette {
  bg: string; // app background (deepest chrome)
  panel: string; // raised panel / code-block background
  surface: string; // card / html-part body background
  text: string; // primary text
  muted: string; // secondary text
  faint: string; // tertiary text (captions, hints)
  border: string; // default hairline border
  border2: string; // stronger border
  hover: string; // hover wash
  info: Accent; // also the accent color (links, focus)
  success: Accent;
  warning: Accent;
  danger: Accent;
}

export interface Theme {
  id: string;
  label: string;
  // Shiki theme names (bundled) for markdown code + diffs, by color scheme.
  shiki: { light: string; dark: string };
  light: Palette;
  dark: Palette;
}

// A resolved color scheme. The chrome resolves this from the OS via a CSS
// `@media (prefers-color-scheme)` query; surface iframes are separate documents
// that don't reliably inherit that resolution, so the viewer passes the mode it
// resolved into each frame to pin it to the chrome (see surfacePage / Card).
export type Mode = "light" | "dark";

// Viewer chrome variables (styles.css names). Accent maps to the info state.
// Exported so the embed theme-token manifest (theme-tokens.ts) derives the host
// contract's token defaults from the same mapping the chrome uses — one source.
export function viewerVars(p: Palette): Record<string, string> {
  return {
    bg: p.bg,
    panel: p.panel,
    surface: p.surface,
    text: p.text,
    muted: p.muted,
    faint: p.faint,
    border: p.border,
    "border-2": p.border2,
    accent: p.info.text,
    "accent-bg": p.info.bg,
    hover: p.hover,
    danger: p.danger.text,
  };
}

// Html-part design tokens (surfacePage names — the agent-facing contract).
// Same variable NAMES across every theme; only the values change.
function tokenVars(p: Palette): Record<string, string> {
  return {
    "color-background-primary": p.surface,
    "color-background-secondary": p.panel,
    "color-background-tertiary": p.bg,
    "color-background-info": p.info.bg,
    "color-background-success": p.success.bg,
    "color-background-warning": p.warning.bg,
    "color-background-danger": p.danger.bg,
    "color-text-primary": p.text,
    "color-text-secondary": p.muted,
    "color-text-tertiary": p.faint,
    "color-text-info": p.info.text,
    "color-text-success": p.success.text,
    "color-text-warning": p.warning.text,
    "color-text-danger": p.danger.text,
    "color-border-primary": p.border2,
    "color-border-secondary": p.border,
    "color-border-tertiary": p.border,
    "color-border-info": p.info.border,
    "color-border-success": p.success.border,
    "color-border-warning": p.warning.border,
    "color-border-danger": p.danger.border,
  };
}

// Terminal chrome. Always sourced from the theme's DARK palette (a terminal
// reads as a terminal — ANSI output assumes a dark backdrop — so it stays dark
// in light mode too), but tinted to the theme so it doesn't look foreign.
function termVars(dark: Palette): Record<string, string> {
  return {
    "term-bg": dark.bg,
    "term-bar": dark.panel,
    "term-fg": dark.text,
    "term-title": dark.muted,
  };
}

const block = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `--${k}: ${v};`)
    .join("");

// `:root` light + a `prefers-color-scheme: dark` override — emitted as a
// <style> so the automatic OS light/dark flip keeps working with no JS. When
// `mode` is given the scheme is PINNED to it instead: a single flat `:root`
// block with no media query, so the document renders that mode regardless of
// the OS preference. The viewer uses this to force a surface iframe to the mode
// the chrome already resolved, since an iframe is a separate document whose
// `prefers-color-scheme` evaluation can diverge from its embedder's.
export function schemeCss(
  light: Record<string, string>,
  dark: Record<string, string>,
  mode?: Mode,
): string {
  if (mode === "light") return `:root{${block(light)}}`;
  if (mode === "dark") return `:root{${block(dark)}}`;
  return `:root{${block(light)}}@media (prefers-color-scheme: dark){:root{${block(dark)}}}`;
}

// Viewer chrome palette CSS (injected into the viewer document head). The
// scheme-flipping chrome vars, plus the terminal vars which are scheme-
// independent (always the dark palette) so they sit outside the media query.
// `mode` pins the scheme (see schemeCss) — used for the rich-part iframes the
// chrome renders via renderSandboxedPart, not the chrome's own <head>.
export function viewerThemeCss(t: Theme, mode?: Mode): string {
  return `${schemeCss(viewerVars(t.light), viewerVars(t.dark), mode)}:root{${block(termVars(t.dark))}}`;
}

// Html-part token CSS (injected into each sandboxed surface iframe). `mode`
// pins the scheme so the iframe matches the chrome (see schemeCss).
export function tokenThemeCss(t: Theme, mode?: Mode): string {
  return schemeCss(tokenVars(t.light), tokenVars(t.dark), mode);
}

export const THEMES: Theme[] = [
  {
    id: "showcase",
    label: "Showcase",
    // Code/diff syntax stays on the GitHub shiki themes — neutral and legible
    // under the violet chrome. (The chrome accent and syntax palette are
    // separate concerns; a violet keyword theme would fight the diff.)
    shiki: { light: "github-light", dark: "github-dark" },
    // Clean slate neutrals carry the "professional"; one indigo-violet accent
    // carries the "fun" — it drives links, focus rings, the active session row,
    // the send button, and mermaid accents. Semantic states stay conventional
    // (green/amber/red) so a warning still reads as a warning.
    light: {
      bg: "#f7f7fb",
      panel: "#eeeef4",
      surface: "#ffffff",
      text: "#1b1c24",
      muted: "#585e6e",
      faint: "#878d9c",
      border: "#e5e5ee",
      border2: "#cdcedb",
      hover: "#eceaf6",
      info: { bg: "#ecebfd", text: "#574fcf", border: "#bbb2f2" },
      success: { bg: "#e4f7ec", text: "#0f854b", border: "#76d2a0" },
      warning: { bg: "#fdf2d6", text: "#946400", border: "#e6c34d" },
      danger: { bg: "#fde7e9", text: "#d12d3b", border: "#f5a2a8" },
    },
    dark: {
      bg: "#0d0e14",
      panel: "#15161f",
      surface: "#1a1b25",
      text: "#e8e9f1",
      muted: "#989eae",
      faint: "#6a7080",
      border: "#272834",
      border2: "#3a3c4b",
      hover: "rgba(150, 142, 220, 0.10)",
      info: { bg: "rgba(126, 110, 242, 0.20)", text: "#a99cff", border: "#7e6ef2" },
      success: { bg: "rgba(52, 200, 124, 0.16)", text: "#46cf8b", border: "#3fb97a" },
      warning: { bg: "rgba(222, 160, 42, 0.16)", text: "#e0b341", border: "#d4a72c" },
      danger: { bg: "rgba(245, 95, 95, 0.16)", text: "#ff8c86", border: "#f56b6b" },
    },
  },
];

export const DEFAULT_THEME_ID = "showcase";

// One fixed theme now (multi-theme was removed). themeById keeps the name +
// the null/unknown fallback so callers and the `?theme=` query just resolve to
// it; viewerThemeCss / tokenThemeCss still feed the chrome vars + part tokens.
export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
