// The viewer's one fire-and-forget write path: JSON body in, one error-toast
// policy out. Callers pass `errorToast` when the user should hear about a
// failure (the comment/thread writes); telemetry-style writes omit it — a
// failed post must not block the learner, only the agent's copy is lost.
import { api } from "./api.ts";
import { toast } from "./state.ts";

export async function postJson(
  path: string,
  body: unknown,
  opts: { method?: "POST" | "PATCH"; errorToast?: string } = {},
): Promise<boolean> {
  try {
    await api(path, { method: opts.method ?? "POST", body: JSON.stringify(body) });
    return true;
  } catch {
    if (opts.errorToast) toast(opts.errorToast);
    return false;
  }
}
