import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("where without limit is reported", () => {
  const code = `final s = await db.collection('users').where('active', isGreaterThan: 0).get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("where with limit is fine", () => {
  const code = `final s = await db.collection('users').where('active', isEqualTo: true).limit(20).get();`;
  assert.deepEqual(rules(code), []);
});

test("limitToLast counts as a limit", () => {
  const code = `final s = await db.collection('users').orderBy('t').limitToLast(5).get();`;
  assert.deepEqual(rules(code), []);
});

test("an aggregate count() query is fine", () => {
  const code = `final c = await db.collection('users').where('a', isEqualTo: 1).count().get();`;
  assert.deepEqual(rules(code), []);
});

test("a single document read is fine", () => {
  const code = `final d = await db.collection('users').doc(id).get();`;
  assert.deepEqual(rules(code), []);
});

test("a plain full-collection read keeps the stronger rule", () => {
  const code = `final s = await db.collection('users').get();`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});

test("a multi-line where query without limit is reported", () => {
  const code = `
    final s = await db
        .collection('users')
        .where('active', isGreaterThan: 0)
        .get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("the where finding is lower severity than the full read and names the collection", () => {
  const w = findPerfInText(`await db.collection('users').where('a', isGreaterThan: 1).get();`)[0];
  const full = findPerfInText(`await db.collection('users').get();`)[0];
  assert.equal(w.severity, "info");
  assert.equal(full.severity, "warning");
  assert.equal(w.collection, "users");
});