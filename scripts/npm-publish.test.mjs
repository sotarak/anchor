import assert from "node:assert/strict";
import { test } from "node:test";
import { publishOnce } from "./npm-publish.mjs";

function rig({ publishError, visibleOnView = Number.POSITIVE_INFINITY } = {}) {
  const calls = { publish: 0, view: 0, sleeps: [], logs: [] };
  return {
    calls,
    opts: {
      publish: async () => {
        calls.publish++;
        if (publishError) throw publishError;
      },
      view: async () => ++calls.view >= visibleOnView,
      sleep: async (ms) => {
        calls.sleeps.push(ms);
      },
      log: (line) => calls.logs.push(line),
    },
  };
}

test("publishes once", async () => {
  const r = rig();
  assert.equal(await publishOnce(r.opts), "published");
  assert.equal(r.calls.publish, 1);
  assert.equal(r.calls.view, 0);
  assert.deepEqual(r.calls.sleeps, []);
});

test("a failed publish whose version appears on the 3rd view resolves already-published and slept twice", async () => {
  const r = rig({ publishError: new Error("E403 cannot publish over"), visibleOnView: 3 });
  assert.equal(await publishOnce(r.opts), "already-published");
  assert.equal(r.calls.publish, 1);
  assert.equal(r.calls.view, 3);
  assert.deepEqual(r.calls.sleeps, [30_000, 30_000]);
});

test("a failed publish that never appears rethrows after 10 views", async () => {
  const error = new Error("E404 not found");
  const r = rig({ publishError: error });
  await assert.rejects(publishOnce(r.opts), (e) => e === error);
  assert.equal(r.calls.view, 10);
  assert.equal(r.calls.sleeps.length, 9);
});

test("a view that throws counts as not visible", async () => {
  const error = new Error("E500");
  const r = rig({ publishError: error });
  r.opts.view = async () => {
    r.calls.view++;
    throw new Error("network");
  };
  await assert.rejects(publishOnce({ ...r.opts, attempts: 2, delayMs: 1 }), (e) => e === error);
  assert.equal(r.calls.view, 2);
  assert.deepEqual(r.calls.sleeps, [1]);
});
