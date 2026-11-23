import test from "node:test";
import assert from "node:assert/strict";
import { agreement, parseAnswers } from "../src/agree";

test("parseAnswers reads the answers table, ignores blank and unknown cells", () => {
  const md = [
    "## Answers",
    "",
    "| # | true / false / unsure |",
    "|---|---|",
    "| 1 | true |",
    "| 2 | False |",
    "| 3 | |",
    "| 4 | maybe |",
    "| 5 | unsure |",
  ].join("\n");
  const a = parseAnswers(md);
  assert.equal(a.get(1), "true");
  assert.equal(a.get(2), "false");
  assert.equal(a.has(3), false);
  assert.equal(a.has(4), false);
  assert.equal(a.get(5), "unsure");
});

test("agreement counts agree and disagree only where both gave true or false", () => {
  const key = [
    { n: 1, id: "a", project: "p", rule: "r1", verdict: "true" },
    { n: 2, id: "b", project: "p", rule: "r1", verdict: "false" },
    { n: 3, id: "c", project: "p", rule: "r2", verdict: "true" },
    { n: 4, id: "d", project: "p", rule: "r2", verdict: "unsure" },
    { n: 5, id: "e", project: "p", rule: "r2", verdict: "false" },
    { n: 6, id: "f", project: "p", rule: "r2", verdict: "true" },
  ];
  const answers = new Map<number, string>([
    [1, "true"],
    [2, "true"],
    [3, "true"],
    [4, "true"],
    [5, "unsure"],
  ]);
  const r = agreement(key, answers);
  assert.equal(r.compared, 3);
  assert.equal(r.agree, 2);
  assert.deepEqual(r.disagree.map((d) => d.n), [2]);
  assert.equal(r.unsure, 2);
  assert.equal(r.unanswered, 1);
});
