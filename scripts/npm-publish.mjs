// Publishes one npm package version so that a re-run succeeds when the version is already out:
// published by hand (a new package's first publish), or by an earlier run whose publish the
// registry accepted but was slow to show. Used by .github/workflows/release-cli.yml.
//
//   node scripts/npm-publish.mjs <tarball> <name>@<version> <npm-tag>
import { execFile, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Runs `publish`; when it fails, checks `view` up to `attempts` times, `delayMs` apart.
 *
 * @param {{
 *   publish: () => Promise<void>,
 *   view: () => Promise<boolean>,
 *   sleep: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   delayMs?: number,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<"published" | "already-published">}
 */
export async function publishOnce({
  publish,
  view,
  sleep,
  attempts = 10,
  delayMs = 30_000,
  log = () => {},
}) {
  try {
    await publish();
    return "published";
  } catch (error) {
    for (let i = 1; i <= attempts; i++) {
      if (i > 1) await sleep(delayMs);
      const visible = await view().catch(() => false);
      if (visible) return "already-published";
      log(`not visible on npm yet (check ${i} of ${attempts})`);
    }
    throw error;
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited with ${code}`)),
    );
  });
}

function visible(spec) {
  return new Promise((resolve) => {
    execFile("npm", ["view", spec, "version"], (error, stdout) =>
      resolve(!error && stdout.trim() !== ""),
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [tarball, spec, tag] = process.argv.slice(2);
  if (!tarball || !spec || !tag) {
    console.error("usage: node scripts/npm-publish.mjs <tarball> <name>@<version> <npm-tag>");
    process.exit(2);
  }
  try {
    const outcome = await publishOnce({
      publish: () => run("npm", ["publish", tarball, "--access", "public", "--tag", tag]),
      view: () => visible(spec),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => console.error(line),
    });
    if (outcome === "already-published") {
      console.log(`::notice::${spec} is already on npm; the publish error above is expected`);
    }
  } catch (error) {
    console.error(`::error::could not publish ${spec}: ${error.message}`);
    process.exit(1);
  }
}
