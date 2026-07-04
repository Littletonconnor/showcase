export const showcaseTourLesson = {
  topic: "showcase codebase tour",
  learnerLevel: "intermediate",
  sessionTitle: "Learn: the showcase codebase",
  conceptGraph: {
    concepts: [
      {
        id: "workspace",
        label: "Workspace boundaries",
        misconceptions: [
          "the CLI imports the server",
          "core can use node APIs since everything runs on node",
        ],
      },
      {
        id: "sandbox",
        label: "The sandbox invariant",
        misconceptions: ["markdown parts render as innerHTML in the viewer"],
      },
      {
        id: "feedback",
        label: "The exactly-once feedback pipe",
        misconceptions: ["each delivery channel keeps its own cursor"],
      },
    ],
    edges: [
      ["workspace", "sandbox"],
      ["workspace", "feedback"],
    ],
  },
  beats: [
    {
      conceptId: "workspace",
      hook: {
        id: "tour-hook",
        conceptId: "workspace",
        kind: "predict",
        prompt:
          "How does the `showcase` CLI talk to the server - direct import, shared store file, or HTTP?",
        options: [
          {
            id: "a",
            label: "It imports the server package and calls flows directly",
            misconception: "the CLI imports the server",
          },
          { id: "b", label: "HTTP only - the CLI is a thin API client", correct: true },
          { id: "c", label: "Both read the same JSON store file" },
        ],
        askConfidence: true,
        reveal:
          "HTTP only (packages/cli/http.ts). The CLI never imports the server tree - that boundary is what lets it stay zero-dependency and target a remote board via SHOWCASE_URL.",
      },
      model: [
        {
          kind: "markdown",
          markdown:
            "Five packages, enforced boundaries: `core` (runtime-agnostic data model + renderers - NO `node:` imports, CI-checked) is imported by everyone; `server` is the Node runtime; `cli` talks to `server` over HTTP, never by import; `mcp` is a stdio client over the same HTTP API; `viewer` is the one Vite-built package, whose dist the server reads at boot.",
        },
        {
          kind: "mermaid",
          mermaid:
            'flowchart TD\n  core["@showcase/core"] --> server["@showcase/server"]\n  core --> cli["@showcase/cli"]\n  core --> mcp["@showcase/mcp"]\n  core --> viewer["@showcase/viewer"]\n  cli -. "HTTP" .-> server\n  mcp -. "HTTP" .-> server\n  viewer -. "dist/index.html read at boot" .-> server',
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "js",
          title: "scripts/check-core-boundary.mjs (the CI gate)",
          code: "// Fails the lint gate on any `node:` import inside packages/core -\n// the check that keeps core portable to any runtime:\nconst matches = source.matchAll(/from\\s+[\"']node:/g);",
        },
      ],
      checkpoints: [
        {
          id: "tour-cp-1",
          conceptId: "workspace",
          kind: "mcq",
          prompt: "Where must a new `readFile` call live?",
          options: [
            {
              id: "a",
              label: "Anywhere - it all runs on Node anyway",
              misconception: "core can use node APIs since everything runs on node",
            },
            { id: "b", label: "server/cli/mcp - never core (CI enforces it)", correct: true },
          ],
          reveal:
            "core stays runtime-agnostic; scripts/check-core-boundary.mjs fails lint on any node: import there. Node wiring belongs to the server (index.ts, storage.ts) or the CLI.",
        },
      ],
      recap:
        "core is imported by all and imports no runtime; cli/mcp reach the server only over HTTP.",
    },
    {
      conceptId: "sandbox",
      model: [
        {
          kind: "markdown",
          markdown:
            "The one untouchable invariant: agent-authored content that becomes HTML renders ONLY inside sandboxed, opaque-origin iframes - never as innerHTML in the trusted viewer origin, which shares its origin with the authenticated API. Two paths exist: html parts load `/s/:id` server-rendered docs; rich parts (markdown/mermaid/diff/code) are built as STRINGS in the viewer and handed to a `srcdoc` sandbox. Data parts (json, chart, trace, checkpoint) render as React text nodes - escaping by construction.",
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "tsx",
          title: "packages/viewer/src/SandboxedPart.tsx",
          code: '<iframe\n  key={doc}\n  className={props.class ?? "partframe"}\n  sandbox="allow-scripts"      // no allow-same-origin: opaque origin\n  srcDoc={doc}                 // string in, live DOM only inside\n/>',
        },
      ],
      checkpoints: [
        {
          id: "tour-cp-2",
          conceptId: "sandbox",
          kind: "mcq",
          prompt: "A markdown part's rendered HTML ends up where?",
          options: [
            {
              id: "a",
              label: "innerHTML in the viewer (markdown-it sanitizes it)",
              misconception: "markdown parts render as innerHTML in the viewer",
            },
            {
              id: "b",
              label: "A srcdoc sandbox iframe - string-built in the viewer, DOM only inside",
              correct: true,
            },
          ],
          reveal:
            "Even library-rendered markup goes into the sandbox: a sanitizer regression then lands in an opaque origin with a no-connect CSP instead of the trusted board.",
        },
        {
          id: "tour-cp-3",
          conceptId: "sandbox",
          kind: "trace",
          prompt:
            "An html part wants to fetch('https://evil.example'). The CSP directive that blocks it falls back from which missing directive? (name it)",
          expected: "connect-src",
          reveal:
            "`connect-src` is deliberately omitted, so it falls back to `default-src 'none'` - all fetch/XHR/WebSocket from a sandboxed part is blocked (core/surfacePage.ts buildCsp).",
        },
      ],
      recap:
        "String-build in the trusted origin, become DOM only inside an opaque-origin sandbox. No third way.",
    },
    {
      conceptId: "feedback",
      model: [
        {
          kind: "markdown",
          markdown:
            "User comments reach the agent exactly once through THREE channels sharing ONE server-side cursor (`session.agentSeq`): piggyback (unseen comments ride every agent write), the blocking wait (`wait_for_feedback` long-poll with settle batching), and the CLI watch stream. The read+advance critical section is serialized per session (`withCursorLock`) so overlapping readers cannot double-deliver. Learn-mode telemetry rides this same pipe as fixed-format `[checkpoint]` comments.",
        },
      ],
      workedExample: [
        {
          kind: "walkthrough",
          title: "Worked example: follow one comment to the agent",
          steps: [
            {
              title: "The lock that makes exactly-once true",
              body: "Every cursor read serializes through this per-session promise chain. Two overlapping readers can never both read before either marks.",
              file: "packages/server/app.ts",
              code: "const cursorLocks = new Map<string, Promise<unknown>>();\nfunction withCursorLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {\n  const prev = cursorLocks.get(sessionId) ?? Promise.resolve();\n  const run = prev.then(fn);\n  const tail = run.catch(() => {});\n  cursorLocks.set(sessionId, tail);\n  void tail.then(() => {\n    if (cursorLocks.get(sessionId) === tail) cursorLocks.delete(sessionId);\n  });\n  return run;\n}",
              language: "ts",
              lineStart: 703,
              highlight: [[704, 706]],
            },
            {
              title: "The wait re-resolves the cursor INSIDE the lock",
              body: "A parked wait cannot trust the cursor it saw before parking; piggyback may have consumed the batch. So `readWindow` re-reads `agentSeq`, lists after it, and marks seen, all in one critical section.",
              file: "packages/server/app.ts",
              code: 'const readWindow = async () => {\n  if (usesSessionCursor) afterSeq = (await store.getSession(q.sessionId!))?.agentSeq;\n  const all = await store.listComments({\n    sessionId: q.sessionId,\n    surfaceId: q.surfaceId,\n    afterSeq,\n  });\n  if (q.author === "user" && q.sessionId && all.length > 0) {\n    await store.markAgentSeen(q.sessionId, all[all.length - 1].seq);\n  }\n  return all;\n};',
              language: "ts",
              lineStart: 1321,
              highlight: [
                [1322, 1322],
                [1328, 1330],
              ],
            },
          ],
        },
      ],
      explorable: {
        gate: {
          id: "tour-gate",
          conceptId: "feedback",
          kind: "predict",
          prompt:
            "Predict: piggyback delivers a batch, then a wait_for_feedback wakes for the SAME session. What does the wait see?",
          options: [
            {
              id: "a",
              label: "The same batch again - each channel has its own cursor",
              misconception: "each delivery channel keeps its own cursor",
            },
            {
              id: "b",
              label: "Nothing - one shared cursor already advanced past it",
              correct: true,
            },
          ],
          reveal:
            "One cursor, shared by all channels - that IS the exactly-once guarantee. Step through it below.",
        },
        html: '<div class="panel stack lg"><span class="eyebrow">One cursor, three channels</span><p class="dim">Click to deliver the next pending comment through a random channel; the cursor advances for ALL of them.</p><div class="row" style="gap:8px"><button id="add">user comments</button><button id="deliver">agent reads (any channel)</button></div><p style="margin-top:8px" class="mono" id="log">pending: 0 · agentSeq: 0</p><script>var pend=0,seq=0,log=document.getElementById("log");function r(){log.textContent="pending: "+pend+" · agentSeq: "+seq;}document.getElementById("add").addEventListener("click",function(){pend++;r();});document.getElementById("deliver").addEventListener("click",function(){var ch=["piggyback","wait","watch"][Math.floor(Math.random()*3)];seq+=pend;var n=pend;pend=0;r();if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"delivered",value:n+" via "+ch});});</script></div>',
      },
      checkpoints: [
        {
          id: "tour-cp-4",
          conceptId: "feedback",
          kind: "apply",
          prompt:
            "Design question: you are adding learn-mode telemetry. Why is 'persist each event as a comment' the right call here, versus a new /api/telemetry store + stream? (2-3 sentences)",
          reveal:
            "Model answer: the comment pipe already guarantees exactly-once delivery across piggyback/wait/watch via the shared agentSeq cursor. A second channel would need its own cursor, locking, and batching - and would inevitably be weaker. Riding comments makes telemetry inherit every guarantee for free (C6).",
        },
      ],
      recap:
        "Three delivery channels, one agentSeq cursor, one lock - telemetry rides the same rails.",
    },
  ],
};
