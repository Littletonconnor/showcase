import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "@showcase/server/app";
import {
  type Blueprint,
  blueprintById,
  blueprintSummaries,
  brandCss,
  isKnownBlueprint,
  registerBlueprints,
  resolveBlueprint,
} from "@showcase/core/blueprints";
import { isKnownKit, kitAssets, registerKits } from "@showcase/core/kits";
import { JsonFileStore } from "@showcase/server/storage";
import { isKnownTheme, registerThemes, themeById, themeIds } from "@showcase/core/themes";
import type { SurfacePart } from "@showcase/core/types";

// register* is global module state that createApp resets per instance; reset to
// the built-ins so a prior test's fixtures never leak into a unit assertion.
const resetRegistries = () => {
  registerThemes([]);
  registerKits([]);
  registerBlueprints([]);
};

const html = (s: string): SurfacePart => ({ kind: "html", html: s });

// --- resolveBlueprint: gap-filling defaults ---

test("a blueprint fills the theme when the publish set none", () => {
  resetRegistries();
  const r = resolveBlueprint({ blueprint: "product-demo", parts: [html("<p>x</p>")] });
  assert.equal(r.blueprintId, "product-demo");
  assert.equal(r.theme, "brand"); // product-demo's theme
});

test("an explicit theme beats the blueprint's", () => {
  resetRegistries();
  const r = resolveBlueprint({
    blueprint: "product-demo",
    theme: "neutral",
    parts: [html("<p>x</p>")],
  });
  assert.equal(r.theme, "neutral");
});

test("a blueprint fills an html part's kits, and an explicit kit list wins", () => {
  resetRegistries();
  const r = resolveBlueprint({
    blueprint: "product-demo", // kits: animate + mockup
    parts: [html("<p>plain</p>"), { kind: "html", html: "<p>own</p>", kits: ["issues"] }],
  });
  assert.deepEqual((r.parts[0] as any).kits, ["animate", "mockup"]); // gap filled
  assert.deepEqual((r.parts[1] as any).kits, ["issues"]); // own kept
});

test("a blueprint never touches non-html parts", () => {
  resetRegistries();
  const parts: SurfacePart[] = [{ kind: "markdown", markdown: "# hi" }];
  const r = resolveBlueprint({ blueprint: "concept", parts });
  assert.deepEqual(r.parts[0], { kind: "markdown", markdown: "# hi" });
});

test("an unknown blueprint is a no-op (no id, theme from explicit only)", () => {
  resetRegistries();
  const r = resolveBlueprint({ blueprint: "nope", theme: "neutral", parts: [html("<p>x</p>")] });
  assert.equal(r.blueprintId, undefined);
  assert.equal(r.theme, "neutral");
  assert.equal((r.parts[0] as any).kits, undefined);
});

test("the blueprint's default badge rides along for the publish flow", () => {
  resetRegistries();
  assert.deepEqual(resolveBlueprint({ blueprint: "concept", parts: [] }).defaultBadge, {
    tone: "info",
    label: "Explainer",
  });
});

test("a user blueprint's invalid kit ids are filtered, not baked into parts", () => {
  resetRegistries();
  registerBlueprints([{ id: "bad", label: "Bad", summary: "s", kits: ["animate", "ghost-kit"] }]);
  const r = resolveBlueprint({ blueprint: "bad", parts: [html("<p>x</p>")] });
  assert.deepEqual((r.parts[0] as any).kits, ["animate"]); // ghost-kit dropped
});

// --- inheritance (extends) ---

test("extends merges parent fields, child overrides, structure inherited", () => {
  resetRegistries();
  registerBlueprints([
    { id: "child", label: "Child", summary: "s", extends: "concept", theme: "showcase" },
  ]);
  const bp = blueprintById("child");
  assert.ok(bp);
  assert.equal(bp.theme, "showcase"); // overridden
  assert.deepEqual(bp.kits, ["animate"]); // inherited from concept
  assert.equal(bp.structure?.[0].id, "question"); // inherited structure
  assert.equal(bp.extends, undefined); // flattened
});

test("a self-referential extends does not loop", () => {
  resetRegistries();
  registerBlueprints([{ id: "loop", label: "L", summary: "s", extends: "loop" }]);
  assert.ok(blueprintById("loop")); // returns, doesn't hang
});

// --- registry layering ---

test("a user blueprint registers and shadows a built-in id", () => {
  resetRegistries();
  assert.equal(isKnownBlueprint("custom"), false);
  registerBlueprints([
    { id: "custom", label: "Custom", summary: "mine", theme: "neutral" },
    { id: "concept", label: "Override", summary: "shadowed", theme: "brand" },
  ]);
  assert.equal(isKnownBlueprint("custom"), true);
  assert.equal(blueprintById("concept")?.theme, "brand"); // user shadows built-in
  registerBlueprints([]); // reset, built-in restored
  assert.equal(blueprintById("concept")?.theme, "neutral");
});

test("a user theme registers and resolves", () => {
  resetRegistries();
  assert.equal(isKnownTheme("acme"), false);
  const palette = themeById("showcase").light;
  registerThemes([
    {
      id: "acme",
      label: "Acme",
      shiki: { light: "github-light", dark: "github-dark" },
      light: palette,
      dark: palette,
    },
  ]);
  assert.equal(isKnownTheme("acme"), true);
  assert.equal(themeById("acme").id, "acme");
  assert.ok(themeIds().includes("acme"));
  registerThemes([]);
});

