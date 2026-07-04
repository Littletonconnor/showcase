export const effectLesson = {
  topic: "Effect-TS error model",
  learnerLevel: "intermediate",
  sessionTitle: "Learn: Effect-TS errors",
  conceptGraph: {
    concepts: [
      {
        id: "typed-errors",
        label: "Errors in the type",
        misconceptions: ["Effect errors are just typed exceptions that still unwind"],
      },
      {
        id: "defects",
        label: "Failures vs defects",
        misconceptions: ["catchAll also catches defects"],
      },
      {
        id: "recovery",
        label: "Typed recovery",
        misconceptions: ["handling one error still leaves the channel dirty"],
      },
    ],
    edges: [
      ["typed-errors", "defects"],
      ["typed-errors", "recovery"],
    ],
  },
  beats: [
    {
      conceptId: "typed-errors",
      hook: {
        id: "fx-hook",
        conceptId: "typed-errors",
        kind: "predict",
        prompt:
          "An `Effect<User, DbError | NotFound>` flows through `Effect.map`. You handle `NotFound` with `catchTag`. What is the error type now?",
        options: [
          {
            id: "a",
            label: "Still `DbError | NotFound` - handling does not narrow",
            misconception: "handling one error still leaves the channel dirty",
          },
          {
            id: "b",
            label: "`DbError` - the handled case is REMOVED from the type",
            correct: true,
          },
        ],
        reveal:
          "`DbError`. The error channel is an ordinary type parameter: handling a case subtracts it. The compiler now proves NotFound cannot escape.",
      },
      model: [
        {
          kind: "markdown",
          markdown:
            "`Effect<A, E, R>` carries its failure mode in `E`, the same way it carries its success in `A`. Nothing unwinds invisibly: an error is a VALUE routed through the error channel, and every combinator states what it does to that channel. `throw` tells you nothing at the type level; `E` tells you everything.",
        },
        {
          kind: "code",
          language: "ts",
          title: "the error is in the signature",
          code: 'class DbError extends Data.TaggedError("DbError")<{ cause: unknown }> {}\nclass NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}\n\nconst getUser = (id: string): Effect.Effect<User, DbError | NotFound> =>\n  Effect.gen(function* () {\n    const row = yield* query(id);        // can fail: DbError\n    if (!row) return yield* new NotFound({ id });\n    return row;\n  });',
        },
      ],
      checkpoints: [
        {
          id: "fx-cp-1",
          conceptId: "typed-errors",
          kind: "mcq",
          prompt: "What is the closest plain-TypeScript analog to the `E` in `Effect<A, E>`?",
          options: [
            { id: "a", label: "A `throws` clause that actually type-checks", correct: true },
            {
              id: "b",
              label: "A try/catch that rethrows",
              misconception: "Effect errors are just typed exceptions that still unwind",
            },
            { id: "c", label: "`Promise.reject`" },
          ],
          reveal:
            "It is the checked-exceptions idea done right: the possible failures ride the signature, and the compiler enforces that you either handle them or pass them on.",
        },
      ],
      recap:
        "The error channel is a type parameter: failures are values, and handling subtracts from the type.",
    },
    {
      conceptId: "defects",
      model: [
        {
          kind: "markdown",
          markdown:
            "Effect splits the world in two: **failures** (expected, typed, in `E` - the domain saying no) and **defects** (bugs: a thrown TypeError, a failed invariant - `Effect.die`). Failure combinators (`catchAll`, `catchTag`, `either`) see ONLY failures. Defects bypass them and crash the fiber, because retrying a bug is not a strategy.",
        },
        {
          kind: "mermaid",
          mermaid:
            'flowchart TD\n  E["effect fails"] --> K{"expected?"}\n  K -- "yes: typed failure" --> F["error channel E"] --> C["catchTag / catchAll / either"]\n  K -- "no: defect (die)" --> D["fiber death"] --> X["exit / cause inspection only"]',
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "ts",
          title: "failure vs defect",
          code: 'const failure = Effect.fail(new NotFound({ id: "1" })); // E = NotFound\nconst defect  = Effect.die(new Error("impossible state")); // E = never!\n\n// catchAll clears failures - but the defect sails through it:\nconst handled = defect.pipe(Effect.catchAll(() => Effect.succeed("nope")));\n// handled still dies. Only Exit/Cause-level tools (e.g. Effect.exit,\n// Effect.catchAllCause) can even OBSERVE it.',
        },
      ],
      checkpoints: [
        {
          id: "fx-cp-2",
          conceptId: "defects",
          kind: "mcq",
          prompt:
            '`Effect.die(new Error("boom")).pipe(Effect.catchAll(() => Effect.succeed(1)))` - what runs?',
          options: [
            {
              id: "a",
              label: "Succeeds with 1 - catchAll caught it",
              misconception: "catchAll also catches defects",
            },
            {
              id: "b",
              label: "The fiber still dies - defects bypass failure handlers",
              correct: true,
            },
          ],
          reveal:
            "The fiber dies. `catchAll` sees the typed error channel only, and `die` never enters it - that is the point: bugs should crash loudly, not be silently retried.",
        },
        {
          id: "fx-cp-3",
          conceptId: "defects",
          kind: "explain",
          prompt:
            "Explain back: why does Effect route defects AROUND catchAll instead of through it?",
          reveal:
            "Model answer: failures are part of the domain contract and deserve typed handling; defects are broken invariants. If catchAll saw both, every recovery path would silently swallow bugs, and the type E would stop meaning anything.",
        },
      ],
      recap:
        "E is for expected failures; defects (die) bypass failure handlers and kill the fiber.",
    },
    {
      conceptId: "recovery",
      model: [
        {
          kind: "markdown",
          markdown:
            'Recovery combinators are set operations on `E`: `catchTag("NotFound", ...)` subtracts one member; `catchAll` empties the channel (`E = never`); `either` moves the failure into the success value as `Either<E, A>`. Read any pipeline\'s honesty off its final `E`.',
        },
      ],
      workedExample: [
        {
          kind: "code",
          language: "ts",
          title: "subtracting errors",
          code: 'const safe: Effect.Effect<User | Anonymous, DbError> = getUser(id).pipe(\n  Effect.catchTag("NotFound", () => Effect.succeed(Anonymous)),\n);\n// NotFound is GONE from the type. Only DbError remains to answer for.',
        },
      ],
      explorable: {
        gate: {
          id: "fx-gate",
          conceptId: "recovery",
          kind: "predict",
          prompt: "Predict: after `either`, what is the error type of the resulting effect?",
          options: [
            { id: "a", label: "Unchanged - either only wraps the success" },
            {
              id: "b",
              label: "`never` - the failure moved into the success value",
              correct: true,
            },
          ],
          reveal:
            "`never`. The failure is now DATA in the success channel. Try the combinators below.",
        },
        html: '<div class="panel stack lg"><span class="eyebrow">The error channel as a set</span><p class="dim">Start: <span class="mono">E = DbError | NotFound | Timeout</span>. Click a combinator; watch E shrink.</p><div class="row" style="gap:8px;flex-wrap:wrap"><button data-op="catchTag(&quot;NotFound&quot;)" data-rm="NotFound">catchTag("NotFound")</button><button data-op="catchTag(&quot;Timeout&quot;)" data-rm="Timeout">catchTag("Timeout")</button><button data-op="catchAll" data-rm="*">catchAll(...)</button><button data-op="reset" data-rm="reset">reset</button></div><p style="margin-top:10px">E = <b id="e" class="mono">DbError | NotFound | Timeout</b></p><script>var all=["DbError","NotFound","Timeout"],cur=all.slice(),el=document.getElementById("e");function render(){el.textContent=cur.length?cur.join(" | "):"never";}document.querySelectorAll("button[data-rm]").forEach(function(b){b.addEventListener("click",function(){var rm=b.getAttribute("data-rm");if(rm==="reset"){cur=all.slice();}else if(rm==="*"){cur=[];}else{cur=cur.filter(function(x){return x!==rm});}render();if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"combinator",value:b.getAttribute("data-op")});});});</script></div>',
      },
      checkpoints: [
        {
          id: "fx-cp-4",
          conceptId: "recovery",
          kind: "apply",
          prompt:
            "You have `Effect<Config, ParseError | IOError>`. Requirement: a ParseError falls back to defaults; an IOError must still be visible to the caller. Which combinator, and what is the final type? (one line)",
          reveal:
            'Model answer: `Effect.catchTag("ParseError", () => Effect.succeed(defaults))` giving `Effect<Config, IOError>` - subtract exactly the handled case, leave the rest honest.',
        },
      ],
      recap:
        "Recovery = set subtraction on E. The final E is the function's honest failure contract.",
    },
  ],
};
