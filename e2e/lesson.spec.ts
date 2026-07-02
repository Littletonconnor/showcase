import { expect, test } from "@playwright/test";

// The learn-loop oracle: publish a lesson -> the reveal is STRUCTURALLY absent
// until an attempt -> a wrong mcq click reveals the resolution + misconception
// -> the attempt arrives on the agent's feedback channel as a [checkpoint]
// telemetry line -> the agent inserts a remediation card via the lesson-beat
// route and it renders. Also: the explorable stays locked behind its gate.
//
// Checkpoints render in the trusted origin (data, not markup), so unlike
// html/markdown parts their text IS reachable from the page DOM — that is by
// design, and it is what lets this oracle assert on reveal visibility.

// Topic per test AND per run: mastery is keyed by topic and persists in the
// mastery file across server restarts, so a reused topic would see stale state.
const RUN = Date.now().toString(36);
const LESSON = (topic: string) => ({
  topic: `${topic} ${RUN}`,
  learnerLevel: "novice",
  conceptGraph: {
    concepts: [{ id: "c1", label: "Concept One", misconceptions: ["the wrong model"] }],
    edges: [],
  },
  beats: [
    {
      conceptId: "c1",
      model: [{ kind: "markdown", markdown: "The mental model prose." }],
      explorable: {
        gate: {
          id: "e2e-gate",
          conceptId: "c1",
          kind: "predict",
          prompt: "Gate prediction prompt",
          options: [
            { id: "a", label: "Gate wrong answer" },
            { id: "b", label: "Gate right answer", correct: true },
          ],
          reveal: "GATE-REVEAL-TEXT",
        },
        html: "<p id='explorable-body'>explorable content</p>",
      },
      checkpoints: [
        {
          id: "e2e-cp",
          conceptId: "c1",
          kind: "mcq",
          prompt: "Which answer is right?",
          options: [
            { id: "a", label: "The wrong one", misconception: "the wrong model" },
            { id: "b", label: "The right one", correct: true },
          ],
          reveal: "SECRET-REVEAL-TEXT",
        },
      ],
      recap: "The recap line.",
    },
  ],
});

async function seedLesson(request: import("@playwright/test").APIRequestContext, topic: string) {
  const res = await request.post("/api/lessons", { data: LESSON(topic) });
  expect(res.status()).toBe(201);
  return (await res.json()) as {
    sessionId: string;
    syllabusId: string;
    beats: { surfaceId: string; conceptId: string }[];
  };
}

test("reveal is structurally absent pre-attempt, shown with the misconception after a miss", async ({
  page,
  request,
}) => {
  const lesson = await seedLesson(request, "e2e reveal gating");
  const beatId = lesson.beats[0].surfaceId;
  await page.goto(`/?surface=${beatId}`);

  const checkpoint = page.locator('[data-checkpoint="e2e-cp"]');
  await expect(checkpoint).toBeVisible();
  // The resolution text must not exist ANYWHERE in the DOM before an attempt —
  // not hidden, not collapsed: absent.
  await expect(page.locator("[data-reveal]")).toHaveCount(0);
  expect(await page.content()).not.toContain("SECRET-REVEAL-TEXT");

  // Commit the WRONG answer.
  await checkpoint.getByRole("button", { name: "The wrong one" }).click();
  await expect(checkpoint.locator("[data-reveal]")).toContainText("SECRET-REVEAL-TEXT");
  await expect(checkpoint).toContainText("the wrong model");
  await expect(checkpoint).toContainText("not quite");

  // The attempt reached the agent's channel as a telemetry line, exactly once,
  // with the misconception tag.
  const wait = await (
    await request.get(`/api/comments?session=${lesson.sessionId}&author=user&wait=5`)
  ).json();
  const texts = (wait.comments as { text: string }[]).map((c) => c.text);
  const line = texts.find((t) => t.startsWith("[checkpoint] e2e-cp"));
  expect(line).toBeTruthy();
  expect(line).toContain("INCORRECT");
  expect(line).toContain('misconception="the wrong model"');

  // The agent reacts: a remediation card lands via update_lesson semantics...
  const remediation = await request.post("/api/lessons/beats", {
    data: {
      session: lesson.sessionId,
      title: "Fixing the wrong model",
      beat: {
        conceptId: "c1",
        model: [{ kind: "markdown", markdown: "Remediation prose targeting the miss." }],
        checkpoints: [
          {
            id: "e2e-remed",
            conceptId: "c1",
            kind: "mcq",
            prompt: "Second try, fresh variant?",
            options: [
              { id: "a", label: "Still wrong" },
              { id: "b", label: "Now right", correct: true },
            ],
            reveal: "REMEDIATION-REVEAL",
          },
        ],
        recap: "Closed the gap.",
      },
    },
  });
  expect(remediation.status()).toBe(200);
  const card = await remediation.json();

  // ...and renders live in the session view.
  await page.goto(`/session/${lesson.sessionId}`);
  const remedCard = page.locator(`.card[data-id="${card.id}"]`);
  await expect(remedCard).toBeVisible();
  await expect(remedCard).toContainText("Remediation");
  await expect(remedCard.locator('[data-checkpoint="e2e-remed"]')).toBeVisible();
});

