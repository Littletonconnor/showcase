// A standalone codebase EXPLAINER session (not a lesson): the walkthrough part
// tracing a real path through this repo, the flagship shape for "explain how X
// works in this codebase". Real files, real line numbers.
const COMMENT_PATH_WALKTHROUGH = {
  kind: "walkthrough",
  title: "How a comment reaches the agent, exactly once",
  mermaid:
    'flowchart LR\n  composer["viewer composer"] --> route["POST /api/comments"]\n  route --> flow["createComment flow"]\n  flow --> storerec["JsonFileStore + seq"]\n  flow --> sse["SSE broadcast"]\n  storerec --> cursor["agentSeq cursor"]\n  cursor --> wait["wait_for_feedback"]\n  cursor --> piggy["piggyback on writes"]',
  steps: [
    {
      title: "The reply line posts an author=user comment",
      body: 'Every card footer has a quiet input. Enter posts to `/api/comments` with this surface id; author defaults to "user", the reserved trust label only the trusted composer path uses.',
      file: "packages/server/app.ts",
      code: 'app.post("/api/comments", async (c) => {\n  const body = await c.req.json().catch(() => null);\n  if (!body || typeof body.text !== "string" || !body.text.trim()) {\n    return c.json({ error: \'body must include non-empty "text" string\' }, 400);\n  }\n  const surface = typeof body.surface === "string" ? body.surface : body.snippet;\n  const result = await createComment({\n    text: body.text,\n    surface: typeof surface === "string" ? surface : undefined,\n    session: typeof body.session === "string" ? body.session : undefined,\n    author: typeof body.author === "string" ? body.author : "user",\n  });',
      language: "ts",
      lineStart: 2081,
      highlight: [[2087, 2092]],
      node: "route",
    },
    {
      title: "The shared flow stores it and broadcasts",
      body: "REST and MCP funnel into ONE `createComment` flow: the store stamps a global `seq` (the ordering every delivery channel shares), then the event bus tells live viewers.",
      file: "packages/server/app.ts",
      code: 'const comment = await store.createComment({\n  sessionId,\n  surfaceId,\n  author: input.author,\n  text: input.text.trim().slice(0, MAX_COMMENT_TEXT),\n});\nif (!comment) return { error: "session not found", status: 404 };\nbus.broadcast({\n  type: "comment-created",\n  id: comment.id,\n  sessionId: comment.sessionId,\n  surfaceId: comment.surfaceId,\n  seq: comment.seq,\n  author: comment.author,\n});',
      language: "ts",
      lineStart: 1279,
      highlight: [
        [1279, 1284],
        [1287, 1287],
      ],
      node: "flow",
    },
    {
      title: "One cursor, guarded by a per-session lock",
      body: "Delivery is exactly-once because there is ONE server-side cursor (`session.agentSeq`) and every reader serializes through this lock. Two overlapping readers can never both read before either marks.",
      file: "packages/server/app.ts",
      code: "const cursorLocks = new Map<string, Promise<unknown>>();\nfunction withCursorLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {\n  const prev = cursorLocks.get(sessionId) ?? Promise.resolve();\n  const run = prev.then(fn);\n  const tail = run.catch(() => {});\n  cursorLocks.set(sessionId, tail);\n  void tail.then(() => {\n    if (cursorLocks.get(sessionId) === tail) cursorLocks.delete(sessionId);\n  });\n  return run;\n}",
      language: "ts",
      lineStart: 703,
      highlight: [[704, 706]],
      node: "cursor",
    },
    {
      title: "A wait reads the window and advances the cursor atomically",
      body: "`wait_for_feedback` re-resolves `agentSeq` INSIDE the locked section (piggyback may have consumed the batch while it was parked), reads everything after it, and marks it seen in the same critical section.",
      file: "packages/server/app.ts",
      code: "const readWindow = async () => {\n  if (usesSessionCursor) afterSeq = (await store.getSession(q.sessionId!))?.agentSeq;\n  const all = await store.listComments({\n    sessionId: q.sessionId,\n    surfaceId: q.surfaceId,\n    afterSeq,\n  });\n  // The cursor advances past every comment in the window \u2014 not just the\n  // filtered ones \u2014 so the next call doesn't re-read the agent's own\n  // comments. collectFeedback already does this; mirror it here.\n  if (q.author === \"user\" && q.sessionId && all.length > 0) {\n    await store.markAgentSeen(q.sessionId, all[all.length - 1].seq);\n  }\n  return all;\n};",
      language: "ts",
      lineStart: 1321,
      highlight: [
        [1322, 1322],
        [1331, 1333],
      ],
      node: "wait",
    },
  ],
};

export const commentPipeSession = {
  agent: "demo",
  title: "Explainer: the comment pipe",
  snippets: [
    {
      title: "How a comment reaches the agent",
      parts: [
        {
          kind: "markdown",
          markdown:
            'You typed a reply on a card. Four hops later the agent has it, and can never receive it twice. Step through the actual code (arrow keys work); hit "I\'m lost here" on any step and the agent finds out exactly where.',
        },
        COMMENT_PATH_WALKTHROUGH,
        {
          kind: "checkpoint",
          checkpoint: {
            id: "pipe-check",
            conceptId: "comment-pipe",
            kind: "mcq",
            prompt:
              "Piggyback delivers a batch while a `wait_for_feedback` is parked on the same session. What does the wait see when it wakes?",
            options: [
              {
                id: "a",
                label: "The same batch again; each channel keeps its own cursor",
                misconception: "per-channel cursors",
              },
              {
                id: "b",
                label: "Nothing; the wait re-resolves the shared cursor inside the lock",
                correct: true,
              },
            ],
            reveal:
              "Nothing. `readWindow` re-reads `agentSeq` inside the locked section, so a batch piggyback consumed is already behind the cursor. One cursor, one lock, three channels.",
          },
        },
      ],
    },
  ],
};
