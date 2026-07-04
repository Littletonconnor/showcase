// The agent's side of the feedback loop: block until the user comments
// (`wait`), or stream every new comment forever for a background monitor
// (`watch`). Both read with author=user and resume from the server-side agent
// cursor so a comment is delivered exactly once across wait/watch/piggyback.
import { defineCommand } from "../command.ts";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { api, BASE, TOKEN } from "../http.ts";
import { emit, isJson } from "../output.ts";
import { resolveSession, resolveSessionByCwd } from "../session.ts";
import { sleep, watchLine } from "../util.ts";

const wait = defineCommand({
  name: "wait",
  group: "Feedback",
  summary: "block until the user comments (long-poll)",
  usage: "showcase wait [options]",
  options: {
    session: { type: "string", placeholder: "id", desc: "session to watch (default: auto)" },
    timeout: { type: "string", placeholder: "sec", desc: "max seconds to wait (default 120)" },
    after: { type: "string", placeholder: "seq", desc: "re-read comments after this cursor" },
  },
  async run({ flags }) {
    const session = await resolveSession(flags);
    if (!session) fail("no active session — publish something first, or pass --session");
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    // NaN would make the deadline NaN and skip the poll loop entirely — a
    // false "no feedback" answer without ever asking the server.
    if (flags.timeout !== undefined && !/^\d+$/.test(flags.timeout)) {
      fail(`--timeout must be a number of seconds (got "${flags.timeout}")`);
    }
    const timeout = Math.max(1, Number(flags.timeout ?? 120));
    const deadline = Date.now() + timeout * 1000;
    let cursor = flags.after;
    let result: { comments: any[]; lastSeq?: string } = { comments: [] };
    while (Date.now() < deadline && result.comments.length === 0) {
      const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
      const afterParam = cursor === undefined ? "" : `&after=${cursor}`;
      result = await api(`/api/comments?session=${session}&author=user${afterParam}&wait=${chunk}`);
      cursor = result.lastSeq;
    }
    if (result.comments.length > 0) {
      emit({ comments: result.comments }, () => result.comments.map(watchLine).join("\n"));
    } else {
      emit(
        { comments: [], timedOut: true, hint: "no user feedback yet — run wait again or continue" },
        "no user feedback yet — run `showcase wait` again or continue",
      );
    }
  },
});

const watch = defineCommand({
  name: "watch",
  group: "Feedback",
  summary: "stream each new user comment forever, one per line",
  usage: "showcase watch [options]",
  options: {
    session: { type: "string", placeholder: "id", desc: "session to watch (default: auto)" },
    after: { type: "string", placeholder: "seq", desc: "re-read comments after this cursor" },
  },
  help: "A continuous long-poll for a background monitor: re-arms forever, backs off on transient network errors, and never exits on its own.",
  async run({ flags }) {
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    let firstAfter = flags.after;
    for (;;) {
      const session = (await resolveSession(flags)) ?? (await resolveSessionByCwd());
      if (!session) {
        await sleep(2000);
        continue;
      }
      let result: { comments?: any[] };
      try {
        const afterParam = firstAfter === undefined ? "" : `&after=${firstAfter}`;
        const res = await fetch(
          `${BASE}/api/comments?session=${session}&author=user${afterParam}&wait=60`,
          { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} },
        );
        if (!res.ok) {
          await sleep(2000);
          continue;
        }
        result = (await res.json()) as { comments?: any[] };
      } catch {
        await sleep(2000);
        continue;
      }
      firstAfter = undefined;
      // --json is the global scripting contract: one JSON object per line
      // (JSONL) so a monitor can pipe into jq instead of parsing prose.
      for (const c of result.comments ?? []) {
        console.log(isJson() ? JSON.stringify(c) : watchLine(c));
      }
    }
  },
});

// The agent's half of an anchored thread: answer a comment (by id, from
// wait/watch output) so the reply renders in the thread at the user's anchor.
const reply = defineCommand({
  name: "reply",
  group: "Feedback",
  summary: "reply to a user's comment in its thread on the board",
  usage: "showcase reply <text> [--to commentId] [--surface id]",
  positionals: true,
  options: {
    to: { type: "string", placeholder: "id", desc: "comment id being answered (from wait/watch)" },
    surface: { type: "string", placeholder: "id", desc: "surface to comment on (no thread)" },
    session: { type: "string", placeholder: "id", desc: "session (default: auto)" },
    agent: { type: "string", placeholder: "name", desc: "author label (default: agent)" },
  },
  async run({ flags, positionals }) {
    const text = positionals.join(" ").trim();
    if (!text) fail('usage: showcase reply "your answer" --to <commentId>');
    const session = flags.to || flags.surface ? undefined : await resolveSession(flags);
    if (!flags.to && !flags.surface && !session) {
      fail("no thread target — pass --to <commentId>, --surface <id>, or have an active session");
    }
    const result = await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({
        text,
        replyTo: flags.to,
        surface: flags.surface,
        session,
        author: flags.agent ?? "agent",
      }),
    });
    emit(result, () => `Replied${result.replyTo ? ` in thread ${result.replyTo}` : ""}.`);
  },
});

export const feedbackCommands: Command[] = [wait, watch, reply];
