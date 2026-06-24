// Viewer-side theme controller. The active theme drives three things:
//   1. the chrome palette — a <style> of viewerThemeCss injected into <head>,
//      overriding the static defaults in styles.css (later rule wins);
//   2. the shiki theme for markdown/diff — read via activeTheme();
//   3. html surface parts — Card keys each iframe src on activeTheme(), so a
//      switch reloads the frame and the server re-injects matching tokens.
// The selection persists per-board server-side (PUT /api/theme); other open
// tabs re-theme via the theme-changed SSE event (see state.ts).
//
// activeTheme + prefersDark live in the zustand board store so components
// re-render when they change. The functions below are non-reactive snapshot
// accessors for the string-building/flow code; components subscribe with the
// useActiveTheme/useResolvedMode hooks.
import { api } from "./api.ts";
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

// Fetch the persisted board theme on startup. There is no in-app switcher
// anymore, so this is the only place the theme is set (fixed per board).
export async function initTheme() {
  const res = await api<{ id: string }>("/api/theme").catch(() => null);
  applyTheme(res?.id ?? DEFAULT_THEME_ID);
}
