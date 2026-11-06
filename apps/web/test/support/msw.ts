import { HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** One MSW server for the whole test run; per-test handlers via server.use(). */
export const server = setupServer();

/** An Anchor API error response: `{ error: { code, message } }`. */
export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}
