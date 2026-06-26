import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { JsonFileStore } from "../server/storage.ts";

function makeApp(authToken?: string, opts?: { publicRead?: "session" | "full" }) {
  const dir = mkdtempSync(join(tmpdir(), "showcase-test-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  return createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
    authToken,
    ...opts,
  });
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const authedJson = (body: unknown, token = "secret") => ({
  ...json(body),
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
});

test("publish without session auto-creates one", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/snippets",
    json({ html: "<p>hi</p>", agent: "pi", title: "First" }),
  );
  assert.equal(res.status, 201);
  const snippet = (await res.json()) as any;
  assert.ok(snippet.id);
  assert.ok(snippet.sessionId);
  assert.equal(snippet.title, "First");
  assert.equal(snippet.version, 1);

  const sessions = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].agent, "pi");
  assert.equal(sessions[0].surfaceCount, 1);
});

test("publish into an existing session groups snippets", async () => {
  const app = makeApp();
  const first = (await (
    await app.request("/api/snippets", json({ html: "<p>1</p>", agent: "amp" }))
  ).json()) as any;
  await app.request("/api/snippets", json({ html: "<p>2</p>", session: first.sessionId }));
  const list = (await (
    await app.request(`/api/sessions/${first.sessionId}/snippets`)
  ).json()) as any;
  assert.equal(list.length, 2);
});

test("publish with sessionTitle names the auto-created session", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/snippets",
    json({ html: "<p>x</p>", agent: "pi", sessionTitle: "Auth refactor" }),
  );
  assert.equal(res.status, 201);
  const snippet = (await res.json()) as any;
  const sessions = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, snippet.sessionId);
  assert.equal(sessions[0].title, "Auth refactor");
});

test("sessionTitle never retitles an existing session", async () => {
  const app = makeApp();
  const first = (await (
    await app.request("/api/snippets", json({ html: "<p>1</p>", sessionTitle: "Original" }))
  ).json()) as any;
  // the user renames the session in the viewer...
  await app.request(`/api/sessions/${first.sessionId}`, {
    ...json({ title: "User's pick" }),
    method: "PATCH",
  });
  // ...and a later publish carrying a sessionTitle must not clobber it
  const res = await app.request(
    "/api/snippets",
    json({ html: "<p>2</p>", session: first.sessionId, sessionTitle: "Clobber attempt" }),
  );
  assert.equal(res.status, 201);
  const sessions = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "User's pick");
});

test("publish into unknown session 404s instead of silently creating", async () => {
  const app = makeApp();
  const res = await app.request("/api/snippets", json({ html: "<p>x</p>", session: "nope" }));
  assert.equal(res.status, 404);
});

test("publish_review explodes one call into a verdict card + a card per finding", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/reviews",
    json({
      branch: "cl/ALLM-116",
      base: "master",
      verdict: "request_changes",
      summary: "Adds the entity + cipher wiring.",
      coverage: "Read the entity; skipped the schema repo.",
      architecture: "flowchart LR; A-->B",
      findings: [
        {
          severity: "bug",
          title: "Null check missing",
          file: "Foo.java",
          line: 12,
          problem: "no checkNotNull",
          confidence: "high",
          coverage: "read the constructor; did not run the suite",
          suggestion: { before: "this.a = a;", after: "this.a = checkNotNull(a);" },
          fix: "fails fast at construction",
        },
        {
          severity: "praise",
          title: "Clean cipher split",
          problem: "scopes the new cipher",
          confidence: "medium",
          coverage: "skimmed the cipher wiring",
        },
        { title: "", problem: "" }, // malformed entries are skipped, not cards
      ],
    }),
  );
  assert.equal(res.status, 201);
  const out = (await res.json()) as any;
  assert.ok(out.session && out.verdict);
  assert.equal(out.findings.length, 2, "two valid findings → two cards (malformed skipped)");

  const surfaces = (await (
    await app.request(`/api/sessions/${out.session}/surfaces`)
  ).json()) as any[];
  assert.equal(surfaces.length, 3); // verdict + 2 findings
  const verdict = surfaces.find((s) => s.id === out.verdict);
  assert.deepEqual(verdict.badge, { tone: "warning", label: "Request changes" });
  assert.match(verdict.parts[0].markdown, /Coverage/);
  assert.match(verdict.parts[0].markdown, /Null check missing/); // the findings table
  assert.match(verdict.parts[0].markdown, /\*\*2 findings\*\* — 1 Bug · 1 Praise/); // the tally
  // architecture diagram rides the verdict card as a trailing mermaid part.
  assert.deepEqual(
    verdict.parts.map((p: any) => p.kind),
    ["markdown", "mermaid"],
  );
  // The bug finding's suggestion → a before/after diff; fix → "Why it's better".
  const bug = surfaces.find((s) => s.title.startsWith("Null check missing"));
  assert.deepEqual(bug.badge, { tone: "critical", label: "Bug" });
  assert.deepEqual(
    bug.parts.map((p: any) => p.kind),
    ["markdown", "diff", "markdown"],
  );
  assert.deepEqual(bug.parts[1].files, [
    { filename: "Foo.java", before: "this.a = a;", after: "this.a = checkNotNull(a);" },
  ]);
  assert.match(bug.parts[2].markdown, /\*\*Why it's better\*\* — fails fast/);
  // The honesty signal rides the head of the leading markdown part.
  assert.match(bug.parts[0].markdown, /High confidence/);
  assert.match(bug.parts[0].markdown, /\*\*Coverage\*\* — read the constructor/);

  assert.equal((await app.request("/api/reviews", json({ verdict: "approve" }))).status, 400);
});

test("publish_review rejects a finding missing the honesty signal (confidence/coverage)", async () => {
  const app = makeApp();
  // Missing confidence → 400, and nothing is published (validated up front).
  const noConf = await app.request(
    "/api/reviews",
    json({
      verdict: "comment",
      findings: [{ title: "x", problem: "y", coverage: "checked it" }],
    }),
  );
  assert.equal(noConf.status, 400);
  assert.match(((await noConf.json()) as any).error, /confidence/);
  // Missing coverage → 400.
  const noCov = await app.request(
    "/api/reviews",
    json({
      verdict: "comment",
      findings: [{ title: "x", problem: "y", confidence: "high" }],
    }),
  );
  assert.equal(noCov.status, 400);
  assert.match(((await noCov.json()) as any).error, /coverage/);
});

test("publish_review leads the verdict card with the opinionated overview (intent/risk/budget/manifest)", async () => {
  const app = makeApp();
  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        branch: "feature/auth",
        verdict: "request_changes",
        intent: "Tighten token validation and add a revocation check.",
        risk: { size: 1, surfaceArea: 1, sensitivity: 3, testDelta: 1, band: "high" },
        budget: "~8 min · 2 files need real eyes · 1 mechanical",
        manifest: [
          {
            file: "pkg-lock.json",
            added: 900,
            removed: 200,
            priority: "mechanical",
            note: "generated",
          },
          {
            file: "auth/token.ts",
            added: 18,
            removed: 4,
            priority: "sensitive",
            note: "token check",
          },
          { file: "api/routes.ts", added: 40, removed: 12, priority: "logic", note: "public API" },
        ],
        findings: [
          { severity: "bug", title: "t", problem: "p", confidence: "high", coverage: "c" },
        ],
      }),
    )
  ).json()) as any;
  const verdict = (await (await app.request(`/api/surfaces/${review.verdict}`)).json()) as any;
  // The overview html part LEADS, then the verdict markdown.
  assert.equal(verdict.parts[0].kind, "html");
  assert.deepEqual(verdict.parts[0].kits, ["review"]);
  assert.equal(verdict.parts[1].kind, "markdown");
  const html = verdict.parts[0].html as string;
  // Intent, risk band, budget all rendered.
  assert.match(html, /Tighten token validation/);
  assert.match(html, /risk-band high/);
  assert.match(html, /Risk: High/);
  assert.match(html, /~8 min/);
  // Sensitive + logic rows are in the hot manifest; mechanical collapses into the
  // low-attention bucket. Priority order: sensitive before logic.
  const tokenAt = html.indexOf("auth/token.ts");
  const routesAt = html.indexOf("api/routes.ts");
  assert.ok(tokenAt > 0 && routesAt > 0 && tokenAt < routesAt, "sensitive ranks before logic");
  assert.match(html, /manifest-row sensitive/);
  assert.match(html, /cold-toggle/); // the mechanical bucket toggle
  assert.match(html, /1 mechanical file/);
  // The mechanical row lives inside the collapsed bucket.
  assert.ok(html.indexOf("cold-bucket") < html.indexOf("pkg-lock.json"));
});

test("publish_review without overview structure stays back-compatible (no html part)", async () => {
  const app = makeApp();
  const review = (await (
    await app.request(
      "/api/reviews",
      json({ branch: "feature", verdict: "approve", summary: "ok", findings: [] }),
    )
  ).json()) as any;
  const verdict = (await (await app.request(`/api/surfaces/${review.verdict}`)).json()) as any;
  assert.equal(verdict.parts[0].kind, "markdown", "no overview fields → verdict markdown leads");
  assert.ok(!verdict.parts.some((p: any) => p.kind === "html"));
});

