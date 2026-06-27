// Viewer-side theme controller. There is one fixed theme now (GitHub, light +
// dark) — multi-theme was removed. It still drives three things: the chrome
// palette (a <style> of viewerThemeCss injected into <head>, on top of the
// styles.css defaults), the shiki theme for markdown/diff/code, and the html
// surface parts (each iframe src carries ?theme= so the server injects matching
// tokens). activeTheme is constant; prefersDark tracks the OS light/dark flip,
// and both live in the zustand store so components re-render. The functions
// below are non-reactive snapshots; components use useActiveTheme/useResolvedMode.
import { createContext, useContext } from "react";
import { useBoard } from "./state.ts";
import { DEFAULT_THEME_ID, type Mode, themeById, viewerThemeCss } from "../../server/themes.ts";

const get = useBoard.getState;
const set = useBoard.setState;

// Initialize the store's theme defaults (activeTheme starts as the default id;
// prefersDark reflects the OS at module load).
const darkQuery =
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
set({ activeTheme: DEFAULT_THEME_ID, prefersDark: !!darkQuery?.matches });

// On an OS light/dark flip the resolved palette changes without a theme change.
darkQuery?.addEventListener("change", (e) => set({ prefersDark: e.matches }));

// Non-reactive snapshots (flow code / string building).
export const activeTheme = (): string => get().activeTheme;
export const resolvedMode = (): Mode => (get().prefersDark ? "dark" : "light");

// Reactive subscriptions for components.
export const useActiveTheme = (): string => useBoard((s) => s.activeTheme);
export const useResolvedMode = (): Mode => useBoard((s) => (s.prefersDark ? "dark" : "light"));

// A surface can render under its own theme (see Surface.theme). Card provides
// its surface's theme id here; parts NOT under a card (e.g. ReviewView evidence)
// see `undefined` and fall back to the global board theme. Part renderers read
// useSurfaceTheme() instead of useActiveTheme() so per-surface theming is
// transparent to them.
export const SurfaceThemeContext = createContext<string | undefined>(undefined);
export const useSurfaceTheme = (): string => {
  const override = useContext(SurfaceThemeContext);
  const global = useActiveTheme();
  return override ?? global;
};

const STYLE_ID = "ss-theme-vars";

// Inject/replace the chrome-palette <style> in <head>, after the bundled
// styles.css so it wins the cascade for the palette vars.
function applyPalette(id: string) {
  let el = document.head.querySelector<HTMLStyleElement>(`#${STYLE_ID}`);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = viewerThemeCss(themeById(id));
}

// Apply locally without a server round-trip (used by initial load + SSE).
export function applyTheme(id: string) {
  const theme = themeById(id);
  applyPalette(theme.id);
  set({ activeTheme: theme.id });
}

// Apply the (single) theme on startup — injects the chrome palette <style>.
export function initTheme() {
  applyTheme(DEFAULT_THEME_ID);
}
