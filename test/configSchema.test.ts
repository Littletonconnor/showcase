import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_KINDS, validateConfig } from "@showcase/core/configSchema";
import type { ConfigKind } from "@showcase/core/configSchema";

// A full, valid palette (every documented slot, valid colors). Shared by the
// theme cases so each test only perturbs the one thing it's checking.
const palette = {
  bg: "#fff",
  panel: "#eee",
  surface: "#fff",
  text: "#111",
  muted: "#666",
  faint: "#999",
  border: "#ddd",
  border2: "#ccc",
  hover: "#f5f5f5",
  info: { bg: "#eef", text: "#33c", border: "#aac" },
  success: { bg: "#efe", text: "#2a2", border: "#9c9" },
  warning: { bg: "rgba(200,160,40,.2)", text: "tomato", border: "var(--w)" },
  danger: { bg: "#fee", text: "#c33", border: "#eaa" },
};
const theme = { id: "acme", label: "Acme", light: palette, dark: palette };

const issues = (kind: ConfigKind, raw: unknown) => {
  const r = validateConfig(kind, raw);
  return r.ok ? [] : r.issues;
};

test("CONFIG_KINDS lists the four config kinds", () => {
  assert.deepEqual([...CONFIG_KINDS].sort(), ["blueprint", "config", "kit", "theme"]);
});

test("a full, well-formed theme validates (hex, rgba, named, var colors all ok)", () => {
  assert.deepEqual(validateConfig("theme", theme), { ok: true });
});

test("a malformed palette color is reported at its path", () => {
  const bad = { ...theme, light: { ...palette, bg: "blue-ish" } };
  const found = issues("theme", bad);
  assert.ok(found.some((i) => i.path === "light.bg" && /CSS color/.test(i.message)));
});

test("a misspelled palette slot is flagged (strict), not silently dropped", () => {
  const { bg: _drop, ...rest } = palette;
  const bad = { ...theme, light: { ...rest, bgg: "#fff" } };
  const found = issues("theme", bad);
  // both the unknown key and the now-missing required slot surface
  assert.ok(found.some((i) => /Unrecognized key/.test(i.message)));
  assert.ok(found.some((i) => i.path === "light.bg"));
});

test("a theme missing a whole scheme is invalid", () => {
  const { dark: _d, ...noDark } = theme;
  assert.ok(issues("theme", noDark).some((i) => i.path === "dark"));
});

test("a theme with no id/label is invalid", () => {
  const found = issues("theme", { light: palette, dark: palette });
  assert.ok(found.some((i) => i.path === "id"));
  assert.ok(found.some((i) => i.path === "label"));
});

test("a kit needs id, label, and non-empty css; summary/classes/js optional", () => {
  assert.deepEqual(validateConfig("kit", { id: "k", label: "K", css: ".x{}" }), { ok: true });
  assert.ok(issues("kit", { id: "k", label: "K" }).some((i) => i.path === "css"));
  assert.ok(issues("kit", { id: "k", label: "K", css: "" }).some((i) => i.path === "css"));
});

test("a blueprint validates structure + badge tone, rejects a bad tone", () => {
  const ok = {
    id: "bp",
    label: "BP",
    summary: "one line",
    kits: ["animate"],
    structure: [{ id: "s", label: "Step", required: true }],
    defaults: { badge: { tone: "info", label: "Demo" } },
  };
  assert.deepEqual(validateConfig("blueprint", ok), { ok: true });

  const badTone = { ...ok, defaults: { badge: { tone: "nope", label: "Demo" } } };
  assert.ok(issues("blueprint", badTone).some((i) => i.path === "defaults.badge.tone"));
});

test("config.json validates the two default fields and flags a typo'd key", () => {
  assert.deepEqual(validateConfig("config", { defaultTheme: "acme" }), { ok: true });
  assert.ok(
    issues("config", { defualtTheme: "acme" }).some((i) => /Unrecognized key/.test(i.message)),
  );
});
