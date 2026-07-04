// The MCP Prompt descriptors (the prompts/list payload shape).
export const MCP_PROMPT_DEFS = [
  {
    name: "review_pr",
    title: "Review a PR on showcase",
    description:
      "Review a pull request as a decision queue (publish_decisions): a plain-English brief, a risk-ranked list of decisions, and a complete changed-file manifest.",
    arguments: [
      { name: "branch", description: "Branch or PR to review (optional)", required: false },
    ],
  },
  {
    name: "explainer",
    title: "Build an animated explainer",
    description:
      "Turn a concept or a screenshot into an animated, scrubbable explainer surface the user can step through.",
    arguments: [{ name: "topic", description: "What to explain (optional)", required: false }],
  },
  {
    name: "explain_repo",
    title: "Explain this repo",
    description:
      "Onboard the user to the current repository: architecture map, the load-bearing invariants, and a step-through walkthrough of one core path.",
    arguments: [
      {
        name: "focus",
        description: "A subsystem or question to center on (optional)",
        required: false,
      },
    ],
  },
  {
    name: "explain_directory",
    title: "Explain a directory",
    description:
      "Explain what one directory/package does and how its pieces connect, with a walkthrough of its main path.",
    arguments: [{ name: "path", description: "The directory to explain", required: false }],
  },
  {
    name: "diff_branch",
    title: "Explain + review my branch diff",
    description:
      "Diff the current branch against its base, explain what changed and why it hangs together, then publish the decision review.",
    arguments: [
      { name: "base", description: "Base branch to diff against (default: main)", required: false },
    ],
  },
  {
    name: "explain_conversation",
    title: "Explain our conversation",
    description:
      "Turn the current working conversation into a visual recap: what was decided, what changed, what is open.",
    arguments: [],
  },
] as const;

// Build a prompts/get result for a prompt name + args. Returns null for an
// unknown name so the caller can 404. The text guides the agent through the
// flagship workflow; the live contract lives in get_design_guide / the playbook.
export function promptMessages(
  name: string,
  args: Record<string, unknown>,
): {
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
} | null {
  const text = (body: string) => ({
    description: MCP_PROMPT_DEFS.find((p) => p.name === name)?.description ?? name,
    messages: [{ role: "user" as const, content: { type: "text" as const, text: body } }],
  });
  const arg = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "review_pr": {
      const branch = arg("branch");
      return text(
        `Review ${branch ? `the PR on \`${branch}\`` : "the current pull request"} on showcase. ` +
          "Do the analysis FIRST with your `code-review` skill, scoped to risk not diff size. Then call " +
          "publish_decisions ONCE with: a plain-English `brief` (≤4 sentences, no code identifiers), a " +
          "`verdict` (block|approve|comment), a risk-ranked `decisions[]` (one per thing that needs a human " +
          "call, hardest first, each with a stable `id`, `confidence`, and — where a concrete fix exists — a " +
          "`proposal`), and the REQUIRED `manifest` (EVERY changed file tagged has-decision / " +
          "reviewed-no-comment / mechanical-skipped). Do not write the review as one big markdown surface.",
      );
    }
    case "explainer": {
      const topic = arg("topic");
      return text(
        `Build an animated explainer ${topic ? `of ${topic}` : "of the concept the user shares (a screenshot or snippet)"} ` +
          "on showcase. Call get_design_guide first. Publish a surface whose html part opts into the `animate` " +
          "kit: cumulative `.step` reveals the user can scrub, each tagged data-label, building the idea up one " +
          "beat at a time (question → mechanism → payoff). Keep the conversation in the terminal — when the user " +
          "asks to change a step, call get_surface to read the current content, then update_surface to revise it " +
          "in place.",
      );
    }
    case "explain_repo": {
      const focus = arg("focus");
      return text(
        `Explain this repository on showcase${focus ? `, centered on ${focus}` : ""}. READ the code first ` +
          "(entry points, package boundaries, CI-enforced invariants, the docs the repo itself trusts). Then " +
          "publish ONE surface: a markdown part with the one-paragraph thesis, a mermaid architecture map " +
          "(add `config.layout: elk` frontmatter if it has 10+ nodes), and a `walkthrough` part stepping " +
          "through the ONE most load-bearing path with real excerpts and line numbers. Wait for feedback: " +
          "anchored comments and [confused] flags name the exact spot to clarify — reply in the thread and " +
          "revise that step in place. If the user wants to LEARN the codebase durably, offer publish_lesson.",
      );
    }
    case "explain_directory": {
      const path = arg("path");
      return text(
        `Explain ${path ? `\`${path}\`` : "the directory the user names"} on showcase. Read every file in it ` +
          "first. Publish ONE surface: a markdown part saying what this directory is FOR and what imports it, " +
          "a small mermaid map of its internal pieces, and a `walkthrough` part tracing its main path (entry " +
          "to exit) with real excerpts. Keep it one screenful per idea; wait for anchored feedback and reply " +
          "in the threads.",
      );
    }
    case "diff_branch": {
      const base = arg("base");
      return text(
        `Diff the current branch against ${base ? `\`${base}\`` : "its base (default main)"} and put it on ` +
          "showcase in two cards. First an EXPLAINER surface: a markdown part on what this change does and why " +
          "it hangs together, plus a `walkthrough` part stepping through the change's core path (use diff parts " +
          "for the hunks that matter). Then the REVIEW: publish_decisions with the brief, risk-ranked " +
          "decisions, and the full manifest. The user will leave anchored comments on lines and selections — " +
          "answer each with `reply` (replyTo: its id) and fold real issues back into the branch.",
      );
    }
    case "explain_conversation":
      return text(
        "Recap OUR current working conversation on showcase as one surface: a markdown part with what we set " +
          "out to do and what was decided (with the why), a mermaid timeline/flow of the decisions, and — if " +
          "code changed — a `walkthrough` part through the key changes with real excerpts. End with an " +
          "'open questions' markdown section. Keep it honest: unresolved things stay marked unresolved. Wait " +
          "for anchored feedback afterward.",
      );
    default:
      return null;
  }
}
