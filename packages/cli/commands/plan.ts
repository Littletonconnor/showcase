// Blocking artifact review — plannotator's founding loop, showcase-shaped,
// with one shared engine behind two commands:
//
//   `plan` / `plan-hook`  — the ExitPlanMode PreToolUse hook: the plan opens
//     on the board, the agent BLOCKS, and the verdict returns in the hook
//     response (approve → allow; request-changes → deny with the annotation
//     batch). A revision round re-versions the SAME card and adds a diff of
//     what changed since the last review, so round 2 reads as a delta.
//   `annotate`            — the generic gate for ANY artifact (markdown, code,
//     or html rendered LIVE with pin-anywhere): publish, block, verdict.
//     `--hook` emits the hook-native contract ({"decision":"block","reason"}
//     on annotations, empty stdout on approve/timeout, always exit 0) so it
//     drops into Stop / PostToolUse recipes; plain mode exits 0/2/3.
//
// Failure posture everywhere: the loop must never break the agent. Board
// unreachable, malformed input, review timeout — degrade silently (hook) or
// say so and exit (plain), never wedge.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "../browser.ts";
import { defineCommand } from "../command.ts";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { BASE, ensureServerUp, TOKEN } from "../http.ts";
import { emit, isJson, printJson } from "../output.ts";
import { inferLang } from "../util.ts";

const APPROVE_SIGNAL = "[plan] approve";
const CHANGES_SIGNAL = "[plan] request-changes";
// Leniency for the footer reply line: a typed verdict works too.
const APPROVE_WORDS = /^(lgtm|approved?|ship it)$/i;
// Reviews take as long as the human takes (plannotator blocks for days) —
// default four hours; SHOWCASE_PLAN_TIMEOUT overrides. On expiry the hook
// defers to the normal permission flow, so a long ceiling costs nothing.
const DEFAULT_CEILING_S = 14400;
export const HOOK_TIMEOUT_S = DEFAULT_CEILING_S + 60;