test("publish_review renders a changeMap as a styled, color-coded mermaid on the verdict card", async () => {
  const app = makeApp();
  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        branch: "feature",
        verdict: "comment",
        changeMap: {
          nodes: [
            { id: "ctrl", label: "ChatController", status: "modified", kind: "class" },
            { id: "ent", label: "FinancialChatFeedback", status: "new", kind: "class" },
            { id: "db", label: "feedback.hbm.xml", status: "new", kind: "table" },
            { id: "junk", status: "new" }, // no label → dropped
          ],
          edges: [
            { from: "ctrl", to: "ent", label: "saves" },
            { from: "ent", to: "db", label: "persists" },
            { from: "ent", to: "nope" }, // unknown target → dropped
          ],
        },
        findings: [
          { severity: "nit", title: "t", problem: "p", confidence: "high", coverage: "c" },
        ],
      }),
    )
  ).json()) as any;
  const verdict = (await (await app.request(`/api/surfaces/${review.verdict}`)).json()) as any;
  assert.deepEqual(
    verdict.parts.map((p: any) => p.kind),
    ["markdown", "mermaid"],
  );
  const src = verdict.parts[1].mermaid as string;
  assert.match(src, /^flowchart LR/);
  // Labels carried, statuses applied, table → cylinder shape.
  assert.match(src, /\["ChatController"\]:::modified/);
  assert.match(src, /\["FinancialChatFeedback"\]:::new/);
  assert.match(src, /\[\("feedback\.hbm\.xml"\)\]:::new/);
  // Edges with labels; the edge to an unknown node is dropped.
  assert.match(src, /-->\|"saves"\|/);
  assert.match(src, /-->\|"persists"\|/);
  assert.doesNotMatch(src, /nope/);
  // Only the used statuses get a classDef (no `removed`/`touched` here).
  assert.match(src, /classDef new /);
  assert.match(src, /classDef modified /);
  assert.doesNotMatch(src, /classDef removed/);
  // The label-less node was dropped (3 nodes → n0..n2, no n3).
  assert.doesNotMatch(src, /\bn3\b/);
});

test("publish_review color-codes changeMap edge status with linkStyle lines (§8.2)", async () => {
  const app = makeApp();
  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        verdict: "comment",
        changeMap: {
          nodes: [
            { id: "a", label: "authMiddleware", status: "touched" },
            { id: "b", label: "validateToken", status: "modified" },
            { id: "c", label: "revocationList", status: "new" },
          ],
          edges: [
            { from: "a", to: "b", label: "calls", status: "existing" },
            { from: "b", to: "c", label: "now checks", status: "new" },
            { from: "a", to: "c", label: "dropped", status: "removed" },
          ],
        },
        findings: [],
      }),
    )
  ).json()) as any;
  const verdict = (await (await app.request(`/api/surfaces/${review.verdict}`)).json()) as any;
  const src = verdict.parts.find((p: any) => p.kind === "mermaid").mermaid as string;
  // One linkStyle per edge, indexed in emission order, reusing the status palette.
  assert.match(src, /linkStyle 0 stroke:#9aa0a6;/); // existing → gray
  assert.match(src, /linkStyle 1 stroke:#2f9e44,stroke-width:1\.5px;/); // new → green
  assert.match(src, /linkStyle 2 stroke:#e03131,stroke-width:1\.5px,stroke-dasharray:4 3;/); // removed → red dashed
});

test("publish_review renders churn as a green/red bar chart on the verdict card", async () => {
  const app = makeApp();
  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        branch: "feature",
        verdict: "comment",
        churn: [
          { file: "src/main/java/Foo.java", added: 120, removed: 8 },
          { file: "Bar.java", added: 4, removed: 30 },
          { file: "bin.dat", added: 0, removed: 0 }, // no churn → dropped
        ],
        findings: [
          { severity: "nit", title: "t", problem: "p", confidence: "high", coverage: "c" },
        ],
      }),
    )
  ).json()) as any;
  const verdict = (await (await app.request(`/api/surfaces/${review.verdict}`)).json()) as any;
  // verdict card: markdown + the churn chart (no architecture here).
  assert.deepEqual(
    verdict.parts.map((p: any) => p.kind),
    ["markdown", "chart"],
  );
  const chart = verdict.parts[1];
  assert.equal(chart.chartType, "bar");
  assert.equal(chart.stacked, true);
  assert.deepEqual(chart.y, ["added", "removed"]);
  assert.deepEqual(chart.colors, ["#2f9e44", "#e03131"]); // added green, removed red
  // Ranked by total churn, basename labels, zero-churn file dropped.
  assert.deepEqual(
    chart.data.map((d: any) => d.file),
    ["Foo.java", "Bar.java"],
  );
  assert.match(chart.caption, /2 files, 162 lines/);
});

test("publish_review reuses the `showcase review` scaffold placeholder as the verdict card", async () => {
  const app = makeApp();
  // `showcase review` seeds a placeholder card badged "In review".
  const placeholder = (await (
    await app.request(
      "/api/surfaces",
      json({
        title: "Review: feature",
        sessionTitle: "Review: feature",
        badge: { tone: "neutral", label: "In review" },
        parts: [{ kind: "markdown", markdown: "## Review: feature\n\n2 files changed" }],
      }),
    )
  ).json()) as any;

  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        branch: "feature",
        verdict: "comment",
        summary: "looks good overall",
        session: placeholder.sessionId,
        findings: [
          {
            severity: "nit",
            title: "tiny thing",
            problem: "small",
            confidence: "high",
            coverage: "c",
          },
        ],
      }),
    )
  ).json()) as any;

  // The verdict IS the placeholder, revised in place — not a new orphan card.
  assert.equal(review.verdict, placeholder.id);
  const surfaces = (await (
    await app.request(`/api/sessions/${review.session}/surfaces`)
  ).json()) as any[];
  assert.equal(surfaces.length, 2, "verdict (reused) + 1 finding — no orphan placeholder");
  const verdict = surfaces.find((s) => s.id === placeholder.id);
  assert.deepEqual(verdict.badge, { tone: "neutral", label: "Comments" }); // re-badged to the verdict
  assert.equal(verdict.title, "Review — feature");
  assert.match(verdict.parts[0].markdown, /looks good overall/);
  assert.ok(verdict.version >= 2, "the placeholder was revised, not recreated");

  // Without a scaffold placeholder, the verdict is a brand-new card (unchanged).
  const fresh = (await (
    await app.request("/api/reviews", json({ branch: "other", verdict: "approve", findings: [] }))
  ).json()) as any;
  const freshSurfaces = (await (
    await app.request(`/api/sessions/${fresh.session}/surfaces`)
  ).json()) as any[];
  assert.equal(freshSurfaces.length, 1);
  assert.equal(freshSurfaces[0].id, fresh.verdict);
});

test("double-escaped newlines in review prose render as real paragraphs", async () => {
  const app = makeApp();
  // The wire carries the literal two characters "\n" (agents double-escape
  // multi-paragraph prose); the card must show a paragraph break, not "\n".
  const review = (await (
    await app.request(
      "/api/reviews",
      json({
        verdict: "comment",
        summary: "First para.\\n\\nSecond para.",
        coverage: "read x\\nand y",
        findings: [
          {
            severity: "nit",
            title: "t",
            problem: "line one\\n\\nline two",
            confidence: "high",
            coverage: "c",
          },
        ],
      }),
    )
  ).json()) as any;
  const surfaces = (await (
    await app.request(`/api/sessions/${review.session}/surfaces`)
  ).json()) as any[];
  const verdict = surfaces.find((s) => s.id === review.verdict);
  assert.match(verdict.parts[0].markdown, /First para\.\n\nSecond para\./);
  assert.doesNotMatch(verdict.parts[0].markdown, /\\n/); // no literal backslash-n survives
  const finding = surfaces.find((s) => s.id === review.findings[0]);
  assert.match(finding.parts[0].markdown, /line one\n\nline two/);
});

test("review_finding composes a multimodal card from structured fields", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/findings",
    json({
      severity: "bug",
      title: "Constructor doesn't fail-fast",
      file: "Foo.java",
      line: 38,
      problem: "args assigned without null checks",
      confidence: "high",
      coverage: "read the constructor and its callers",
      fix: "checkNotNull each required arg",
      patch: "@@ -1 +1 @@\n-a\n+b",
      diagram: "flowchart LR; A-->B",
      sessionTitle: "ALLM-116 review",
    }),
  );
  assert.equal(res.status, 201);
  const lean = (await res.json()) as any;
  // severity → badge, and the file:line rides the title.
  assert.deepEqual(lean.badge, { tone: "critical", label: "Bug" });
  // No suggestion: fix folds into the problem markdown; patch → diff; diagram → mermaid last.
  assert.deepEqual(lean.kinds, ["markdown", "diff", "mermaid"]);

  const full = (await (await app.request(`/api/surfaces/${lean.id}`)).json()) as any;
  assert.equal(full.title, "Constructor doesn't fail-fast — Foo.java:38");
  assert.match(full.parts[0].markdown, /\*\*Problem\*\* — args assigned/);
  assert.match(full.parts[0].markdown, /\*\*Fix\*\* — checkNotNull/);
  assert.equal(full.parts[1].patch, "@@ -1 +1 @@\n-a\n+b");

  // A finding WITH a before/after suggestion: the fix becomes the rationale under
  // a computed diff, so the card reads Problem → suggested change → why.
  const suggested = (await (
    await app.request(
      "/api/findings",
      json({
        title: "Use a constant",
        problem: "magic number",
        confidence: "medium",
        coverage: "grepped for other call sites",
        suggestion: { before: "timeout(5000)", after: "timeout(DEFAULT_MS)" },
        fix: "names the intent and avoids drift",
        session: lean.sessionId,
      }),
    )
  ).json()) as any;
  assert.deepEqual(suggested.kinds, ["markdown", "diff", "markdown"]);
  const suggestedFull = (await (await app.request(`/api/surfaces/${suggested.id}`)).json()) as any;
  assert.doesNotMatch(suggestedFull.parts[0].markdown, /\*\*Fix\*\*/); // not folded inline
  assert.deepEqual(suggestedFull.parts[1].files, [
    { filename: "suggestion", before: "timeout(5000)", after: "timeout(DEFAULT_MS)" },
  ]);
  assert.match(suggestedFull.parts[2].markdown, /\*\*Why it's better\*\* — names the intent/);

  // Minimal call: title + problem + the required honesty signal (no other extras).
  const minimal = (await (
    await app.request(
      "/api/findings",
      json({
        title: "x",
        problem: "y",
        confidence: "low",
        coverage: "static read only",
        session: lean.sessionId,
      }),
    )
  ).json()) as any;
  assert.deepEqual(minimal.badge, { tone: "neutral", label: "Note" });
  assert.deepEqual(minimal.kinds, ["markdown"]);
  // The minimal card still leads with the confidence meta + coverage line.
  const minimalFull = (await (await app.request(`/api/surfaces/${minimal.id}`)).json()) as any;
  assert.match(minimalFull.parts[0].markdown, /Low confidence/);
  assert.match(minimalFull.parts[0].markdown, /\*\*Coverage\*\* — static read only/);

  // title + problem are required, and so are confidence + coverage.
  assert.equal((await app.request("/api/findings", json({ title: "x" }))).status, 400);
  assert.equal(
    (await app.request("/api/findings", json({ title: "x", problem: "y" }))).status,
    400,
  );
});

