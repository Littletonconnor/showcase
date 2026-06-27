// Sharing a session outside the live board: a self-contained `.html` (or a flat
// PDF) export, and `decisions`, which publishes a decision-queue review.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { Command } from "../command.ts";
import { fail } from "../errors.ts";
import { api, BASE, TOKEN } from "../http.ts";
import { emit } from "../output.ts";

const exportCmd: Command = {
  name: "export",
  group: "Share",
  summary: "write a self-contained, shareable .html of a session",
  usage: "showcase export <session> [--out file] [--pdf]",
  positionals: true,
  options: {
    out: {
      type: "string",
      placeholder: "file",
      desc: "output path (default: showcase-<session>.html)",
    },
    pdf: { type: "boolean", desc: "render the HTML to a flat PDF via headless Chrome" },
  },
  help: "Set SHOWCASE_CHROME to point --pdf at a specific Chrome/Chromium binary.",
  async run({ flags, positionals }) {
    const session = positionals[0];
    if (!session) fail("usage: showcase export <session> [--out <file>] [--pdf]");
    let res: Response;
    try {
      // The PDF path asks for the flattened export (?flatten=1): rich parts
      // render inline so they paginate across page breaks instead of being
      // stranded/clipped in iframes Chrome can't split.
      const url =
        `${BASE}/api/sessions/${encodeURIComponent(session)}/export` +
        (flags.pdf ? "?flatten=1" : "");
      res = await fetch(url, { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} });
    } catch {
      fail(`server not reachable at ${BASE} — start it with: showcase serve`);
    }
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      fail(body.error ?? `${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const suggested =
      res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `showcase-${session}.html`;

    if (!flags.pdf) {
      const file = flags.out ?? suggested;
      writeFileSync(file, html);
      emit(
        { session, file, bytes: html.length, format: "html" },
        `wrote ${file} (${html.length} bytes)`,
      );
      return;
    }

    const chrome = findChrome();
    if (!chrome) {
      fail(
        "no Chrome/Chromium found for --pdf — install Chrome or set SHOWCASE_CHROME=/path/to/chrome",
      );
    }
    const file = flags.out ?? suggested.replace(/\.html$/i, ".pdf");
    const dir = mkdtempSync(join(tmpdir(), "showcase-pdf-"));
    const tmpHtml = join(dir, "page.html");
    writeFileSync(tmpHtml, html);
    try {
      execFileSync(
        chrome,
        [
          "--headless",
          "--disable-gpu",
          "--no-pdf-header-footer",
          // Let async rendering (mermaid, the iframe resize bridge) settle before
          // the page is printed, so nothing prints half-laid-out.
          "--virtual-time-budget=8000",
          `--print-to-pdf=${file}`,
          `file://${tmpHtml}`,
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch (e: any) {
      fail(`Chrome failed to render the PDF: ${e.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!existsSync(file)) fail("Chrome ran but produced no PDF");
    emit({ session, file, format: "pdf" }, `wrote ${file}`);
  },
};

const decisions: Command = {
  name: "decisions",
  group: "Share",
  summary: "publish a decision-queue review (JSON) for a session",
  usage: "showcase decisions <session> <file|->",
  positionals: true,
  help: "View the published review at <url>/?review=<session>.",
  async run({ positionals }) {
    const session = positionals[0];
    const file = positionals[1];
    if (!session || !file) fail("usage: showcase decisions <session> <file.json|->");
    let body: string;
    try {
      body = readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (e: any) {
      fail(`can't read ${file}: ${e.message}`);
    }
    const review = await api(`/api/sessions/${encodeURIComponent(session)}/review`, {
      method: "POST",
      body,
    });
    const url = `${BASE}/?review=${encodeURIComponent(session)}`;
    emit(
      { session, decisions: review.decisions.length, url },
      `published ${review.decisions.length} decisions\n  ${url}`,
    );
  },
};

// Locate a Chrome/Chromium binary for `export --pdf`. $SHOWCASE_CHROME wins;
// otherwise probe the usual install paths per platform, then PATH for a bare
// command name. Returns null if none is found.
function findChrome(): string | null {
  if (process.env.SHOWCASE_CHROME) return process.env.SHOWCASE_CHROME;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            join(
              process.env.PROGRAMFILES ?? "C:/Program Files",
              "Google/Chrome/Application/chrome.exe",
            ),
            join(
              process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
              "Google/Chrome/Application/chrome.exe",
            ),
          ]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const c of candidates) {
    if (c.includes("/") || c.includes("\\")) {
      if (existsSync(c)) return c;
    } else {
      try {
        const found = execFileSync(process.platform === "win32" ? "where" : "which", [c], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .split("\n")[0];
        if (found) return found;
      } catch {}
    }
  }
  return null;
}

export const shareCommands: Command[] = [exportCmd, decisions];
