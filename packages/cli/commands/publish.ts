// The publish family: every command that creates or revises a surface, plus
// the raw asset helpers. They share PUBLISH_OPTS (title + session controls) and
// the publishSurface() helper.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Command, OptionSpecs } from "../command.ts";
import { api, BASE, uploadFile } from "../http.ts";
import { emit, emitSurface } from "../output.ts";
import { resolveSession } from "../session.ts";
import { fail } from "../errors.ts";
import { confirm, CONFIRM_OPTS } from "../prompt.ts";
import { inferLang, normalizeKits, readContent } from "../util.ts";

const PUBLISH_OPTS: OptionSpecs = {
  title: { type: "string", placeholder: "t", desc: "surface (card) title" },
  theme: {
    type: "string",
    placeholder: "id",
    desc: "render under a theme (showcase | brand | neutral | ocean | forest | dracula | nord | rose)",
  },
  blueprint: { type: "string", placeholder: "id", desc: "apply an explainer blueprint preset" },
  session: { type: "string", placeholder: "id", desc: "target session (default: auto per agent)" },
  "session-title": { type: "string", placeholder: "t", desc: "name for a newly created session" },
  agent: { type: "string", placeholder: "name", desc: "agent name for new sessions" },
  "new-session": { type: "boolean", desc: "force a fresh session" },
};

async function publishSurface(parts: unknown[], flags: Record<string, any>): Promise<any> {
  const session = await resolveSession(flags, { create: true });
  return api("/api/surfaces", {
    method: "POST",
    body: JSON.stringify({
      parts,
      title: flags.title,
      theme: flags.theme,
      blueprint: flags.blueprint,
      session,
      sessionTitle: flags["session-title"],
    }),
  });
}

const publish: Command = {
  name: "publish",
  group: "Publish",
  summary: "publish an HTML surface (one html part; combine with other parts)",
  usage: "showcase publish <file|-> [options]",
  positionals: true,
  options: {
    ...PUBLISH_OPTS,
    md: { type: "string", placeholder: "file|-", desc: "add a markdown part (prose)" },
    mermaid: { type: "string", placeholder: "file|-", desc: "add a mermaid part (diagram → SVG)" },
    diff: { type: "string", placeholder: "file|-", desc: "add a diff part from a patch" },
    image: {
      type: "string",
      placeholder: "file",
      desc: "upload an image and append an image part",
    },
    terminal: {
      type: "string",
      placeholder: "file|-",
      desc: "add a terminal part (monospace/ANSI)",
    },
    "json-part": {
      type: "string",
      placeholder: "file|-",
      desc: "add a json part (collapsible tree)",
    },
    code: { type: "string", placeholder: "file|-", desc: "add a code part (shiki-highlighted)" },
    kit: {
      type: "string",
      multiple: true,
      placeholder: "id",
      desc: "opt the html part into a kit (repeatable; see `showcase kits`)",
    },
    layout: {
      type: "string",
      placeholder: "mode",
      desc: "diff layout: unified (default) or split",
    },
  },
  help: "Note: --json is the global raw-output flag; to add a JSON *part*, use --json-part <file>.",
  async run({ flags, positionals }) {
    if (!positionals[0] && process.stdin.isTTY) fail("usage: showcase publish <file|->");
    const htmlPart: Record<string, unknown> = { kind: "html", html: readContent(positionals[0]) };
    const kits = normalizeKits(flags.kit);
    if (kits) htmlPart.kits = kits;
    const parts: Record<string, unknown>[] = [htmlPart];
    if (flags.md !== undefined) {
      parts.push({ kind: "markdown", markdown: readContent(flags.md || "-") });
    }
    if (flags.mermaid !== undefined) {
      parts.push({ kind: "mermaid", mermaid: readContent(flags.mermaid || "-") });
    }
    if (flags.diff !== undefined) {
      parts.push({
        kind: "diff",
        patch: readContent(flags.diff || "-"),
        ...(flags.layout === "split" && { layout: "split" }),
      });
    }
    if (flags.terminal !== undefined) {
      parts.push({ kind: "terminal", text: readContent(flags.terminal || "-") });
    }
    if (flags["json-part"] !== undefined) {
      const text = readContent(flags["json-part"] || "-");
      try {
        parts.push({ kind: "json", data: JSON.parse(text) });
      } catch {
        fail(`--json-part: invalid JSON${flags["json-part"] ? ` in ${flags["json-part"]}` : ""}`);
      }
    }
    if (flags.code !== undefined) {
      const codeFile = flags.code || "-";
      const part: Record<string, unknown> = { kind: "code", code: readContent(codeFile) };
      const codeLang = codeFile !== "-" ? inferLang(codeFile) : undefined;
      if (codeLang) part.language = codeLang;
      if (codeFile !== "-") part.title = codeFile.split("/").pop() || codeFile;
      parts.push(part);
    }
    // Resolve the session first so the image upload and the surface share it.
    const session = await resolveSession(flags, { create: true });
    if (flags.image !== undefined) {
      const asset = await uploadFile(flags.image, { session: session ?? undefined, kind: "image" });
      parts.push({ kind: "image", assetId: asset.id });
    }
    emitSurface(await publishSurface(parts, { ...flags, session }));
  },
};

