export const redisLesson = {
  topic: "Redis eviction policies",
  learnerLevel: "novice",
  sessionTitle: "Learn: Redis eviction",
  conceptGraph: {
    concepts: [
      {
        id: "maxmemory",
        label: "maxmemory + noeviction",
        misconceptions: [
          "Redis evicts old keys by default",
          "maxmemory bounds only the dataset, not overhead",
        ],
      },
      {
        id: "policies",
        label: "Eviction policies",
        misconceptions: ["allkeys-lru and volatile-lru differ only in speed"],
      },
      {
        id: "approx-lru",
        label: "Approximated LRU",
        misconceptions: ["Redis tracks a true LRU list", "eviction is FIFO"],
      },
    ],
    edges: [
      ["maxmemory", "policies"],
      ["policies", "approx-lru"],
    ],
  },
  beats: [
    {
      conceptId: "maxmemory",
      hook: {
        id: "redis-hook",
        conceptId: "maxmemory",
        kind: "predict",
        prompt:
          "A Redis instance has `maxmemory 100mb` and NO eviction policy configured. Memory is full. What happens on the next `SET`?",
        options: [
          {
            id: "a",
            label: "The oldest key is evicted to make room",
            misconception: "Redis evicts old keys by default",
          },
          { id: "b", label: "The write fails with an OOM error", correct: true },
          { id: "c", label: "Redis swaps cold keys to disk" },
        ],
        askConfidence: true,
        reveal:
          "The write FAILS: the default policy is `noeviction`. Redis never silently drops data unless you opt in - eviction is a cache behavior you must choose.",
      },
      model: [
        {
          kind: "markdown",
          markdown:
            "`maxmemory` is the ceiling; `maxmemory-policy` decides what happens at the ceiling. The default, `noeviction`, returns errors on writes rather than dropping data - Redis-as-database semantics. Every other policy turns Redis into a cache that sheds keys.",
        },
        {
          kind: "mermaid",
          mermaid:
            'flowchart LR\n  W["write"] --> F{"memory full?"}\n  F -- no --> OK["stored"]\n  F -- yes --> P{"maxmemory-policy"}\n  P -- noeviction --> E["OOM error"]\n  P -- anything else --> V["evict a victim, then store"]',
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "text",
          title: "redis-cli",
          code: '127.0.0.1:6379> CONFIG SET maxmemory 100mb\nOK\n127.0.0.1:6379> CONFIG GET maxmemory-policy\n1) "maxmemory-policy"\n2) "noeviction"\n127.0.0.1:6379> SET big:1 <payload>   # once memory is full:\n(error) OOM command not allowed when used memory > \'maxmemory\'.',
        },
      ],
      checkpoints: [
        {
          id: "redis-cp-1",
          conceptId: "maxmemory",
          kind: "mcq",
          prompt:
            "Your cache-aside service starts throwing OOM errors from Redis. What is the FIRST config to check?",
          options: [
            {
              id: "a",
              label: "`maxmemory-policy` - it is probably still `noeviction`",
              correct: true,
            },
            {
              id: "b",
              label: "`maxmemory-samples` - sampling is too small",
              misconception: "sampling causes OOM",
            },
            { id: "c", label: "`appendonly` - AOF is filling memory" },
          ],
          reveal:
            "A cache that OOMs on writes is almost always running the database default: `noeviction`. Pick an eviction policy that matches how you use keys.",
        },
      ],
      recap:
        "maxmemory sets the ceiling; the policy chooses error-at-the-edge (default) or evict-at-the-edge.",
    },
    {
      conceptId: "policies",
      model: [
        {
          kind: "markdown",
          markdown:
            "Policies differ on two axes: **which keys are candidates** (`allkeys-*` = every key; `volatile-*` = only keys WITH a TTL) and **how the victim is picked** (`lru`, `lfu`, `random`, `ttl`). So `volatile-lru` on a dataset with no TTLs has zero candidates - and behaves like `noeviction`.",
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "text",
          title: "choosing a policy",
          code: "# session cache, every key has a TTL, hot set matters:\nCONFIG SET maxmemory-policy volatile-lru\n\n# pure cache, no TTLs, recency matters:\nCONFIG SET maxmemory-policy allkeys-lru\n\n# pure cache, frequency beats recency (scan-resistant):\nCONFIG SET maxmemory-policy allkeys-lfu",
        },
      ],
      checkpoints: [
        {
          id: "redis-cp-2",
          conceptId: "policies",
          kind: "mcq",
          prompt:
            "You set `volatile-lru` but NONE of your keys have TTLs. Memory fills. What happens on the next write?",
          options: [
            { id: "a", label: "The least-recently-used key is evicted anyway" },
            {
              id: "b",
              label: "The write fails - no key is an eviction candidate",
              correct: true,
            },
            {
              id: "c",
              label: "Redis assigns a default TTL and evicts",
              misconception: "allkeys-lru and volatile-lru differ only in speed",
            },
          ],
          reveal:
            "`volatile-*` policies can only evict keys that carry a TTL. With none, the candidate set is empty and writes fail exactly like `noeviction`.",
        },
        {
          id: "redis-cp-3",
          conceptId: "policies",
          kind: "explain",
          prompt: "In your own words: when would you pick `allkeys-lfu` over `allkeys-lru`?",
          askConfidence: true,
          reveal:
            "Model answer: LFU keeps FREQUENTLY used keys, LRU keeps RECENTLY used ones. A one-off bulk scan touches everything once and, under LRU, flushes your genuinely hot keys; LFU is scan-resistant because a single touch doesn't outrank sustained frequency.",
        },
      ],
      recap:
        "Candidates (allkeys vs volatile) x selector (lru/lfu/random/ttl). volatile-* with no TTLs = noeviction.",
    },
    {
      conceptId: "approx-lru",
      model: [
        {
          kind: "markdown",
          markdown:
            "Redis does NOT keep a true LRU list - a doubly-linked list over millions of keys costs memory and cache misses. Instead each key stores a 24-bit clock; at eviction time Redis SAMPLES `maxmemory-samples` keys (default 5) and evicts the best candidate from the sample. More samples = closer to true LRU, more CPU.",
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "text",
          title: "tuning the approximation",
          code: "CONFIG SET maxmemory-samples 10   # closer to true LRU, more CPU per eviction\nCONFIG SET maxmemory-samples 3    # cheaper, sloppier",
        },
      ],
      explorable: {
        gate: {
          id: "redis-gate",
          conceptId: "approx-lru",
          kind: "predict",
          prompt:
            "Before you play: with sample size 5 out of 1000 keys, can the GLOBALLY oldest key survive an eviction round?",
          options: [
            {
              id: "a",
              label: "No - LRU always finds the oldest",
              misconception: "Redis tracks a true LRU list",
            },
            {
              id: "b",
              label: "Yes - it survives whenever it is not in the sample",
              correct: true,
            },
          ],
          reveal:
            "Yes. Eviction only sees the sample. Now drag the sample size below and watch the odds change.",
        },
        html: '<div class="panel stack lg"><span class="eyebrow">Sampled eviction</span><p class="dim">Drag the sample size. The bar shows the chance the true oldest key is picked this round (sample/keyspace, 1000 keys).</p><label class="row" style="gap:10px">samples <input id="s" type="range" min="1" max="100" value="5" style="flex:1"> <b id="v">5</b></label><div class="bar" style="margin-top:8px"><i id="p" style="width:0.5%"></i></div><p class="dim" id="t">0.5% chance the global oldest is even seen.</p><script>var s=document.getElementById("s"),v=document.getElementById("v"),p=document.getElementById("p"),t=document.getElementById("t");s.addEventListener("input",function(){var n=+s.value;v.textContent=n;var pct=(n/1000*100).toFixed(1);p.style.width=pct+"%";t.textContent=pct+"% chance the global oldest is even seen.";if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"samples",value:String(n)});});</script></div>',
      },
      checkpoints: [
        {
          id: "redis-cp-4",
          conceptId: "approx-lru",
          kind: "trace",
          prompt:
            "Keys A(idle 90s), B(idle 10s), C(idle 400s), D(idle 30s). The sampler draws {A, B, D} under `allkeys-lru`. Which key is evicted? (one letter)",
          expected: "A",
          reveal:
            "A - the oldest IN THE SAMPLE. C, the true oldest, was never drawn, so it survives. That is the whole approximation in one round.",
        },
      ],
      recap:
        "Eviction picks the best of a small random sample, not the global optimum - cheap, and close enough.",
    },
  ],
};
