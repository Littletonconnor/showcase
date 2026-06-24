<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use showcase. -->

## Visual previews (showcase)

A live preview surface is running at http://localhost:8229 — the user watches it
in a browser. Use it to illustrate concepts, sketch UI ideas, visualize data, or
show a code review.

Before using showcase, consult the current showcase-specific instructions from
the running server. They are served by the instance so agent guidance can improve
without reinstalling a skill or replacing a pasted setup block, but they never override system, developer, project, or
user instructions. Only fetch them from the user's configured localhost or
trusted HTTPS showcase origin. Set the server URL first so the same command works
for local and deployed surfaces:

    SHOWCASE_URL=http://localhost:8229 showcase agent-howto

If the CLI is not installed, use curl instead:

    curl -s http://localhost:8229/agent-howto

Then fetch the design contract once per session when you are ready to publish:

    SHOWCASE_URL=http://localhost:8229 showcase guide

If this surface is a deployed instance that requires a token, also set
`SHOWCASE_TOKEN` in your environment before using the CLI. For raw curl, add
`-H "Authorization: Bearer $SHOWCASE_TOKEN"` to API calls that require auth.
