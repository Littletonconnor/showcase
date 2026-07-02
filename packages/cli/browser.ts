// Fire-and-forget the platform browser opener. Detached + unref'd so the
// short-lived CLI never waits on it, and failures are swallowed — the caller
// prints the URL, which is the useful output either way. SHOWCASE_NO_OPEN=1
// skips the launch entirely (scripts, tests).
import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  if (process.env.SHOWCASE_NO_OPEN) return;
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // the "" fills start's window-title slot so the URL isn't eaten as a title
          ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // opener missing (e.g. no xdg-open) — nothing to do, the URL is printed
    });
    child.unref();
  } catch {
    // same: never let a broken opener fail the command
  }
}
