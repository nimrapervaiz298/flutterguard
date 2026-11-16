import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor } from "../src/report";

const rep = (items: { severity: string; confidence: string }[], failed = false) =>
  ({
    checks: failed ? [{ name: "x", status: "failed" }] : [{ name: "x", status: "ok" }],
    summary: { bySeverity: items.reduce((acc: any, d) => ({ ...acc, [d.severity]: (acc[d.severity] || 0) + 1 }), { critical: 0, high: 0, medium: 0, low: 0, info: 0 }) },
    diagnostics: items,
  }) as any;

test("default min-confidence keeps the old behaviour", () => {
  assert.equal(exitCodeFor(rep([{ severity: "high", confidence: "low" }]), "high"), 1);
});

test("min-confidence high ignores a high severity finding of low confidence", () => {
  assert.equal(exitCodeFor(rep([{ severity: "high", confidence: "low" }]), "high", "high"), 0);
});

test("min-confidence high still fails on a high-confidence finding", () => {
  assert.equal(exitCodeFor(rep([{ severity: "high", confidence: "high" }]), "high", "high"), 1);
});

test("min-confidence medium counts medium and high", () => {
  assert.equal(exitCodeFor(rep([{ severity: "medium", confidence: "medium" }]), "medium", "medium"), 1);
  assert.equal(exitCodeFor(rep([{ severity: "medium", confidence: "low" }]), "medium", "medium"), 0);
});

test("a failed check is still exit code 2", () => {
  assert.equal(exitCodeFor(rep([], true), "high", "high"), 2);
});