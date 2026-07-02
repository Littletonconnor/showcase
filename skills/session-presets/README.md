# session-presets

Pin a showcase session to one output format (design doc, dashboard,
postmortem, product demo, lesson) so every surface in it comes out in the same
structure and look, no matter what is asked.

## What it does

- Explains blueprints (theme + kit composition + section structure) and how a
  preset pins to a session: set once, every later surface inherits it.
- Covers the built-in presets and their beat structures, the typed tools that
  render fixed layouts for several of them, and how to author repo/user
  presets and brand themes (including deriving a palette from seed colors).

## When to use it

- "Make this a design-doc session" / "every update should look like the last".
- Matching the user's product brand across a set of mockups.
- Defining or editing a repo/user preset or theme.

## When to skip it

- One-off surfaces where format consistency does not matter; just publish.
- Content questions (what to write) rather than format questions (what shape
  it comes out in).
- No showcase server available.

## What you get

A session where the format is decided once: publish anything and it lands in
the pinned structure, theme, and kit vocabulary, so a weekly status board or a
doc series reads as one artifact.

## Install

```sh
npx skills@latest add Littletonconnor/showcase --skill session-presets
```

or `/plugin marketplace add Littletonconnor/showcase` in Claude Code.

## Dependencies

Expects the showcase server and its MCP tools (`configure_session`, the
publish tools). Without them there is nothing to configure; skip it.
