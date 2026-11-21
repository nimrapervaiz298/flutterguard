import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, toMarkdown } from "../src/accuracy";
import type { KnownBug, ProjectEntry, ProjectInput } from "../src/accuracy";
import type { DiagLike, LabelFile } from "../src/bench";

const entry = (name: string): ProjectEntry => ({ name, dir: name, labels: `${name}.json`, tuned: false });
const d = (id: string, rule: string, file = "lib/a.dart", line = 1): DiagLike => ({
  id,
  rule,
  location: { file, line },
});
const input = (name: string, diagnostics: DiagLike[]): ProjectInput => ({
  entry: entry(name),
  diagnostics,
  labels: { project: name, labels: [] } as LabelFile,
});

const known = [
  { project: "p", file: "lib/a.dart", description: "caught", rule: "perf/x", origin: "found before the rule" },
  { project: "p", file: "lib/b.dart", description: "rule exists, did not fire", rule: "perf/x", origin: "rule built from this bug" },
  { project: "p", file: "lib/c.dart", description: "no rule at all", rule: null, origin: "found before the rule" },
] as KnownBug[];

test("known bugs: gaps (no rule) are listed apart from misses (rule exists but did not fire)", () => {
  const ev = evaluate([input("p", [d("1", "perf/x", "lib/a.dart")])], known);
  assert.equal(ev.known.total, 3);
  assert.equal(ev.known.detected, 1);
  assert.equal(ev.known.missed.length, 1);
  assert.match(ev.known.missed[0], /rule exists, did not fire/);
  assert.equal(ev.known.gaps.length, 1);
  assert.match(ev.known.gaps[0], /no rule at all/);
});

test("the markdown lists gaps and misses separately", () => {
  const md = toMarkdown(evaluate([input("p", [d("1", "perf/x", "lib/a.dart")])], known), ["p"]);
  assert.match(md, /missed: p: lib\/b\.dart/);
  assert.match(md, /gap \(no rule yet\): p: lib\/c\.dart/);
});
