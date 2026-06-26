# showcase — UX vision & redesign plan

A focused design direction for the viewer, written through one lens: **does an
affordance serve the daily loop, or not?** If it isn't used most sessions, it's a
candidate for the cut list — not the build list.

This is a proposal to react to, not a shipped spec. Companion to `TODO.md` (the
capability roadmap) and `AGENTS.md` (architecture). Code references point at the
current viewer so each item is executable.

---

## 1. What this app is (the focus)

Strip away the part-kinds and there is **one atomic interaction** that defines the
product:

> **A card appears → you react → the agent revises.**

Everything else is in service of that micro-loop. The two flagship workflows are
just two flavors of it:

- **Job A — "Review my branch with me."** The agent posts finding cards; you
  triage and push back; it revises in place; you end at a verdict you trust.
  _(The flagship — the thing no GitHub thread or terminal does.)_
- **Job B — "Show me how this works."** The agent draws a diagram/explainer; you
  ask follow-ups and it revises.

Both jobs are the _same loop_. So a superior UX is not "more affordances." It is:

1. Make the loop **close reliably and instantly**, and
2. **Delete everything not on its critical path.**

The daily user is a developer running a coding agent (Claude Code / Cursor) who
wants a screen for their agent — primarily to **review code visually** and to
**understand code visually.**

---

## 2. The core insight: the loop is open by default

This is the single most important fact about the current UX, and it is hiding in
plain sight.

**The agent only hears you while it is parked in `wait_for_feedback`.** The rest
of the time the loop is open, and the app says so:

- `AgentPresence` (`viewer/src/App.tsx`) defaults to **"Agent idle."**
- The idle affordance **copies an instruction for you to paste into your
  terminal** to re-arm the agent.
- The session chat footer reads **"messages queue until your agent checks."**
- `TODO.md` §4 admits it: _"after a turn the agent isn't listening — the reliable
  pattern is comment → tell the agent to check."_

So the real daily experience is: you comment → you see "queued" → **you alt-tab to
your terminal and nudge the agent by hand.** The headline promise ("comment and it
flows straight to the agent") holds only sometimes.

For a tool used _daily_, this is the whole ballgame. No amount of toolbar polish
matters if the loop doesn't close on its own. **Everything in this plan is ranked
by that razor.**

The real fix already exists but is buried: the `showcase watch` plugin (the
`ConnectModal`) runs a background process that streams comments to the agent
exactly-once. The redesign's job is to make _that_ the default, central state of
the app — not an optional plugin in a footer menu.

---

## 3. A superior UX, in four moves

### Move 1 — Make loop-closure the app's primary status ⭐ (highest leverage)

The most important thing a user needs to know at all times is: **"if I comment
right now, will the agent actually get it?"** Today that's a small gray pill and a
plugin buried in _Help & resources_.

**Design:**

- **Reframe the language from blame to a setting you own.** Not _"Agent idle"_ but
  **"Auto-replies: Off"**, with a one-click path to On. "Idle" sounds like
  waiting; "Off" sounds fixable — and it is.
- **The empty state's hero action becomes "Turn on auto-replies"** (install the
  watcher once), not a `curl` snippet. The curl demo is a party trick; connecting
  the loop is the product. _(Current `Onboard` in `App.tsx` leads with `SETUP_SNIP`
  / `TRY_SNIP`.)_
- **Carry the fix at the moment of friction.** When auto-replies are Off, the
  composer itself should say so ("queued — turn on auto-replies") instead of a
  far-away header pill. That's the exact instant the user feels the pain.
- **When On, be confident.** The composer reads **"Agent will see this."** No
  hedging.

**Current state:** `AgentPresence` + `SessionChat` footer in `App.tsx`;
`ConnectModal` is the real mechanism. **Acceptance:** a first-run user reaches
"auto-replies On" without reading docs, and never has to hand-nudge their agent
again. **Decision to confirm:** this changes the app's whole framing — align
before building.

### Move 2 — For review (Job A), build a burndown, not a stream

A vertical chat-stream is right for Job B (watching explainers arrive). It is the
_wrong_ shape for Job A. A reviewer's daily job is **see the verdict → work each
finding → drive open-count to zero → done.** That's an inbox/checklist, not an
infinite scroll.

The raw material exists: `ReviewSummary` (`App.tsx`) already rolls finding badges
into per-severity chips, and Approve/Dismiss already resolve a finding. Promote it
into a persistent **review cockpit**:

- **Open/resolved progress** ("4 open · 2 resolved") with a real **terminal
  state**: when the last finding resolves, the session declares **"Review complete
  — Request changes / Approved."** Today resolution only strikes a chip through
  (`ReviewSummary`); there is no satisfying "done," which is the entire emotional
  payoff of a review.
- A primary **"Next open finding"** action + keyboard **`j` / `k`** paging.
  Daily reviewers live on the keyboard; jumping finding-to-finding and hitting
  Approve/Dismiss without the mouse is what makes a review feel _fast_ instead of
  _cute_. _(Extends the existing chip-jump in `ReviewSummary` and the reading-view
  key handling.)_
