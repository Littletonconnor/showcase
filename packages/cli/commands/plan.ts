// The blocking plan-review loop (plannotator's founding feature, showcase-
// shaped). A PreToolUse hook on ExitPlanMode publishes the plan to the board
// as a markdown surface, opens the browser, and BLOCKS while the user
// annotates (anchored comments) and submits a verdict — Approve plan or
// Request changes, the footer verbs the "Plan review" badge unlocks. The
// verdict returns in-band in the hook response: approve allows the tool call;
// request-changes denies it with the annotation batch as the reason, so the
// agent revises and calls ExitPlanMode again — the review reopens on the SAME
// surface as a new version. The agent cannot miss the feedback and nothing
// polls after the fact.
//
// Failure posture: the hook must never break plan mode. Board unreachable,
// malformed input, review timeout — all exit 0 with no output, which hands
// Claude Code back to its normal permission flow.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "../browser.ts";
import { defineCommand } from "../command.ts";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { BASE, ensureServerUp, TOKEN } from "../http.ts";
import { emit } from "../output.ts";

const PLAN_AGENT = "plan-review";
const APPROVE_SIGNAL = "[plan] approve";
const CHANGES_SIGNAL = "[plan] request-changes";
// Leniency for the footer reply line: a typed verdict works too.
const APPROVE_WORDS = /^(lgtm|approved?|ship it)$/i;

// Quiet client: unlike api(), a failure returns null instead of exiting —
// the hook degrades silently. Still auto-starts a local server, so plan
// review "just works" with no babysat tab.
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
// exact scope the reviewer pointed at.
function annotationLine(c: {
  text?: string;
  anchor?: { file?: string; line?: number; quote?: string };
}): string {
  const a = c.anchor ?? {};
  const where = [a.file, a.line !== undefined ? `line ${a.line}` : null].filter(Boolean).join(" ");
  const quote = typeof a.quote === "string" && a.quote ? `"${a.quote}"` : "";
  const scope = [where, quote].filter(Boolean).join(" ");
  return scope ? `- ${scope}: ${c.text ?? ""}` : `- ${c.text ?? ""}`;
}

export interface PlanOutcome {
  decision: "approve" | "request-changes" | "timeout";
  notes: string[];
  url: string;
}

// Publish (or re-version) the plan surface and block until a verdict lands.
// Returns null when the board can't be reached — the caller degrades.
async function runPlanReview(plan: string): Promise<PlanOutcome | null> {
  const cwd = process.cwd();
  const sessions = await quiet("/api/sessions");
  if (!Array.isArray(sessions)) return null;
  let session = sessions.find((s: any) => s.agent === PLAN_AGENT && s.cwd === cwd);
  session ??= await quiet("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent: PLAN_AGENT,
      title: `Plan review — ${cwd.split(/[\\/]/).pop() ?? "repo"}`,
      cwd,
    }),
  });
  if (!session) return null;

  // Drain the cursor so a leftover comment from an abandoned round can never
  // approve or deny THIS plan.
  await quiet(`/api/comments?session=${session.id}&author=user&wait=0`);

  // One surface per session, re-versioned each round — the reviewer's tab
  // live-updates in place, and the version dropdown holds the history.
  const content = {
    title: planTitle(plan),
    parts: [{ kind: "markdown", markdown: plan }],
    badge: { tone: "info", label: "Plan review" },
  };
  const existing = await quiet(`/api/sessions/${session.id}/surfaces`);
  const current = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
  const surface = current
    ? await quiet(`/api/surfaces/${current.id}`, { method: "PUT", body: JSON.stringify(content) })
    : await quiet("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({ ...content, session: session.id }),
      });
  if (!surface) return null;
  const url = `${BASE}/session/${session.id}/s/${surface.id}`;
  // Open only on round 1 — on a revise the reviewer's tab is already open and
  // live-updates over SSE.
  if (!current) openBrowser(url);

  const ceiling = Math.max(30, Number(process.env.SHOWCASE_PLAN_TIMEOUT ?? 1800) || 1800);
  const deadline = Date.now() + ceiling * 1000;
  const notes: string[] = [];
  while (Date.now() < deadline) {
    const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
    const result = await quiet(`/api/comments?session=${session.id}&author=user&wait=${chunk}`);
    if (!result) return null; // server vanished mid-review — degrade
    for (const comment of result.comments ?? []) {
      const text = String(comment.text ?? "").trim();
      if (text === APPROVE_SIGNAL || APPROVE_WORDS.test(text))
        return { decision: "approve", notes, url };
      if (text === CHANGES_SIGNAL) return { decision: "request-changes", notes, url };
      notes.push(annotationLine(comment));
    }
  }
  return { decision: "timeout", notes, url };
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
  help: "Publishes the plan as a markdown surface (badge: Plan review), opens the browser, and blocks until the footer verdict lands: Approve plan or Request changes (annotations ride along). Exit code 0 = approved, 2 = changes requested, 3 = timed out (SHOWCASE_PLAN_TIMEOUT seconds, default 1800). Claude Code users: `showcase install-plan-hook` wires this into ExitPlanMode so it happens automatically.",
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
      // The hook's own ceiling (1800s) + slack, so Claude Code doesn't kill a
      // review the user is still reading.
      hooks: [{ type: "command", command, timeout: 1860 }],
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

export const planCommands: Command[] = [plan, planHook, installPlanHook];
