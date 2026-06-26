import { useEffect, useState } from "react";
import {
  type FileDiffMetadata,
  getFiletypeFromFileName,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
  processFile,
  type SupportedLanguages,
} from "@pierre/diffs";
import { preloadFileDiff } from "@pierre/diffs/ssr";
import type { DiffPart as DiffPartData } from "./api.ts";
import { themeById } from "../../server/themes.ts";
import { SandboxedPart } from "./SandboxedPart.tsx";
import { useActiveTheme, useResolvedMode } from "./theme.ts";

// Wrapper styles for the sandbox iframe. Each file's diff is a @pierre/diffs SSR
// fragment mounted in its OWN declarative shadow root (it ships its own scoped
// stylesheet, keyed off :host), so the iframe body only spaces the files.
const DIFF_CSS = `
body { margin: 0; padding: 0; background: transparent; font-size: 12.5px; }
/* cursor inherits into the @pierre/diffs shadow root, so this is the one hint
   that lines are clickable (the bridge turns a line click into a comment). */
diffs-container { display: block; cursor: pointer; }
diffs-container + diffs-container { border-top: 0.5px solid var(--border); }
`;

// A small base set of langs the highlighter always loads; the rest are
// inferred from the part's filenames. preloadHighlighter only loads what we
// ask for, so we keep this lean to avoid pulling in every shiki grammar.
const BASE_LANGS = ["text", "json", "javascript", "typescript", "tsx", "jsx"];

// Generated / vendored / lockfile / snapshot paths — high-churn, low-attention
// changes a reviewer confirms in one glance rather than reads (P2/P4). These
// collapse out of the rendered diff by default; the manifest still lists them.
const GENERATED_RE =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.ya?ml|npm-shrinkwrap\.json|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|bun\.lockb)$|(?:^|\/)(?:dist|build|out|vendor|node_modules)\/|\.min\.(?:js|css)$|\.snap$|(?:^|\/)__snapshots__\//;
const isGenerated = (name: string): boolean => GENERATED_RE.test(name);

// Per-file metadata for the manifest header: name, the rename/move source, the
// change type, churn (+/−), and whether it's a low-attention generated file.
interface DiffFileInfo {
  name: string;
  prevName?: string;
  type: string;
  added: number;
  removed: number;
  generated: boolean;
}

// Map @pierre/diffs' ChangeTypes to a one-letter status, a tone class, and a
// word. `rename-pure` (a move with no content change — the "moved, unchanged"
// case from P4) reads as "moved"; `rename-changed` as "renamed".
const TYPE_META: Record<string, { sym: string; cls: string; word: string }> = {
  new: { sym: "A", cls: "text-emerald-600 dark:text-emerald-400", word: "added" },
  deleted: { sym: "D", cls: "text-red-600 dark:text-red-400", word: "deleted" },
  "rename-pure": { sym: "R", cls: "text-sky-600 dark:text-sky-400", word: "moved" },
  "rename-changed": { sym: "R", cls: "text-sky-600 dark:text-sky-400", word: "renamed" },
  change: { sym: "M", cls: "text-amber-600 dark:text-amber-400", word: "modified" },
};

function fileChurn(fd: FileDiffMetadata): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of fd.hunks ?? []) {
    added += h.additionLines;
    removed += h.deletionLines;
  }
  return { added, removed };
}

