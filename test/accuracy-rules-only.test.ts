import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/accuracy";

const diag = (id: string, rule: string) => ({ id, rule, location: { file: "f", line: 1 } }) as any;
const lab = (id: string, rule: string, verdict: string) => ({ id, rule, file: "f", line: 1, verdict, note: "" }) as any;

const base = (rulesOnly?: string[]) => ({
  entry: { name: "p", dir: "p", labels: "p.json", tuned: false, rulesOnly } as any,
  diagnostics: [diag("a", "firestore-rules/open-access"), diag("b", "perf/firestore-unbounded-read"), diag("c", "perf/firestore-unbounded-read")],
  labels: { project: "p", labels: [lab("x", "perf/firestore-unbounded-read", "true"), lab("a", "firestore-rules/open-access", "false")] } as any,
});

test("without rulesOnly every unlabeled finding of a labelled rule is waiting", () => {
  const ev = evaluate([base()], []);
  assert.equal(ev.unlabeled.length, 2);
});

test("with rulesOnly only the listed rule prefixes are waiting", () => {
  const ev = evaluate([base(["firestore-rules/"])], []);
  assert.equal(ev.unlabeled.length, 0);
});

test("rulesOnly does not hide a finding of a listed rule", () => {
  const b = base(["firestore-rules/"]);
  b.diagnostics.push(diag("d", "firestore-rules/open-access"));
  assert.equal(evaluate([b], []).unlabeled.length, 1);
});