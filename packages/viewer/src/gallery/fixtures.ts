// Fixture surfaces for the part gallery — one entry per part kind/variant the
// renderers support, with data shaped like a real agent would publish. Pure
// data; the gallery page renders each through the real PartRenderer.
import type { Surface, SurfacePart } from "@showcase/core/types";

export interface GalleryEntry {
  id: string;
  label: string;
  note?: string;
  surface: Surface;
}

let seq = 0;
const surface = (title: string, parts: SurfacePart[]): Surface => ({
  id: `gallery-${++seq}`,
  sessionId: "gallery",
  title,
  parts,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
  history: [],
});

const entry = (id: string, label: string, parts: SurfacePart[], note?: string): GalleryEntry => ({
  id,
  label,
  surface: surface(label, parts),
  ...(note ? { note } : {}),
});

const WALKTHROUGH_MERMAID = `graph LR
  comment[POST /api/comments] --> store[(JsonFileStore)]
  store --> piggyback[publish response]
  store --> wait[wait_for_feedback]`;

const MOVED_BEFORE = `function readCapped(req, max) {
  const reader = req.body.getReader();
  let total = 0;
  return pump(reader, max, total);
}

export function handler(req) {
  if (tooLarge(req)) return r413();
  return readCapped(req, MAX);
}
`;

const MOVED_AFTER = `export function handler(req) {
  if (tooLarge(req)) return r413();
  return readCapped(req, MAX);
}

function readCapped(req, max) {
  const reader = req.body.getReader();
  let total = 0;
  return pump(reader, max, total);
}
`;

const HOT_FILES = [
  { file: "server/app.ts", lines: 412, tone: "sensitive" },
  { file: "server/storage.ts", lines: 96, tone: "logic" },
  { file: "core/types.ts", lines: 44, tone: "logic" },
  { file: "viewer/Card.tsx", lines: 71, tone: "mechanical" },
  { file: "test/api.test.ts", lines: 187, tone: "mechanical" },
];