// Turn a DiffPart into one FileDiffMetadata per file: prefer an explicit
// unified patch, else build a diff from each before/after pair.
function buildFileDiffs(part: DiffPartData): { diffs: FileDiffMetadata[]; langs: string[] } {
  const langs = new Set<string>(BASE_LANGS);
  const diffs: FileDiffMetadata[] = [];

  if (part.patch) {
    // parsePatchFiles returns one ParsedPatch per commit; each carries a
    // files[] of FileDiffMetadata. Flatten them into a flat per-file list.
    for (const parsed of parsePatchFiles(part.patch)) {
      for (const fd of parsed.files) {
        diffs.push(fd);
        if (fd.name) langs.add(getFiletypeFromFileName(fd.name));
      }
    }
    // Some patches (a bare hunk with no `diff --git` header) yield no files
    // from parsePatchFiles; fall back to treating the whole text as one file.
    if (diffs.length === 0) {
      const fd = processFile(part.patch);
      if (fd) diffs.push(fd);
    }
  } else if (part.files) {
    for (const f of part.files) {
      const lang = f.language ?? getFiletypeFromFileName(f.filename);
      langs.add(lang);
      diffs.push(
        parseDiffFromFile(
          { name: f.filename, contents: f.before, lang: lang as SupportedLanguages },
          { name: f.filename, contents: f.after, lang: lang as SupportedLanguages },
        ),
      );
    }
  }
  return { diffs, langs: [...langs] };
}

