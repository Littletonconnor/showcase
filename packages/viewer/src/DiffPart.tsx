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
import { isReadonly, type DiffPart as DiffPartData } from "./api.ts";
import { escapeHtml } from "@showcase/core/surfacePage";
import { themeById } from "@showcase/core/themes";
import { detectMovedBlocks, type MovedBlock } from "./movedCode.ts";
import { SandboxedPart } from "./SandboxedPart.tsx";
import { useSurfaceTheme, useResolvedMode } from "./theme.ts";
import { openComposer } from "./threads.ts";

// Wrapper styles for the sandbox iframe. Each file's diff is a @pierre/diffs SSR
// fragment mounted in its OWN declarative shadow root (it ships its own scoped
// stylesheet, keyed off :host), so the iframe body only spaces the files.
const DIFF_CSS = `
body { margin: 0; padding: 0; background: transparent; font-size: 12.5px; }
diffs-container { display: block; }
diffs-container + diffs-container { border-top: 0.5px solid var(--border); }
`;

// Injected INSIDE each file's shadow root (outer CSS can't pierce it): the
// plannotator-style gutter affordance — line numbers read as clickable and
// light up on hover. Our own trusted string, never agent markup.
const GUTTER_CSS = `<style>
[data-gutter] [data-line-type] { cursor: pointer; border-radius: 3px; }
[data-gutter] [data-line-type]:hover { background: rgba(59, 130, 246, 0.16); }
[data-gutter] [data-line-type]:hover [data-line-number-content] { color: #3b82f6; font-weight: 600; }
</style>`;

