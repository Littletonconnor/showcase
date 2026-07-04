// Seed content for `showcase demo`, one module per session/lesson. Keep this
// tree dependency-free like the CLI.
import { authSession } from "./auth.js";
import { commentPipeSession } from "./commentPipe.js";
import { effectLesson } from "./effect.js";
import { explainersSession } from "./explainers.js";
import { mockupsSession } from "./mockups.js";
import { notificationsSession } from "./notifications.js";
import { queueSession } from "./queue.js";
import { redisLesson } from "./redis.js";
import { reviewSession } from "./review.js";
import { showcaseTourLesson } from "./showcaseTour.js";

// Seeded in order; the viewer sorts sessions by last activity, so the last
// session here ends up on top.
export const DEMO_SESSIONS = [
  mockupsSession,
  explainersSession,
  reviewSession,
  queueSession,
  authSession,
  notificationsSession,
  commentPipeSession,
];

// Three lessons published through the REAL pipeline (POST /api/lessons) by
// `showcase demo` - the acceptance bar for the teach skill's output shape:
// every beat element (hook, model, worked example, gated explorable,
// misconception-tagged checkpoints, recap) appears in each lesson.
export const DEMO_LESSONS = [redisLesson, effectLesson, showcaseTourLesson];
