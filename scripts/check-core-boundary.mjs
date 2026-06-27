#!/usr/bin/env node
// Enforces the runtime-agnostic boundary of @showcase/core: it must not import
// any `node:` builtin. This is the package constraint the monorepo split makes
// checkable (TODO §6.A move 0) — keep it green so core can run in any runtime,
// not just Node. Run from the lint gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = fileURLToPath(new URL("../packages/core", import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const offenders = [];
// Matches `from "node:..."` and `import("node:...")` / `require("node:...")`.
const nodeImport = /(?:from|import|require)\s*\(?\s*["']node:[^"']+["']/;
for (const file of walk(coreDir)) {
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (nodeImport.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error("@showcase/core must not import node: builtins (it is runtime-agnostic):");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("core boundary OK — no node: imports in @showcase/core");
