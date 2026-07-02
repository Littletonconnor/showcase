---
name: adding-a-skill
description: Add or modify a skill in this repo following its conventions - packaging (SKILL.md + README with a When-to-skip section), the one-way showcase dependency rule, the design-guide/typed-tool split, and the demo-session requirement for anything that renders. Use when asked to create, package, or restructure a skill in the showcase repo.
---

# adding-a-skill

Conventions every skill in this repo follows. Check each one before you ship.

## Packaging (per skill folder)

Two files minimum, under `skills/<name>/`:

- `SKILL.md`: agent-facing. YAML frontmatter with `name` and a `description`
  that states both the positive triggers AND the negative ones ("do NOT use
  for..."), then the instructions. Keep instructions procedural and terse;
  long reference material goes in `references/*.md` files the skill points to.
- `README.md`: human-facing, this exact shape: one-line purpose, "What it
  does", "When to use it", **"When to skip it"** (explicit negative triggers;
  this section is mandatory, it is what keeps skills from firing on
  everything), "What you get", "Install", "Dependencies".

Layout is the ecosystem standard (`skills/<name>/SKILL.md`), so
`npx skills@latest add Littletonconnor/showcase --skill <name>` works as a
plain folder copy and the `.claude-plugin/` marketplace manifest picks it up.
Skills must not assume Claude Code specifically.

## The one-way dependency rule

showcase knows about skills; skills do not require showcase. A skill that uses
showcase declares it as a SOFT dependency ("expects the showcase MCP server")
and degrades gracefully: state exactly what the skill does when the server is
absent, and make that path genuinely useful (the `teach` skill teaches in
plain chat; `showcase` fetching docs is the exception since it IS the
bootstrap). Never make a skill that errors out without showcase.

## The design-guide / typed-tool split

Pedagogy, analysis, and judgment live in the skill. Layout lives in the
server's typed tools (`publish_decisions`, `publish_lesson`, the preset
tools). A skill should hand structured slots to a typed tool, not hand-roll
html for a form factor that has one. If the form factor is new, the typed tool
and its server-side renderer come first; the skill fills it.

## The demo requirement

Anything with a rendering component ships a demo: a session seeded by
`showcase demo` (add to `packages/cli/demoData.js`) produced through the REAL
pipeline, so the demo doubles as the acceptance test for the skill's output
shape.

## Registration checklist

- [ ] `skills/<name>/SKILL.md` with frontmatter, negative triggers in the
      description
- [ ] `skills/<name>/README.md` with a real "When to skip it"
- [ ] Soft-dependency statement + degradation path if it touches showcase
- [ ] `references/*.md` for anything longer than a screen
- [ ] Demo session if it renders
- [ ] `.claude-plugin/marketplace.json` untouched or updated (it points at the
      repo root; new skills under `skills/` are picked up automatically)
- [ ] No em-dashes in the authored prose
