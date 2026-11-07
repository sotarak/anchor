declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    ANCHOR_ROOT_KEY: string;
    ANCHOR_ROOT_KEY_ID?: string;
    ANCHOR_ROOT_KEY_PREVIOUS?: string;
    ANCHOR_ROOT_KEY_PREVIOUS_ID?: string;
    REENCRYPT_QUEUE: Queue<import("../../src/keys/rotation").ReencryptMessage>;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
