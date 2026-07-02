// Local-setup peeks: tail the shared server log (`logs`) and jump a browser to
// the active session (`open`).
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { openBrowser } from "../browser.ts";
import { defineCommand } from "../command.ts";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { BASE, SERVICE_LOG } from "../http.ts";
import { emit } from "../output.ts";
import { resolveSession } from "../session.ts";

const logs = defineCommand({
  name: "logs",
  group: "Inspect",
  summary: "print the server log (autostart and the OS service share one file)",
  usage: "showcase logs [--lines N] [--follow]",
  options: {
    lines: { type: "string", placeholder: "N", desc: "trailing lines to print (default 50)" },
    follow: { type: "boolean", short: "f", desc: "keep streaming appended lines (Ctrl-C exits)" },
  },
  help: "Reads ~/.showcase/server.log — where both the auto-started server and `showcase service install` log. --follow streams and ignores --json.",
  run({ flags }) {
    // NaN would slice(-NaN) to an empty tail — a silent wrong answer.
    if (flags.lines !== undefined && !/^\d+$/.test(flags.lines)) {
      fail(`--lines must be a number (got "${flags.lines}")`);
    }
    const n = Math.max(1, Number(flags.lines ?? 50));
    let text: string;
    try {
      text = readFileSync(SERVICE_LOG, "utf8");
    } catch {
      console.log(
        `no log yet at ${SERVICE_LOG} — one appears when a publish auto-starts the server or after \`showcase service install\`.`,
      );
      return;
    }
    const all = text.split("\n");
    if (all.at(-1) === "") all.pop();
    const tail = all.slice(-n);
    if (!flags.follow) {
      emit({ file: SERVICE_LOG, lines: tail }, () => tail.join("\n"));
      return;
    }
    if (tail.length > 0) console.log(tail.join("\n"));
    // Poll from the last byte offset rather than fs.watch: same behavior on
    // every platform/filesystem, and a truncated (rotated) file just resets.
    let offset = Buffer.byteLength(text);
    setInterval(() => {
      let size: number;
      try {
        size = statSync(SERVICE_LOG).size;
      } catch {
        return; // file vanished — keep waiting for it to come back
      }
      if (size < offset) offset = 0;
      if (size === offset) return;
      const fd = openSync(SERVICE_LOG, "r");
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      offset = size;
      process.stdout.write(buf.toString("utf8"));
    }, 300);
  },
});

const open = defineCommand({
  name: "open",
  group: "Inspect",
  summary: "open the board in a browser at the active session",
  usage: "showcase open [--session id]",
  options: {
    session: { type: "string", placeholder: "id", desc: "session to open (default: active)" },
  },
  help: "Prints the URL either way; set SHOWCASE_NO_OPEN=1 to skip launching a browser (scripts, CI).",
  async run({ flags }) {
    const session = await resolveSession(flags);
    const url = session ? `${BASE}/session/${session}` : BASE;
    openBrowser(url);
    emit({ url }, url);
  },
});

export const inspectCommands: Command[] = [logs, open];