// Quiet client: unlike api(), a failure returns null instead of exiting —
// the hook degrades silently. Still auto-starts a local server, so review
// "just works" with no babysat tab.
async function quiet(path: string, init: RequestInit = {}): Promise<any | null> {
  const send = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
  let res = await send().catch(() => null);
  if (!res && (await ensureServerUp())) res = await send().catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

function planTitle(plan: string): string {
  const heading = plan.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return heading ? `Plan: ${heading.slice(0, 80)}` : "Plan review";
}

// One annotation as a line the agent can act on — anchored comments carry the
// exact scope the reviewer pointed at, suggestions carry the proposed edit.
function annotationLine(c: {
  text?: string;
  anchor?: { file?: string; line?: number; quote?: string; pos?: { x: number; y: number } };
  suggestion?: { before?: string; after?: string };
}): string {
  const a = c.anchor ?? {};
  const where = [
    a.file,
    a.line !== undefined ? `line ${a.line}` : null,
    a.pos ? `at ${a.pos.x}%, ${a.pos.y}%` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const quote = typeof a.quote === "string" && a.quote ? `"${a.quote}"` : "";
  const scope = [where, quote].filter(Boolean).join(" ");
  const suggestion = c.suggestion
    ? ` [suggested edit: "${c.suggestion.before ?? ""}" → "${c.suggestion.after ?? ""}"]`
    : "";
  const body = `${c.text ?? ""}${suggestion}`;
  return scope ? `- ${scope}: ${body}` : `- ${body}`;
}

// Same line for the piggyback shape (feedbackView), where the anchor arrives
// pre-formatted as a string.
function feedbackLine(f: {
  text?: string;
  anchor?: string;
  suggestion?: { before?: string; after?: string };
}): string {
  const suggestion = f.suggestion
    ? ` [suggested edit: "${f.suggestion.before ?? ""}" → "${f.suggestion.after ?? ""}"]`
    : "";
  const body = `${f.text ?? ""}${suggestion}`;
  return f.anchor ? `- ${f.anchor}: ${body}` : `- ${body}`;
}

export interface PlanOutcome {
  decision: "approve" | "request-changes" | "timeout";
  notes: string[];
  url: string;
}

interface GateSpec {
  agent: string; // session key per cwd
  sessionTitle: string;
  badgeLabel: string; // unlocks the footer verdict verbs
  // Pick this artifact's surface within the session (annotate keeps one card
  // per file); null → create fresh.
  matchSurface: (list: any[]) => any | null;
  // Build title+parts, seeing the previous round's full surface so a revision
  // can carry a what-changed diff.
  build: (previous: { title?: string; parts?: any[] } | null) => {
    title: string;
    parts: unknown[];
  };
}

// Publish (or re-version) the gated surface and block until a verdict lands.
// Returns null when the board can't be reached — the caller degrades.
async function runGatedReview(spec: GateSpec): Promise<PlanOutcome | null> {
  const cwd = process.cwd();
  const sessions = await quiet("/api/sessions");
  if (!Array.isArray(sessions)) return null;
  let session = sessions.find((s: any) => s.agent === spec.agent && s.cwd === cwd);
  session ??= await quiet("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ agent: spec.agent, title: spec.sessionTitle, cwd }),
  });
  if (!session) return null;

  // Drain the cursor so a leftover comment from an abandoned round can never
  // approve or deny THIS review.
  await quiet(`/api/comments?session=${session.id}&author=user&wait=0`);

  const existing = await quiet(`/api/sessions/${session.id}/surfaces`);
  const match = Array.isArray(existing) ? spec.matchSurface(existing) : null;
  // The previous round's full content, so build() can diff against it.
  const previous = match ? await quiet(`/api/surfaces/${match.id}`) : null;
  const content = {
    ...spec.build(previous),
    badge: { tone: "info", label: spec.badgeLabel },
  };
  const surface = match
    ? await quiet(`/api/surfaces/${match.id}`, { method: "PUT", body: JSON.stringify(content) })
    : await quiet("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({ ...content, session: session.id }),
      });
  if (!surface) return null;
  const url = `${BASE}/session/${session.id}/s/${surface.id}`;
  // Open only on round 1 — on a revise the reviewer's tab is already open and
  // live-updates over SSE.
  if (!match) openBrowser(url);

  const notes: string[] = [];
  const consume = (list: any[], line: (item: any) => string): PlanOutcome | null => {
    for (const item of list) {
      const text = String(item.text ?? "").trim();
      if (text === APPROVE_SIGNAL || APPROVE_WORDS.test(text))
        return { decision: "approve", notes, url };
      if (text === CHANGES_SIGNAL) return { decision: "request-changes", notes, url };
      notes.push(line(item));
    }
    return null;
  };
  // Comments that land while the publish is in flight ride back on ITS
  // response (the piggyback is exactly-once) — dropping them would eat a
  // verdict or an annotation and park the review until the ceiling.
  const early = consume(surface.userFeedback ?? [], feedbackLine);
  if (early) return early;

  const ceiling = Math.max(
    30,
    Number(process.env.SHOWCASE_PLAN_TIMEOUT ?? DEFAULT_CEILING_S) || DEFAULT_CEILING_S,
  );
  const deadline = Date.now() + ceiling * 1000;
  while (Date.now() < deadline) {
    const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
    const result = await quiet(`/api/comments?session=${session.id}&author=user&wait=${chunk}`);
    if (!result) return null; // server vanished mid-review — degrade
    const outcome = consume(result.comments ?? [], annotationLine);
    if (outcome) return outcome;
  }
  return { decision: "timeout", notes, url };
}

