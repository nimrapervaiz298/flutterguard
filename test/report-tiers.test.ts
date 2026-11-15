import test from "node:test";
import assert from "node:assert/strict";
import { groupByConfidence } from "../src/report";

const d = (rule: string, severity: string, confidence: string) => ({ rule, severity, confidence }) as any;

test("findings are grouped by confidence into confirmed, likely and hints", () => {
  const g = groupByConfidence([
    d("a", "high", "high"),
    d("b", "high", "medium"),
    d("c", "medium", "low"),
  ]);
  assert.deepEqual(g.confirmed.map((x: any) => x.rule), ["a"]);
  assert.deepEqual(g.likely.map((x: any) => x.rule), ["b"]);
  assert.deepEqual(g.hints.map((x: any) => x.rule), ["c"]);
});

test("info and low severity findings are left out", () => {
  const g = groupByConfidence([d("a", "info", "high"), d("b", "low", "low")]);
  assert.equal(g.confirmed.length + g.likely.length + g.hints.length, 0);
});

test("each group shows at most 15", () => {
  const many = Array.from({ length: 20 }, (_, i) => d("r" + i, "high", "high"));
  assert.equal(groupByConfidence(many).confirmed.length, 15);
});