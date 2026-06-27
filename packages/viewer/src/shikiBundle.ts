// Curated stand-in for shiki's full bundle, aliased in for the bare "shiki"
// specifier (see vite.config.ts). The stock `shiki` barrel ships every bundled
// grammar (~200) and theme (~60) as an object map of dynamic imports; both our
// highlight.ts and @pierre/diffs import `bundledLanguages` / `createHighlighter`
// from "shiki" and index that map by a runtime string id, which forces Vite to
// emit a chunk per grammar — and vite-plugin-singlefile inlines every chunk, so
// the full bundle alone was ~9 MB (two thirds) of the viewer. This module
// exposes only the languages we realistically render plus the engine + core
// re-exports the two consumers need; everything else resolves to a no-grammar
// fallback (rendered as plain, unhighlighted text) so a diff or code part in an
// uncurated language degrades gracefully instead of throwing.
//
// tsc resolves "shiki" to the real package (the alias is build-only), so this
// shim only has to match shiki's *runtime* shape for the names the two consumers
// import — the types still check against upstream shiki.

export * from "@shikijs/core";
import {
  createHighlighterCore,
  createSingletonShorthands,
  type HighlighterCore,
} from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";

export { createJavaScriptRegexEngine, createOnigurumaEngine };
export type Highlighter = HighlighterCore;

// The grammars we bundle. Each value is a literal dynamic import so Vite can
// emit (and singlefile inline) exactly these chunks — keep the list lean, every
// entry is weight. Covers the languages a code-review / agent surface shows in
// practice; anything outside it falls through to the plain-text fallback below.
const CANONICAL: Record<string, () => Promise<unknown>> = {
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  json5: () => import("@shikijs/langs/json5"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  less: () => import("@shikijs/langs/less"),
  sass: () => import("@shikijs/langs/sass"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  bash: () => import("@shikijs/langs/bash"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  shellsession: () => import("@shikijs/langs/shellsession"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  scala: () => import("@shikijs/langs/scala"),
  dart: () => import("@shikijs/langs/dart"),
  lua: () => import("@shikijs/langs/lua"),
  r: () => import("@shikijs/langs/r"),
  perl: () => import("@shikijs/langs/perl"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  ini: () => import("@shikijs/langs/ini"),
  diff: () => import("@shikijs/langs/diff"),
  graphql: () => import("@shikijs/langs/graphql"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  xml: () => import("@shikijs/langs/xml"),
  proto: () => import("@shikijs/langs/proto"),
  make: () => import("@shikijs/langs/make"),
  hcl: () => import("@shikijs/langs/hcl"),
  elixir: () => import("@shikijs/langs/elixir"),
  powershell: () => import("@shikijs/langs/powershell"),
  groovy: () => import("@shikijs/langs/groovy"),
};

// Common aliases (file-extension ids, short names) → a canonical loader, so
// ```js, a `.ts` file, `sh`, `yml`, etc. all resolve to a real grammar.
const ALIASES: Record<string, string> = {
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  rs: "rust",
  kt: "kotlin",
  docker: "dockerfile",
  makefile: "make",
  terraform: "hcl",
  tf: "hcl",
  ps1: "powershell",
  htm: "html",
  pl: "perl",
};

// A valid-but-empty grammar so an uncurated language id resolves (rendered as
// plain text) instead of rejecting — @pierre/diffs throws on a missing loader,
// which would fail the whole diff, so every id must resolve to something.
function plainFallback(id: string): () => Promise<unknown> {
  const scope = `source.${id.replace(/[^a-zA-Z0-9]+/g, "_") || "text"}`;
  return () =>
    Promise.resolve({ default: [{ name: id, scopeName: scope, patterns: [], repository: {} }] });
}

function loaderFor(id: string): () => Promise<unknown> {
  return CANONICAL[id] ?? (ALIASES[id] ? CANONICAL[ALIASES[id]] : undefined) ?? plainFallback(id);
}

// Proxy so `bundledLanguages[id]` always yields a loader and
// `hasOwnProperty(id)` is always true — @pierre/diffs' resolveLanguage relies on
// both, and this is what keeps an uncurated language from throwing.
export const bundledLanguages: Record<string, () => Promise<unknown>> = new Proxy(CANONICAL, {
  get: (_t, prop) => (typeof prop === "string" ? loaderFor(prop) : undefined),
  has: () => true,
  getOwnPropertyDescriptor: (_t, prop) =>
    typeof prop === "string"
      ? { configurable: true, enumerable: true, writable: false, value: loaderFor(prop) }
      : undefined,
});

// Only the themes the registry actually selects (server/themes.ts). Unlike
// languages this isn't a hot path with arbitrary ids, so a plain map is enough.
export const bundledThemes: Record<string, () => Promise<unknown>> = {
  "github-light": () => import("@shikijs/themes/github-light"),
  "github-dark": () => import("@shikijs/themes/github-dark"),
};

const sharedJsEngine = createJavaScriptRegexEngine({ forgiving: true });
const PLAIN = new Set(["text", "plaintext", "plain", "txt", "ansi"]);

// Map shiki's string-id `langs`/`themes` options onto core's loader inputs, and
// default the engine to the JS regex engine (no oniguruma WASM) — both consumers
// pass langs/themes as bundle ids, which core (unlike the full bundle) doesn't
// accept directly.
export function createHighlighter(options: Record<string, unknown> = {}) {
  const langs = ((options.langs as unknown[]) ?? [])
    .filter((l) => !(typeof l === "string" && PLAIN.has(l)))
    .map((l) => (typeof l === "string" ? loaderFor(l) : l));
  const themes = ((options.themes as unknown[]) ?? []).map((t) =>
    typeof t === "string" ? (bundledThemes[t] ?? plainFallback(t)) : t,
  );
  return createHighlighterCore({
    ...options,
    langs,
    themes,
    engine: (options.engine as never) ?? sharedJsEngine,
  } as never);
}

// @pierre/diffs imports `codeToHtml` from "shiki"; build the bundled shorthands
// on top of the curated createHighlighter above.
export const {
  codeToHtml,
  codeToHast,
  codeToTokens,
  getSingletonHighlighter,
  getLastGrammarState,
} = createSingletonShorthands(createHighlighter as never);
