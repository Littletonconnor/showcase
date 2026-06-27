// CLI entry: pick the command, parse its args, run it. `bin/showcase.js` calls
// run() after confirming the node version can type-strip this source.
import { parseCommand } from "./command.ts";
import { fail, suggest } from "./errors.ts";
import { renderTopLevelHelp } from "./help.ts";
import { commands, findCommand } from "./registry.ts";

export async function run(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;

  if (!name || name === "help" || name === "--help" || name === "-h") {
    console.log(renderTopLevelHelp(commands));
    return;
  }

  const cmd = findCommand(name);
  if (!cmd) {
    const hint = suggest(
      name,
      commands.filter((c) => !c.hidden).map((c) => c.name),
    );
    fail(
      `unknown command "${name}"${hint ? ` — did you mean "${hint}"?` : ""} — run "showcase help"`,
    );
  }

  const ctx = parseCommand(cmd, rest);
  await cmd.run(ctx);
}