// A revision round shows WHAT CHANGED since the reviewer's last verdict — the
// delta is the thing they need to re-read, not the whole document again. The
// diff part brings line comments + moved-code labels along for free.
function withRevisionDiff(
  parts: unknown[],
  previousText: string | undefined,
  nextText: string,
  filename: string,
): unknown[] {
  if (!previousText || previousText === nextText) return parts;
  return [...parts, { kind: "diff", files: [{ filename, before: previousText, after: nextText }] }];
}

function runPlanReview(plan: string): Promise<PlanOutcome | null> {
  const cwd = process.cwd();
  return runGatedReview({
    agent: "plan-review",
    sessionTitle: `Plan review — ${cwd.split(/[\\/]/).pop() ?? "repo"}`,
    badgeLabel: "Plan review",
    matchSurface: (list) => (list.length > 0 ? list[0] : null),
    build: (previous) => {
      const prevMd = previous?.parts?.find((p: any) => p.kind === "markdown")?.markdown as
        | string
        | undefined;
      return {
        title: planTitle(plan),
        parts: withRevisionDiff([{ kind: "markdown", markdown: plan }], prevMd, plan, "plan.md"),
      };
    },
  });
}

// The artifact gate: markdown reads as prose, html renders LIVE (sandboxed,
// pin-anywhere and the locate round-trip both work on it), anything else is
// highlighted source.
function artifactParts(name: string, text: string): { parts: unknown[]; sourceText?: string } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "md" || ext === "markdown" || name === "stdin") {
    return { parts: [{ kind: "markdown", markdown: text }], sourceText: text };
  }
  if (ext === "html" || ext === "htm") {
    // Live render only — a source diff of a mockup is noise; the reviewer
    // sees the new version render in place.
    return { parts: [{ kind: "html", html: text }] };
  }
  const language = inferLang(name);
  return {
    parts: [{ kind: "code", code: text, title: name, ...(language ? { language } : {}) }],
    sourceText: text,
  };
}

function runAnnotateReview(file: string, text: string): Promise<PlanOutcome | null> {
  const name = file === "-" ? "stdin" : (file.split(/[\\/]/).pop() ?? file);
  const title = `Review: ${name}`;
  const cwd = process.cwd();
  return runGatedReview({
    agent: "annotate",
    sessionTitle: `Annotations — ${cwd.split(/[\\/]/).pop() ?? "repo"}`,
    badgeLabel: "Review",
    // One card per artifact, re-versioned per round.
    matchSurface: (list) => list.find((s: any) => s.title === title) ?? null,
    build: (previous) => {
      const { parts, sourceText } = artifactParts(name, text);
      const prev = previous?.parts?.find((p: any) => p.kind === "markdown" || p.kind === "code") as
        | { markdown?: string; code?: string }
        | undefined;
      return {
        title,
        parts: sourceText
          ? withRevisionDiff(parts, prev?.markdown ?? prev?.code, sourceText, name)
          : parts,
      };
    },
  });
}

// The PreToolUse hook body. Reads Claude Code's hook payload from stdin and
// returns the hook JSON to print, or null for "no output" (defer to the
// normal permission flow).
export async function planHookMain(stdin: string): Promise<object | null> {
  let payload: any;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return null;
  }
  const plan = payload?.tool_input?.plan;
  if (payload?.tool_name !== "ExitPlanMode" || typeof plan !== "string" || !plan.trim()) {
    return null;
  }
  let outcome: PlanOutcome | null = null;
  try {
    outcome = await runPlanReview(plan);
  } catch {
    return null;
  }
  if (!outcome || outcome.decision === "timeout") return null;
  if (outcome.decision === "approve") {
    return {
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          outcome.notes.length > 0
            ? `Plan approved on showcase, with notes:\n${outcome.notes.join("\n")}`
            : "Plan approved on showcase",
      },
    };
  }
  const notes =
    outcome.notes.length > 0
      ? outcome.notes.join("\n")
      : "- (no written notes — ask what should change)";
  return {
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `The user reviewed the plan on showcase and requests changes:\n${notes}\n` +
        "Revise the plan and call ExitPlanMode again — the review reopens with the new version.",
    },
  };
}

