import test from "node:test";
import assert from "node:assert/strict";
import { formatAgreement } from "../src/agree";

test("formatAgreement states the counts, the percentage and the disagreements", () => {
  const out = formatAgreement({
    compared: 4,
    agree: 3,
    disagree: [{ n: 7, id: "x", project: "p", rule: "perf/x", verdict: "true" }],
    unsure: 2,
    unanswered: 1,
  });
  assert.match(out, /compared: 4/);
  assert.match(out, /agree: 3 of 4 \(75%\)/);
  assert.match(out, /unsure on either side: 2/);
  assert.match(out, /unanswered: 1/);
  assert.match(out, /#7 perf\/x \(p\): key says true/);
  assert.match(out, /only over items where both gave true or false/);
});

test("formatAgreement does not print a percentage when nothing was compared", () => {
  const out = formatAgreement({ compared: 0, agree: 0, disagree: [], unsure: 0, unanswered: 30 });
  assert.match(out, /agree: n\/a/);
  assert.ok(!/%/.test(out));
});
