import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor } from "../src/report";

const mk = (bySeverity: Record<string, number>, failed = false) =>
  ({
    checks: failed ? [{ name: "x", status: "failed" }] : [{ name: "x", status: "ok" }],
    summary: { bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...bySeverity } },
  }) as any;

test("default still fails only on high or critical", () => {
  assert.equal(exitCodeFor(mk({ medium: 3 })), 0);
  assert.equal(exitCodeFor(mk({ high: 1 })), 1);
});

test("fail-on medium fails on a medium finding", () => {
  assert.equal(exitCodeFor(mk({ medium: 1 }), "medium"), 1);
  assert.equal(exitCodeFor(mk({ low: 5 }), "medium"), 0);
});

test("fail-on low includes low and above", () => {
  assert.equal(exitCodeFor(mk({ low: 1 }), "low"), 1);
  assert.equal(exitCodeFor(mk({ info: 4 }), "low"), 0);
});

test("a failed check is still exit code 2 whatever fail-on says", () => {
  assert.equal(exitCodeFor(mk({}, true), "info"), 2);
});