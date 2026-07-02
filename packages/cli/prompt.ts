// Guard an irreversible action behind explicit confirmation. `--yes` proceeds
// silently; an interactive TTY gets a y/N prompt; a non-interactive run (an
// agent or a pipe) refuses rather than guess — nothing irreversible happens
// without an explicit go-ahead. The prompt goes to stderr so it never pollutes
// the --json result on stdout.
import { createInterface } from "node:readline";
import type { OptionSpecs } from "./command.ts";
import { fail } from "./errors.ts";

// The flags that pair with confirm(): spread into a destructive command's
// options so --yes parses, completes, and shows in help like any other.
export const CONFIRM_OPTS = {
  yes: { type: "boolean", short: "y", desc: "skip the confirmation prompt" },
} satisfies OptionSpecs;

export async function confirm(message: string, flags: { yes?: boolean }): Promise<void> {
  if (flags.yes) return;
  if (!process.stdin.isTTY) {
    fail(
      `${message}\n  refusing without confirmation — pass --yes to proceed, or --dry-run to preview`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer: string = await new Promise((resolve) =>
    rl.question(`${message} Continue? [y/N] `, resolve),
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail("aborted");
}
