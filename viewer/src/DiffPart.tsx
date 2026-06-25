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

export function DiffPart(props: {
  part: DiffPartData;
  onLineClick?: (anchor: { line: number; lineType?: "context" | "addition" | "deletion" }) => void;
}) {
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  const dark = mode === "dark";
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

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
        } as const;
        const rendered = await Promise.all(
          diffs.map((fileDiff) => preloadFileDiff({ fileDiff, options })),
        );
        if (disposed) return;
        setError(null);
        setBody(
          rendered
            .map(
              (r) =>
                `<diffs-container><template shadowrootmode="open">${r.prerenderedHTML}</template></diffs-container>`,
            )
            .join(""),
        );
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Could not render diff.");
      }
    })();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.part, activeTheme, dark]);

  return (
    <div className="border-t-[0.5px] border-border">
      {error ? (
        <div className="px-3.5 py-2.5 text-xs text-faint">Couldn't render diff — {error}</div>
      ) : (
        <SandboxedPart
          class="block w-full border-0 bg-transparent"
          body={body ?? ""}
          css={DIFF_CSS}
          onLineClick={props.onLineClick}
        />
      )}
    </div>
  );
}
