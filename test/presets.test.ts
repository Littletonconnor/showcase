import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { JsonFileStore } from "../server/storage.ts";
import {
  loadBoardDefaults,
  loadUserExtensions,
  mergeExtensions,
  saveUserTheme,
  type UserExtensions,
} from "../server/userConfig.ts";
import type { Theme } from "../server/themes.ts";
import { deriveTheme } from "../server/themeDerive.ts";

function makeApp(opts?: { defaultBlueprint?: string; defaultTheme?: string }) {
  const dir = mkdtempSync(join(tmpdir(), "showcase-preset-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    playbookText: "# playbook",
    persistTheme: (t) => saveUserTheme(dir, t),
    ...opts,
  });
  return { app, store, dir };
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const patch = (body: unknown) => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const html = (s: string) => ({ kind: "html", html: s });

// Read a stored surface's first-part kits, asserting the surface exists (keeps
// the optional chain off the property access the linter flags).
async function firstKits(store: JsonFileStore, id: string): Promise<unknown> {
  const surf = await store.getSurface(id);
  assert.ok(surf, `surface ${id} exists`);
  return (surf.parts[0] as any).kits;
}

test("first publish pins the blueprint to the session; later surfaces inherit it", async () => {
  const { app, store } = makeApp();
  const s1 = (await (
    await app.request(
      "/api/surfaces",
      post({ title: "one", parts: [html("<p>1</p>")], blueprint: "product-demo" }),
    )
  ).json()) as any;
  // product-demo pins theme=brand, kits=animate+mockup; the first surface gets them.
  const surf1 = await store.getSurface(s1.id);
  assert.equal(surf1?.theme, "brand");
  assert.deepEqual(await firstKits(store, s1.id), ["animate", "mockup"]);

  // The session is now a product-demo session.
  const session = await store.getSession(s1.sessionId);
  assert.equal(session?.blueprint, "product-demo");

  // A SECOND publish with NO blueprint inherits the pinned preset.
  const s2 = (await (
    await app.request(
      "/api/surfaces",
      post({ title: "two", parts: [html("<p>2</p>")], session: s1.sessionId }),
    )
  ).json()) as any;
  const surf2 = await store.getSurface(s2.id);
  assert.equal(surf2?.theme, "brand");
  assert.deepEqual(await firstKits(store, s2.id), ["animate", "mockup"]);
});

test("a board default preset pins new sessions that name none", async () => {
  const { app, store } = makeApp({ defaultBlueprint: "concept" });
  const s = (await (
    await app.request("/api/surfaces", post({ title: "x", parts: [html("<p>x</p>")] }))
  ).json()) as any;
  const session = await store.getSession(s.sessionId);
  assert.equal(session?.blueprint, "concept");
  const surf = await store.getSurface(s.id);
  assert.equal(surf?.theme, "neutral"); // concept's theme
  assert.deepEqual(await firstKits(store, s.id), ["animate"]);
});

test("PATCH /api/sessions/:id pins and clears the preset", async () => {
  const { app, store } = makeApp();
  const s = (await (
    await app.request("/api/surfaces", post({ title: "x", parts: [html("<p>x</p>")] }))
  ).json()) as any;
  // Configure the session to data-viz after the fact.
  const patched = (await (
    await app.request(`/api/sessions/${s.sessionId}`, patch({ blueprint: "data-viz" }))
  ).json()) as any;
  assert.equal(patched.blueprint, "data-viz");
  const s2 = (await (
    await app.request(
      "/api/surfaces",
      post({ title: "y", parts: [html("<p>y</p>")], session: s.sessionId }),
    )
  ).json()) as any;
  assert.equal((await store.getSurface(s2.id))?.theme, "ocean"); // data-viz theme

  // Clearing the preset stops the inheritance.
  await app.request(`/api/sessions/${s.sessionId}`, patch({ blueprint: null }));
  assert.equal((await store.getSession(s.sessionId))?.blueprint, undefined);
});

test("an explicit preset on a later publish re-pins the session", async () => {
  const { app, store } = makeApp();
  const s1 = (await (
    await app.request("/api/surfaces", post({ parts: [html("<p>1</p>")], blueprint: "concept" }))
  ).json()) as any;
  await app.request(
    "/api/surfaces",
    post({ parts: [html("<p>2</p>")], session: s1.sessionId, blueprint: "data-viz" }),
  );
  assert.equal((await store.getSession(s1.sessionId))?.blueprint, "data-viz");
});

test("GET /api/sessions surfaces the pinned preset", async () => {
  const { app } = makeApp();
  const s = (await (
    await app.request("/api/surfaces", post({ parts: [html("<p>x</p>")], blueprint: "status" }))
  ).json()) as any;
  const sessions = (await (await app.request("/api/sessions")).json()) as any[];
  const row = sessions.find((r) => r.id === s.sessionId);
  // The session row carries the pinned blueprint id (the preset). The blueprint's
  // theme is applied to surfaces at resolve time, not copied onto the session.
  assert.equal(row.blueprint, "status");
});

test("POST /api/themes derives a brand theme, registers it live, and persists it", async () => {
  const { app, dir } = makeApp();
  const res = await app.request(
    "/api/themes",
    post({ seed: { id: "acme", label: "Acme", accent: "#5c46e6" }, persist: true }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.equal(body.id, "acme");
  assert.equal(body.persisted, true);
  assert.ok(body.theme.light.info.text);
  // It's now resolvable as a known theme.
  const themes = (await (await app.request("/api/themes")).json()) as string[];
  assert.ok(themes.includes("acme"));
  // And it was written to <dir>/themes/acme.json.
  const ext = await loadUserExtensions(dir);
  assert.ok(ext.themes.some((t) => t.id === "acme"));
});

// --- userConfig layering ----------------------------------------------------

const ext = (themes: { id: string; tag: string }[]): UserExtensions => ({
  themes: themes.map((t) => ({ id: t.id, label: t.tag }) as unknown as Theme),
  kits: [],
  blueprints: [],
});

test("mergeExtensions dedupes by id, earlier layer wins", () => {
  const repo = ext([{ id: "brandish", tag: "repo" }]);
  const user = ext([
    { id: "brandish", tag: "user" },
    { id: "mine", tag: "user" },
  ]);
  const merged = mergeExtensions([repo, user]); // repo first → repo wins
  const byId = new Map(merged.themes.map((t) => [t.id, (t as any).label]));
  assert.equal(byId.get("brandish"), "repo");
  assert.equal(byId.get("mine"), "user");
  assert.equal(merged.themes.length, 2);
});

test("loadBoardDefaults reads config.json, missing dir → {}", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-cfg-"));
  assert.deepEqual(await loadBoardDefaults(dir), {});
  writeFileSync(join(dir, "config.json"), JSON.stringify({ defaultBlueprint: "design-doc" }));
  assert.deepEqual(await loadBoardDefaults(dir), {
    defaultBlueprint: "design-doc",
    defaultTheme: undefined,
  });
});

test("saveUserTheme round-trips through loadUserExtensions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-save-"));
  mkdirSync(dir, { recursive: true });
  // A valid theme needs light + dark palettes (the loader validates them); derive
  // one so the round-trip exercises the real shape.
  const theme = deriveTheme({ id: "saved", label: "Saved", accent: "#5c46e6" });
  await saveUserTheme(dir, theme);
  const loaded = await loadUserExtensions(dir);
  assert.ok(loaded.themes.some((t) => t.id === "saved"));
});
