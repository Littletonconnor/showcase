// `showcase completions <bash|zsh|install>` — generate or install shell
// completion scripts. The scripts are derived from the live command registry
// (command names + each command's flags), so completions never drift from the
// actual CLI surface. Loaded lazily inside run() to avoid a registry import
// cycle.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command, OptionSpecs } from "../command.ts";
import { GLOBAL_OPTIONS } from "../command.ts";
import { fail } from "../errors.ts";

type Shell = "bash" | "zsh";

function flagsFor(cmd: Command): string[] {
  const specs: OptionSpecs = { ...cmd.options, ...GLOBAL_OPTIONS };
  return Object.keys(specs).map((name) => `--${name}`);
}

function bashScript(commands: Command[]): string {
  const names = commands
    .filter((c) => !c.hidden)
    .map((c) => c.name)
    .join(" ");
  const cases = commands.map((c) => `    ${c.name}) opts="${flagsFor(c).join(" ")}" ;;`).join("\n");
  return `# showcase bash completion
_showcase() {
  local cur cmd opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names}" -- "$cur") )
    return
  fi
  cmd="\${COMP_WORDS[1]}"
  case "$cmd" in
${cases}
    *) opts="--help --json" ;;
  esac
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
}
complete -F _showcase showcase
`;
}

function zshScript(commands: Command[]): string {
  const described = commands
    .filter((c) => !c.hidden)
    .map((c) => `    '${c.name}:${c.summary.replace(/'/g, "")}'`)
    .join("\n");
  const cases = commands
    .map(
      (c) =>
        `      ${c.name}) opts=(${flagsFor(c)
          .map((f) => `'${f}'`)
          .join(" ")}) ;;`,
    )
    .join("\n");
  return `#compdef showcase
_showcase() {
  local -a commands opts
  commands=(
${described}
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
${cases}
      *) opts=('--help' '--json') ;;
  esac
  compadd -- \${opts}
}
_showcase "$@"
`;
}

function detectShell(): Shell | null {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  return null;
}

function completionFile(shell: Shell): string {
  const dir = join(homedir(), ".config", "showcase", "completions");
  return join(dir, shell === "bash" ? "showcase.bash" : "_showcase");
}

function shellConfig(shell: Shell): string {
  const home = homedir();
  if (shell === "zsh") return join(home, ".zshrc");
  const profile = join(home, ".bash_profile");
  return process.platform === "darwin" && existsSync(profile) ? profile : join(home, ".bashrc");
}

function sourceLine(shell: Shell): string {
  const file = completionFile(shell);
  if (shell === "bash")
    return `\n# showcase shell completions\n[ -f "${file}" ] && source "${file}"\n`;
  const dir = join(homedir(), ".config", "showcase", "completions");
  return `\n# showcase shell completions\nfpath=(${dir} $fpath)\nautoload -Uz compinit && compinit\n`;
}

function install(shell: Shell, commands: Command[]): void {
  const file = completionFile(shell);
  const script = shell === "bash" ? bashScript(commands) : zshScript(commands);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, script, { mode: 0o644 });
  const config = shellConfig(shell);
  const already =
    existsSync(config) && readFileSync(config, "utf8").includes("showcase shell completions");
  if (!already) appendFileSync(config, sourceLine(shell));
  console.log(
    `installed ${shell} completions → ${file}\n` +
      (already ? `  ${config} already sources them` : `  added a source line to ${config}`) +
      `\n  restart your shell or run: source ${config}`,
  );
}

const completions: Command = {
  name: "completions",
  group: "Setup",
  summary: "generate or install shell completions (bash|zsh)",
  usage: "showcase completions <bash|zsh|install [bash|zsh]>",
  positionals: true,
  help: [
    "  showcase completions bash            print the bash completion script",
    "  showcase completions zsh             print the zsh completion script",
    "  showcase completions install         auto-detect the shell and install",
    "  showcase completions install zsh     install for a specific shell",
    "",
    "Or source directly: source <(showcase completions bash)",
  ].join("\n"),
  async run({ positionals }) {
    const { commands } = await import("../registry.ts");
    const [action, arg] = positionals;
    if (action === "bash") return void console.log(bashScript(commands));
    if (action === "zsh") return void console.log(zshScript(commands));
    if (action === "install") {
      const shell = (arg as Shell) ?? detectShell();
      if (shell !== "bash" && shell !== "zsh") {
        fail("could not detect shell — run: showcase completions install <bash|zsh>");
      }
      return install(shell, commands);
    }
    fail("usage: showcase completions <bash|zsh|install [bash|zsh]>");
  },
};

export const completionsCommands: Command[] = [completions];
