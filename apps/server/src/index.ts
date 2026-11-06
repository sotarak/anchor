import { createApp } from "./app";
import { handleScheduled } from "./audit/scheduled";
import type { Bindings } from "./env";
import { handleReencryptBatch } from "./keys/queue";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handleReencryptBatch,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Bindings>;
