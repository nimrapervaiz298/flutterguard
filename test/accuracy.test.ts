import test from "node:test";
import assert from "node:assert/strict";
import { compare, evaluate, precisionOf, toMarkdown } from "../src/accuracy";
import type { Baseline, KnownBug, ProjectEntry, ProjectInput } from "../src/accuracy";
import type { DiagLike, LabelEntry, LabelFile } from "../src/bench";

const entry = (name: string, tuned = false): ProjectEntry => ({ name, dir: name, labels: `${name}.json`, tuned });
const d = (id: string, rule: string, file = "lib/a.dart", line = 1): DiagLike => ({
  id,
  rule,
  location: { file, line },
});
const lab = (id: string, rule: string, verdict: LabelEntry["verdict"]): LabelEntry => ({
  id,
  rule,
  file: "lib/a.dart",
  line: 1,
  verdict,
  note: "",
});
const input = (name: string, tuned: boolean, diagnostics: DiagLike[], labels: LabelEntry[]): ProjectInput => ({
  entry: entry(name, tuned),
  diagnostics,
  labels: { project: name, labels } as LabelFile,
});
const rule = (ev: ReturnType<typeof evaluate>, name: string) => ev.rules.find((r) => r.rule === name);

test("counts true, false and unsure per rule", () => {
  const ev = evaluate(
    [
      input("p", false, [d("1", "perf/x"), d("2", "perf/x"), d("3", "perf/x")], [
        lab("1", "perf/x", "true"),
        lab("2", "perf/x", "false"),
        lab("3", "perf/x", "unsure"),
      ]),
    ],
    [],
  );
  assert.deepEqual(rule(ev, "perf/x")?.all, { tp: 1, fp: 1, unsure: 1 });
  assert.equal(precisionOf({ tp: 1, fp: 1, unsure: 1 }), 0.5);
});

test("precision is null when nothing is labelled true or false", () => {
  assert.equal(precisionOf({ tp: 0, fp: 0, unsure: 2 }), null);
});

test("the untuned numbers leave out tuned projects", () => {
  const ev = evaluate(
    [
      input("tuned", true, [d("1", "perf/x")], [lab("1", "perf/x", "true")]),
      input("fresh", false, [d("2", "perf/x"), d("3", "perf/x")], [lab("2", "perf/x", "false"), lab("3", "perf/x", "false")]),
    ],
    [],
  );
  assert.deepEqual(rule(ev, "perf/x")?.all, { tp: 1, fp: 2, unsure: 0 });
  assert.deepEqual(rule(ev, "perf/x")?.untuned, { tp: 0, fp: 2, unsure: 0 });
});

test("a true label that is no longer found is a lost real problem; a false one counts as resolved", () => {
  const ev = evaluate(
    [
      input("p", false, [], [
        { ...lab("1", "perf/x", "true"), file: "lib/b.dart", line: 7 },
        lab("2", "perf/x", "false"),
        lab("3", "perf/x", "unsure"),
      ]),
    ],
    [],
  );
  assert.equal(ev.lostTrue.length, 1);
  assert.match(ev.lostTrue[0], /lib\/b\.dart:7/);
  assert.equal(ev.resolvedFalse, 1);
});

test("findings of a labelled rule without a decided label are reported as unlabeled", () => {
  const ev = evaluate(
    [
      input("p", false, [d("1", "perf/x"), d("2", "perf/x"), d("3", "perf/x"), d("4", "bloat/y")], [
        lab("1", "perf/x", "true"),
        lab("2", "perf/x", "unlabeled"),
      ]),
    ],
    [],
  );
  assert.deepEqual(ev.unlabeled.map((u) => u.rule), ["perf/x", "perf/x"]);
  assert.deepEqual(ev.unmeasured, ["bloat/y"]);
});

test("known bugs: a rule that finds the bug is detected, no rule means missed, absent project is not counted", () => {
  const known: KnownBug[] = [
    { project: "p", file: "lib/a.dart", description: "found by a rule", rule: "perf/x" },
    { project: "p", file: "lib/c.dart", description: "no rule yet", rule: null },
    { project: "gone", file: "lib/z.dart", description: "project not present", rule: null },
  ];
  const ev = evaluate([input("p", false, [d("1", "perf/x", "lib/a.dart")], [lab("1", "perf/x", "true")])], known);
  assert.equal(ev.known.total, 2);
  assert.equal(ev.known.detected, 1);
  assert.equal(ev.known.missed.length, 1);
  assert.match(ev.known.missed[0], /no rule yet/);
});

test("compare without a baseline only reports lost real problems", () => {
  const ev = evaluate([input("p", false, [], [lab("1", "perf/x", "true")])], []);
  const c = compare(ev, null);
  assert.equal(c.regressions.length, 1);
  assert.match(c.regressions[0], /no longer found/);
});

test("compare flags more false alarms and lower precision against the baseline", () => {
  const base: Baseline = { version: 1, rules: { "perf/x": { tp: 2, fp: 0, unsure: 0 } } };
  const ev = evaluate(
    [input("p", false, [d("1", "perf/x"), d("2", "perf/x"), d("3", "perf/x")], [
      lab("1", "perf/x", "true"),
      lab("2", "perf/x", "true"),
      lab("3", "perf/x", "false"),
    ])],
    [],
  );
  const c = compare(ev, base);
  assert.ok(c.regressions.some((r) => /false alarms went from 0 to 1/.test(r)));
  assert.ok(c.regressions.some((r) => /precision fell/.test(r)));
});

test("compare reports fewer false alarms as an improvement, not a regression", () => {
  const base: Baseline = { version: 1, rules: { "perf/x": { tp: 1, fp: 3, unsure: 0 } } };
  const ev = evaluate(
    [input("p", false, [d("1", "perf/x"), d("2", "perf/x")], [lab("1", "perf/x", "true"), lab("2", "perf/x", "false")])],
    [],
  );
  const c = compare(ev, base);
  assert.deepEqual(c.regressions, []);
  assert.ok(c.improvements.length >= 1);
});

test("the markdown is identical for identical input and mentions precision", () => {
  const make = () =>
    evaluate([input("p", false, [d("1", "perf/x")], [lab("1", "perf/x", "true")])], []);
  const a = toMarkdown(make(), ["p"]);
  const b = toMarkdown(make(), ["p"]);
  assert.equal(a, b);
  assert.match(a, /precision/i);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a)); // no timestamps
});