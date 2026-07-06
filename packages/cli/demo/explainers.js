// An animated explainer built on the `animate` kit: steps reveal one at a time
// (play/pause + scrub injected by the kit), building up the concept. The kind of
// thing the "explain this on showcase" loop produces.
const HASHMAP_EXPLAINER = `
<div class="anim">
  <div class="step">
    <h2 style="margin:0 0 8px">How a hash map gets O(1)</h2>
    <p class="dim">Arrays find an item by scanning. A hash map jumps straight to it. Press play, or scrub.</p>
  </div>
  <div class="step"><p>You store a value under a <b>key</b> — say <code>"sky" → "#4a90d9"</code>.</p></div>
  <div class="step"><p>A <span class="cue">hash function</span> turns the key into a number, then mod the table size gives a <b>bucket index</b>: <code>hash("sky") % 8 = 3</code>.</p></div>
  <div class="step"><p>The value is dropped into <b>bucket 3</b>. No scanning — the key <i>computed</i> its own address.</p></div>
  <div class="step"><p>Looking it up re-runs the same hash on <code>"sky"</code> → bucket 3 → the value, in <b>one step</b>. That's the O(1).</p></div>
  <div class="step"><p>When two keys hash to the same bucket — a <span class="cue">collision</span> — they chain in a little list there. Rare, so lookups stay fast on average.</p></div>
</div>`;

export const explainersSession = {
  agent: "claude-code",
  title: "Explainers",
  snippets: [
    {
      title: "How a hash map gets O(1)",
      badge: { tone: "info", label: "Explainer" },
      parts: [{ kind: "html", html: HASHMAP_EXPLAINER, kits: ["animate"] }],
    },
  ],
};
