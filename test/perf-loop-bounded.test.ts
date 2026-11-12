import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("a loop over the docs of a limit(1) query is not flagged", () => {
  const code = `
    final q = await db.collection('c').where('a', isEqualTo: 1).limit(1).get();
    for (final d in q.docs) {
      await d.reference.delete();
    }`;
  assert.deepEqual(rules(code), []);
});

test("a loop over the docs of a documentId equality query is not flagged", () => {
  const code = `
    final q = await db.collection('c').where(FieldPath.documentId, isEqualTo: id).get();
    for (final d in q.docs) {
      await d.reference.delete();
    }`;
  assert.deepEqual(rules(code), []);
});

test("control: a loop over an unbounded query is still flagged", () => {
  const code = `
    final q = await db.collection('c').where('a', isEqualTo: 1).get();
    for (final d in q.docs) {
      await d.reference.delete();
    }`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});

test("control: limit with a variable is not a known bound, still flagged", () => {
  const code = `
    final q = await db.collection('c').where('a', isEqualTo: 1).limit(n).get();
    for (final d in q.docs) {
      await d.reference.delete();
    }`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});