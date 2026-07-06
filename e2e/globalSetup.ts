import { rm } from "node:fs/promises";
import type { FullConfig } from "@playwright/test";

// One fresh board + mastery file per run: mastery is keyed by topic and
// persists across server restarts, so state left by a previous run would
// leak into this one (the specs used to dodge it by suffixing topics with a
// run id). The webServer may already be spawning when this runs, but both
// stores read their file lazily on the first request, which is always after
// setup finishes.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
  const env = (server?.env ?? {}) as Record<string, string | undefined>;
  const files = [env.SHOWCASE_DATA, env.SHOWCASE_MASTERY].filter(
    (f): f is string => typeof f === "string" && f.length > 0,
  );
  await Promise.all(
    files.flatMap((f) => [f, `${f}.bak`, `${f}.tmp`]).map((f) => rm(f, { force: true })),
  );
}
