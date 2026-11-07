import test from "node:test";
import assert from "node:assert/strict";
import { makeTemplate, parseLabelFile, scoreLabels } from "../src/bench";
import type { DiagLike, LabelEntry, LabelFile } from "../src/bench";

const d = (id: string, rule: string, file = "lib/a.dart", line = 1): DiagLike => ({
  id,
  rule,
  location: { file, line },
});

const entry = (id: string, rule: string, verdict: LabelEntry["verdict"], note = ""): LabelEntry => ({
  id,
  rule,
  file: "lib/a.dart",
  line: 1,
  verdict,
  note,
});

test("template lists only findings of the chosen rule, all unlabeled", () => {
  const lf = makeTemplate([d("1", "perf/x"), d("2", "bloat/y"), d("3", "perf/z")], "perf/", "p");
  assert.deepEqual(lf.labels.map((l) => l.id), ["1", "3"]);
  assert.ok(lf.labels.every((l) => l.verdict === "unlabeled"));
});

test("template keeps existing verdicts, notes and labels of other rules", () => {
  const existing: LabelFile = {
    project: "p",
    labels: [entry("1", "perf/x", "true", "checked"), entry("9", "secrets/s", "false")],
  };
  const lf = makeTemplate([d("1", "perf/x"), d("3", "perf/z")], "perf/", "p", existing);
  const byId = new Map(lf.labels.map((l) => [l.id, l]));
  assert.equal(byId.get("1")?.verdict, "true");
  assert.equal(byId.get("1")?.note, "checked");
  assert.equal(byId.get("3")?.verdict, "unlabeled");
  assert.equal(byId.get("9")?.verdict, "false");
});

test("precision is true / (true + false); unsure and unlabeled are not counted", () => {
  const diags = ["1", "2", "3", "4", "5"].map((id) => d(id, "perf/x"));
  const lf: LabelFile = {
    project: "p",
    labels: [
      entry("1", "perf/x", "true"),
      entry("2", "perf/x", "true"),
      entry("3", "perf/x", "false"),
      entry("4", "perf/x", "unsure"),
      entry("5", "perf/x", "unlabeled"),
    ],
  };
  const { rules } = scoreLabels(diags, lf);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].truePositives, 2);
  assert.equal(rules[0].falsePositives, 1);
  assert.equal(rules[0].unsure, 1);
  assert.equal(rules[0].unlabeled, 1);
  assert.ok(Math.abs((rules[0].precision as number) - 2 / 3) < 1e-9);
});

test("precision is null when nothing is labelled true or false", () => {
  const lf: LabelFile = { project: "p", labels: [entry("1", "perf/x", "unlabeled")] };
  const { rules } = scoreLabels([d("1", "perf/x")], lf);
  assert.equal(rules[0].precision, null);
});

test("a label that no longer matches a finding is counted as stale, not scored", () => {
  const lf: LabelFile = { project: "p", labels: [entry("99", "perf/x", "true")] };
  const { rules, stale } = scoreLabels([d("1", "perf/x")], lf);
  assert.equal(stale, 1);
  assert.equal(rules.length, 0);
});

test("parse rejects an unknown verdict with a clear message", () => {
  const text = JSON.stringify({ project: "p", labels: [{ id: "1", rule: "r", verdict: "maybe" }] });
  assert.throws(() => parseLabelFile(text), /verdict/);
});

test("parse fills defaults for missing optional fields", () => {
  const text = JSON.stringify({ project: "p", labels: [{ id: "1", rule: "r" }] });
  const lf = parseLabelFile(text);
  assert.equal(lf.labels[0].verdict, "unlabeled");
  assert.equal(lf.labels[0].note, "");
  assert.equal(lf.labels[0].line, 0);
});