// A multi-file manifest header (P2, the within-diff manifest): a scannable
// strip of the files in the diff — change type, name (with the rename/move
// source), and per-file churn — so the reviewer reads "what's in here" before
// scrolling the hunks. Rendered with React text nodes in the trusted origin (the
// data path the invariant allows; filenames are escaped by construction), never
// as markup. The generated/vendored files render muted; their hunks collapse
// below (DiffPart) into an on-demand frame.
function DiffManifest(props: { files: DiffFileInfo[] }) {
  const totalAdd = props.files.reduce((s, f) => s + f.added, 0);
  const totalDel = props.files.reduce((s, f) => s + f.removed, 0);
  const genCount = props.files.filter((f) => f.generated).length;
  return (
    <div className="border-b-[0.5px] border-border bg-muted/30 px-3.5 py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
        <span className="font-medium">
          {props.files.length} files
          {genCount > 0 ? ` · ${genCount} generated` : ""}
        </span>
        <span className="tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{totalAdd}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{totalDel}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {props.files.map((f, i) => {
          const meta = TYPE_META[f.type] ?? TYPE_META.change;
          return (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 text-[12px]"
              title={`${meta.word}${f.prevName ? ` from ${f.prevName}` : ""}`}
            >
              <span
                className={`w-3 flex-none text-center font-mono text-[11px] font-semibold ${meta.cls}`}
              >
                {meta.sym}
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${f.generated ? "text-faint" : "text-foreground"}`}
              >
                {f.prevName ? <span className="text-faint">{f.prevName} → </span> : null}
                {f.name}
                {f.generated ? <span className="ml-1.5 text-faint">· generated</span> : null}
              </span>
              <span className="flex-none tabular-nums text-[11px] text-faint">
                {f.added > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">+{f.added}</span>
                ) : null}
                {f.added > 0 && f.removed > 0 ? " " : ""}
                {f.removed > 0 ? (
                  <span className="text-red-600 dark:text-red-400">−{f.removed}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DiffPart(props: {
  part: DiffPartData;
  onLineClick?: (anchor: { line: number; lineType?: "context" | "addition" | "deletion" }) => void;
}) {
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  const dark = mode === "dark";
  const [error, setError] = useState<string | null>(null);
  // The rendered diff splits into a manifest (multi-file only), the hot files'
  // SSR HTML (rendered immediately), and the generated/vendored files' HTML
  // (collapsed behind a toggle so a 900-line lockfile doesn't render until asked).
  const [manifest, setManifest] = useState<DiffFileInfo[]>([]);
  const [hotBody, setHotBody] = useState<string | null>(null);
  const [coldBody, setColdBody] = useState<string>("");
  const [showCold, setShowCold] = useState(false);

  // The shiki light/dark pair follows the board theme (kept identical to
  // MarkdownPart so a diff and a fenced code block read as one syntax theme).
  // Render to an HTML STRING (per file, via the SSR API) whenever the board
  // theme or color scheme changes — string building is not a DOM sink, so
  // doing it in the trusted viewer is safe; SandboxedPart parses it inside an
  // opaque-origin iframe. Each file's fragment goes in its own declarative
  // shadow root so its scoped :host stylesheet applies.
  useEffect(() => {
    let disposed = false;
    const t = themeById(activeTheme);
    const shiki = { dark: t.shiki.dark, light: t.shiki.light };
    void (async () => {
      try {
        const { diffs, langs } = buildFileDiffs(props.part);
        if (diffs.length === 0) {
          setError("No diff content.");
          return;
        }
        await preloadHighlighter({
          themes: [shiki.dark, shiki.light],
          langs: langs as SupportedLanguages[],
          preferredHighlighter: "shiki-js",
        });
        if (disposed) return;
        const options = {
          diffStyle: props.part.layout ?? "unified",
          theme: { dark: shiki.dark, light: shiki.light },
          themeType: dark ? "dark" : "light",
          preferredHighlighter: "shiki-js",
          // Word-level intra-line highlighting (Step D / P4): mark the changed
          // SPANS within a modified line, not just the whole line, so the eye
          // lands on the exact edit. @pierre/diffs computes the sub-line diff;
          // the line rows (and their data-line-type/data-column-number hooks the
          // click bridge rides) are unchanged, so line-anchored comments still work.
          lineDiffType: "word",
        } as const;
        const rendered = await Promise.all(
          diffs.map((fileDiff) => preloadFileDiff({ fileDiff, options })),
        );
        if (disposed) return;

        // Per-file manifest + hot/cold partition. A generated/vendored file is
        // low-attention: it stays in the manifest but its hunks collapse out of
        // the rendered diff. Single-file diffs skip the manifest entirely.
        const info: DiffFileInfo[] = diffs.map((fd) => {
          const { added, removed } = fileChurn(fd);
          return {
            name: fd.name,
            prevName: fd.prevName,
            type: fd.type,
            added,
            removed,
            generated: isGenerated(fd.name),
          };
        });
        const wrap = (html: string) =>
          `<diffs-container><template shadowrootmode="open">${html}</template></diffs-container>`;
        const hot: string[] = [];
        const cold: string[] = [];
        rendered.forEach((r, i) => {
          (info[i].generated ? cold : hot).push(wrap(r.prerenderedHTML));
        });

        setError(null);
        setManifest(diffs.length > 1 ? info : []);
        // If every file is generated there's no hot body — show them anyway so
        // the diff is never empty.
        setHotBody(hot.length > 0 ? hot.join("") : cold.join(""));
        setColdBody(hot.length > 0 ? cold.join("") : "");
        setShowCold(false);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Could not render diff.");
      }
    })();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.part, activeTheme, dark]);

  const coldCount = manifest.filter((f) => f.generated).length;

  return (
    <div className="border-t-[0.5px] border-border">
      {error ? (
        <div className="px-3.5 py-2.5 text-xs text-faint">Couldn't render diff — {error}</div>
      ) : (
        <>
          {manifest.length > 1 ? <DiffManifest files={manifest} /> : null}
          <SandboxedPart
            class="block w-full border-0 bg-transparent"
            body={hotBody ?? ""}
            css={DIFF_CSS}
            onLineClick={props.onLineClick}
          />
          {coldBody ? (
            <div className="border-t-[0.5px] border-border">
              <button
                type="button"
                onClick={() => setShowCold((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-[12px] text-faint transition-colors hover:bg-muted/40"
              >
                <span className={`transition-transform ${showCold ? "rotate-90" : ""}`}>▸</span>
                {showCold ? "Hide" : "Show"} {coldCount} generated file{coldCount > 1 ? "s" : ""}{" "}
                (low attention)
              </button>
              {showCold ? (
                <SandboxedPart
                  class="block w-full border-0 bg-transparent"
                  body={coldBody}
                  css={DIFF_CSS}
                  onLineClick={props.onLineClick}
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