export const GALLERY: GalleryEntry[] = [
  entry(
    "html",
    "html (issues kit)",
    [
      {
        kind: "html",
        html: '<div class="card"><span class="badge warn">Nit</span><h3>Rename the flag</h3><p>`--json-part` reads better than overloading `--json`.</p><div class="bar"><span style="width:60%"></span></div></div>',
        kits: ["issues"],
      },
    ],
    "rendered through the same sandboxed doc the /s/:id route serves",
  ),
  entry("markdown", "markdown", [
    {
      kind: "markdown",
      markdown:
        "## Prose with the works\n\nInline `code`, **bold**, a [link](https://example.com), and math: $E = mc^2$.\n\n| col | value |\n| --- | ----- |\n| a   | 1     |\n\n```ts\nconst x: number = 42;\n```\n\n> Raw HTML like <b>this</b> stays escaped.",
    },
  ]),
  entry("mermaid", "mermaid", [
    {
      kind: "mermaid",
      mermaid:
        "graph TD\n  A[publish_surface] --> B{store}\n  B --> C[SSE event]\n  C --> D[viewer renders]\n  D --> E[comment back]\n  E --> A\n  class B accent",
    },
  ]),
  entry(
    "diff",
    "diff (multi-file, moved block)",
    [
      {
        kind: "diff",
        files: [
          { filename: "server/app.ts", before: MOVED_BEFORE, after: MOVED_AFTER },
          {
            filename: "server/limits.ts",
            before: "export const MAX = 1024;\n",
            after: "export const MAX = 4096; // raised for uploads\n",
          },
        ],
      },
    ],
    "exercises the manifest header and the ↕ moved-code strip",
  ),
  entry("code", "code", [
    {
      kind: "code",
      code: "export function themeById(id: string | null | undefined): Theme {\n  return allThemes().find((t) => t.id === id) ?? THEMES[0];\n}",
      language: "ts",
      title: "themes.ts",
      lineStart: 508,
    },
  ]),
  entry("terminal", "terminal", [
    {
      kind: "terminal",
      text: "$ pnpm test\n\u001b[32m✓\u001b[0m 344 passed\n\u001b[31m✗\u001b[0m 0 failed\n\u001b[2mDone in 23.4s\u001b[0m",
      title: "test run",
    },
  ]),
  entry("json", "json", [
    {
      kind: "json",
      data: {
        status: "ok",
        board: { sessions: 4, surfaces: 12, assets: { count: 3, bytes: 51200 } },
        tags: ["local", "demo"],
      },
    },
  ]),
  entry("trace", "trace", [
    {
      kind: "trace",
      title: "tool calls",
      steps: [
        { label: "read app.ts", kind: "tool", detail: "1,204 lines" },
        { label: "grep for coerceReview", kind: "tool" },
        { label: "publish decision queue", kind: "thought", detail: "3 decisions, 9 files" },
      ],
    },
  ]),
  entry("chart-bar", "chart — stacked bar", [
    {
      kind: "chart",
      chartType: "bar",
      data: [
        { module: "server", added: 320, removed: 140 },
        { module: "viewer", added: 210, removed: 80 },
        { module: "core", added: 90, removed: 20 },
      ],
      x: "module",
      y: ["added", "removed"],
      stacked: true,
      colors: ["#2f9e44", "#e03131"],
      caption: "churn by module",
    },
  ]),
  entry("chart-line", "chart — line", [
    {
      kind: "chart",
      chartType: "line",
      data: [
        { day: "Mon", p50: 12, p95: 48 },
        { day: "Tue", p50: 14, p95: 61 },
        { day: "Wed", p50: 11, p95: 42 },
        { day: "Thu", p50: 18, p95: 84 },
        { day: "Fri", p50: 13, p95: 51 },
      ],
      x: "day",
      y: ["p50", "p95"],
      yLabel: "ms",
    },
  ]),
  entry("chart-pie", "chart — pie", [
    {
      kind: "chart",
      chartType: "pie",
      data: [
        { kind: "has-decision", files: 3 },
        { kind: "reviewed", files: 9 },
        { kind: "mechanical", files: 4 },
      ],
      x: "kind",
      y: "files",
    },
  ]),
  entry("chart-treemap", "chart — treemap (risk-weighted)", [
    {
      kind: "chart",
      chartType: "treemap",
      data: HOT_FILES.map((f) => ({ name: f.file, churn: f.lines, tone: f.tone })),
      x: "name",
      y: "churn",
      caption: "area = churn · color = sensitivity",
    },
  ]),
  entry("chart-scatter", "chart — scatter (confidence×coverage quadrant)", [
    {
      kind: "chart",
      chartType: "scatter",
      data: [
        { label: "token refresh", confidence: 3, coverage: 1, tone: "danger" },
        { label: "eviction sweep", confidence: 2, coverage: 2 },
        { label: "cli output", confidence: 3, coverage: 3 },
      ],
      x: "confidence",
      y: "coverage",
      xLabel: "confidence",
      yLabel: "coverage",
    },
  ]),
  entry("chart-bubble", "chart — bubble (churn×complexity hotspots)", [
    {
      kind: "chart",
      chartType: "bubble",
      data: [
        { label: "server/app.ts", churn: 412, complexity: 34, loc: 1900, tone: "sensitive" },
        { label: "server/storage.ts", churn: 96, complexity: 21, loc: 700, tone: "logic" },
        { label: "viewer/Card.tsx", churn: 71, complexity: 12, loc: 500, tone: "mechanical" },
        { label: "core/types.ts", churn: 44, complexity: 6, loc: 800, tone: "mechanical" },
      ],
      x: "churn",
      y: "complexity",
      z: "loc",
      xLabel: "churn",
      yLabel: "complexity",
    },
  ]),
  entry("chart-minimap", "chart — minimap (file heat-strip)", [
    {
      kind: "chart",
      chartType: "minimap",
      data: HOT_FILES.map((f) => ({ file: f.file, lines: f.lines, tone: f.tone })),
      x: "file",
      y: "lines",
      caption: "the PR's footprint — width = churn, color = sensitivity",
    },
  ]),
  entry("chart-matrix", "chart — matrix (co-change adjacency)", [
    {
      kind: "chart",
      chartType: "matrix",
      data: [
        { a: "server/app.ts", b: "server/storage.ts", n: 5 },
        { a: "server/app.ts", b: "core/types.ts", n: 3 },
        { a: "server/storage.ts", b: "core/types.ts", n: 4 },
        { a: "viewer/Card.tsx", b: "core/types.ts", n: 2 },
        { a: "viewer/Card.tsx", b: "viewer/state.ts", n: 5 },
      ],
      x: "a",
      x2: "b",
      y: "n",
      caption: "files that change together in this PR's history",
    },
  ]),
  entry("chart-arc", "chart — arc (layered dependency flow)", [
    {
      kind: "chart",
      chartType: "arc",
      data: [
        { from: "cli", to: "server", w: 6 },
        { from: "server", to: "core", w: 8, tone: "logic" },
        { from: "viewer", to: "core", w: 5 },
        { from: "mcp", to: "core", w: 3 },
        { from: "cli", to: "core", w: 1, tone: "sensitive" },
      ],
      x: "from",
      x2: "to",
      y: "w",
      caption: "package dependency weight — the red arc skips a layer",
    },
  ]),
  entry(
    "checkpoint",
    "checkpoint (learn mode, mcq)",
    [
      {
        kind: "checkpoint",
        checkpoint: {
          id: "gallery-cp-1",
          conceptId: "sandbox",
          kind: "mcq",
          prompt: "Where does agent-authored HTML become live DOM?",
          options: [
            { id: "a", label: "In the trusted viewer via innerHTML" },
            { id: "b", label: "Inside an opaque-origin sandboxed iframe", correct: true },
            { id: "c", label: "It is stripped to text first", misconception: "sanitize-only" },
          ],
          reveal: "Only inside the sandboxed iframe — the viewer origin never parses agent markup.",
        },
      },
    ],
    "attempts post telemetry — expect an error toast in this server-free harness",
  ),
  entry("walkthrough", "walkthrough (synced diagram + node jump)", [
    {
      kind: "walkthrough",
      title: "How a comment reaches the agent",
      mermaid: WALKTHROUGH_MERMAID,
      steps: [
        {
          title: "The comment lands",
          body: "The viewer posts `author=user` comments to the API; nothing pushes to the editor.",
          file: "server/app.ts",
          code: "app.post('/api/comments', async (c) => {\n  const body = await c.req.json();\n  const comment = store.addComment(body);\n  bus.emit('comment', comment);\n  return c.json(comment);\n});",
          language: "ts",
          lineStart: 704,
          highlight: [[706, 707]],
          node: "comment",
        },
        {
          title: "The store persists it",
          body: "One atomic tmp+rename write; the comment now carries the session's `agentSeq` cursor.",
          file: "server/storage.ts",
          code: "addComment(input: CommentInput): Comment {\n  const comment = withSeq(input, ++this.agentSeq);\n  this.board.comments.push(comment);\n  this.flush();\n  return comment;\n}",
          language: "ts",
          lineStart: 210,
          highlight: [[211, 212]],
          node: "store",
        },
        {
          title: "The agent pulls it",
          body: "Piggybacked on the next publish, or via a blocking `wait_for_feedback` — exactly once either way. Click a diagram node above to jump between steps.",
          file: "server/app.ts",
          code: "const feedback = store.takeFeedback(sessionId, afterSeq);\nreturn c.json({ ...surface, userFeedback: feedback });",
          language: "ts",
          lineStart: 812,
          node: "wait",
        },
      ],
    },
  ]),
];