test("a surface badge is validated, echoed, updatable, and clearable", async () => {
  const app = makeApp();
  const created = (await (
    await app.request(
      "/api/surfaces",
      json({
        title: "Bug: unbounded upload",
        badge: { tone: "critical", label: "Bug" },
        parts: [{ kind: "markdown", markdown: "the body buffers before the cap" }],
      }),
    )
  ).json()) as any;
  assert.deepEqual(created.badge, { tone: "critical", label: "Bug" });

  // surfaceMeta (the read path) carries it too.
  const full = (await (await app.request(`/api/surfaces/${created.id}`)).json()) as any;
  assert.deepEqual(full.badge, { tone: "critical", label: "Bug" });

  // A bad tone is rejected (→ no badge), never coerced to a wrong color.
  const badTone = (await (
    await app.request(
      "/api/surfaces",
      json({
        title: "x",
        badge: { tone: "purple", label: "?" },
        parts: [{ kind: "html", html: "<p>x</p>" }],
      }),
    )
  ).json()) as any;
  assert.equal(badTone.badge, undefined);

  const putJson = (body: unknown) => ({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // Update replaces the badge.
  const downgraded = (await (
    await app.request(
      `/api/surfaces/${created.id}`,
      putJson({ badge: { tone: "warning", label: "Nit" } }),
    )
  ).json()) as any;
  assert.deepEqual(downgraded.badge, { tone: "warning", label: "Nit" });

  // A parts-only update leaves the badge untouched.
  await app.request(
    `/api/surfaces/${created.id}`,
    putJson({ parts: [{ kind: "html", html: "<p>fixed</p>" }] }),
  );
  const afterParts = (await (await app.request(`/api/surfaces/${created.id}`)).json()) as any;
  assert.deepEqual(afterParts.badge, { tone: "warning", label: "Nit" });

  // `null` clears it.
  await app.request(`/api/surfaces/${created.id}`, putJson({ badge: null }));
  const cleared = (await (await app.request(`/api/surfaces/${created.id}`)).json()) as any;
  assert.equal(cleared.badge, undefined);
});

test("pin/unpin a surface drives the Library collection", async () => {
  const app = makeApp();
  const a = (await (
    await app.request(
      "/api/surfaces",
      json({ title: "Keep", parts: [{ kind: "html", html: "<p>a</p>" }] }),
    )
  ).json()) as any;
  const b = (await (
    await app.request(
      "/api/surfaces",
      json({ title: "Skip", parts: [{ kind: "html", html: "<p>b</p>" }] }),
    )
  ).json()) as any;

  // Nothing pinned yet.
  assert.deepEqual((await (await app.request("/api/library")).json()) as any, []);

  const pinRes = await app.request(`/api/surfaces/${a.id}/pin`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned: true }),
  });
  assert.equal(pinRes.status, 200);
  assert.equal(((await pinRes.json()) as any).pinned, true);

  let library = (await (await app.request("/api/library")).json()) as any[];
  assert.deepEqual(
    library.map((s) => s.id),
    [a.id],
  );
  assert.equal(library[0].pinned, true);
  assert.equal(library[0].title, "Keep");

  // Unpinning drops it back out of the Library.
  await app.request(`/api/surfaces/${a.id}/pin`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned: false }),
  });
  assert.deepEqual((await (await app.request("/api/library")).json()) as any, []);

  // Pinning an unknown surface 404s.
  assert.equal(
    (
      await app.request(`/api/surfaces/${b.id}-nope/pin`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      })
    ).status,
    404,
  );
});

test("publishes a combined html+diff surface; /s renders the html part only", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({
      title: "Review",
      parts: [
        { kind: "html", html: "<p>diagram</p>" },
        { kind: "diff", patch: "@@ -1 +1 @@\n-a\n+b", layout: "split" },
      ],
    }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  // the write response is lean — kinds, no part bodies echoed back
  assert.deepEqual(surface.kinds, ["html", "diff"]);
  assert.equal(surface.parts, undefined);

  // the full record keeps the html and the diff patch
  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts.length, 2);
  assert.equal(full.parts[0].html, "<p>diagram</p>");
  assert.equal(full.parts[1].patch, "@@ -1 +1 @@\n-a\n+b");

  // /s renders the requested html part; a diff part has no html doc
  const part0 = await app.request(`/s/${surface.id}?part=0`);
  assert.ok((await part0.text()).includes("<p>diagram</p>"));
  assert.equal((await app.request(`/s/${surface.id}?part=1`)).status, 404);
});

test("a snippet's kits ride the html part and inject the kit CSS/JS at /s", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/snippets",
    json({ title: "Deck", html: "<div class=deck></div>", kits: ["slides"] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;

  // the kits persist on the stored html part
  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.deepEqual(full.parts[0].kits, ["slides"]);

  // /s injects the kit's css (rail/deck rules) and its behavior js
  const doc = await (await app.request(`/s/${surface.id}`)).text();
  assert.match(doc, /\.deck>\.slide/);
  assert.match(doc, /querySelector\('\.deck'\)/);

  // a plain snippet (no kits) gets neither
  const plain = await app.request("/api/snippets", json({ title: "Plain", html: "<p>x</p>" }));
  const plainSurface = (await plain.json()) as any;
  const plainDoc = await (await app.request(`/s/${plainSurface.id}`)).text();
  assert.doesNotMatch(plainDoc, /querySelector\('\.deck'\)/);
});

test("an unknown kit id is rejected before storage (400)", async () => {
  const app = makeApp();
  const bad = await app.request(
    "/api/snippets",
    json({ title: "x", html: "<p>x</p>", kits: ["bogus"] }),
  );
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as any).error, /unknown kit "bogus"/);

  const badPart = await app.request(
    "/api/surfaces",
    json({ title: "x", parts: [{ kind: "html", html: "<p>x</p>", kits: ["bogus"] }] }),
  );
  assert.equal(badPart.status, 400);
});

test("GET /api/kits advertises the available kits without the css payload", async () => {
  const app = makeApp();
  const kits = (await (await app.request("/api/kits")).json()) as any[];
  const ids = kits.map((k) => k.id);
  assert.ok(ids.includes("issues") && ids.includes("slides"));
  for (const k of kits) {
    assert.ok(typeof k.summary === "string" && k.summary.length > 0);
    assert.equal("css" in k, false);
  }
});

test("REST surface routes reject malformed parts before storage", async () => {
  const app = makeApp();

  const badCreate = await app.request("/api/surfaces", json({ parts: [{ kind: "image" }] }));
  assert.equal(badCreate.status, 400);
  assert.match(((await badCreate.json()) as any).error, /assetId/);
  assert.deepEqual(await (await app.request("/api/sessions")).json(), []);

  const good = (await (
    await app.request("/api/surfaces", json({ parts: [{ kind: "html", html: "<p>x</p>" }] }))
  ).json()) as any;
  const badUpdate = await app.request(`/api/surfaces/${good.id}`, {
    ...json({ parts: [{ kind: "diff", files: [{ filename: "x", before: "a" }] }] }),
    method: "PUT",
  });
  assert.equal(badUpdate.status, 400);
  assert.match(((await badUpdate.json()) as any).error, /before.*after/);

  const unchanged = (await (await app.request(`/api/surfaces/${good.id}`)).json()) as any;
  assert.equal(unchanged.version, 1);
  assert.deepEqual(unchanged.parts, [{ kind: "html", html: "<p>x</p>" }]);
});

test("publish_surface MCP tool round-trips a diff part", async () => {
  const app = makeApp();
  const list = (await (await app.request("/mcp", mcpCall(1, "tools/list"))).json()) as any;
  const names = list.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("publish_surface"));
  assert.ok(names.includes("publish_snippet")); // alias still advertised

  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "publish_surface",
        arguments: { title: "Diff", parts: [{ kind: "diff", patch: "@@ -1 +1 @@\n-x\n+y" }] },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  assert.ok(payload.id && payload.sessionId);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "diff");
  assert.equal(full.parts[0].patch, "@@ -1 +1 @@\n-x\n+y");
});

test("publishes a markdown part; /s has no html doc for it", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Plan", parts: [{ kind: "markdown", markdown: "## Plan\n\n- step one" }] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.deepEqual(surface.kinds, ["markdown"]);

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "markdown");
  assert.equal(full.parts[0].markdown, "## Plan\n\n- step one");
  // markdown is viewer-rendered data, not a sandboxed html doc
  assert.equal((await app.request(`/s/${surface.id}?part=0`)).status, 404);
});

test("publish_surface MCP tool keeps markdown parts and drops empty ones", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "publish_surface",
        arguments: {
          title: "Notes",
          parts: [
            { kind: "markdown", markdown: "  " },
            { kind: "markdown", markdown: "real prose" },
          ],
        },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  assert.equal(full.parts.length, 1);
  assert.equal(full.parts[0].kind, "markdown");
  assert.equal(full.parts[0].markdown, "real prose");
});

test("publish_surface MCP tool round-trips a terminal part", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "publish_surface",
        arguments: {
          title: "Terminal",
          parts: [
            { kind: "terminal", text: "$ echo hi\n\x1b[32mhi\x1b[0m", cols: 80, title: "sh" },
          ],
        },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  assert.ok(payload.id && payload.sessionId);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "terminal");
  assert.equal(full.parts[0].text, "$ echo hi\n\x1b[32mhi\x1b[0m");
  assert.equal(full.parts[0].cols, 80);
  assert.equal(full.parts[0].title, "sh");
  // a terminal part has no html doc, so /s 404s like diff/image/trace
  assert.equal((await app.request(`/s/${payload.id}?part=0`)).status, 404);
});

