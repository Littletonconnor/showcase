import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTheme, parseHex, themePreviewHtml } from "@showcase/core/themeDerive";
import type { Palette } from "@showcase/core/themes";

// Recompute WCAG contrast in the test so the assertion is independent of the
// engine's own clamp — this is the property that actually matters (a derived
// accent must stay legible), checked against the source of truth, not itself.
function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const PALETTE_KEYS: (keyof Palette)[] = [
  "bg",
  "panel",
  "surface",
  "text",
  "muted",
  "faint",
  "border",
  "border2",
  "hover",
];

function assertComplete(p: Palette) {
  for (const k of PALETTE_KEYS) assert.ok((p[k] as string).length > 0, `${String(k)} is set`);
  for (const a of ["info", "success", "warning", "danger"] as const) {
    assert.ok(p[a].bg.length > 0, `${a}.bg`);
    assert.ok(p[a].text.length > 0, `${a}.text`);
    assert.ok(p[a].border.length > 0, `${a}.border`);
  }
}

test("a single accent seed yields a complete light + dark theme", () => {
  const t = deriveTheme({ id: "acme", label: "Acme", accent: "#5c46e6" });
  assert.equal(t.id, "acme");
  assert.equal(t.label, "Acme");
  assert.deepEqual(t.shiki, { light: "github-light", dark: "github-dark" });
  assertComplete(t.light);
  assertComplete(t.dark);
});

test("derived accent text stays legible on its surface (both schemes)", () => {
  // A pale brand color is the hard case — the clamp must darken it on white and
  // lighten it on the dark surface until it clears a readable threshold.
  const t = deriveTheme({ id: "pale", label: "Pale", accent: "#9ad0ff" });
  assert.ok(
    contrast(t.light.info.text, t.light.surface) >= 4,
    `light accent contrast ${contrast(t.light.info.text, t.light.surface).toFixed(2)} >= 4`,
  );
  assert.ok(
    contrast(t.dark.info.text, t.dark.surface) >= 4,
    `dark accent contrast ${contrast(t.dark.info.text, t.dark.surface).toFixed(2)} >= 4`,
  );
});

test("light and dark are genuinely different schemes", () => {
  const t = deriveTheme({ id: "x", label: "X", accent: "#1a66c7" });
  assert.notEqual(t.light.bg, t.dark.bg);
  assert.notEqual(t.light.text, t.dark.text);
  // Dark bg is darker than dark text; light bg is lighter than light text.
  assert.ok(luminance(t.dark.bg) < luminance(t.dark.text));
  assert.ok(luminance(t.light.bg) > luminance(t.light.text));
});

test("a neutral seed tints the chrome; semantic overrides are honored", () => {
  const warm = deriveTheme({ id: "warm", label: "Warm", accent: "#bd5b3c", neutral: "#8a7c5a" });
  const cool = deriveTheme({ id: "cool", label: "Cool", accent: "#bd5b3c", neutral: "#5a6b8a" });
  // Same accent, different neutral → different paper.
  assert.notEqual(warm.light.bg, cool.light.bg);
  // An explicit danger color flows through to the danger accent text.
  const t = deriveTheme({ id: "d", label: "D", accent: "#1a66c7", danger: "#aa0000" });
  assert.ok(contrast(t.light.danger.text, t.light.surface) >= 4);
});

test("an unparseable accent falls back instead of throwing", () => {
  const t = deriveTheme({ id: "bad", label: "Bad", accent: "not-a-color" });
  assertComplete(t.light);
  assertComplete(t.dark);
});

test("themePreviewHtml references theme tokens and the label", () => {
  const t = deriveTheme({ id: "acme", label: "Acme Brand", accent: "#5c46e6" });
  const html = themePreviewHtml(t);
  assert.match(html, /--color-text-info/);
  assert.match(html, /--color-background-primary/);
  assert.match(html, /Acme Brand/);
});

test("parseHex accepts #rgb, #rrggbb, and rejects junk", () => {
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("000000"), { r: 0, g: 0, b: 0 });
  assert.equal(parseHex("nope"), null);
});
