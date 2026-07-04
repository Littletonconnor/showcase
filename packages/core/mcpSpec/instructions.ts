export const MCP_SERVER_INFO = { name: "showcase", version: "0.1.0" };

export const MCP_INSTRUCTIONS =
  "showcase is a live visual surface the user watches in a browser. Publish surfaces to illustrate " +
  "concepts, sketch UI ideas, visualize data, or show a code review while you work. A surface is an " +
  "ordered list of parts: an `html` part is markup you write (a body fragment), a `markdown` part is " +
  "prose the viewer renders with consistent typography, a `mermaid` part is diagram source the viewer " +
  "renders to an SVG (flowchart, sequence, ERD, …), a `diff` part is a patch the viewer renders as " +
  "a syntax-highlighted split/unified diff. Combine them — e.g. a markdown rationale above a diff part — " +
  "in one card. CODEBASE EXPLAINERS: when asked how something works in a repo ('explain the auth flow', " +
  "'how does a request get here?'), READ the code first, then publish a `walkthrough` part — a step " +
  "player that walks the call path hop by hop with real excerpts, per-step line highlighting, and an " +
  "optionally synced diagram — instead of a wall of markdown. Pair it with a closing `checkpoint` part " +
  "when the user is trying to LEARN (or use publish_lesson for a full lesson). " +
  "publish_surface is the general tool; publish_snippet is " +
  "sugar for a single html part. FOR A CODE REVIEW: call publish_decisions ONCE. Do the analysis " +
  "with your `code-review` skill first, then hand over a plain-English `brief` (≤4 sentences, no code " +
  "identifiers — for anyone), a `verdict`, a risk-ranked `decisions[]` array (ONE decision per thing " +
  "that needs a human call — a 5,000-line diff is usually a handful, hardest first), and the REQUIRED " +
  "`manifest` (EVERY changed file, each tagged has-decision/reviewed-no-comment/mechanical-skipped, so " +
  "nothing is hidden). Each decision is fixed structure: call (block|ship|decide), kind, scope, a " +
  "one-sentence assertion, optional impact/details, REQUIRED confidence, an optional pivot, optional " +
  "evidence (surface parts — usually a diff — shown in the synced right pane), and an optional " +
  "`proposal:{before,after}` suggested fix. showcase renders it as a Brief + a scroll-snapped decision " +
  "queue the human adjudicates at /?review=<session>. NEVER write a review as one big markdown surface " +
  "— that wall of text is the failure mode publish_decisions exists to prevent. " +
  "Call get_design_guide once before your first publish. On your first " +
  'publish, also pass sessionTitle to name the session after the task (e.g. "Auth refactor"). ' +
  "SESSION PRESETS: a session can be pinned to a PRESET (an explainer blueprint + theme) so every " +
  "surface in it comes out in the same structure + look no matter what is asked — a design-doc session, " +
  "a product-demo session, a data-viz session. If the user asks for a kind of session ('make this a " +
  "design-doc session') call configure_session up front; otherwise pass `blueprint` on your first " +
  "publish and it pins for the rest of the session. Then author every surface to the preset's structure. " +
  "A repo or user can also set a default preset that new sessions start in. Discover presets via " +
  "GET /api/blueprints. Several presets also have a TAILORED tool that takes typed fields and renders a " +
  "fixed layout (so every instance looks identical, like publish_decisions does for a review): " +
  "publish_postmortem, publish_dashboard, publish_design_doc, publish_status, publish_architecture, " +
  "publish_product_demo, and publish_product_direction (the 'wf product style' — visualize a product and weigh " +
  "options with pros & cons, ending in a 'Leaning & why' call). Prefer the tailored tool when one fits; fall back to publish_surface for free-form. " +
  "REFERENCING A SURFACE: every card shows a copy-to-clipboard ref in its header. The user copies it — " +
  "it carries the surface id AND title — and pastes it to you in YOUR TERMINAL, where the conversation " +
  "happens. To act on a referenced surface, call get_surface with its id to read its CURRENT full " +
  "content (every part), then update_surface to revise it in place. list_surfaces is the title index " +
  "for a session; get_surface is the full content of one. " +
  "TEACHING: when the user wants to LEARN or deeply understand a topic or codebase (not just get an " +
  "answer), use publish_lesson — the learn form factor. Call get_learner_state first (prior mastery), " +
  "publish the lesson (syllabus + concept beats with checkpoints), then park on wait_for_feedback: the " +
  "learner's checkpoint attempts arrive as [checkpoint] telemetry lines with misconception tags. Grade " +
  "free-text answers and record_attempt; remediate misses with update_lesson. Never dump answers — the " +
  "structure makes the learner produce before they receive, and reveals stay hidden until an attempt. " +
  "When `showcase review-due` / get_learner_state shows due concepts, run a short review session with " +
  "FRESH variants of the due checkpoints. " +
  "FEEDBACK FROM THE BROWSER: on a review the user adjudicates in the tab — Accept burns a decision down " +
  "(local). To push back they copy a decision's ref (shown in its header) and paste it to you in YOUR " +
  "TERMINAL to scope a revision — there's no browser pushback verb. On other surfaces the user leaves " +
  "comments: call wait_for_feedback after publishing (or anything you want a reaction to) to receive them, " +
  "and any publish/update result may also carry a userFeedback array — comments left since your last call, " +
  "delivered once. Act on feedback in your normal terminal loop: make the change, then republish the review " +
  "with publish_decisions so the board updates.";

// Rides on every wait_for_feedback delivery (both transports) as an in-context
// reminder, right when the agent is deciding how to respond.
export const FEEDBACK_REPLY_NOTE =
  "These are the user's comments on the surfaces they're watching. A comment with an `anchor` points at an " +
  "exact spot (a quoted selection, a file:line, a walkthrough step) — answer it with the `reply` tool passing " +
  "its `id` as replyTo, so your answer renders IN the thread at that spot on the card. Substantive changes " +
  "still go through update_surface / publish_decisions; use reply for the conversational half (answering a " +
  "question, explaining a line, confirming a fix landed). Telemetry lines ([checkpoint]/[explorable]/" +
  "[confused]) are machine-built signals, not prose to reply to verbatim. Then wait_for_feedback again if " +
  "you expect more.";