test("publishes a mermaid part; /s has no html doc for it", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Flow", parts: [{ kind: "mermaid", mermaid: "graph TD; A-->B" }] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.deepEqual(surface.kinds, ["mermaid"]);

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "mermaid");
  assert.equal(full.parts[0].mermaid, "graph TD; A-->B");
  // mermaid is viewer-rendered data, not a sandboxed html doc
  assert.equal((await app.request(`/s/${surface.id}?part=0`)).status, 404);
});

test("publishes a json part; round-trips data and 404s on /s", async () => {
  const app = makeApp();
  const data = {
    name: "showcase",
    version: "1.2.3",
    deps: ["a", "b"],
    nested: { x: true, y: null },
  };
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Config", parts: [{ kind: "json", data }] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.deepEqual(surface.kinds, ["json"]);

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "json");
  assert.deepEqual(full.parts[0].data, data);
  // json is viewer-rendered data, not a sandboxed html doc
  assert.equal((await app.request(`/s/${surface.id}?part=0`)).status, 404);
});

test("json part with null data is valid (null is a JSON value)", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Null", parts: [{ kind: "json", data: null }] }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].data, null);
});

test("json part without data key is rejected", async () => {
  const app = makeApp();
  const res = await app.request("/api/surfaces", json({ title: "Bad", parts: [{ kind: "json" }] }));
  assert.equal(res.status, 400);
});

test("publishes a code part; round-trips code/lang/title and 404s on /s", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({
      title: "Entry",
      parts: [{ kind: "code", code: "const x = 42;\n", language: "ts", title: "a.ts" }],
    }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.deepEqual(surface.kinds, ["code"]);

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "code");
  assert.equal(full.parts[0].code, "const x = 42;\n");
  assert.equal(full.parts[0].language, "ts");
  assert.equal(full.parts[0].title, "a.ts");
  assert.equal((await app.request(`/s/${surface.id}?part=0`)).status, 404);
});

test("code part without code is rejected", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Bad", parts: [{ kind: "code", language: "ts" }] }),
  );
  assert.equal(res.status, 400);
});

test("publishes a chart part; round-trips the spec and 404s on /s", async () => {
  const app = makeApp();
  const chart = {
    kind: "chart",
    chartType: "bar",
    x: "pctl",
    y: ["before", "after"],
    data: [
      { pctl: "p50", before: 41, after: 12 },
      { pctl: "p95", before: 300, after: 86 },
    ],
    yLabel: "ms",
    caption: "before vs after",
  };
  const res = await app.request("/api/surfaces", json({ title: "Latency", parts: [chart] }));
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  assert.deepEqual(surface.kinds, ["chart"]);

  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.deepEqual(full.parts[0], chart);
  // chart is viewer-rendered data, not a sandboxed html doc
  assert.equal((await app.request(`/s/${surface.id}?part=0`)).status, 404);
});

test("chart part with a single y field is valid", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({
      title: "Single",
      parts: [{ kind: "chart", chartType: "line", x: "t", y: "v", data: [{ t: "a", v: 1 }] }],
    }),
  );
  assert.equal(res.status, 201);
});

test("chart part with an unknown chartType is rejected (strict REST)", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({
      title: "Bad",
      parts: [{ kind: "chart", chartType: "donut", x: "t", y: "v", data: [{ t: "a", v: 1 }] }],
    }),
  );
  assert.equal(res.status, 400);
});

test("chart part with empty data is rejected (strict REST)", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({ title: "Bad", parts: [{ kind: "chart", chartType: "bar", x: "t", y: "v", data: [] }] }),
  );
  assert.equal(res.status, 400);
});

test("publish_surface MCP tool coerces a bad chartType to bar (loose)", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "publish_surface",
        arguments: {
          title: "Chart",
          parts: [{ kind: "chart", chartType: "donut", x: "t", y: "v", data: [{ t: "a", v: 1 }] }],
        },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  assert.equal(full.parts[0].kind, "chart");
  assert.equal(full.parts[0].chartType, "bar");
});

test("chart colors round-trip when safe and a bad one is rejected (strict REST)", async () => {
  const app = makeApp();
  const base = {
    kind: "chart",
    chartType: "bar",
    x: "f",
    y: ["added", "removed"],
    data: [{ f: "a", added: 3, removed: 1 }],
  };
  // Safe colors (hex + rgb) round-trip verbatim.
  const ok = await app.request(
    "/api/surfaces",
    json({ title: "Churn", parts: [{ ...base, colors: ["#2f9e44", "rgb(224, 49, 49)"] }] }),
  );
  assert.equal(ok.status, 201);
  const surface = (await ok.json()) as any;
  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.deepEqual(full.parts[0].colors, ["#2f9e44", "rgb(224, 49, 49)"]);
  // A CSS-injection attempt is rejected by strict REST validation.
  const bad = await app.request(
    "/api/surfaces",
    json({ title: "Bad", parts: [{ ...base, colors: ["red; } body{}"] }] }),
  );
  assert.equal(bad.status, 400);
});

test("chart colors: the loose MCP path drops unsafe colors but keeps the part", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "publish_surface",
        arguments: {
          title: "Churn",
          parts: [
            {
              kind: "chart",
              chartType: "bar",
              x: "f",
              y: ["added", "removed"],
              data: [{ f: "a", added: 3, removed: 1 }],
              colors: ["#2f9e44", "url(#evil)", "rgb(224,49,49)"],
            },
          ],
        },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  // Unsafe url(...) dropped; the two safe colors survive.
  assert.deepEqual(full.parts[0].colors, ["#2f9e44", "rgb(224,49,49)"]);
});

test("code part with lineStart round-trips", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/surfaces",
    json({
      title: "Excerpt",
      parts: [
        {
          kind: "code",
          code: "const x = 1;\nconst y = 2;\n",
          language: "ts",
          title: "a.ts",
          lineStart: 80,
        },
      ],
    }),
  );
  assert.equal(res.status, 201);
  const surface = (await res.json()) as any;
  const full = (await (await app.request(`/api/surfaces/${surface.id}`)).json()) as any;
  assert.equal(full.parts[0].lineStart, 80);
});

test("publish_surface MCP tool keeps mermaid parts and drops empty ones", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "publish_surface",
        arguments: {
          title: "Diagram",
          parts: [
            { kind: "mermaid", mermaid: "  " },
            { kind: "mermaid", mermaid: "graph TD; A-->B" },
          ],
        },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  const full = (await (await app.request(`/api/surfaces/${payload.id}`)).json()) as any;
  assert.equal(full.parts.length, 1);
  assert.equal(full.parts[0].kind, "mermaid");
  assert.equal(full.parts[0].mermaid, "graph TD; A-->B");
});

test("update bumps version and keeps history; old version renderable", async () => {
  const app = makeApp();
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>v1</p>", title: "T" }))
  ).json()) as any;
  const res = await app.request(`/api/snippets/${s.id}`, {
    ...json({ html: "<p>v2</p>" }),
    method: "PUT",
  });
  const updated = (await res.json()) as any;
  assert.equal(updated.version, 2);

  const full = (await (await app.request(`/api/snippets/${s.id}`)).json()) as any;
  assert.equal(full.history.length, 1);
  assert.equal(full.history[0].parts[0].html, "<p>v1</p>");

  const current = await (await app.request(`/s/${s.id}`)).text();
  assert.ok(current.includes("<p>v2</p>"));
  const old = await (await app.request(`/s/${s.id}?ver=1`)).text();
  assert.ok(old.includes("<p>v1</p>"));
});

test("snippet page is wrapped with CSP, bridge, and kit", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  const page = await (await app.request(`/s/${s.id}`)).text();
  assert.ok(page.includes("Content-Security-Policy"));
  assert.ok(page.includes("window.sendPrompt"));
  assert.ok(page.includes("__showcase"));
  // Snippet kit: SVG utilities in the stylesheet and the shared arrow marker
  // injected before the snippet body so url(#arrow) resolves.
  assert.ok(page.includes(".c-blue"));
  assert.ok(page.indexOf('<marker id="arrow"') < page.indexOf("<p>x</p>"));
  assert.ok(page.includes('<marker id="arrow"'));
});

test("comments attach to snippets and filter by author/after", async () => {
  const app = makeApp();
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>x</p>", title: "Sketch" }))
  ).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "love it", author: "user" }));
  await app.request("/api/comments", json({ snippet: s.id, text: "thanks", author: "claude" }));

  const all = (await (await app.request(`/api/comments?session=${s.sessionId}`)).json()) as any;
  assert.equal(all.comments.length, 2);
  assert.equal(all.comments[0].surfaceTitle, "Sketch");

  // explicit after=0: re-read from the start regardless of the agent cursor
  const users = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user&after=0`)
  ).json()) as any;
  assert.equal(users.comments.length, 1);
  assert.equal(users.comments[0].text, "love it");

  const later = (await (
    await app.request(`/api/comments?session=${s.sessionId}&after=${all.lastSeq}`)
  ).json()) as any;
  assert.equal(later.comments.length, 0);
});

test("a comment targets a surface or the session", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;

  // a session id lands in the session-level chat (surfaceId null)
  const res = await app.request("/api/comments", json({ session: s.sessionId, text: "general" }));
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as any).surfaceId, null);

  // a surface that doesn't exist is a 404, not a silent session-level comment
  const ghost = await app.request("/api/comments", json({ snippet: "missing", text: "ghost" }));
  assert.equal(ghost.status, 404);
});

test("author=user reads resume from the agent's server-side cursor", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "first", author: "user" }));

  // no cursor given: delivered once...
  const first = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user`)
  ).json()) as any;
  assert.equal(first.comments.length, 1);
  assert.equal(first.comments[0].text, "first");

  // ...and not again on the next cursor-less read (e.g. a fresh CLI process)
  const again = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user`)
  ).json()) as any;
  assert.equal(again.comments.length, 0);

  // unfiltered reads (the viewer) never consume the cursor
  const viewer = (await (await app.request(`/api/comments?session=${s.sessionId}`)).json()) as any;
  assert.equal(viewer.comments.length, 1);
});

test("piggyback delivery advances the cursor seen by author=user waits", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "tweak it", author: "user" }));

  // an agent write piggybacks the pending feedback...
  const updated = (await (
    await app.request(`/api/snippets/${s.id}`, {
      ...json({ html: "<p>v2</p>" }),
      method: "PUT",
    })
  ).json()) as any;
  assert.equal(updated.userFeedback.length, 1);
  assert.equal(updated.userFeedback[0].text, "tweak it");

  // ...so a cursor-less wait on another channel must not re-deliver it
  const wait = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user`)
  ).json()) as any;
  assert.equal(wait.comments.length, 0);
});