test("a user kit registers and injects its css", () => {
  resetRegistries();
  assert.equal(isKnownKit("bezel"), false);
  registerKits([
    { id: "bezel", label: "Bezel", summary: "s", classes: "frame", css: ".frame{border:9px}" },
  ]);
  assert.equal(isKnownKit("bezel"), true);
  assert.match(kitAssets(["bezel"]).css, /\.frame\{border:9px\}/);
  registerKits([]);
});

// --- brandCss ---

test("brandCss emits font/logo/wordmark tokens and strips css-breaking chars", () => {
  const css = brandCss(
    { fontFamily: "Acme Sans, sans-serif", logoAssetId: "abc_123", wordmark: 'Acme"};danger' },
    "http://host",
  );
  assert.match(css, /--font-sans:Acme Sans, sans-serif/);
  assert.match(css, /--brand-logo:url\("http:\/\/host\/a\/abc_123"\)/);
  assert.match(css, /--brand-wordmark:"Acmedanger"/); // ", }, ; stripped
  assert.doesNotMatch(css, /\}danger/); // the brace never escaped the rule
});

test("brandCss is empty for no brand / an unusable logo id", () => {
  assert.equal(brandCss(undefined, "http://h"), "");
  assert.equal(brandCss({ logoAssetId: "../etc/passwd" }, "http://h"), ""); // rejected by the id guard
});

// --- discovery payload ---

test("blueprintSummaries exposes built-ins with their structure", () => {
  resetRegistries();
  const ids = blueprintSummaries().map((b) => b.id);
  assert.ok(ids.includes("product-demo"));
  assert.ok(ids.includes("concept"));
  const demo = blueprintSummaries().find((b) => b.id === "product-demo");
  assert.equal(demo?.theme, "brand");
  assert.ok(demo?.structure.some((s) => s.id === "proof" && s.required));
});

// --- integration: createApp ---

function makeApp(extras?: { themes?: any[]; kits?: any[]; blueprints?: Blueprint[] }) {
  const dir = mkdtempSync(join(tmpdir(), "showcase-bp-"));
  return createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    playbookText: "# playbook",
    extraThemes: extras?.themes,
    extraKits: extras?.kits,
    extraBlueprints: extras?.blueprints,
  });
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("publishing with a blueprint bakes its theme + kits + badge into the surface", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    post({ title: "Demo", blueprint: "product-demo", parts: [{ kind: "html", html: "<p>x</p>" }] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.equal(surface.blueprint, "product-demo");
  assert.equal(surface.theme, "brand");
  assert.equal(surface.badge.label, "Demo");

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.deepEqual(full.parts[0].kits, ["animate", "mockup"]);
});

test("an explicit theme on publish overrides the blueprint's", async () => {
  const app = makeApp();
  const surface = (await (
    await app.request(
      "/api/surfaces",
      post({
        title: "T",
        blueprint: "product-demo",
        theme: "neutral",
        parts: [{ kind: "html", html: "<p>x</p>" }],
      }),
    )
  ).json()) as any;
  assert.equal(surface.theme, "neutral");
});

test("GET /api/blueprints and /api/themes expose discovery payloads", async () => {
  const app = makeApp();
  const bps = (await (await app.request("/api/blueprints")).json()) as any[];
  assert.ok(bps.some((b) => b.id === "concept"));
  const themes = (await (await app.request("/api/themes")).json()) as string[];
  assert.ok(themes.includes("showcase"));
});

test("user config flows through createApp into the registries and render", async () => {
  const palette = themeById("showcase").light;
  const app = makeApp({
    themes: [
      {
        id: "acme",
        label: "Acme",
        shiki: { light: "github-light", dark: "github-dark" },
        light: palette,
        dark: palette,
      },
    ],
    blueprints: [
      {
        id: "acme-demo",
        label: "Acme demo",
        summary: "branded",
        theme: "acme",
        kits: ["animate"],
        brand: { fontFamily: "Acme Sans", wordmark: "Acme" },
      },
    ],
  });
  // The user theme + blueprint are discoverable...
  const themes = (await (await app.request("/api/themes")).json()) as string[];
  assert.ok(themes.includes("acme"));
  const bps = (await (await app.request("/api/blueprints")).json()) as any[];
  assert.ok(bps.some((b) => b.id === "acme-demo"));

  // ...and publishing under the user blueprint resolves the user theme + injects brand.
  const surface = (await (
    await app.request(
      "/api/surfaces",
      post({
        title: "Acme",
        blueprint: "acme-demo",
        parts: [{ kind: "html", html: "<div class='anim'><div class='step'>hi</div></div>" }],
      }),
    )
  ).json()) as any;
  assert.equal(surface.theme, "acme");

  const page = await (await app.request(`/s/${surface.id}?part=0`)).text();
  assert.match(page, /--font-sans:Acme Sans/); // brand font override
  assert.match(page, /--brand-wordmark:"Acme"/); // brand wordmark token
});

test("the served guide lists the board's blueprints", async () => {
  const app = makeApp();
  const guide = await (await app.request("/guide")).text();
  assert.match(guide, /Explainer blueprints on this board/);
  assert.match(guide, /\*\*product-demo\*\*/);
  assert.match(guide, /Hook → Problem → Feature → Proof → Next step/);
});