// A small publish command that wraps a single part read from a file/stdin.
function singlePartCommand(
  name: string,
  group: string,
  summary: string,
  build: (text: string, flags: Record<string, any>) => Record<string, unknown>,
  extraOptions: OptionSpecs = {},
): Command {
  return {
    name,
    group,
    summary,
    usage: `showcase ${name} <file|-> [options]`,
    positionals: true,
    options: { ...PUBLISH_OPTS, ...extraOptions },
    async run({ flags, positionals }) {
      if (!positionals[0] && process.stdin.isTTY) fail(`usage: showcase ${name} <file|->`);
      emitSurface(await publishSurface([build(readContent(positionals[0]), flags)], flags));
    },
  };
}

const diff: Command = singlePartCommand(
  "diff",
  "Publish",
  "publish a diff surface from a unified/git patch",
  (patch, flags) => ({
    kind: "diff",
    patch,
    ...(flags.layout === "split" && { layout: "split" }),
  }),
  { layout: { type: "string", placeholder: "mode", desc: "unified (default) or split" } },
);

const markdown: Command = singlePartCommand(
  "markdown",
  "Publish",
  "publish a markdown surface (prose)",
  (md) => ({ kind: "markdown", markdown: md }),
);

const mermaid: Command = singlePartCommand(
  "mermaid",
  "Publish",
  "publish a mermaid surface (diagram source → SVG)",
  (src) => ({ kind: "mermaid", mermaid: src }),
);

const terminal: Command = singlePartCommand(
  "terminal",
  "Publish",
  "publish terminal output (monospace + ANSI)",
  (text, flags) => {
    const cols = Number(flags.cols);
    return {
      kind: "terminal",
      text,
      ...(Number.isFinite(cols) && cols > 0 && { cols: Math.floor(cols) }),
      ...(flags["term-title"] && { title: flags["term-title"] }),
    };
  },
  {
    "term-title": { type: "string", placeholder: "t", desc: "label in the terminal window chrome" },
    cols: { type: "string", placeholder: "n", desc: "render width hint, in columns" },
  },
);

const jsonCmd: Command = {
  name: "json",
  group: "Publish",
  summary: "publish a JSON surface (collapsible tree)",
  usage: "showcase json <file|-> [options]",
  positionals: true,
  options: { ...PUBLISH_OPTS },
  async run({ flags, positionals }) {
    if (!positionals[0]) fail("usage: showcase json <file|-> [--title t]");
    let data;
    try {
      data = JSON.parse(readContent(positionals[0]));
    } catch {
      fail(`invalid JSON${positionals[0] !== "-" ? ` in ${positionals[0]}` : ""}`);
    }
    emitSurface(await publishSurface([{ kind: "json", data }], flags));
  },
};

const chart: Command = {
  name: "chart",
  group: "Publish",
  summary: "publish a chart surface (native SVG chart)",
  usage: "showcase chart <file|-> [options]",
  positionals: true,
  options: { ...PUBLISH_OPTS },
  help: "The file holds the chart spec: {chartType, x, y, data[, stacked, xLabel, yLabel, caption]}.",
  async run({ flags, positionals }) {
    if (!positionals[0]) fail("usage: showcase chart <file|-> [--title t]");
    let spec;
    try {
      spec = JSON.parse(readContent(positionals[0]));
    } catch {
      fail(`invalid JSON${positionals[0] !== "-" ? ` in ${positionals[0]}` : ""}`);
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      fail("chart spec must be a JSON object with chartType, x, y, and data");
    }
    emitSurface(await publishSurface([{ kind: "chart", ...spec }], flags));
  },
};