test("author=user lastSeq reflects the last comment overall, not the last user comment", async () => {
  // When an agent reply lands after the user comment, the cursor returned
  // to the caller (lastSeq) must be the agent comment's seq — otherwise
  // the next call re-reads the agent comment and wastes a round-trip.
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "first", author: "user" }));
  await app.request("/api/comments", json({ snippet: s.id, text: "reply", author: "agent" }));

  const res = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user&after=0`)
  ).json()) as any;
  assert.equal(res.comments.length, 1);
  assert.equal(res.comments[0].text, "first");
  // lastSeq is the agent comment's seq (2), not the user comment's (1)
  assert.equal(res.lastSeq, 2);
});

function makeVersionApp(version?: string, latest?: { version: string; notes?: string } | Error) {
  const dir = mkdtempSync(join(tmpdir(), "showcase-test-"));
  return createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
    version,
    upgradeCommand: "npm install -g showcase",
    fetchLatestRelease: () =>
      latest instanceof Error ? Promise.reject(latest) : Promise.resolve(latest ?? null),
  });
}

test("version endpoint reports an available update with notes", async () => {
  const app = makeVersionApp("0.3.0", { version: "0.4.0", notes: "### Added\n- things" });
  const res = (await (await app.request("/api/version")).json()) as any;
  assert.deepEqual(res, {
    current: "0.3.0",
    latest: "0.4.0",
    updateAvailable: true,
    upgradeCommand: "npm install -g showcase",
    notes: "### Added\n- things",
  });
});

test("version endpoint is quiet when current, unconfigured, or offline", async () => {
  // up to date — and a same-or-older registry version is never an "update"
  const same = (await (
    await makeVersionApp("0.4.0", { version: "0.4.0" }).request("/api/version")
  ).json()) as any;
  assert.equal(same.updateAvailable, false);
  assert.equal(same.upgradeCommand, null);
  const older = (await (
    await makeVersionApp("0.4.1", { version: "0.4.0" }).request("/api/version")
  ).json()) as any;
  assert.equal(older.updateAvailable, false);

  // no version configured: nothing to compare against
  const none = (await (await makeVersionApp(undefined).request("/api/version")).json()) as any;
  assert.deepEqual(none, { current: null, latest: null, updateAvailable: false });

  // lookup failure is silent
  const offline = (await (
    await makeVersionApp("0.3.0", new Error("offline")).request("/api/version")
  ).json()) as any;
  assert.deepEqual(offline, {
    current: "0.3.0",
    latest: null,
    updateAvailable: false,
    upgradeCommand: null,
    notes: null,
  });
});

test("long-poll resolves when a comment arrives", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  const pending = app.request(`/api/comments?session=${s.sessionId}&wait=5`);
  setTimeout(() => {
    app.request("/api/comments", json({ snippet: s.id, text: "feedback!", author: "user" }));
  }, 50);
  const start = Date.now();
  const result = (await (await pending).json()) as any;
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].text, "feedback!");
  assert.ok(Date.now() - start < 4000, "should resolve well before the timeout");
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("a parked feedback wait coalesces a burst of comments into one batch", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  // The agent parks on its session feedback wait...
  const pending = app.request(`/api/comments?session=${s.sessionId}&author=user&wait=8`);
  await sleep(100);
  // ...and the user fires two comments in quick succession (within the settle
  // window). Pre-fix this woke on the first and the second missed the turn.
  await app.request("/api/comments", json({ snippet: s.id, text: "one", author: "user" }));
  await sleep(150);
  await app.request("/api/comments", json({ snippet: s.id, text: "two", author: "user" }));

  const result = (await (await pending).json()) as any;
  assert.deepEqual(
    result.comments.map((c: { text: string }) => c.text),
    ["one", "two"],
  );
});

test("a composing heartbeat keeps the wait open so a slower second message still batches", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  const pending = app.request(`/api/comments?session=${s.sessionId}&author=user&wait=8`);
  await sleep(100);
  await app.request("/api/comments", json({ snippet: s.id, text: "one", author: "user" }));
  // Keep "composing" alive across a gap longer than the settle window — without
  // the heartbeat the wait would have returned with just "one".
  await app.request("/api/composing", json({ session: s.sessionId }));
  await sleep(950);
  await app.request("/api/composing", json({ session: s.sessionId }));
  await app.request("/api/comments", json({ snippet: s.id, text: "two", author: "user" }));

  const result = (await (await pending).json()) as any;
  assert.deepEqual(
    result.comments.map((c: { text: string }) => c.text),
    ["one", "two"],
  );
});

test("the composing endpoint accepts a session or surface and always 204s", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  assert.equal((await app.request("/api/composing", json({ session: s.sessionId }))).status, 204);
  assert.equal((await app.request("/api/composing", json({ surface: s.id }))).status, 204);
  // A stray ping with no resolvable target is still a quiet no-op, never an error.
  assert.equal((await app.request("/api/composing", json({}))).status, 204);
});

test("deleting a session cascades to snippets and comments", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "hi" }));
  const res = await app.request(`/api/sessions/${s.sessionId}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal((await app.request(`/api/snippets/${s.id}`)).status, 404);
  const sessions = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(sessions.length, 0);
});

test("rename session", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  const res = await app.request(`/api/sessions/${s.sessionId}`, {
    ...json({ title: "Auth refactor" }),
    method: "PATCH",
  });
  assert.equal(((await res.json()) as any).title, "Auth refactor");
});

test("auth hook can guard an embedding host without authToken", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-test-"));
  const app = createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    authenticate: (request) => request.headers.get("x-showcase-internal") === "ok",
  });

  assert.equal((await app.request("/guide")).status, 401);
  assert.equal((await app.request("/api/sessions")).status, 401);
  const allowed = await app.request("/api/sessions", { headers: { "x-showcase-internal": "ok" } });
  assert.equal(allowed.status, 200);
});

test("auth token guards mutating routes when configured", async () => {
  const app = makeApp("secret");
  const denied = await app.request("/api/snippets", json({ html: "<p>x</p>" }));
  assert.equal(denied.status, 401);
  const allowed = await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }));
  assert.equal(allowed.status, 201);
  // full surface is guarded, including reads and the viewer
  assert.equal((await app.request("/api/sessions")).status, 401);
  assert.equal((await app.request("/")).status, 401);
  // docs and bootstrap instructions stay open
  assert.equal((await app.request("/guide")).status, 200);
  assert.equal((await app.request("/setup")).status, 200);
  assert.equal((await app.request("/agent-howto")).status, 200);
  // ?key= grants access and sets a cookie for subsequent requests
  const keyed = await app.request("/?key=secret");
  assert.equal(keyed.status, 200);
  const cookie = keyed.headers.get("set-cookie") ?? "";
  assert.ok(cookie.includes("showcase_key=secret"));
  const viaCookie = await app.request("/api/sessions", {
    headers: { cookie: "showcase_key=secret" },
  });
  assert.equal(viaCookie.status, 200);
});

async function readSseUntil(res: Response, needle: string, abort?: () => void): Promise<string> {
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    await Promise.race([
      (async () => {
        while (!text.includes(needle)) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
      })(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), 1000),
      ),
    ]);
  } finally {
    abort?.();
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

// --- public read auth modes ---

test("public read full mode allows unauthenticated GETs but not writes", async () => {
  const app = makeApp("secret", { publicRead: "full" });

  assert.equal((await app.request("/")).status, 200);
  assert.equal((await app.request("/session/anything")).status, 200);
  assert.equal((await app.request("/api/sessions")).status, 200);
  assert.equal((await app.request("/api/version")).status, 200);

  const created = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }))
  ).json()) as any;
  assert.equal((await app.request(`/s/${created.id}`)).status, 200);
  assert.equal((await app.request(`/api/surfaces/${created.id}`)).status, 200);

  assert.equal((await app.request("/api/snippets", json({ html: "<p>x</p>" }))).status, 401);
  assert.equal((await app.request("/api/comments", json({ text: "hi" }))).status, 401);
});

test("public read session mode allows scoped reads and denies root/session list", async () => {
  const app = makeApp("secret", { publicRead: "session" });

  assert.equal((await app.request("/")).status, 401);
  assert.equal((await app.request("/api/sessions")).status, 401);
  assert.equal((await app.request("/api/version")).status, 200);

  const created = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }))
  ).json()) as any;
  assert.equal((await app.request(`/session/${created.sessionId}`)).status, 200);
  assert.equal((await app.request(`/session/${created.sessionId}/s/${created.id}`)).status, 200);
  assert.equal((await app.request(`/s/${created.id}`)).status, 200);
  assert.equal((await app.request(`/api/surfaces/${created.id}`)).status, 200);
  assert.equal((await app.request(`/api/snippets/${created.id}`)).status, 200);
  assert.equal((await app.request(`/api/sessions/${created.sessionId}/surfaces`)).status, 200);

  assert.equal((await app.request("/api/snippets", json({ html: "<p>x</p>" }))).status, 401);
});

test("public read session mode validates unauthenticated session viewer URLs", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const created = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }))
  ).json()) as any;

  assert.equal((await app.request("/session/missing")).status, 404);
  assert.equal((await app.request(`/session/${created.sessionId}/s/missing`)).status, 404);
  assert.equal((await app.request(`/session/missing/s/${created.id}`)).status, 404);

  const authed = await app.request("/session/missing", {
    headers: { authorization: "Bearer secret" },
  });
  assert.equal(authed.status, 200);
});