- **Sidebar sessions show review status** (an open-count badge), so "where did I
  leave off" is answerable at a glance. A review session is a unit of work to
  resume. _(Extends `SessionItem` in `App.tsx`, which already has an unread dot
  and surface count.)_

Keep it **one canvas with a review overlay**, not a second app: the stream stays;
the cockpit rides on top when a session has findings (`surface.badge`).

**Acceptance:** a reviewer can run an entire PR review keyboard-only and end on an
explicit verdict.

### Move 3 — Three verbs, made unmistakable

The daily review verbs are **Approve / Dismiss / Request a change.** Approve and
Dismiss are now gated to finding cards (done). Next: on finding cards, render them
as **labeled buttons**, not three more ghost icons among nine. These three
decisions _are_ the review — they should look like the primary action, with the
composer as the catch-all "say more." Chrome (pin / copy link / open / read) stays
quiet and in the ⋯ menu (done).

**Current state:** `approveAction` / `dismissAction` / "Request a change" in
`Card.tsx` are all icon-only `IconAction`s. **Acceptance:** on a finding card, the
verdict actions read as primary at a glance; on a plain card the footer stays
minimal.

### Move 4 — Collapse "three ways to comment" into one model

There are currently three comment entry points: general comment, 📍 point-pin
annotation, and diff line-comment. That's two too many concepts to hold daily.

- **Line comments on diffs** — obviously daily-useful; you're pointing at code.
  Keep.
- **General comment** — the catch-all. Keep.
- **Point-pin annotations on arbitrary cards** (`annotateAction` + `AnnotationPin`
  - `AnnotationComposer` in `Card.tsx`) — the odd one out. When would you _daily_
    drop an (x,y) pin on a diagram instead of just commenting? **Fold into "comment
    with an optional location," or cut.**

**Acceptance:** one comment verb, optionally located — not three parallel ones.

---

## 4. The daily-use razor: cut / demote list

_If it isn't used most sessions, it isn't worth its footprint._ Applied honestly,
even to shipped features:

| Affordance                                                     | Verdict                       | Why                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library** (pin surfaces into a cross-session knowledge base) | **Cut or hide**               | A "save for later" almost nobody revisits, holding permanent top-nav real estate (`LibraryNavItem`) for a near-zero-daily action.                           |
| **Reading mode** (one-at-a-time pager, `ReadingView`)          | **Demote to explainers only** | Review wants density + progress, not a slideshow; overlaps with scrolling. Not daily-core.                                                                  |
| **Point annotations** (📍)                                     | **Cut / fold into comment**   | Third redundant comment path (Move 4).                                                                                                                      |
| **Copy link / Open in new tab**                                | **Keep, stay hidden**         | Sharing, not daily. Already demoted to the ⋯ menu.                                                                                                          |
| **Version `Select` per card**                                  | **Keep, evolve**              | The daily-valuable form is a **v1↔v2 visual compare** (already a `TODO.md` item), not a bare version number — that's what you reach for in the revise loop. |
| **Approve/Dismiss on non-finding cards**                       | **Already cut** ✓             | They had no verdict to resolve there.                                                                                                                       |

Cutting Library and reading mode stings (both are wired and oracle-tested). But
every always-present nav item and every icon taxes the clarity of the things that
matter. The app should feel like it is _about_ the review loop — not a gallery of
capabilities.

---

## 5. Build order

Ranked strictly by daily-loop leverage:

1. **Close the loop by default** (Move 1) — reframe presence as Auto-replies
   On/Off, make connect the empty-state hero, surface the fix at the point of
   friction. _Nothing else matters as much._
2. **Review cockpit** (Move 2) — persistent open/resolved burndown, keyboard
   finding-nav, explicit "Review complete" terminal state.
3. **Three labeled verbs** (Move 3) on finding cards.
4. **Prune** (Move 4 + §4) — hide Library + reading mode, collapse the third
   comment path.

That sequence makes the app _do the one thing it promises_, then makes its
flagship workflow feel like a real review tool, then strips the noise around both.

---

## 6. Open decisions (confirm before building the affected move)

- **Move 1 reframing** — "Auto-replies On/Off" changes the app's central framing
  and leans hard on the `showcase watch` plugin as the default path. Confirm that's
  the intended primary route (vs. keeping `wait_for_feedback` parking as co-equal).
- **Cutting Library / reading mode** — these are shipped and oracle-guarded
  (`loop.spec.ts` covers pin-to-Library and reading-mode paging). Cutting means
  removing those oracle cases too. Confirm appetite before deleting working,
  tested features.
- **Point annotations** — fold-vs-cut. Folding preserves the line-comment anchor
  machinery (`CommentAnchor`) that review depends on; only the arbitrary-point
  pin would go.

---

## 7. The principle to hold

Every screen should answer, without the user asking: **will my next comment reach
the agent, and what's the one action this card wants from me?** When an affordance
doesn't help answer one of those two questions, it's chrome — quiet it, or cut it.
