import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JsonFileStore } from "@showcase/server/storage";
import { htmlPart } from "@showcase/core/types";
import { runStoreContract } from "./storeContract.ts";

const freshPath = () => join(mkdtempSync(join(tmpdir(), "showcase-store-")), "data.json");

runStoreContract("JsonFileStore", () => new JsonFileStore(freshPath()));

test("JsonFileStore: concurrent first calls share one disk load", async () => {
  const path = freshPath();
  const seed = new JsonFileStore(path);
  const persisted = await seed.createSession({ agent: "old", title: "Persisted" });

  const cold = new JsonFileStore(path);
  const [, created] = await Promise.all([
    cold.listSessions(),
    cold.createSession({ agent: "new", title: "Concurrent" }),
  ]);

  const reloaded = new JsonFileStore(path);
  const sessions = await reloaded.listSessions();
  assert.deepEqual(new Set(sessions.map((s) => s.id)), new Set([persisted.id, created.id]));
});

test("JsonFileStore: data survives a reload from disk", async () => {
  const path = freshPath();
  const store = new JsonFileStore(path);
  const session = await store.createSession({ agent: "pi", title: "Persisted" });
  const surface = await store.createSurface({
    sessionId: session.id,
    parts: [htmlPart("<p>x</p>")],
  });
  await store.updateSurface(surface?.id ?? "", { parts: [htmlPart("<p>v2</p>")] });
  await store.createComment({
    sessionId: session.id,
    surfaceId: surface?.id,
    author: "user",
    text: "hi",
  });

  await store.markAgentSeen(session.id, 1);

  const reloaded = new JsonFileStore(path);
  assert.equal((await reloaded.getSession(session.id))?.title, "Persisted");
  assert.equal((await reloaded.getSession(session.id))?.agentSeq, 1);
  const got = await reloaded.getSurface(surface?.id ?? "");
  assert.equal(got?.version, 2);
  assert.equal(got?.history.length, 1);
  const comments = await reloaded.listComments({});
  assert.equal(comments.length, 1);
  // lastSeq is restored too: the next comment continues the sequence
  const next = await reloaded.createComment({ sessionId: session.id, author: "user", text: "2" });
  assert.ok(next && next.seq > comments[0].seq);
});

test("JsonFileStore: recovers from .bak when the live file is corrupt", async () => {
  const path = freshPath();
  const store = new JsonFileStore(path);
  const session = await store.createSession({ agent: "pi", title: "Backed up" });
  await store.createSurface({ sessionId: session.id, parts: [htmlPart("<p>x</p>")] });

  // A truncated/garbled live file must not lose the board: the .bak mirror,
  // written after each good persist, carries the last valid state.
  writeFileSync(path, "{ this is not json");

  const recovered = new JsonFileStore(path);
  assert.equal((await recovered.getSession(session.id))?.title, "Backed up");
  assert.equal((await recovered.listSurfaces(session.id)).length, 1);
});

test("JsonFileStore: touchAsset flushes at most hourly, not per serve", async () => {
  const path = freshPath();
  const store = new JsonFileStore(path);
  const session = await store.createSession({ agent: "pi", title: "Assets" });
  const asset = await store.putAsset({
    sessionId: session.id,
    kind: "image",
    contentType: "image/png",
    data: new Uint8Array([1, 2, 3]),
  });

  // A fresh asset was just persisted; an immediate touch must NOT rewrite the
  // whole store (that would turn every asset view into a full-board write).
  const before = readFileSync(path, "utf8");
  await store.touchAsset(asset!.id);
  assert.equal(readFileSync(path, "utf8"), before);

  // Age the on-disk record past the flush window; a touch on a cold asset
  // must persist so GC's recency ordering survives a restart.
  const stale = JSON.parse(before);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  stale.assets[0].lastAccessedAt = old;
  writeFileSync(path, JSON.stringify(stale));
  const cold = new JsonFileStore(path);
  await cold.touchAsset(asset!.id);
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(after.assets[0].lastAccessedAt > old);
});

test("JsonFileStore: a concurrent mutation burst is durable through the coalesced flush", async () => {
  const path = freshPath();
  const store = new JsonFileStore(path);
  const session = await store.createSession({ agent: "pi", title: "Burst" });
  // 20 concurrent writes coalesce into few disk flushes; every awaited call
  // must still mean "my write is on disk".
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.createSurface({ sessionId: session.id, parts: [htmlPart(`<p>${i}</p>`)] }),
    ),
  );
  const reloaded = new JsonFileStore(path);
  const surfaces = await reloaded.listSurfaces(session.id);
  assert.equal(surfaces.length, 20);
});
