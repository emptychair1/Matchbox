import test from "node:test";
import assert from "node:assert/strict";
import { createMatchbox } from "../src/index.js";

test("lights a verified match", async () => {
  const box = createMatchbox([{ name: "clock", run: () => ({ time: 12 }), verify: x => x.time === 12 }]);
  assert.deepEqual(await box.strike("clock"), { name: "clock", status: "light", value: { time: 12 } });
});

test("dud does not stop another match", async () => {
  const box = createMatchbox([
    { name: "clock", run: () => { throw new Error("clock broken"); } },
    { name: "voice", run: () => "still talking" }
  ]);
  assert.equal((await box.strike("clock")).status, "dud");
  assert.equal((await box.strike("voice")).status, "light");
});

test("blocked, unstruck and event reporting", async () => {
  const events = [];
  const box = createMatchbox([{ name: "clock", validate: () => false, run: () => 1 }], { onEvent: e => events.push(e.type) });
  box.expect("clock");
  box.expect("voice");
  assert.deepEqual(box.report().unstruck, ["clock", "voice"]);
  assert.equal((await box.strike("clock")).status, "blocked");
  assert.deepEqual(box.report().unstruck, ["voice"]);
  assert.deepEqual(events, ["strike", "blocked"]);
});

test("missing match is blocked and not mistaken for success", async () => {
  const box = createMatchbox();
  assert.equal((await box.strike("forge")).status, "blocked");
});

test("unverified result is a dud", async () => {
  const box = createMatchbox([{ name: "forge", run: () => ({ sha: "invented" }), verify: () => false }]);
  assert.equal((await box.strike("forge")).status, "dud");
});
