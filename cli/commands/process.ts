// Process-management commands: run the surface in the foreground (`serve`), run
// the stdio MCP server (`mcp`), or install/remove it as an OS user service
// (`service`) so it starts on login and restarts on crash.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { SERVICE_LOG } from "../http.ts";
import { ROOT, ensureNodeCanRun, entrypoint } from "../runtime.ts";

const SERVICE_LABEL = "dev.showcase.server"; // launchd label / reverse-DNS id
const SERVICE_UNIT = "showcase.service"; // systemd unit name

const serve: Command = {
  name: "serve",
  group: "Run",
  summary: "start the surface (API + viewer)",
  usage: "showcase serve [--port N] [--open]",
  options: {
    port: { type: "string", placeholder: "N", desc: "port to listen on (default 8229)" },
    open: { type: "boolean", desc: "open the viewer in a browser once it's up" },
  },
  run({ flags }) {
    const port = flags.port ?? process.env.PORT ?? "8229";
    const entry = entrypoint("server", "index.ts");
    ensureNodeCanRun(entry);
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: { ...process.env, PORT: port },
    });
    if (flags.open) {
      const url = `http://localhost:${port}`;
      const { opener, openerArgs } =
        process.platform === "darwin"
          ? { opener: "open", openerArgs: [url] }
          : process.platform === "win32"
            ? { opener: "cmd", openerArgs: ["/c", "start", url] }
            : { opener: "xdg-open", openerArgs: [url] };
      setTimeout(() => spawn(opener, openerArgs, { stdio: "ignore" }), 700);
    }
    child.on("exit", (code) => process.exit(code ?? 0));
  },
};

const mcp: Command = {
  name: "mcp",
  group: "Run",
  summary: "run the stdio MCP server (for agent configs)",
  usage: "showcase mcp",
  run() {
    const entry = entrypoint("mcp", "server.ts");
    ensureNodeCanRun(entry);
    const child = spawn(process.execPath, [entry], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => process.exit(code ?? 0));
  },
};

const service: Command = {
  name: "service",
  group: "Run",
  summary: "install/uninstall/status the surface as a background OS service",
  usage: "showcase service <install|uninstall|status> [--port N]",
  positionals: true,
  options: { port: { type: "string", placeholder: "N", desc: "port to listen on (default 8229)" } },
  help: "Runs the surface as a launchd (macOS) / systemd --user (Linux) service: starts on login, restarts on crash, no babysat terminal tab.",
  run({ flags, positionals }) {
    const action = positionals[0];
    const port = flags.port ?? process.env.PORT ?? "8229";
    const cfg = serviceConfig(port);
    if (!cfg) {
      fail(
        `\`showcase service\` needs launchd (macOS) or systemd (Linux); ${process.platform} has neither.\n` +
          "  Run `showcase serve` in a background process/terminal multiplexer instead.",
      );
    }

    if (action === "install") {
      mkdirSync(dirname(cfg.path), { recursive: true });
      mkdirSync(dirname(SERVICE_LOG), { recursive: true });
      writeFileSync(cfg.path, cfg.content);
      for (const [cmd, args, opts] of cfg.load) {
        const res = run(cmd, args, { ...opts, soft: true });
        if (!res.ok && !opts?.soft) {
          rmSync(cfg.path, { force: true });
          fail(
            `${cmd} ${args.join(" ")} failed — ${res.out.trim() || "could not load the service"}`,
          );
        }
      }
      console.log(
        `showcase service installed (${cfg.kind}) → http://localhost:${port}\n` +
          `  unit:  ${cfg.path}\n` +
          `  logs:  ${SERVICE_LOG}\n` +
          `  it now starts on login and restarts on crash.\n` +
          (cfg.kind === "systemd"
            ? "  to keep it running after you log out: `loginctl enable-linger`\n"
            : "") +
          "  stop & remove it any time with: showcase service uninstall",
      );
      return;
    }

    if (action === "uninstall") {
      for (const [cmd, args, opts] of cfg.unload) run(cmd, args, opts);
      if (existsSync(cfg.path)) rmSync(cfg.path);
      console.log(`showcase service uninstalled (${cfg.kind}). The unit file was removed.`);
      return;
    }

    if (action === "status") {
      const installed = existsSync(cfg.path);
      const running = installed && cfg.isRunning();
      console.log(
        `showcase service (${cfg.kind}): ${
          !installed ? "not installed" : running ? "running" : "installed, not running"
        }\n` +
          `  unit:  ${cfg.path}${installed ? "" : " (missing)"}\n` +
          (running ? `  url:   http://localhost:${port}\n` : "") +
          `  logs:  ${SERVICE_LOG}`,
      );
      return;
    }

    fail("usage: showcase service <install|uninstall|status> [--port N]");
  },
};

// Escape the five XML entities so a home path with `&` or `<` can't corrupt the
// plist.
function xmlEscape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

interface ServiceCfg {
  kind: "launchd" | "systemd";
  path: string;
  content: string;
  load: [string, string[], { soft?: boolean }?][];
  unload: [string, string[], { soft?: boolean }?][];
  isRunning: () => boolean;
}

// Resolve the per-platform service facts: where the unit file lives, the loader
// commands, and how to read its running state. `null` on an unsupported
// platform (Windows has no launchd/systemd).
function serviceConfig(port: string): ServiceCfg | null {
  const entry = entrypoint("server", "index.ts");
  ensureNodeCanRun(entry);
  const exec = process.execPath;
  const home = homedir();
  if (process.platform === "darwin") {
    const path = join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(exec)}</string>
    <string>${xmlEscape(entry)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${port}</string>
    <key>PATH</key><string>${xmlEscape(dirname(exec))}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(SERVICE_LOG)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(SERVICE_LOG)}</string>
</dict>
</plist>
`;
    return {
      kind: "launchd",
      path,
      content,
      load: [
        ["launchctl", ["unload", path], { soft: true }],
        ["launchctl", ["load", "-w", path]],
      ],
      unload: [["launchctl", ["unload", "-w", path], { soft: true }]],
      isRunning: () => run("launchctl", ["list", SERVICE_LABEL], { soft: true }).ok,
    };
  }
  if (process.platform === "linux") {
    const path = join(home, ".config", "systemd", "user", SERVICE_UNIT);
    const content = `[Unit]
Description=showcase — live visual surface for terminal coding agents
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=PORT=${port}
ExecStart=${exec} ${entry}
StandardOutput=append:${SERVICE_LOG}
StandardError=append:${SERVICE_LOG}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
    return {
      kind: "systemd",
      path,
      content,
      load: [
        ["systemctl", ["--user", "daemon-reload"]],
        ["systemctl", ["--user", "enable", "--now", SERVICE_UNIT]],
      ],
      unload: [
        ["systemctl", ["--user", "disable", "--now", SERVICE_UNIT], { soft: true }],
        ["systemctl", ["--user", "daemon-reload"], { soft: true }],
      ],
      isRunning: () =>
        run("systemctl", ["--user", "is-active", "--quiet", SERVICE_UNIT], { soft: true }).ok,
    };
  }
  return null;
}

// Run a command, capturing success. `soft` swallows a non-zero exit so callers
// can probe/clean up without aborting the whole command.
function run(
  cmd: string,
  args: string[],
  { soft = false }: { soft?: boolean } = {},
): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (err: any) {
    if (!soft) fail(`${cmd} ${args.join(" ")} failed — ${err.stderr || err.message}`);
    return { ok: false, out: err.stderr || "" };
  }
}

export const processCommands: Command[] = [serve, mcp, service];
