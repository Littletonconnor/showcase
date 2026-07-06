// Shared JSON-file persistence: the atomic tmp+rename write with a .bak
// mirror of the last good state, and the live -> .bak read fallback. The two
// stores keep their own recovery policies as call-site choices: the board
// reads "strict" (a corrupt .bak is fatal), mastery reads "lenient" (derived
// data must never crash a session; fall back to empty).

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Write atomically, then mirror to .bak. The copy happens AFTER the rename, so
// the backup only ever holds validated data and can't be poisoned by a corrupt
// live file — readJsonFile recovers from it if the live file is later lost or
// truncated.
export async function writeJsonFile(filePath: string, data: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, filePath);
  await copyFile(filePath, `${filePath}.bak`);
}

// Read the live file, falling back to the .bak mirror when the live one is
// missing or corrupt. A missing file (fresh store) is never an error; returns
// null when neither exists so the caller starts empty.
export async function readJsonFile<T>(
  filePath: string,
  policy: "strict" | "lenient",
): Promise<T | null> {
  const bak = `${filePath}.bak`;
  for (const path of [filePath, bak]) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") continue;
      if (policy === "strict") throw err;
      console.error(`showcase: cannot read ${path} (${err?.message}) — starting empty`);
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      if (path === bak) {
        if (policy === "strict") throw err;
        console.error(`showcase: ${path} is unreadable — starting empty`);
        return null;
      }
      console.error(`showcase: ${path} is unreadable, recovering from ${bak}`);
    }
  }
  return null;
}
