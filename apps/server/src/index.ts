import { createApp } from "./app";
import { handleScheduled } from "./audit/scheduled";
import type { Bindings } from "./env";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Bindings>;
