// Read-only inspection of the board (list surfaces, sessions, kits,
// blueprints) plus `demo`, which seeds example sessions to explore the viewer.
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { api, BASE } from "../http.ts";
import { emit } from "../output.ts";
import { resolveSession } from "../session.ts";
import { formatBytes, formatDuration } from "../util.ts";

// One-line board tally, shared by `board` and `gc`'s post-sweep summary.
function statusLine(s: any): string {
  const a = s.assets;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    plural(s.sessions, "session"),
    plural(s.surfaces, "surface"),
    plural(s.comments, "comment"),
    plural(s.reviews, "review"),
    `${plural(a.count, "asset")} (${formatBytes(a.bytes)} / ${formatBytes(s.assetBudgetBytes)})`,
  ];
  if (a.orphaned > 0) parts.push(`${a.orphaned} orphaned (${formatBytes(a.orphanedBytes)})`);
  return parts.join(" · ");
}

const list: Command = {
  name: "list",
  group: "Inspect",
  summary: "list surfaces in the active (or a given) session",
  usage: "showcase list [--session id | --all]",
  options: {
    session: { type: "string", placeholder: "id", desc: "session to list (default: active)" },
    all: { type: "boolean", desc: "list every session's surfaces" },
  },
  async run({ flags }) {
    if (flags.all) {
      const sessions = await api("/api/sessions");
      const result: any[] = [];
      for (const s of sessions) {
        result.push({ ...s, surfaces: await api(`/api/sessions/${s.id}/surfaces`) });
      }
      emit(result, () =>
        result
          .map(
            (s: any) =>
              `${s.title ?? s.id} (${s.surfaces.length} surface${s.surfaces.length === 1 ? "" : "s"})`,
          )
          .join("\n"),
      );
      return;
    }
    const session = flags.session ?? (await resolveSession(flags));
    if (!session) fail("no active session — pass --session or --all");
    const surfaces = await api(`/api/sessions/${session}/surfaces`);
    emit(surfaces, () =>
      surfaces.length === 0
        ? "(no surfaces)"
        : surfaces
            .map(
              (s: any) =>
                `${s.id}  ${s.title ?? "(untitled)"}${s.version > 1 ? `  v${s.version}` : ""}`,
            )
            .join("\n"),
    );
  },
};

const sessions: Command = {
  name: "sessions",
  group: "Inspect",
  summary: "list sessions",
  usage: "showcase sessions",
  async run() {
    const all = await api("/api/sessions");
    emit(all, () =>
      all.length === 0
        ? "(no sessions)"
        : all
            .map((s: any) => `${s.id}  ${s.title ?? "(untitled)"}  [${s.agent ?? "agent"}]`)
            .join("\n"),
    );
  },
};

const kits: Command = {
  name: "kits",
  group: "Inspect",
  summary: "list the opt-in html kits this board offers",
  usage: "showcase kits",
  async run() {
    const all = await api("/api/kits");
    emit(all, () => all.map((k: any) => `${k.id}  —  ${k.summary ?? k.label ?? ""}`).join("\n"));
  },
};

const blueprints: Command = {
  name: "blueprints",
  group: "Inspect",
  summary: "list the explainer blueprint presets this board offers",
  usage: "showcase blueprints",
  async run() {
    const all = await api("/api/blueprints");
    emit(all, () => all.map((b: any) => `${b.id}  —  ${b.summary ?? b.label ?? ""}`).join("\n"));
  },
};

const demo: Command = {
  name: "demo",
  group: "Inspect",
  summary: "seed example sessions to explore the viewer",
  usage: "showcase demo",
  async run() {
    const { DEMO_SESSIONS } = await import(new URL("../demoData.js", import.meta.url).href);
    for (const d of DEMO_SESSIONS) {
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agent: d.agent, title: d.title }),
      });
      // A review session seeds a decision-queue review; a visualization session
      // seeds surfaces.
      if (d.review) {
        await api(`/api/sessions/${session.id}/review`, {
          method: "POST",
          body: JSON.stringify(d.review),
        });
        continue;
      }
      for (const snip of d.snippets) {
        const snippet = snip.parts
          ? await api("/api/surfaces", {
              method: "POST",
              body: JSON.stringify({
                session: session.id,
                title: snip.title,
                parts: snip.parts,
                badge: snip.badge,
                theme: snip.theme,
              }),
            })
          : await api("/api/snippets", {
              method: "POST",
              body: JSON.stringify({ session: session.id, title: snip.title, html: snip.html }),
            });
        for (const step of snip.followups ?? []) {
          if (step.update) {
            await api(`/api/snippets/${snippet.id}`, {
              method: "PUT",
              body: JSON.stringify(step.update),
            });
          }
          if (step.comment) {
            await api("/api/comments", {
              method: "POST",
              body: JSON.stringify({ snippet: snippet.id, ...step.comment }),
            });
          }
        }
      }
    }
    console.log(`Seeded ${DEMO_SESSIONS.length} demo sessions — open ${BASE} to look around.`);
  },
};

const board: Command = {
  name: "board",
  group: "Inspect",
  summary: "show board size — sessions, surfaces, assets, orphaned slack",
  usage: "showcase board",
  async run() {
    const stats = await api("/api/board");
    emit(stats, () => statusLine(stats));
  },
};

const health: Command = {
  name: "health",
  group: "Inspect",
  summary: "liveness check — uptime, version, board tally, last error",
  usage: "showcase health",
  async run() {
    const h = await api("/api/health");
    emit(h, () => {
      const head = `${h.status} · up ${formatDuration(h.uptimeMs)}${h.version ? ` · v${h.version}` : ""}`;
      const lines = [head, statusLine(h.board)];
      if (h.lastError) lines.push(`last error: ${h.lastError.message} (${h.lastError.at})`);
      return lines.join("\n");
    });
  },
};

const gc: Command = {
  name: "gc",
  group: "Manage",
  summary: "reclaim orphaned assets no surface references",
  usage: "showcase gc [--dry-run]",
  options: {
    "dry-run": { type: "boolean", desc: "report what would be reclaimed without deleting" },
  },
  async run({ flags }) {
    if (flags["dry-run"]) {
      const stats = await api("/api/board");
      emit({ ...stats, dryRun: true }, () => {
        const { orphaned, orphanedBytes } = stats.assets;
        return orphaned === 0
          ? `Nothing to reclaim — ${statusLine(stats)}`
          : `Would reclaim ${orphaned} orphaned asset${orphaned === 1 ? "" : "s"} (${formatBytes(orphanedBytes)}).\n${statusLine(stats)}`;
      });
      return;
    }
    const result = await api("/api/board/gc", { method: "POST" });
    emit(result, () => {
      const head =
        result.removed === 0
          ? "Nothing to reclaim — no orphaned assets."
          : `Reclaimed ${result.removed} orphaned asset${result.removed === 1 ? "" : "s"}, freed ${formatBytes(result.bytesFreed)}.`;
      return `${head}\n${statusLine(result.stats)}`;
    });
  },
};

export const boardCommands: Command[] = [list, sessions, kits, blueprints, board, health, gc, demo];
