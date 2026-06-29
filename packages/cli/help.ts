// Help rendering, generated from the command registry and each command's
// option spec — both the top-level overview and per-command `--help`.
import type { Command, OptionSpec, OptionSpecs } from "./command.ts";

const GROUP_ORDER = [
  "Run",
  "Publish",
  "Revise",
  "Feedback",
  "Inspect",
  "Manage",
  "Share",
  "Learn",
  "Setup",
];

const HEADER = "showcase — a live visual surface for terminal coding agents";

const ENVIRONMENT = `environment:
  SHOWCASE_URL      server base URL (default http://localhost:8229; set to a
                    deployed instance, e.g. https://showcase.example.com)
  SHOWCASE_TOKEN    bearer token for a deployed instance
  SHOWCASE_SESSION  fixed session id (overrides auto-detection)
  SHOWCASE_AGENT    agent name used when creating sessions`;

// Align a list of [left, right] rows into an indented two-column block, sizing
// the left column to its widest entry. One formatter for every table in the
// help output (the command index and each command's option list) so they share
// a layout instead of each hand-rolling padEnd with a guessed width. Pass
// `width` to align across several blocks (the command index sizes once so every
// group lines up); omit it to size each block to its own contents.
function column(rows: [string, string][], width?: number): string {
  const w = width ?? Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(w)}  ${right}`).join("\n");
}

// `showcase` / `showcase help`: the grouped command index.
export function renderTopLevelHelp(commands: Command[]): string {
  const visible = commands.filter((c) => !c.hidden);
  const groups = new Map<string, Command[]>();
  for (const c of visible) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  const order = [...GROUP_ORDER, ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g))];

  // Size the command column once across every group so all summaries line up.
  const width = Math.max(...visible.map((c) => commandSignature(c).length));
  const sections: string[] = [];
  for (const group of order) {
    const cmds = groups.get(group);
    if (!cmds) continue;
    const rows = cmds.map((c) => [commandSignature(c), c.summary] as [string, string]);
    sections.push(`${group.toLowerCase()}:\n${column(rows, width)}`);
  }

  return [
    HEADER,
    "",
    "usage: showcase <command> [options]   (run `showcase <command> --help` for details)",
    "",
    sections.join("\n\n"),
    "",
    ENVIRONMENT,
    "",
  ].join("\n");
}

// `showcase <command> --help`: usage line, options table, extended prose.
export function renderCommandHelp(cmd: Command, specs: OptionSpecs): string {
  const out: string[] = [`usage: ${cmd.usage ?? `showcase ${commandSignature(cmd)}`}`];
  if (cmd.summary) out.push("", cmd.summary);

  const optionRows = Object.entries(specs)
    .filter(([, spec]) => spec.desc)
    .map(([name, spec]) => [optionSignature(name, spec), spec.desc!] as [string, string]);
  if (optionRows.length > 0) out.push("", "options:", column(optionRows));

  if (cmd.help) out.push("", cmd.help.trim());
  out.push("");
  return out.join("\n");
}

// "publish <file|-> [options]" — the name plus its positional/usage hint, used
// in both the index and the per-command usage line.
function commandSignature(cmd: Command): string {
  if (cmd.usage) return cmd.usage.replace(/^showcase\s+/, "");
  return cmd.positionals ? `${cmd.name} [args]` : cmd.name;
}

function optionSignature(name: string, spec: OptionSpec): string {
  const lead = spec.short ? `-${spec.short}, --${name}` : `    --${name}`;
  return spec.type === "string" ? `${lead} <${spec.placeholder ?? "value"}>` : lead;
}