const code: Command = {
  name: "code",
  group: "Publish",
  summary: "publish a code surface (shiki-highlighted)",
  usage: "showcase code <file|-> [options]",
  positionals: true,
  options: {
    ...PUBLISH_OPTS,
    filename: { type: "string", placeholder: "f", desc: "filename shown in the code header bar" },
    language: {
      type: "string",
      placeholder: "lang",
      desc: "shiki language id (inferred if omitted)",
    },
    "line-start": {
      type: "string",
      placeholder: "n",
      desc: "1-based line number the excerpt starts at",
    },
  },
  async run({ flags, positionals }) {
    if (!positionals[0]) {
      fail(
        "usage: showcase code <file|-> [--title t] [--filename f] [--language lang] [--line-start n]",
      );
    }
    const part: Record<string, unknown> = { kind: "code", code: readContent(positionals[0]) };
    const lang = flags.language ?? (positionals[0] !== "-" ? inferLang(positionals[0]) : undefined);
    if (lang) part.language = lang;
    const ls = Number(flags["line-start"]);
    if (Number.isFinite(ls) && ls >= 1) part.lineStart = Math.floor(ls);
    const filename =
      flags.filename ??
      (positionals[0] !== "-" ? positionals[0].split("/").pop() || positionals[0] : undefined);
    if (filename) part.title = filename;
    emitSurface(await publishSurface([part], flags));
  },
};

const image: Command = {
  name: "image",
  group: "Publish",
  summary: "upload an image and publish it as a surface",
  usage: "showcase image <file> [options]",
  positionals: true,
  options: {
    ...PUBLISH_OPTS,
    caption: { type: "string", placeholder: "c", desc: "caption under the image" },
  },
  async run({ flags, positionals }) {
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase image <file> [--title t]");
    const session = await resolveSession(flags, { create: true });
    const asset = await uploadFile(file, { session: session ?? undefined, kind: "image" });
    const part = {
      kind: "image",
      assetId: asset.id,
      ...(flags.caption && { caption: flags.caption }),
    };
    emitSurface(await publishSurface([part], { ...flags, session }));
  },
};

const trace: Command = {
  name: "trace",
  group: "Publish",
  summary: "upload a trace file and publish it as a surface",
  usage: "showcase trace <file> [options]",
  positionals: true,
  options: { ...PUBLISH_OPTS },
  async run({ flags, positionals }) {
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase trace <file> [--title t]");
    const session = await resolveSession(flags, { create: true });
    const asset = await uploadFile(file, { session: session ?? undefined, kind: "trace" });
    emitSurface(
      await publishSurface([{ kind: "trace", assetId: asset.id }], { ...flags, session }),
    );
  },
};

const upload: Command = {
  name: "upload",
  group: "Publish",
  summary: "upload an asset, print its id and URL",
  usage: "showcase upload <file> [options]",
  positionals: true,
  options: {
    kind: { type: "string", placeholder: "k", desc: "image|trace|file (default: inferred)" },
    session: { type: "string", placeholder: "id", desc: "session to attach to (default: auto)" },
  },
  async run({ flags, positionals }) {
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase upload <file> [--kind k] [--session id]");
    const session = flags.session ?? (await resolveSession(flags, { create: true }));
    const asset = await uploadFile(file, { session: session ?? undefined, kind: flags.kind });
    emit(asset, () => `uploaded ${file}\n  ${asset.url}\n  asset ${asset.id}`);
  },
};

const assetUrl: Command = {
  name: "asset-url",
  group: "Publish",
  summary: "print the URL a file will have (content hash; no upload)",
  usage: "showcase asset-url <file>",
  positionals: true,
  async run({ positionals }) {
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase asset-url <file>");
    const id = createHash("sha256").update(readFileSync(file)).digest("hex");
    emit({ id, url: `${BASE}/a/${id}` }, `${BASE}/a/${id}`);
  },
};

