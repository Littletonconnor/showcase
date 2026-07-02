// Learn-mode commands: publish a lesson from a typed JSON plan, inspect the
// mastery store, and surface the spaced-review queue (docs/learn-form-factor.md).
// Zero runtime deps, like every command.
import { defineCommand } from "../command.ts";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { api, BASE } from "../http.ts";
import { emit } from "../output.ts";
import { resolveSession } from "../session.ts";
import { readContent } from "../util.ts";

const lesson = defineCommand({
  name: "lesson",
  group: "Publish",
  summary: "publish a lesson (syllabus + concept beats) from a JSON plan",
  usage: "showcase lesson <file|-> [options]",
  positionals: true,
  options: {
    session: { type: "string", placeholder: "id", desc: "lesson session (default: auto)" },
    "session-title": { type: "string", placeholder: "t", desc: "session name on first publish" },
    agent: { type: "string", placeholder: "name", desc: "agent label (first publish only)" },
    "new-session": { type: "boolean", desc: "start a fresh session instead of reusing" },
  },
  help:
    "The plan is the typed Lesson shape (see docs/learn-form-factor.md): {topic, learnerLevel, " +
    "conceptGraph:{concepts,edges}, beats:[{conceptId, hook, model, workedExample, explorable, " +
    "checkpoints, recap}]}. The server owns the layout; checkpoints render as interactive cards " +
    "whose reveal stays hidden until the learner commits an attempt.",
  async run({ flags, positionals }) {
    if (!positionals[0] && process.stdin.isTTY) fail("usage: showcase lesson <file|->");
    let plan: Record<string, unknown>;
    try {
      plan = JSON.parse(readContent(positionals[0]));
    } catch {
      fail(`invalid lesson JSON${positionals[0] && positionals[0] !== "-" ? ` in ${positionals[0]}` : ""}`);
    }
    const session = await resolveSession(flags, { create: true });
    const result = await api("/api/lessons", {
      method: "POST",
      body: JSON.stringify({
        ...plan,
        session,
        sessionTitle: flags["session-title"],
        agent: flags.agent,
        cwd: process.cwd(),
      }),
    });
    emit(result, () => {
      const beats = (result.beats ?? []) as { surfaceId: string; conceptId: string }[];
      return [
        `Published lesson — ${BASE}/session/${result.sessionId}`,
        `  syllabus ${result.syllabusId}`,
        ...beats.map((b) => `  beat ${b.surfaceId}  (${b.conceptId})`),
      ].join("\n");
    });
  },
});

const reviewDue = defineCommand({
  name: "review-due",
  group: "Feedback",
  summary: "list concepts due for spaced review, interleaved across topics",
  usage: "showcase review-due [options]",
  options: {
    now: { type: "string", placeholder: "iso", desc: "compute dueness as of this time" },
  },
  help:
    "Paste the output to your agent to run a review session: it should generate FRESH variants of " +
    "the due checkpoints (same concept, new surface context), never replay old questions verbatim.",
  async run({ flags }) {
    const q = flags.now ? `?now=${encodeURIComponent(flags.now)}` : "";
    const result = await api(`/api/review-due${q}`);
    const due = (result.due ?? []) as {
      topic: string;
      conceptId: string;
      label: string;
      state: string;
      overdueDays: number;
      misconceptions: string[];
    }[];
    emit(result, () => {
      if (due.length === 0) return "Nothing due for review.";
      return due
        .map(
          (d) =>
            `${d.topic} / ${d.label} (${d.conceptId}) — ${d.state}, ` +
            `${d.overdueDays === 0 ? "due today" : `${d.overdueDays}d overdue`}` +
            (d.misconceptions.length > 0 ? `, missed on: ${d.misconceptions.join("; ")}` : ""),
        )
        .join("\n");
    });
  },
});

const mastery = defineCommand({
  name: "mastery",
  group: "Feedback",
  summary: "inspect (or reset) the per-topic mastery store",
  usage: "showcase mastery [topic]\nshowcase mastery reset <topic>",
  positionals: true,
  async run({ positionals }) {
    if (positionals[0] === "reset") {
      const topic = positionals[1];
      if (!topic) fail("usage: showcase mastery reset <topic>");
      await api(`/api/mastery/${encodeURIComponent(topic)}`, { method: "DELETE" });
      emit({ ok: true, topic }, `Reset mastery for "${topic}".`);
      return;
    }
    const q = positionals[0] ? `?topic=${encodeURIComponent(positionals[0])}` : "";
    const result = await api(`/api/mastery${q}`);
    const topics = (result.topics ?? []) as {
      topic: string;
      concepts: { id: string; label: string; state: string; attempts?: number; dueAt?: string }[];
    }[];
    emit(result, () => {
      if (topics.length === 0) return "No mastery data yet — publish a lesson first.";
      return topics
        .map(
          (t) =>
            `${t.topic}\n` +
            t.concepts
              .map(
                (c) =>
                  `  ${c.state.padEnd(9)} ${c.label} (${c.id})` +
                  (c.attempts ? `  ${c.attempts} attempts, due ${c.dueAt?.slice(0, 10)}` : ""),
              )
              .join("\n"),
        )
        .join("\n\n");
    });
  },
});

export const learnCommands: Command[] = [lesson, reviewDue, mastery];
