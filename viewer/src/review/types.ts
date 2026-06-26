// The agent-era review form factor — data model. See docs/review-form-factor.md.
// A review is a plain-English Brief plus a risk-ranked queue of decisions; the
// agent argues, the human judges. Evidence reuses the existing surface parts
// (diff/mermaid/code/markdown), rendered in the right pane.
import type { SurfacePart } from "../api.ts";

export type DecisionCall = "block" | "ship" | "decide";
export type DecisionScope = "changed-line" | "whole-file" | "codebase";
export type Confidence = "high" | "medium" | "low";

// A declared verification gap — the target of a scoped "Prove it".
export interface DecisionGap {
  what: string; // what the agent did NOT check, in plain terms
  proveScope?: string; // the scoped task "Prove it" would dispatch
}

export interface Decision {
  call: DecisionCall;
  kind: string; // bug | fix | capability | refactor | migration | risk
  scope: DecisionScope; // how far the reviewer must look to judge it
  assertion: string; // one sentence — the conclusion
  impact?: string; // why it matters — who hits it, how bad
  confidence: Confidence;
  coverage: string; // what was / wasn't verified
  gaps?: DecisionGap[]; // declared uncertainties → each a [Prove it]
  pivot?: string; // conditional — "flips to ✅ if …"; omit unless there's a real fork
  evidence?: SurfacePart[]; // right-pane artifacts; absent → the row is full-width
}

export interface Review {
  brief: string; // ≤4 sentences, plain English, no identifiers
  verdict: "block" | "approve" | "comment"; // the bottom line (a consequence of the decisions)
  decisions: Decision[]; // risk-ranked; decisions[0] is the lede
}
