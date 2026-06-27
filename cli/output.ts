// Output policy in one place. The CLI prints a short human line by default and
// the raw machine object only under `--json` (set globally per invocation).
// Commands build both: the structured value and a human string, then call
// emit() — so scripting (`--json`) and interactive use share one code path.
import { BASE } from "./http.ts";

let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJson(): boolean {
  return jsonMode;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

// Emit a result: the structured `value` under --json, otherwise the human
// rendering (a string, or a thunk so callers can skip building it in json mode).
export function emit(value: unknown, human: string | (() => string)): void {
  if (jsonMode) return printJson(value);
  console.log(typeof human === "function" ? human() : human);
}

export interface Surfaceish {
  id: string;
  sessionId: string;
  title?: string;
  version?: number;
}

export function surfaceUrl(surface: Surfaceish): string {
  return `${BASE}/session/${surface.sessionId}/s/${surface.id}`;
}

// Standard "a surface was published/updated" result. Human form leads with the
// deep link (what you click) and the id (what you paste back to the agent).
export function emitSurface(surface: Surfaceish): void {
  const url = surfaceUrl(surface);
  emit({ ...surface, url }, () => {
    const label = surface.title ? `“${surface.title}” ` : "";
    const ver = surface.version && surface.version > 1 ? ` (v${surface.version})` : "";
    return `published ${label}${ver}\n  ${url}\n  surface ${surface.id}`;
  });
}