const planHook = defineCommand({
  name: "plan-hook",
  group: "Feedback",
  hidden: true,
  summary: "PreToolUse hook body for ExitPlanMode (hook JSON on stdin)",
  usage: "showcase plan-hook",
  async run() {
    const out = await planHookMain(readFileSync(0, "utf8"));
    if (out) console.log(JSON.stringify(out));
  },
});

const plan = defineCommand({
  name: "plan",
  group: "Feedback",
  summary:
    "publish a plan for blocking review — annotate in the browser, then approve or request changes",
  usage: "showcase plan <file|->",
  positionals: true,
  help: "Publishes the plan as a markdown surface (badge: Plan review), opens the browser, and blocks until the footer verdict lands: Approve plan or Request changes (annotations ride along). A revision round re-versions the same card and adds a what-changed diff. Exit code 0 = approved, 2 = changes requested, 3 = timed out (SHOWCASE_PLAN_TIMEOUT seconds, default 14400). Claude Code users: `showcase install-plan-hook` wires this into ExitPlanMode so it happens automatically.",
  async run({ positionals }) {
    const src = positionals[0];
    if (!src) fail("usage: showcase plan <file|->  (- reads the plan from stdin)");
    let text: string;
    try {
      text = readFileSync(src === "-" ? 0 : src, "utf8");
    } catch {
      fail(`cannot read ${src === "-" ? "stdin" : src}`);
    }
    if (!text.trim()) fail("the plan is empty");
    const outcome = await runPlanReview(text);
    if (!outcome) fail(`server not reachable at ${BASE} — start it with: showcase serve`);
    emit(outcome, () => {
      const head =
        outcome.decision === "approve"
          ? "Plan approved."
          : outcome.decision === "request-changes"
            ? "Changes requested:"
            : "Review timed out — no verdict.";
      return [head, ...outcome.notes].join("\n");
    });
    if (outcome.decision === "request-changes") process.exitCode = 2;
    if (outcome.decision === "timeout") process.exitCode = 3;
  },
});

const annotate = defineCommand({
  name: "annotate",
  group: "Feedback",
  summary: "gate any artifact on a blocking review — markdown, code, or LIVE html",
  usage: "showcase annotate <file|-> [--hook]",
  positionals: true,
  options: {
    hook: {
      type: "boolean",
      desc: 'agent-hook mode: {"decision":"block","reason":…} on annotations, silent approve, exit 0',
    },
  },
  help: `Publishes the file for review (markdown → prose, .html → a LIVE sandboxed render with pin-anywhere, anything else → highlighted source), opens the browser, and blocks for the footer verdict. A re-run for the same file re-versions its card with a what-changed diff.

Plain mode exits 0 (approved) / 2 (changes requested, notes printed) / 3 (timeout). --json emits {"decision":"approved"|"request-changes"|"timeout", notes}. --hook emits the agent-hook contract on stdout and ALWAYS exits 0: approve/timeout print nothing (the hook passes), annotations print {"decision":"block","reason":"<the notes>"} so the agent is blocked and fed the feedback.

Recipes (Claude Code settings.json):
  gate every file the agent writes (PostToolUse on Write):
    { "matcher": "Write", "hooks": [{ "type": "command",
      "command": "showcase annotate \\"$CLAUDE_TOOL_INPUT_file_path\\" --hook", "timeout": ${HOOK_TIMEOUT_S} }] }`,
  async run({ positionals, flags }) {
    const src = positionals[0];
    if (!src) fail("usage: showcase annotate <file|->  (- reads from stdin)");
    let text: string;
    try {
      text = readFileSync(src === "-" ? 0 : src, "utf8");
    } catch {
      if (flags.hook) return; // hooks never break the agent
      fail(`cannot read ${src === "-" ? "stdin" : src}`);
    }
    if (!text.trim()) {
      if (flags.hook) return;
      fail("the artifact is empty");
    }
    let outcome: PlanOutcome | null = null;
    try {
      outcome = await runAnnotateReview(src, text);
    } catch {
      outcome = null;
    }
    if (flags.hook) {
      // The stdout contract: silence passes the hook; a block carries the notes.
      if (outcome?.decision === "request-changes") {
        const reason =
          `The user annotated ${src === "-" ? "the artifact" : src} on showcase:\n` +
          (outcome.notes.join("\n") || "- (no written notes — ask what should change)");
        console.log(JSON.stringify({ decision: "block", reason }));
      }
      return;
    }
    if (!outcome) fail(`server not reachable at ${BASE} — start it with: showcase serve`);
    if (isJson()) {
      printJson({ decision: outcome.decision, notes: outcome.notes, url: outcome.url });
    } else {
      const head =
        outcome.decision === "approve"
          ? "Approved."
          : outcome.decision === "request-changes"
            ? "Changes requested:"
            : "Review timed out — no verdict.";
      console.log([head, ...outcome.notes].join("\n"));
    }
    if (outcome.decision === "request-changes") process.exitCode = 2;
    if (outcome.decision === "timeout") process.exitCode = 3;
  },
});

