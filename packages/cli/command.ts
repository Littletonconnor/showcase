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

// Options every command accepts, merged into each parse. `satisfies` (not an
// annotation) keeps the literal spec types FlagsOf derives flag types from.
const GLOBAL_OPTIONS = {
  json: { type: "boolean", desc: "print the raw JSON result instead of a human summary" },
  help: { type: "boolean", short: "h", desc: "show this command's help" },
} satisfies OptionSpecs;

// What parseArgs hands back for one spec. The last arm is the fallback for a
// spec only known as the widened OptionSpec (e.g. a plain `Command`).
type FlagValue<S extends OptionSpec> = S extends { type: "boolean" }
  ? S extends { multiple: true }
    ? boolean[]
    : boolean
  : S extends { multiple: true }
    ? string[]
    : S extends { type: "string" }
      ? string
      : string | boolean | string[];

// The flags run() receives, derived from the command's option specs plus the
// globals. All optional: an unset flag parses to undefined.
export type FlagsOf<O extends OptionSpecs> = {
  [K in keyof (O & typeof GLOBAL_OPTIONS)]?: FlagValue<(O & typeof GLOBAL_OPTIONS)[K]>;
};

export interface CommandContext<O extends OptionSpecs = OptionSpecs> {
  flags: FlagsOf<O>;
  positionals: string[];
}

export interface Command<O extends OptionSpecs = OptionSpecs> {
  name: string;
  group: string;
  summary: string; // one line, shown in the top-level command list
  usage?: string; // the `usage:` line(s); defaults to `showcase <name>`
  options?: O;
  positionals?: boolean;
  help?: string; // extended prose under the options in per-command help
  hidden?: boolean; // kept out of the top-level list (aliases, internals)
  run(ctx: CommandContext<O>): Promise<void> | void;
}

// Identity helper whose `const` type parameter captures the literal option
// spec, so run() sees per-flag types — a mistyped flag name or a wrong-type
// read is a compile error instead of a silent undefined.
export function defineCommand<const O extends OptionSpecs = Record<never, never>>(
  cmd: Command<O>,
): Command<O> {
  return cmd;
}

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
  // parseArgs types values as (string | boolean)[]-capable; our specs only
  // ever produce string[] for `multiple`, so narrow at the one boundary.
  return { flags: parsed.values as CommandContext["flags"], positionals: parsed.positionals };
}

export { GLOBAL_OPTIONS };