test("an explorable stays locked until its gate checkpoint is attempted", async ({
  page,
  request,
}) => {
  const lesson = await seedLesson(request, "e2e explorable gate");
  await page.goto(`/?surface=${lesson.beats[0].surfaceId}`);

  const card = page.locator(`.card[data-id="${lesson.beats[0].surfaceId}"]`);
  await expect(card).toBeVisible();
  // Locked: the placeholder is there and the explorable's iframe is NOT.
  // (Rich parts render in srcdoc iframes too, so target the html part's
  // /s/:id-sourced frame specifically.)
  const explorableFrame = card.locator('iframe[src*="/s/"]');
  await expect(card.locator('[data-explorable-locked="e2e-gate"]')).toBeVisible();
  await expect(explorableFrame).toHaveCount(0);

  // Commit the gate prediction (right or wrong — committing is what unlocks).
  await card
    .locator('[data-checkpoint="e2e-gate"]')
    .getByRole("button", { name: "Gate wrong answer" })
    .click();
  await expect(card.locator('[data-checkpoint="e2e-gate"] [data-reveal]')).toContainText(
    "GATE-REVEAL-TEXT",
  );
  await expect(card.locator('[data-explorable-locked="e2e-gate"]')).toHaveCount(0);
  await expect(explorableFrame).toHaveCount(1);
});

test("the syllabus card renders the concept graph and re-renders as mastery moves", async ({
  page,
  request,
}) => {
  const lesson = await seedLesson(request, "e2e syllabus");
  await page.goto(`/?surface=${lesson.syllabusId}`);
  const syllabus = page.locator(`.card[data-id="${lesson.syllabusId}"]`);
  await expect(syllabus).toBeVisible();
  await expect(syllabus).toContainText("Syllabus");
  // The mermaid graph + legend render sandboxed (unreachable by design); the
  // trusted header carries the version — v1 now, v2 after the live re-render.
  await expect(syllabus).toContainText("v1");
  // And the stored parts carry the concept graph.
  const before = await (await request.get(`/api/surfaces/${lesson.syllabusId}`)).json();
  expect(before.parts[0].mermaid).toContain("Concept One");
  expect(before.parts[0].mermaid).toContain(":::untouched");

  // A wrong attempt moves the concept to shaky; the server revises the
  // syllabus surface in place (v2) and the legend updates live.
  const res = await request.post("/api/telemetry", {
    data: {
      surface: lesson.beats[0].surfaceId,
      event: {
        v: 1,
        type: "checkpoint_attempt",
        checkpointId: "e2e-cp",
        conceptId: "c1",
        kind: "mcq",
        answer: ["a"],
        correct: false,
        misconception: "the wrong model",
        latencyMs: 1200,
      },
    },
  });
  expect(res.status()).toBe(201);
  // The trusted header flips to v2 as the SSE surface-updated lands...
  await expect(syllabus).toContainText("v2", { timeout: 10_000 });
  // ...and the re-rendered graph carries the shaky badge.
  const after = await (await request.get(`/api/surfaces/${lesson.syllabusId}`)).json();
  expect(after.version).toBe(2);
  expect(after.parts[0].mermaid).toContain(":::shaky");
});
