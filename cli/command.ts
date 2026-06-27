// The command contract + the per-command argument parser. A command declares
// its options once (type, short, description, placeholder); from that single
// spec we derive Node's parseArgs config, the per-command `--help`, and the
// shell completions — so the three never drift apart.
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { fail, suggest } from "./errors.ts";
import { renderCommandHelp } from "./help.ts";
import { setJsonMode } from "./output.ts";

export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
  default?: string | boolean;
  // Help-only metadata (stripped before reaching parseArgs).
  placeholder?: string;
  desc?: string;
}

export type OptionSpecs = Record<string, OptionSpec>;

export interface CommandContext {
  flags: Record<string, any>;
  positionals: string[];
}

export interface Command {
  name: string;
  group: string;
  summary: string; // one line, shown in the top-level command list
  usage?: string; // the `usage:` line(s); defaults to `showcase <name>`
  options?: OptionSpecs;
  positionals?: boolean;
  help?: string; // extended prose under the options in per-command help
  hidden?: boolean; // kept out of the top-level list (aliases, internals)
  run(ctx: CommandContext): Promise<void> | void;
}

// Options every command accepts, merged into each parse.
const GLOBAL_OPTIONS: OptionSpecs = {
  json: { type: "boolean", desc: "print the raw JSON result instead of a human summary" },
  help: { type: "boolean", short: "h", desc: "show this command's help" },
};

// Derive the parseArgs `options` map from our richer specs (drop help-only
// fields parseArgs would reject).
function toParseArgsOptions(specs: OptionSpecs): NonNullable<ParseArgsConfig["options"]> {
  const out: NonNullable<ParseArgsConfig["options"]> = {};
  for (const [name, spec] of Object.entries(specs)) {
    out[name] = {
      type: spec.type,
      ...(spec.short ? { short: spec.short } : {}),
      ...(spec.multiple ? { multiple: true } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
    };
  }
  return out;
}

// Parse one command's argv. Prints help and exits 0 on `--help`; fails with a
// one-line message (and a "did you mean" hint) on a bad flag. Returns the
// parsed flags + positionals on success.
export function parseCommand(cmd: Command, argv: string[]): CommandContext {
  const specs: OptionSpecs = { ...cmd.options, ...GLOBAL_OPTIONS };
  const options = toParseArgsOptions(specs);
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (err: unknown) {
    const code = String((err as { code?: string })?.code ?? "");
    if (!code.startsWith("ERR_PARSE_ARGS")) throw err;
    const message = (err as Error).message;
    const unknown = message.match(/Unknown option '(--[^']+)'/);
    if (unknown) {
      const hint = suggest(unknown[1], Object.keys(specs), "--");
      if (hint) fail(`Unknown option '${unknown[1]}'. Did you mean ${hint}? — run "showcase help"`);
    }
    fail(`${message.split(". ")[0]} — run "showcase help"`);
  }
  if (parsed.values.help) {
    console.log(renderCommandHelp(cmd, specs));
    process.exit(0);
  }
  setJsonMode(Boolean(parsed.values.json));
  return { flags: parsed.values, positionals: parsed.positionals };
}

export { GLOBAL_OPTIONS };