test("public read session mode protects unscoped comments reads", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const created = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }))
  ).json()) as any;
  await app.request("/api/comments", authedJson({ snippet: created.id, text: "hi" }));

  assert.equal((await app.request("/api/comments")).status, 401);
  assert.equal((await app.request("/api/comments?session=missing")).status, 404);
  assert.equal((await app.request(`/api/comments?session=${created.sessionId}`)).status, 200);
  assert.equal((await app.request(`/api/comments?surface=${created.id}`)).status, 200);

  const owner = await app.request("/api/comments", {
    headers: { authorization: "Bearer secret" },
  });
  assert.equal(owner.status, 200);
});

test("public read session mode protects and scopes event streams", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const first = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>one</p>" }))
  ).json()) as any;
  const second = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>two</p>" }))
  ).json()) as any;

  assert.equal((await app.request("/api/events")).status, 401);
  assert.equal((await app.request("/api/events?session=missing")).status, 404);

  const ac = new AbortController();
  const stream = await app.request(`/api/events?session=${first.sessionId}`, { signal: ac.signal });
  assert.equal(stream.status, 200);
  const other = (await (
    await app.request(
      "/api/snippets",
      authedJson({ html: "<p>other</p>", session: second.sessionId }),
    )
  ).json()) as any;
  const matching = (await (
    await app.request(
      "/api/snippets",
      authedJson({ html: "<p>matching</p>", session: first.sessionId }),
    )
  ).json()) as any;

  const text = await readSseUntil(stream, matching.id, () => ac.abort());
  assert.ok(text.includes(matching.id));
  assert.ok(!text.includes(other.id));
});

test("public read viewer config marks unauthenticated full-mode visitors readonly", async () => {
  const app = makeApp("secret", { publicRead: "full" });

  const html = await (await app.request("/")).text();
  assert.ok(html.includes("__SHOWCASE_READONLY__=true"));
  assert.ok(html.includes('__SHOWCASE_PUBLIC_READ__="full"'));
});

test("public read viewer config keeps authenticated owners writable", async () => {
  const app = makeApp("secret", { publicRead: "full" });

  const html = await (
    await app.request("/", { headers: { authorization: "Bearer secret" } })
  ).text();
  assert.ok(!html.includes("__SHOWCASE_READONLY__"));
  assert.ok(!html.includes("__SHOWCASE_PUBLIC_READ__"));
});

test("public read viewer config marks session-mode visitors readonly", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const created = (await (
    await app.request("/api/snippets", authedJson({ html: "<p>x</p>" }))
  ).json()) as any;

  const html = await (await app.request(`/session/${created.sessionId}`)).text();
  assert.ok(html.includes("__SHOWCASE_READONLY__=true"));
  assert.ok(html.includes('__SHOWCASE_PUBLIC_READ__="session"'));
});

test("public read viewer config treats query key as authenticated for that response", async () => {
  const app = makeApp("secret", { publicRead: "full" });

  const res = await app.request("/?key=secret");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes("__SHOWCASE_READONLY__"));
  assert.ok(!html.includes("__SHOWCASE_PUBLIC_READ__"));
});

test("public read does not bypass custom authenticate hooks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-test-"));
  const app = createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    authenticate: (request) => request.headers.get("x-showcase-internal") === "ok",
    publicRead: "full",
  });

  assert.equal((await app.request("/api/sessions")).status, 401);
  assert.equal(
    (await app.request("/api/sessions", { headers: { "x-showcase-internal": "ok" } })).status,
    200,
  );
});

const mcpCall = (id: number, method: string, params?: unknown) =>
  json({ jsonrpc: "2.0", id, method, params });

test("mcp endpoint: initialize, tools/list, publish round trip", async () => {
  const app = makeApp();

  const init = (await (
    await app.request("/mcp", mcpCall(1, "initialize", { protocolVersion: "2025-03-26" }))
  ).json()) as any;
  assert.equal(init.result.serverInfo.name, "showcase");
  assert.ok(init.result.instructions.length > 0);
  // The MCP instructions prime the chat loop, so a connected agent learns the
  // wait → reply → wait behavior without the user pasting anything.
  assert.match(init.result.instructions, /wait_for_feedback/);
  assert.match(init.result.instructions, /loop/i);

  const list = (await (await app.request("/mcp", mcpCall(2, "tools/list"))).json()) as any;
  const names = list.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("publish_snippet"));
  assert.ok(names.includes("wait_for_feedback"));

  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(3, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "Via MCP", html: "<p>mcp</p>", agent: "test-agent" },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  assert.ok(payload.id);
  assert.ok(payload.sessionId);
  assert.ok(payload.url.includes(`/s/${payload.id}`));

  // session continuity: second publish into the returned session
  const second = (await (
    await app.request(
      "/mcp",
      mcpCall(4, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "Second", html: "<p>2</p>", session: payload.sessionId },
      }),
    )
  ).json()) as any;
  assert.equal(JSON.parse(second.result.content[0].text).sessionId, payload.sessionId);

  // feedback loop through the mcp tool
  await app.request("/api/comments", json({ snippet: payload.id, text: "nice", author: "user" }));
  const feedback = (await (
    await app.request(
      "/mcp",
      mcpCall(5, "tools/call", {
        name: "wait_for_feedback",
        arguments: { session: payload.sessionId, timeoutSeconds: 0 },
      }),
    )
  ).json()) as any;
  const fb = JSON.parse(feedback.result.content[0].text);
  assert.equal(fb.comments.length, 1);
  assert.equal(fb.comments[0].text, "nice");
  assert.ok(fb.lastSeq > 0);
});

test("mcp publish_snippet honors sessionTitle on first publish only", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "One", html: "<p>1</p>", sessionTitle: "Cache design" },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  const sessions = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "Cache design");

  // publishing into the existing session with another sessionTitle is a no-op
  await app.request(
    "/mcp",
    mcpCall(2, "tools/call", {
      name: "publish_snippet",
      arguments: {
        title: "Two",
        html: "<p>2</p>",
        session: payload.sessionId,
        sessionTitle: "Other",
      },
    }),
  );
  const after = (await (await app.request("/api/sessions")).json()) as any;
  assert.equal(after[0].title, "Cache design");
});

test("mcp endpoint: unknown method and unknown tool", async () => {
  const app = makeApp();
  const bad = (await (await app.request("/mcp", mcpCall(1, "resources/list"))).json()) as any;
  assert.equal(bad.error.code, -32601);
  const badTool = (await (
    await app.request("/mcp", mcpCall(2, "tools/call", { name: "nope", arguments: {} }))
  ).json()) as any;
  assert.equal(badTool.result.isError, true);
});

test("mcp endpoint requires bearer when token configured", async () => {
  const app = makeApp("secret");
  assert.equal((await app.request("/mcp", mcpCall(1, "tools/list"))).status, 401);
  const ok = await app.request("/mcp", {
    ...mcpCall(2, "tools/list"),
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
  });
  assert.equal(ok.status, 200);
});

test("agent writes piggyback unseen user comments, delivered once", async () => {
  const app = makeApp();
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>v1</p>", title: "Doc" }))
  ).json()) as any;
  assert.equal(s.userFeedback, undefined);

  // the user comments while the agent works on something else
  await app.request("/api/comments", json({ snippet: s.id, text: "wrong color", author: "user" }));
  await app.request("/api/comments", json({ snippet: s.id, text: "also add a key" }));

  // the agent's next write carries the feedback
  const updated = (await (
    await app.request(`/api/snippets/${s.id}`, { ...json({ html: "<p>v2</p>" }), method: "PUT" })
  ).json()) as any;
  assert.deepEqual(
    updated.userFeedback.map((f: any) => f.text),
    ["wrong color", "also add a key"],
  );
  assert.equal(updated.userFeedback[0].surfaceTitle, "Doc");

  // delivered once — the next write is clean
  const again = (await (
    await app.request(`/api/snippets/${s.id}`, { ...json({ html: "<p>v3</p>" }), method: "PUT" })
  ).json()) as any;
  assert.equal(again.userFeedback, undefined);

  // agent replies piggyback too; the user's own comments never do
  await app.request("/api/comments", json({ snippet: s.id, text: "more", author: "user" }));
  const userPost = (await (
    await app.request("/api/comments", json({ snippet: s.id, text: "and more", author: "user" }))
  ).json()) as any;
  assert.equal(userPost.userFeedback, undefined);
  const reply = (await (
    await app.request("/api/comments", json({ snippet: s.id, text: "on it", author: "claude" }))
  ).json()) as any;
  assert.deepEqual(
    reply.userFeedback.map((f: any) => f.text),
    ["more", "and more"],
  );
});