const installPlanHook = defineCommand({
  name: "install-plan-hook",
  group: "Setup",
  summary: "wire ExitPlanMode plan review into Claude Code (.claude/settings.json)",
  usage: "showcase install-plan-hook [--user]",
  options: {
    user: {
      type: "boolean",
      desc: "install into ~/.claude/settings.json instead of this repo's .claude/",
    },
  },
  help: "Adds a PreToolUse hook on ExitPlanMode that runs `showcase plan-hook`: the plan opens on the board, the agent blocks, and your verdict (Approve plan / Request changes, plus anchored notes) returns in the hook response. Pinned to the node binary running this install so the hook survives an old default node. Restart Claude Code after installing.",
  async run({ flags }) {
    const dir = flags.user ? join(homedir(), ".claude") : join(process.cwd(), ".claude");
    const file = join(dir, "settings.json");
    let settings: any = {};
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // missing or unparseable → start fresh (an unparseable file is preserved
      // below only by refusing to clobber it)
      try {
        readFileSync(file);
        fail(`${file} exists but is not valid JSON — fix it, then re-run`);
      } catch (e) {
        if ((e as { code?: string }).code !== "ENOENT") throw e;
      }
    }
    if (typeof settings !== "object" || settings === null) settings = {};
    settings.hooks ??= {};
    settings.hooks.PreToolUse ??= [];
    const already = settings.hooks.PreToolUse.some((entry: any) =>
      (entry?.hooks ?? []).some((h: any) => String(h?.command ?? "").includes("plan-hook")),
    );
    if (already) {
      emit(
        { file, installed: false, reason: "already installed" },
        `plan-review hook already installed in ${file}`,
      );
      return;
    }
    // Pin the exact node + bin running this install: hooks execute under the
    // user's login shell, where the default node may be too old to type-strip.
    const command = `"${process.execPath}" "${process.argv[1]}" plan-hook`;
    settings.hooks.PreToolUse.push({
      matcher: "ExitPlanMode",
      // The hook's own ceiling + slack, so Claude Code doesn't kill a review
      // the user is still reading.
      hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }],
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    emit({ file, installed: true, command }, () =>
      [
        `Installed the plan-review hook → ${file}`,
        "ExitPlanMode now opens the plan on the board and blocks for your verdict:",
        "annotate, then Approve plan or Request changes in the card footer.",
        "Restart Claude Code to pick it up.",
      ].join("\n"),
    );
  },
});

export const planCommands: Command[] = [plan, annotate, planHook, installPlanHook];
