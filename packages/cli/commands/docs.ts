// The agent-facing docs the CLI can print: the surface design contract
// (`guide`), the AGENTS.md integration block (`setup`), and the publishing
// recipe (`playbook`). Each prefers the running server's copy, falling back to
// the checked-in markdown when offline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { BASE } from "../http.ts";
import { ROOT } from "../runtime.ts";

async function fetchTextWithFallback(path: string, localFile: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.ok) return await res.text();
  } catch {}
  try {
    return readFileSync(localFile, "utf8");
  } catch {
    fail(
      `server not reachable at ${BASE} and no local copy at ${localFile} — start it with: showcase serve`,
    );
  }
}

function docCommand(
  name: string,
  summary: string,
  path: string,
  localFile: string,
  hidden = false,
): Command {
  return {
    name,
    group: "Learn",
    summary,
    usage: `showcase ${name}`,
    hidden,
    async run() {
      // ROOT is packages/ in a dev checkout; guide/ lives at the repo root.
      console.log(await fetchTextWithFallback(path, join(ROOT, "..", "guide", localFile)));
    },
  };
}

export const docsCommands: Command[] = [
  docCommand("guide", "print the design contract for surfaces", "/guide", "DESIGN_GUIDE.md"),
  docCommand("setup", "print the AGENTS.md integration block", "/setup", "AGENT_SETUP.md"),
  docCommand("playbook", "print the agent publishing playbook", "/playbook", "PLAYBOOK.md"),
  // Back-compat alias for the old command name.
  docCommand("agent-howto", "alias for `playbook`", "/playbook", "PLAYBOOK.md", true),
];
