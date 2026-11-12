import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("a query with only isEqualTo filters is not flagged", () => {
  const code = `
    final q = await FirebaseFirestore.instance
        .collection('likes')
        .where('postId', isEqualTo: a)
        .where('userId', isEqualTo: b)
        .get();`;
  assert.deepEqual(rules(code), []);
});

test("isNotEqualTo is still flagged", () => {
  const code = `
    final q = await FirebaseFirestore.instance
        .collection('users')
        .where('uId', isNotEqualTo: me)
        .get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("a range filter is still flagged", () => {
  const code = `
    final q = await FirebaseFirestore.instance
        .collection('posts')
        .where('date', isGreaterThan: d)
        .get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("one equality plus one range filter is still flagged", () => {
  const code = `
    final q = await FirebaseFirestore.instance
        .collection('posts')
        .where('owner', isEqualTo: u)
        .where('date', isGreaterThan: d)
        .get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});