test("a consumed wait is not re-delivered as piggyback", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request(
    "/api/comments",
    json({ snippet: s.id, text: "seen via wait", author: "user" }),
  );

  // the agent receives it through the long-poll...
  const waited = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user`)
  ).json()) as any;
  assert.equal(waited.comments.length, 1);

  // ...so the next write carries nothing
  const updated = (await (
    await app.request(`/api/snippets/${s.id}`, { ...json({ html: "<p>v2</p>" }), method: "PUT" })
  ).json()) as any;
  assert.equal(updated.userFeedback, undefined);

  // the viewer's unfiltered reads do NOT consume the cursor
  await app.request("/api/comments", json({ snippet: s.id, text: "fresh", author: "user" }));
  await app.request(`/api/comments?session=${s.sessionId}`); // viewer-style read
  const next = (await (
    await app.request(`/api/snippets/${s.id}`, { ...json({ html: "<p>v3</p>" }), method: "PUT" })
  ).json()) as any;
  assert.deepEqual(
    next.userFeedback.map((f: any) => f.text),
    ["fresh"],
  );
});

// The agentSeq cursor is shared across every delivery channel, so a comment
// delivered once on one channel must never reappear on another. The REST-to-REST
// directions are covered above; these pin the MCP<->REST crossings, the pairing
// most likely to drift since the two go through different code paths.

test("feedback consumed via the MCP wait is not re-delivered through REST channels", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "Doc", html: "<p>v1</p>", agent: "mcp-agent" },
      }),
    )
  ).json()) as any;
  const p = JSON.parse(published.result.content[0].text);
  await app.request("/api/comments", json({ snippet: p.id, text: "via mcp", author: "user" }));

  // the agent drains it through the MCP tool...
  const feedback = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "wait_for_feedback",
        arguments: { session: p.sessionId, timeoutSeconds: 0 },
      }),
    )
  ).json()) as any;
  assert.deepEqual(
    JSON.parse(feedback.result.content[0].text).comments.map((c: any) => c.text),
    ["via mcp"],
  );

  // ...so a REST write must not re-piggyback it, and a REST author=user read
  // (CLI watch) sees nothing either — both honor the same advanced cursor
  const updated = (await (
    await app.request(`/api/snippets/${p.id}`, { ...json({ html: "<p>v2</p>" }), method: "PUT" })
  ).json()) as any;
  assert.equal(updated.userFeedback, undefined);
  const restWait = (await (
    await app.request(`/api/comments?session=${p.sessionId}&author=user`)
  ).json()) as any;
  assert.equal(restWait.comments.length, 0);
});

test("feedback consumed via a REST wait is not re-delivered through the MCP wait", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request("/api/comments", json({ snippet: s.id, text: "via rest", author: "user" }));

  // the agent drains it through a REST author=user read...
  const restWait = (await (
    await app.request(`/api/comments?session=${s.sessionId}&author=user`)
  ).json()) as any;
  assert.deepEqual(
    restWait.comments.map((c: any) => c.text),
    ["via rest"],
  );

  // ...so the MCP tool, reading the same cursor, must not re-deliver it
  const feedback = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "wait_for_feedback",
        arguments: { session: s.sessionId, timeoutSeconds: 0 },
      }),
    )
  ).json()) as any;
  const fb = JSON.parse(feedback.result.content[0].text);
  assert.equal(fb.comments.length, 0);

  // and a fresh comment still flows to the MCP channel — the cursor advanced,
  // it didn't wedge
  await app.request("/api/comments", json({ snippet: s.id, text: "later", author: "user" }));
  const next = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "wait_for_feedback",
        arguments: { session: s.sessionId, timeoutSeconds: 0 },
      }),
    )
  ).json()) as any;
  assert.deepEqual(
    JSON.parse(next.result.content[0].text).comments.map((c: any) => c.text),
    ["later"],
  );
});

test("delivered feedback nudges the agent to reply in the tab, not the terminal", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>x</p>" }))).json()) as any;
  await app.request(
    "/api/comments",
    json({ snippet: s.id, text: "which variant?", author: "user" }),
  );
  const res = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "wait_for_feedback",
        arguments: { session: s.sessionId, timeoutSeconds: 0 },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(res.result.content[0].text);
  // The in-context reminder rides with every non-empty delivery so the agent
  // answers via reply_to_user instead of stalling on a terminal prompt.
  assert.match(payload.note, /reply_to_user/);
  assert.match(payload.note, /not the terminal/i);
});

test("mcp publish result carries userFeedback", async () => {
  const app = makeApp();
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "One", html: "<p>1</p>", agent: "mcp-agent" },
      }),
    )
  ).json()) as any;
  const first = JSON.parse(published.result.content[0].text);
  await app.request("/api/comments", json({ snippet: first.id, text: "neat", author: "user" }));

  const second = (await (
    await app.request(
      "/mcp",
      mcpCall(2, "tools/call", {
        name: "publish_snippet",
        arguments: { title: "Two", html: "<p>2</p>", session: first.sessionId },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(second.result.content[0].text);
  assert.deepEqual(
    payload.userFeedback.map((f: any) => f.text),
    ["neat"],
  );
});

test("rejects empty and oversized html", async () => {
  const app = makeApp();
  assert.equal((await app.request("/api/snippets", json({ html: "" }))).status, 400);
  assert.equal(
    (await app.request("/api/snippets", json({ html: "x".repeat(2 * 1024 * 1024 + 1) }))).status,
    413,
  );
});

test("ids are unguessable: 11 url-safe chars (~64 bits), not a 32-bit segment", async () => {
  const app = makeApp();
  const s = (await (await app.request("/api/snippets", json({ html: "<p>hi</p>" }))).json()) as any;
  assert.match(s.id, /^[A-Za-z0-9_-]{11}$/);
  assert.match(s.sessionId, /^[A-Za-z0-9_-]{11}$/);
});

test("malformed base64 in an asset envelope is a 400, not a 500", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/assets",
    json({ data: "not valid base64!!!", contentType: "image/png" }),
  );
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as any).error, /base64/);
});

test("comment text and titles are capped before they ride the feedback channel", async () => {
  const app = makeApp();
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>hi</p>", title: "T".repeat(1000) }))
  ).json()) as any;
  // title capped at the publish edge
  assert.equal(s.title.length, 500);

  await app.request(
    "/api/comments",
    json({ snippet: s.id, text: "x".repeat(20000), author: "user" }),
  );
  const all = (await (await app.request(`/api/comments?session=${s.sessionId}`)).json()) as any;
  assert.equal(all.comments[0].text.length, 8000);
  // the capped title is what gets snapshotted onto the comment (feedback view)
  assert.equal(all.comments[0].surfaceTitle.length, 500);
});

// --- assets ---

const b64 = (bytes: number[]) => Buffer.from(new Uint8Array(bytes)).toString("base64");

test("uploads an asset via base64 JSON and serves the exact bytes", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/assets",
    json({ data: b64([137, 80, 78, 71, 0, 255]), contentType: "image/png", filename: "shot.png" }),
  );
  assert.equal(res.status, 201);
  const asset = (await res.json()) as any;
  assert.ok(asset.id);
  assert.ok(asset.sessionId); // auto-created a session
  assert.equal(asset.kind, "image"); // inferred from image/*
  assert.equal(asset.byteLength, 6);
  assert.ok(String(asset.url).endsWith(`/a/${asset.id}`));

  const served = await app.request(`/a/${asset.id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("content-disposition"), "inline");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await served.arrayBuffer())], [137, 80, 78, 71, 0, 255]);
});

test("uploads raw bytes with metadata from the query string", async () => {
  const app = makeApp();
  const res = await app.request("/api/assets?filename=trace.json&kind=trace", {
    method: "POST",
    headers: { "content-type": "application/json-not" }, // non-json -> raw path
    body: new Uint8Array([123, 125]),
  });
  // content-type header here is the asset's own type, not the request envelope
  const raw = await app.request("/api/assets?kind=file", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.equal(raw.status, 201);
  const asset = (await raw.json()) as any;
  assert.equal(asset.kind, "file");
  assert.equal(asset.byteLength, 3);
  assert.ok(res.status === 201);
});

test("non-inline types are served as attachments and html is neutered", async () => {
  const app = makeApp();
  const svg = (await (
    await app.request("/api/assets", json({ data: b64([60, 115]), contentType: "image/svg+xml" }))
  ).json()) as any;
  const svgRes = await app.request(`/a/${svg.id}`);
  assert.equal(svgRes.headers.get("content-type"), "image/svg+xml");
  assert.match(svgRes.headers.get("content-disposition") ?? "", /^attachment/);

  const html = (await (
    await app.request("/api/assets", json({ data: b64([60, 104]), contentType: "text/html" }))
  ).json()) as any;
  const htmlRes = await app.request(`/a/${html.id}`);
  assert.equal(htmlRes.headers.get("content-type"), "application/octet-stream");
  assert.match(htmlRes.headers.get("content-disposition") ?? "", /^attachment/);
});

test("rejects empty and oversized uploads", async () => {
  const app = makeApp();
  assert.equal(
    (await app.request("/api/assets", json({ data: "", contentType: "x" }))).status,
    400,
  );
  const big = b64(Array(5 * 1024 * 1024 + 1).fill(0));
  assert.equal(
    (await app.request("/api/assets", json({ data: big, contentType: "image/png" }))).status,
    413,
  );
});

test("rejects an oversize Content-Length before buffering the body", async () => {
  const app = makeApp();
  // A raw-bytes POST whose declared Content-Length exceeds the cap must 413
  // without reading the body — the handler checks the header first.
  const res = await app.request("/api/assets?kind=file", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(5 * 1024 * 1024 + 1),
    },
    body: new Uint8Array(0), // no bytes actually sent — the check fires first
  });
  assert.equal(res.status, 413);
  assert.match(((await res.json()) as any).error, /exceeds/);
});