// Line-click forwarding, running inside the diff iframe (same trust standing
// as BRIDGE_JS — our string, not agent content). composedPath crosses the open
// declarative shadow roots, so a click on a gutter cell resolves to its line
// number, side, and owning <diffs-container data-file>; the matching content
// row supplies the quoted line. Only capped strings and rect numbers cross to
// the host, which re-validates before opening the composer.
const DIFF_LINE_JS = `
// A gutter mouseup must not reach BRIDGE_JS's selection handler: with nothing
// selected it reports selection-cleared, which would close the composer the
// click below just opened. Capture phase, so it wins regardless of order.
document.addEventListener('mouseup', function (e) {
  var p = e.composedPath ? e.composedPath() : [];
  for (var i = 0; i < p.length; i++) {
    var el = p[i];
    if (el && el.nodeType === 1 && el.matches && el.matches('[data-gutter] [data-line-type]')) {
      e.stopImmediatePropagation();
      return;
    }
  }
}, true);
document.addEventListener('click', function (e) {
  var path = e.composedPath ? e.composedPath() : [];
  var cell = null, container = null;
  for (var i = 0; i < path.length; i++) {
    var el = path[i];
    if (!el || el.nodeType !== 1) continue;
    if (!cell && el.matches && el.matches('[data-gutter] [data-line-type]')) cell = el;
    if (el.tagName === 'DIFFS-CONTAINER') { container = el; break; }
  }
  if (!cell || !container) return;
  var line = parseInt((cell.textContent || '').trim(), 10);
  if (!line || line < 1) return;
  var idx = cell.getAttribute('data-line-index') || '';
  var row = idx && container.shadowRoot
    ? container.shadowRoot.querySelector('[data-content] [data-line-index="' + idx + '"]')
    : null;
  var rect = cell.getBoundingClientRect();
  parent.postMessage({
    __showcase: true,
    type: 'diff-line-click',
    file: container.getAttribute('data-file') || '',
    line: line,
    side: cell.getAttribute('data-line-type') || '',
    text: row ? (row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : '',
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  }, '*');
});
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
    // A bare hunk with no file header yields no files from parsePatchFiles —
    // and processFile would misread patch text as file CONTENTS (an empty,
    // hunkless diff). Synthesize a minimal header so the hunks parse for real.
    if (diffs.length === 0 && /^@@ /m.test(part.patch)) {
      const synthetic = `diff --git a/file b/file\n--- a/file\n+++ b/file\n${part.patch}`;
      for (const parsed of parsePatchFiles(synthetic)) {
        for (const fd of parsed.files) diffs.push(fd);
      }
    }
    if (diffs.length === 0) {
      const fd = processFile(part.patch);
      if (fd && (fd.hunks?.length ?? 0) > 0) diffs.push(fd);
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

// The "moved, unchanged" strip (P4): in-file block moves the hunks render as
// delete+add, labeled so the reviewer skips the re-read. Trusted React text
// nodes, same standing as the manifest.
function MovedNote(props: { moves: MovedBlock[]; multiFile: boolean }) {
  return (
    <div className="border-b-[0.5px] border-border bg-muted/30 px-3.5 py-1.5">
      <ul className="flex flex-col gap-px">
        {props.moves.map((m, i) => (
          <li key={i} className="flex items-center gap-2 text-[11.5px] text-faint">
            <span className="flex-none font-mono font-semibold text-sky-600 dark:text-sky-400">
              ↕
            </span>
            <span className="min-w-0 truncate">
              {m.lines} lines moved within {props.multiFile ? m.file : "the file"}, unchanged
              <span className="ml-1.5 font-mono tabular-nums">
                {m.fromStart}–{m.fromStart + m.lines - 1} → {m.toStart}–{m.toStart + m.lines - 1}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiffPart(props: {
  part: DiffPartData;
  // Present when the diff renders on a surface card (PartRenderer): line-gutter
  // clicks open the anchored-comment composer. Absent in review evidence panes
  // (a decision isn't a surface), where the gutter stays inert.
  surfaceId?: string;
  partIndex?: number;
  // Overrides the composer: the caller handles the gutter click itself (e.g. a
  // guided-review chapter turning file:line into scoped pushback). Wins over
  // surfaceId when both are set.
  onLineClick?: (at: { file: string; line: number; quote: string }) => void;
}) {
  const activeTheme = useSurfaceTheme();
  const mode = useResolvedMode();
  const interactive =
    (props.onLineClick !== undefined || props.surfaceId !== undefined) && !isReadonly();
  const dark = mode === "dark";
  const [error, setError] = useState<string | null>(null);
  // The rendered diff splits into a manifest (multi-file only), the hot files'
  // SSR HTML (rendered immediately), and the generated/vendored files' HTML
  // (collapsed behind a toggle so a 900-line lockfile doesn't render until asked).
  const [manifest, setManifest] = useState<DiffFileInfo[]>([]);
  const [moved, setMoved] = useState<MovedBlock[]>([]);
  const [hotBody, setHotBody] = useState<string | null>(null);
  const [coldBody, setColdBody] = useState<string>("");
  const [showCold, setShowCold] = useState(false);
  // A hand-authored `patch` that doesn't parse into renderable hunks (no
  // `diff --git` header, fake `@@` markers, etc.) would otherwise render as a
  // silent empty box. Fall back to the raw text so evidence is never lost.
  const [rawFallback, setRawFallback] = useState<string | null>(null);

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
        // A patch we couldn't parse into anything renderable: no files, or files
        // that parsed to zero changed lines and aren't pure renames (which
        // legitimately have none). A hand-authored pseudo-patch lands here — its
        // fake `@@` markers parse into empty hunks, so churn is 0 across the
        // board. Show the raw patch rather than an empty `−0 +0` shell.
        const renderable = diffs.some((d) => {
          const { added, removed } = fileChurn(d);
          return added + removed > 0 || d.type === "rename-pure";
        });
        if (!renderable) {
          if (props.part.patch) {
            setRawFallback(props.part.patch);
            setError(null);
            return;
          }
          setError("No diff content.");
          return;
        }
        setRawFallback(null);
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
          // Word-level intra-line highlighting: mark the changed SPANS within a
          // modified line, not just the whole line, so the eye lands on the exact
          // edit. @pierre/diffs computes the sub-line diff.
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
        // data-file names the container for the line-click bridge; the gutter
        // style rides inside the shadow root (outer CSS can't pierce it) and
        // only when clicking actually does something.
        const wrap = (html: string, file: string) =>
          `<diffs-container data-file="${escapeHtml(file)}"><template shadowrootmode="open">${interactive ? GUTTER_CSS : ""}${html}</template></diffs-container>`;
        const hot: string[] = [];
        const cold: string[] = [];
        rendered.forEach((r, i) => {
          (info[i].generated ? cold : hot).push(wrap(r.prerenderedHTML, diffs[i].name ?? ""));
        });

        setError(null);
        setManifest(diffs.length > 1 ? info : []);
        setMoved(diffs.flatMap(detectMovedBlocks));
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

  // A gutter click arrived from the sandbox. The payload is agent-reachable
  // data, so re-validate every field host-side before it becomes an anchor;
  // the typed comment itself never leaves this trusted origin.
  const onBridge = interactive
    ? (d: Record<string, unknown>, frame: HTMLIFrameElement) => {
        if (d.type !== "diff-line-click") return;
        const line = Number(d.line);
        if (!Number.isInteger(line) || line < 1 || line > 10_000_000) return;
        const file = typeof d.file === "string" ? d.file.slice(0, 300) : "";
        const quote = typeof d.text === "string" && d.text.trim() ? d.text.slice(0, 300) : "";
        const rect = (d.rect ?? {}) as {
          top?: number;
          left?: number;
          width?: number;
          height?: number;
        };
        if (props.onLineClick) {
          props.onLineClick({ file, line, quote });
          return;
        }
        const fr = frame.getBoundingClientRect();
        const x = fr.left + (Number(rect.left) || 0) + (Number(rect.width) || 0) / 2;
        const y = fr.top + (Number(rect.top) || 0) + (Number(rect.height) || 0);
        openComposer({
          surfaceId: props.surfaceId!,
          partIndex: props.partIndex ?? 0,
          line,
          ...(file ? { file } : {}),
          ...(quote ? { quote } : {}),
          x: Math.max(0, Math.min(window.innerWidth, x)),
          y: Math.max(0, Math.min(window.innerHeight, y)),
        });
      }
    : undefined;
  const lineScript = interactive ? `<script>${DIFF_LINE_JS}</script>` : "";

  return (
    <div className="border-t-[0.5px] border-border">
      {error ? (
        <div className="px-3.5 py-2.5 text-xs text-faint">Couldn't render diff — {error}</div>
      ) : rawFallback ? (
        <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
          <span className="text-[11px] text-faint">
            Showing raw patch — couldn't parse it as a diff.
          </span>
          <pre className="overflow-auto rounded bg-muted/40 p-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground">
            {rawFallback}
          </pre>
        </div>
      ) : (
        <>
          {manifest.length > 1 ? <DiffManifest files={manifest} /> : null}
          {moved.length > 0 ? <MovedNote moves={moved} multiFile={manifest.length > 1} /> : null}
          <SandboxedPart
            class="block w-full border-0 bg-transparent"
            body={hotBody ? hotBody + lineScript : ""}
            css={DIFF_CSS}
            title="Diff"
            onBridgeMessage={onBridge}
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
                  body={coldBody + lineScript}
                  css={DIFF_CSS}
                  title="Diff — generated files"
                  onBridgeMessage={onBridge}
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
