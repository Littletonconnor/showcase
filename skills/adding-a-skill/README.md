# adding-a-skill

The meta-skill: how skills in this repo are packaged, so agents extend it
consistently.

## What it does

Encodes the repo's skill conventions: the SKILL.md + README packaging shape
(including the mandatory "When to skip it" section), the one-way showcase
dependency rule with graceful chat degradation, the split between skill-owned
judgment and server-owned typed-tool layout, and the demo-session requirement
for anything that renders.

## When to use it

- Adding a new skill to this repo.
- Restructuring or re-packaging an existing one.
- Reviewing a skill PR for convention drift.

## When to skip it

- Writing skills for other repos or catalogs (their conventions win).
- General agent configuration or MCP server work.
- Anything that is not about the `skills/` tree.

## What you get

A checklist-driven procedure that produces a skill folder matching every other
skill here, installable via the standard skills CLI and the Claude Code plugin
marketplace without extra wiring.

## Install

```sh
npx skills@latest add Littletonconnor/showcase --skill adding-a-skill
```

## Dependencies

None. Pure convention.