test("caps a chunked upload with no Content-Length instead of buffering it", async () => {
  const app = makeApp();
  // A streamed body sends no Content-Length, so the header early-out can't fire.
  // The handler must stop reading once the byte cap is exceeded rather than
  // buffering the whole stream (an unauthenticated OOM). Prove it stopped by
  // counting how many 1 MiB chunks the stream was actually asked for: if it read
  // everything it would pull all 40; capped at 5 MiB it should stop near 6.
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled++;
      if (pulled > 40) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const res = await app.request(
    new Request("http://localhost/api/assets?kind=file", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  assert.equal(res.status, 413);
  assert.match(((await res.json()) as any).error, /exceeds/);
  assert.ok(pulled < 16, `read too much before capping: ${pulled} chunks`);
});

test("assembles a valid multi-chunk streamed upload and stores it intact", async () => {
  const app = makeApp();
  // A streamed body under the cap must be accepted and its chunks reassembled
  // in order — every other upload test sends a single chunk, so this is the only
  // cover for a multi-chunk body surviving the bodyLimit re-wrap. We read the
  // asset back and compare bytes so a wrong offset/order would fail loudly.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.enqueue(new Uint8Array([7, 8, 9]));
      controller.close();
    },
  });
  const res = await app.request(
    new Request("http://localhost/api/assets?kind=file", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  assert.equal(res.status, 201);
  const asset = (await res.json()) as any;
  assert.equal(asset.byteLength, 9);
  const served = await app.request(`/a/${asset.id}`);
  assert.deepEqual([...new Uint8Array(await served.arrayBuffer())], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("the global body cap rejects oversize JSON and MCP bodies", async () => {
  const app = makeApp();
  // Every write endpoint reads its body with an unbounded c.req.json(); the
  // global bodyLimit must refuse an oversize one with a 413 before it is read.
  // An over-cap Content-Length is the cheap path (no body buffered) — assert it
  // fires on a REST write endpoint and on /mcp, the two body-reading surfaces.
  const oversize = {
    "content-type": "application/json",
    "content-length": String(17 * 1024 * 1024),
  };
  const surfaces = await app.request("/api/surfaces", {
    method: "POST",
    headers: oversize,
    body: new Uint8Array(0), // no bytes sent — the Content-Length check fires first
  });
  assert.equal(surfaces.status, 413);
  const mcp = await app.request("/mcp", {
    method: "POST",
    headers: oversize,
    body: new Uint8Array(0),
  });
  assert.equal(mcp.status, 413);
});

test("uploading to an unknown session 404s; serving a missing asset 404s", async () => {
  const app = makeApp();
  const res = await app.request(
    "/api/assets",
    json({ data: b64([1]), contentType: "image/png", session: "nope" }),
  );
  assert.equal(res.status, 404);
  assert.equal((await app.request("/a/missing")).status, 404);
});

test("the surface CSP allows the server origin so assets embed by url", async () => {
  const app = makeApp();
  const snip = (await (
    await app.request("/api/snippets", json({ html: "<img src=/a/x>" }))
  ).json()) as any;
  const page = await (await app.request(`/s/${snip.id}`)).text();
  assert.match(page, /img-src https: data: blob: http:\/\/localhost/);
});

test("asset routes require auth when a token is set", async () => {
  const app = makeApp("secret");
  assert.equal(
    (await app.request("/api/assets", json({ data: b64([1]), contentType: "x" }))).status,
    401,
  );
  assert.equal((await app.request("/a/anything")).status, 401);
});

// --- URL routing: /session/:id and /session/:id/s/:surfaceId ---

test("/session/:id serves the viewer HTML", async () => {
  const app = makeApp();
  // create a session with a surface so the id is valid
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>x</p>", agent: "pi" }))
  ).json()) as any;
  const res = await app.request(`/session/${s.sessionId}`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/html"));
  const body = await res.text();
  assert.ok(body.includes("viewer"), "should serve the viewer document");
});

test("/session/:id/s/:surfaceId serves the viewer HTML", async () => {
  const app = makeApp();
  const s = (await (
    await app.request("/api/snippets", json({ html: "<p>x</p>", agent: "pi" }))
  ).json()) as any;
  const res = await app.request(`/session/${s.sessionId}/s/${s.id}`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/html"));
  const body = await res.text();
  assert.ok(body.includes("viewer"), "should serve the viewer document");
});

test("/session/:id serves viewer even for nonexistent session ids", async () => {
  const app = makeApp();
  // the SPA handles resolution; the server just serves the HTML
  const res = await app.request("/session/deadbeef");
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/html"));
});

test("/session routes require auth when a token is set", async () => {
  const app = makeApp("secret");
  assert.equal((await app.request("/session/abc123")).status, 401);
  assert.equal((await app.request("/session/abc123/s/def456")).status, 401);
  // with auth they serve the viewer
  const authed = await app.request("/session/abc123", {
    headers: { authorization: "Bearer secret" },
  });
  assert.equal(authed.status, 200);
  assert.ok((await authed.text()).includes("viewer"));
});

test("a parked wait_for_feedback marks the session as listening, cleared on reply", async () => {
  const app = makeApp();
  const session = (await (
    await app.request("/api/sessions", json({ agent: "claude-code" }))
  ).json()) as any;
  const surface = (await (
    await app.request(
      "/api/surfaces",
      json({ session: session.id, title: "P", parts: [{ kind: "markdown", markdown: "hi" }] }),
    )
  ).json()) as any;

  const listening = async () =>
    ((await (await app.request("/api/sessions")).json()) as any[]).find((s) => s.id === session.id)
      .listening;

  // Not listening before any agent parks a wait.
  assert.equal(await listening(), false);

  // Park an author=user long-poll (the wait_for_feedback path) without awaiting.
  const waiting = app.request(`/api/comments?session=${session.id}&author=user&wait=5`);
  await new Promise((r) => setTimeout(r, 60)); // let the waiter register
  assert.equal(await listening(), true);

  // A real (surfaced) user comment resolves the wait early; presence then clears.
  const t0 = Date.now();
  await app.request("/api/comments", json({ surface: surface.id, author: "user", text: "hi" }));
  await waiting;
  // The long-poll returned on the comment, not at the 5s timeout.
  assert.ok(Date.now() - t0 < 2000, "wait should resolve early on the comment");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await listening(), false);
});

test("an aborted wait_for_feedback stops counting toward presence", async () => {
  const app = makeApp();
  const session = (await (
    await app.request("/api/sessions", json({ agent: "claude-code" }))
  ).json()) as any;
  const ctrl = new AbortController();
  const waiting = Promise.resolve(
    app.request(`/api/comments?session=${session.id}&author=user&wait=30`, { signal: ctrl.signal }),
  ).catch(() => null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(
    ((await (await app.request("/api/sessions")).json()) as any[]).find((s) => s.id === session.id)
      .listening,
    true,
  );
  ctrl.abort();
  await waiting;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    ((await (await app.request("/api/sessions")).json()) as any[]).find((s) => s.id === session.id)
      .listening,
    false,
  );
});

test("a session-level comment (no surface) is accepted with a null surfaceId", async () => {
  const app = makeApp();
  const session = (await (
    await app.request("/api/sessions", json({ agent: "claude-code" }))
  ).json()) as any;
  const res = await app.request(
    "/api/comments",
    json({ session: session.id, author: "user", text: "what's the plan?" }),
  );
  assert.equal(res.status, 201);
  const c = (await res.json()) as any;
  assert.equal(c.surfaceId, null);
  assert.equal(c.sessionId, session.id);
});

test("a comment with neither surface nor session is rejected", async () => {
  const app = makeApp();
  const res = await app.request("/api/comments", json({ author: "user", text: "orphan" }));
  assert.equal(res.status, 400);
});

test("reply_to_user without surfaceId replies session-level (MCP HTTP)", async () => {
  const app = makeApp();
  const session = (await (
    await app.request("/api/sessions", json({ agent: "claude-code" }))
  ).json()) as any;
  const published = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "reply_to_user",
        arguments: { sessionId: session.id, message: "Here's the session-level answer." },
      }),
    )
  ).json()) as any;
  const payload = JSON.parse(published.result.content[0].text);
  assert.equal(payload.surfaceId, null);
  assert.equal(payload.sessionId, session.id);
  assert.equal(payload.author, "agent");
});

test("an anchored comment carries its anchor through to agent feedback", async () => {
  const app = makeApp();
  const surface = (await (
    await app.request(
      "/api/surfaces",
      json({ title: "S", parts: [{ kind: "markdown", markdown: "hi" }] }),
    )
  ).json()) as any;
  // The user pins a comment to a spot.
  await app.request(
    "/api/comments",
    json({
      surface: surface.id,
      author: "user",
      text: "about here",
      anchor: { xPct: 0.4, yPct: 0.6 },
    }),
  );
  // An agent reply piggybacks the pending feedback — which must include the anchor.
  const reply = (await (
    await app.request(
      "/api/comments",
      json({ surface: surface.id, author: "claude-code", text: "ack" }),
    )
  ).json()) as any;
  const fb = (reply.userFeedback ?? []).find((f: any) => f.text === "about here");
  assert.ok(fb, "the anchored comment was delivered as feedback");
  assert.deepEqual(fb.anchor, { xPct: 0.4, yPct: 0.6 });
});

test("a comment anchor is clamped to 0..1 and dropped when malformed or session-level", async () => {
  const app = makeApp();
  const surface = (await (
    await app.request(
      "/api/surfaces",
      json({ title: "S", parts: [{ kind: "markdown", markdown: "hi" }] }),
    )
  ).json()) as any;
  // out-of-range values clamp
  const clamped = (await (
    await app.request(
      "/api/comments",
      json({ surface: surface.id, author: "user", text: "a", anchor: { xPct: 1.5, yPct: -0.2 } }),
    )
  ).json()) as any;
  assert.deepEqual(clamped.anchor, { xPct: 1, yPct: 0 });
  // malformed anchor is ignored
  const bad = (await (
    await app.request(
      "/api/comments",
      json({ surface: surface.id, author: "user", text: "b", anchor: { xPct: "nope" } }),
    )
  ).json()) as any;
  assert.equal(bad.anchor, undefined);
  // an anchor with no surface (session-level) is dropped
  const sess = (await (
    await app.request(
      "/api/comments",
      json({
        session: surface.sessionId,
        author: "user",
        text: "c",
        anchor: { xPct: 0.5, yPct: 0.5 },
      }),
    )
  ).json()) as any;
  assert.equal(sess.anchor, undefined);
});

test("a diff line anchor is stored and delivered to the agent", async () => {
  const app = makeApp();
  const surface = (await (
    await app.request(
      "/api/surfaces",
      json({ title: "Review", parts: [{ kind: "diff", patch: "@@ -1 +1 @@\n-a\n+b" }] }),
    )
  ).json()) as any;

  const c = (await (
    await app.request(
      "/api/comments",
      json({
        surface: surface.id,
        author: "user",
        text: "off-by-one here",
        anchor: { line: 752, lineType: "addition" },
      }),
    )
  ).json()) as any;
  assert.deepEqual(c.anchor, { line: 752, lineType: "addition" });

  // A line anchor takes precedence over stray point fields, and an unknown
  // lineType is dropped (never coerced).
  const mixed = (await (
    await app.request(
      "/api/comments",
      json({
        surface: surface.id,
        author: "user",
        text: "this line",
        anchor: { line: 10, lineType: "bogus", xPct: 0.3, yPct: 0.3 },
      }),
    )
  ).json()) as any;
  assert.deepEqual(mixed.anchor, { line: 10 });

  // It rides the feedback channel to the agent like any anchor.
  const fb = (
    (await (
      await app.request(`/api/comments?session=${surface.sessionId}&author=user`)
    ).json()) as any
  ).comments.find((x: { text: string }) => x.text === "off-by-one here");
  assert.deepEqual(fb.anchor, { line: 752, lineType: "addition" });
});
