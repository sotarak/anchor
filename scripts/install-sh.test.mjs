// Offline tests of apps/docs/public/install.sh: a fake `uname` picks the platform and
// ANCHOR_DOWNLOAD_BASE points curl at file:// fixtures shaped like GitHub release downloads.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../apps/docs/public/install.sh", import.meta.url));
const ASSETS = [
  "anchor-darwin-arm64",
  "anchor-darwin-x64",
  "anchor-linux-x64",
  "anchor-linux-arm64",
  "anchor-windows-x64.exe",
];

const fakeBinary = (output) => `#!/bin/sh\necho ${output}\n`;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function writeRelease(dir, bodies) {
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(dir, name), body);
    lines.push(`${sha256(body)}  ${name}`);
  }
  writeFileSync(join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

/** A temp dir with fake releases (latest prints 9.9.9, v0.2.0 prints 0.2.0) and a fake uname. */
function fixture({ os = "Linux", arch = "x86_64", latest = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "anchor-install-"));
  const bodies = (version) => Object.fromEntries(ASSETS.map((a) => [a, fakeBinary(version)]));
  writeRelease(join(tmp, "releases/latest/download"), { ...bodies("9.9.9"), ...latest });
  writeRelease(join(tmp, "releases/download/v0.2.0"), bodies("0.2.0"));
  const shim = join(tmp, "shim");
  mkdirSync(shim);
  writeFileSync(
    join(shim, "uname"),
    `#!/bin/sh\ncase "$1" in -m) echo '${arch}' ;; *) echo '${os}' ;; esac\n`,
  );
  chmodSync(join(shim, "uname"), 0o755);
  return {
    tmp,
    shim,
    bin: join(tmp, "bin"),
    sums: join(tmp, "releases/latest/download/SHA256SUMS"),
  };
}

function runInstall(fx, env = {}) {
  const r = spawnSync("/bin/sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: `${fx.shim}:${process.env.PATH}`,
      HOME: fx.tmp,
      ANCHOR_DOWNLOAD_BASE: `file://${fx.tmp}/releases`,
      ANCHOR_INSTALL_DIR: fx.bin,
      ...env,
    },
  });
  return { code: r.status, stderr: r.stderr };
}

const runBin = (path) => execFileSync(path, ["--version"], { encoding: "utf8" }).trim();

test("installs the latest linux-x64 binary as anchor and anchor-secrets", () => {
  const fx = fixture();
  const r = runInstall(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(runBin(join(fx.bin, "anchor")), "9.9.9");
  assert.equal(runBin(join(fx.bin, "anchor-secrets")), "9.9.9");
  assert.ok(statSync(join(fx.bin, "anchor")).mode & 0o111);
  assert.ok(lstatSync(join(fx.bin, "anchor-secrets")).isSymbolicLink());
});

test("maps aarch64 to the arm64 asset", () => {
  const fx = fixture({ arch: "aarch64", latest: { "anchor-linux-arm64": fakeBinary("arm") } });
  const r = runInstall(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(runBin(join(fx.bin, "anchor")), "arm");
});

test("pins ANCHOR_VERSION with or without a leading v", () => {
  const fx = fixture();
  for (const [version, expected] of [
    ["0.2.0", "0.2.0"],
    ["v0.2.0", "0.2.0"],
    ["latest", "9.9.9"],
  ]) {
    const r = runInstall(fx, { ANCHOR_VERSION: version });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(runBin(join(fx.bin, "anchor")), expected, version);
  }
});

test("rejects a malformed ANCHOR_VERSION", () => {
  const fx = fixture();
  for (const version of ["0.2", "1", "0.2.0.1", "0..2", "0.2.0-"]) {
    const r = runInstall(fx, { ANCHOR_VERSION: version });
    assert.equal(r.code, 1, version);
    assert.ok(r.stderr.includes(`must look like 0.2.0 or v0.2.0, got: ${version}`), r.stderr);
    assert.equal(existsSync(join(fx.bin, "anchor")), false);
  }
});

test("fails closed on a checksum mismatch and keeps the existing binary", () => {
  const fx = fixture();
  mkdirSync(fx.bin);
  writeFileSync(join(fx.bin, "anchor"), fakeBinary("old"));
  chmodSync(join(fx.bin, "anchor"), 0o755);
  const sums = readFileSync(fx.sums, "utf8").replace(
    /^[0-9a-f]{64}( {2}anchor-linux-x64)$/m,
    `${"0".repeat(64)}$1`,
  );
  writeFileSync(fx.sums, sums);
  const r = runInstall(fx);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /checksum/i);
  assert.equal(runBin(join(fx.bin, "anchor")), "old");
  assert.deepEqual(readdirSync(fx.bin), ["anchor"]);
});

test("fails when the asset is missing from SHA256SUMS", () => {
  const fx = fixture();
  const sums = readFileSync(fx.sums, "utf8").replace(/^.* {2}anchor-linux-x64\n/m, "");
  writeFileSync(fx.sums, sums);
  const r = runInstall(fx);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /anchor-linux-x64/);
  assert.equal(existsSync(join(fx.bin, "anchor")), false);
});

test("rejects an unsupported OS and points to npm", () => {
  const fx = fixture({ os: "FreeBSD" });
  const r = runInstall(fx);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /FreeBSD/);
  assert.ok(r.stderr.includes("npm install -g @anchor-secrets/cli"), r.stderr);
});

test("verifies with shasum when sha256sum is absent", () => {
  const fx = fixture();
  const restricted = join(fx.tmp, "restricted");
  mkdirSync(restricted);
  const which = (tool) =>
    execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
  for (const tool of ["curl", "mktemp", "rm", "mkdir", "cp", "chmod", "mv", "ln"]) {
    symlinkSync(which(tool), join(restricted, tool));
  }
  // Prefer the real shasum; fall back to sha256sum (dropping `-a 256`) on hosts without it.
  const marker = join(fx.tmp, "shasum-called");
  let real;
  try {
    real = `exec ${which("shasum")} "$@"`;
  } catch {
    real = `for a; do last=$a; done; exec ${which("sha256sum")} "$last"`;
  }
  writeFileSync(join(restricted, "shasum"), `#!/bin/sh\n: > '${marker}'\n${real}\n`);
  chmodSync(join(restricted, "shasum"), 0o755);

  const r = runInstall(fx, { PATH: `${fx.shim}:${restricted}` });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(marker), "shasum was not used");
  assert.equal(runBin(join(fx.bin, "anchor")), "9.9.9");
});

test("hints only when the install dir is not on PATH", () => {
  const fx = fixture();
  const hint = `export PATH="${fx.bin}:$PATH"`;
  const off = runInstall(fx);
  assert.equal(off.code, 0, off.stderr);
  assert.ok(off.stderr.includes(hint), off.stderr);
  const on = runInstall(fx, { PATH: `${fx.bin}:${fx.shim}:${process.env.PATH}` });
  assert.equal(on.code, 0, on.stderr);
  assert.ok(!on.stderr.includes(hint), on.stderr);
});

test("installs anchor.exe without an alias on Windows shells", () => {
  const fx = fixture({ os: "MINGW64_NT-10.0-20348" });
  const r = runInstall(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readdirSync(fx.bin), ["anchor.exe"]);
});
