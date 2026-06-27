// The single command registry. Order here is the order groups' commands appear
// in `showcase help`; grouping/labels live on each Command.
import type { Command } from "./command.ts";
import { processCommands } from "./commands/process.ts";
import { publishCommands } from "./commands/publish.ts";
import { feedbackCommands } from "./commands/feedback.ts";
import { boardCommands } from "./commands/board.ts";
import { shareCommands } from "./commands/share.ts";
import { docsCommands } from "./commands/docs.ts";
import { completionsCommands } from "./commands/completions.ts";

export const commands: Command[] = [
  ...processCommands,
  ...publishCommands,
  ...feedbackCommands,
  ...boardCommands,
  ...shareCommands,
  ...docsCommands,
  ...completionsCommands,
];

export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name);
}