// Rebuild a part of the surface's own kind from new text content, carrying
// non-content fields (language, layout, title, kits, …) over from the old
// part. Returns null for kinds that can't be authored from text (image/trace
// are asset-backed).
function revisedPart(old: Record<string, unknown>, text: string): Record<string, unknown> | null {
  switch (old.kind) {
    case "html":
      return { ...old, html: text };
    case "markdown":
      return { ...old, markdown: text };
    case "mermaid":
      return { ...old, mermaid: text };
    case "diff":
      return { ...old, patch: text };
    case "terminal":
      return { ...old, text };
    case "code":
      return { ...old, code: text };
    case "json": {
      try {
        return { ...old, data: JSON.parse(text) };
      } catch {
        fail("update: the new content must be valid JSON (the surface is a json part)");
      }
    }
    case "chart": {
      try {
        return { ...old, ...JSON.parse(text) };
      } catch {
        fail("update: the new content must be a JSON chart spec (the surface is a chart part)");
      }
    }
    default:
      return null;
  }
}

const update: Command = {
  name: "update",
  group: "Revise",
  summary: "revise a surface (new version, same card and kind)",
  usage: "showcase update <id> <file|->",
  positionals: true,
  options: {
    title: { type: "string", placeholder: "t", desc: "replace the surface title" },
    kit: {
      type: "string",
      multiple: true,
      placeholder: "id",
      desc: "opt the html part into a kit",
    },
  },
  help: "The new content replaces the surface's existing part in place, keeping its kind — a markdown card stays markdown, a diff stays a diff.",
  async run({ flags, positionals }) {
    const id = positionals[0];
    if (!id) fail("usage: showcase update <id> <file|->");
    if (!positionals[1] && process.stdin.isTTY) fail("usage: showcase update <id> <file|->");
    // Fetch first: the revision must preserve the surface's part kind (a
    // markdown card must not silently become an html part) and a bad id should
    // fail before we read stdin.
    const existing = await api(`/api/surfaces/${id}`);
    const parts: Record<string, unknown>[] = existing.parts ?? [];
    if (parts.length !== 1) {
      fail(
        `surface ${id} has ${parts.length} parts — the CLI updates single-part surfaces only; use the update_surface MCP tool to revise multi-part surfaces`,
      );
    }
    const part = revisedPart(parts[0], readContent(positionals[1]));
    if (!part) {
      fail(
        `surface ${id} is a ${parts[0].kind} part, which is asset-backed — publish a new surface instead`,
      );
    }
    const kits = normalizeKits(flags.kit);
    if (kits && part.kind === "html") part.kits = kits;
    emitSurface(
      await api(`/api/surfaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({ parts: [part], title: flags.title }),
      }),
    );
  },
};

const del: Command = {
  name: "delete",
  group: "Revise",
  summary: "delete a surface (the card + all its versions)",
  usage: "showcase delete <id> [--dry-run] [--yes]",
  positionals: true,
  options: {
    "dry-run": { type: "boolean", desc: "report what would be deleted without deleting" },
    ...CONFIRM_OPTS,
  },
  help: "Deleting removes the card and every version — irreversible. Prefer `update` to revise in place. The CLI confirms before deleting; pass --yes to skip the prompt (required when run non-interactively).",
  async run({ flags, positionals }) {
    const id = positionals[0];
    if (!id) fail("usage: showcase delete <id> [--dry-run] [--yes]");
    // Fetch first so the preview/prompt can name the card, and so a bad id
    // fails cleanly (api() turns the 404 into "surface not found") before we
    // ask to confirm anything.
    const surface = await api(`/api/surfaces/${id}`);
    const label =
      `surface ${id}` +
      (surface.title ? ` (“${surface.title}”)` : "") +
      (surface.version > 1 ? `, ${surface.version} versions` : "");
    if (flags["dry-run"]) {
      emit({ ...surface, dryRun: true }, () => `Would delete ${label}.`);
      return;
    }
    await confirm(`About to delete ${label} — this cannot be undone.`, flags);
    const result = await api(`/api/surfaces/${id}`, { method: "DELETE" });
    emit(result, `deleted surface ${id}`);
  },
};

export const publishCommands: Command[] = [
  publish,
  diff,
  markdown,
  mermaid,
  terminal,
  jsonCmd,
  chart,
  code,
  image,
  trace,
  upload,
  assetUrl,
  update,
  del,
];
