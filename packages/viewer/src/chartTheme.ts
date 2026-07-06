import { type Mode, themeById } from "@showcase/core/themes";

// Tone → fixed hue for the review charts (treemap cells, scatter/bubble points,
// minimap segments, matrix cells, arcs). These match the diff/severity palette
// (sensitive=red, logic=amber, mechanical=gray) so the charts read with the
// rest of the review; an unknown tone falls back to the board accent. Tones are
// a closed set the server emits — never an agent-supplied color string — so
// there's nothing to sanitize. Each mode has its own steps, machine-validated
// like REST_PALETTE (lightness band, ≥3:1 contrast on the mode's surface); the
// gray intentionally sits under the chroma floor — it means neutral — and
// red↔amber CVD proximity is acceptable because these are status hues whose
// identity comes from meaning, not adjacency.
export const TONE_HUE: Record<Mode, Record<string, string>> = {
  light: {
    sensitive: "#e03131",
    danger: "#e03131",
    logic: "#bd6f08",
    warn: "#bd6f08",
    mechanical: "#757c84",
    cool: "#757c84",
    normal: "#2f9e44",
  },
  dark: {
    sensitive: "#e05252",
    danger: "#e05252",
    logic: "#c9821f",
    warn: "#c9821f",
    mechanical: "#8b9198",
    cool: "#8b9198",
    normal: "#3fa457",
  },
};

export interface ThemeColors {
  text: string;
  muted: string;
  faint: string;
  border: string;
  surface: string;
  accent: string;
}

// Resolve chart colors from the SURFACE's theme (not the document root), so a
// chart on a themed surface — e.g. a data-viz preset pinned to `ocean` — uses
// that surface's palette instead of the board chrome's. Mirrors how the
// sandboxed parts pass themeById(surfaceTheme) into their frame; reading
// document.body here would always yield the board theme and ignore the override.
export function readThemeColors(themeId: string, mode: Mode): ThemeColors {
  const p = mode === "dark" ? themeById(themeId).dark : themeById(themeId).light;
  return {
    text: p.text,
    muted: p.muted,
    faint: p.faint,
    border: p.border,
    surface: p.surface,
    accent: p.info.text,
  };
}

export const toneHue = (mode: Mode, tone: unknown, fallback: string): string =>
  TONE_HUE[mode][String(tone ?? "")] ?? fallback;
