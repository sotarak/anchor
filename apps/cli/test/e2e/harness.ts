// End-to-end harness: runs the real Anchor Worker (apps/server) locally.
//
// Mechanism (verified against wrangler 4.158): `createTestHarness` from `wrangler`, the documented
// successor of unstable_dev/unstable_startWorker. Test-only secrets go through the worker input's
// `secrets` option (overriding .dev.vars, so nothing is written into the repo), migrations through
// `getWorker().applyD1Migrations("DB")`, and storage is local to the harness session.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

const serverConfig = fileURLToPath(new URL("../../../../wrangler.jsonc", import.meta.url));

export async function startAnchor(): Promise<{
  url: string;
  stop(): Promise<void>;
}> {
  const server = createTestHarness({
    workers: [
      {
        configPath: serverConfig,
        secrets: {
          ANCHOR_ROOT_KEY: randomBytes(32).toString("base64"),
        },
      },
    ],
  });
  const { url } = await server.listen();
  await server.getWorker().applyD1Migrations("DB");
  return { url: url.origin, stop: () => server.close() };
}
