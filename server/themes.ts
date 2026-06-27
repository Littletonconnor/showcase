// Theme registry — the single source of truth for the board's palette, shared
// by the server (html-part token injection in surfacePage) and the viewer
// (chrome palette + shiki theme for markdown/diff). Runtime-agnostic: no
// `node:` imports, so it bundles into the viewer (vite) build unchanged.
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
    // under the warm chrome. (The chrome accent and syntax palette are separate
    // concerns; a coral-tinted keyword theme would fight the diff.)
    shiki: { light: "github-light", dark: "github-dark" },
    // Anthropic/Claude-inspired: warm ivory paper neutrals + warm near-black
    // text carry the editorial, professional base; the terracotta/coral accent
    // (Claude's signature) is used with restraint — links, focus rings, the
    // active session row, the send button, mermaid accents. Semantic states stay
    // conventional but warmed, so a warning still reads as a warning.
    light: {
      bg: "#f7f6f1",
      panel: "#f0eee6",
      surface: "#ffffff",
      text: "#1a1915",
      muted: "#6b6a62",
      faint: "#928f86",
      border: "#e7e4d9",
      border2: "#d6d2c4",
      hover: "#efece3",
      info: { bg: "#f6e7df", text: "#bd5b3c", border: "#dba88e" },
      success: { bg: "#e7f1e3", text: "#3f7a44", border: "#9cc89a" },
      warning: { bg: "#fbf0d3", text: "#946618", border: "#e3c068" },
      danger: { bg: "#fbe7e1", text: "#bf4634", border: "#eda595" },
    },
    dark: {
      bg: "#1f1e1b",
      panel: "#262521",
      surface: "#2b2925",
      text: "#f0eee6",
      muted: "#a8a59b",
      faint: "#78756c",
      border: "#3a3832",
      border2: "#4c4a42",
      hover: "rgba(232, 226, 210, 0.07)",
      info: { bg: "rgba(210, 110, 80, 0.18)", text: "#e08a6a", border: "#c2603f" },
      success: { bg: "rgba(95, 170, 105, 0.16)", text: "#7fc081", border: "#5a8a5a" },
      warning: { bg: "rgba(210, 160, 60, 0.16)", text: "#d9b264", border: "#b78a30" },
      danger: { bg: "rgba(220, 105, 85, 0.16)", text: "#e89080", border: "#bf4634" },
    },
  },
  {
    // Brand — the deep-eggplant palette the mockups kept re-deriving inline,
    // promoted to a first-class theme: indigo ink, a violet accent, and warm
    // amber / green / red states. The mockup kit's components resolve against
    // the semantic tokens, so they pick this up automatically.
    id: "brand",
    label: "Brand",
    shiki: { light: "github-light", dark: "github-dark" },
    light: {
      bg: "#f4f2fa",
      panel: "#f7f6fb",
      surface: "#ffffff",
      text: "#230b59",
      muted: "#6b6588",
      faint: "#9a95b0",
      border: "rgba(35, 11, 89, 0.10)",
      border2: "rgba(35, 11, 89, 0.18)",
      hover: "rgba(35, 11, 89, 0.05)",
      info: { bg: "#f1effd", text: "#5c46e6", border: "#dad4f7" },
      success: { bg: "#e7f4ec", text: "#1e7a4d", border: "#bfe3cd" },
      warning: { bg: "#fbf3e1", text: "#9a6510", border: "#ecdcb4" },
      danger: { bg: "#fbe9e5", text: "#b83a2b", border: "#eec6bd" },
    },
    dark: {
      bg: "#161229",
      panel: "#1d1838",
      surface: "#221d42",
      text: "#ece9f7",
      muted: "#a8a1c6",
      faint: "#746c98",
      border: "rgba(220, 212, 247, 0.12)",
      border2: "rgba(220, 212, 247, 0.20)",
      hover: "rgba(220, 212, 247, 0.06)",
      info: { bg: "rgba(92, 70, 230, 0.24)", text: "#ab9ef6", border: "#6a55e8" },
      success: { bg: "rgba(30, 122, 77, 0.22)", text: "#72c79b", border: "#2f7d4f" },
      warning: { bg: "rgba(154, 101, 16, 0.24)", text: "#dab266", border: "#9a6510" },
      danger: { bg: "rgba(184, 58, 43, 0.22)", text: "#e9917f", border: "#b83a2b" },
    },
  },
  {
    // Neutral — a stark grayscale for wireframe/low-fidelity mockups. Accent is
    // a near-black gray (not a hue), and the semantic states are desaturated so
    // the surface reads as a sketch, not a finished product.
    id: "neutral",
    label: "Neutral",
    shiki: { light: "github-light", dark: "github-dark" },
    light: {
      bg: "#f4f4f5",
      panel: "#ececee",
      surface: "#ffffff",
      text: "#18181b",
      muted: "#6b6b70",
      faint: "#9a9aa0",
      border: "#e4e4e7",
      border2: "#d1d1d6",
      hover: "#f0f0f1",
      info: { bg: "#ececee", text: "#3f3f46", border: "#d1d1d6" },
      success: { bg: "#eef2ee", text: "#4f6b54", border: "#c8d6c8" },
      warning: { bg: "#f5efe1", text: "#7c6a3d", border: "#e0d3b2" },
      danger: { bg: "#f4e9e7", text: "#8c4a3f", border: "#ddc4be" },
    },
    dark: {
      bg: "#111113",
      panel: "#19191c",
      surface: "#1e1e21",
      text: "#ededee",
      muted: "#a1a1a6",
      faint: "#6e6e73",
      border: "#2c2c30",
      border2: "#3f3f44",
      hover: "rgba(255, 255, 255, 0.06)",
      info: { bg: "#2a2a2e", text: "#cfcfd4", border: "#3f3f44" },
      success: { bg: "rgba(90, 150, 100, 0.18)", text: "#85b58f", border: "#4a6b52" },
      warning: { bg: "rgba(180, 150, 70, 0.18)", text: "#cbb072", border: "#6e5d30" },
      danger: { bg: "rgba(180, 90, 75, 0.18)", text: "#d99284", border: "#6e433b" },
    },
  },
];

export const DEFAULT_THEME_ID = "showcase";

// All registered theme ids, in registry order (drives the viewer picker and the
// MCP/CLI theme allowlist).
export const THEME_IDS = THEMES.map((t) => t.id);

// Is `id` a known theme? Used to validate the agent-supplied / query `theme`.
export const isKnownTheme = (id: unknown): id is string =>
  typeof id === "string" && THEMES.some((t) => t.id === id);

// Resolve a theme by id, falling back to the default for null/unknown — so a
// stale `?theme=` or a surface authored before a theme was removed still renders.
export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
