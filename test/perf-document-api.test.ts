import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("old API: a single document read with .document() is not a full-collection read", () => {
  const code = `
    final like = await Firestore.instance
        .collection('likes')
        .document('\${cat.documentId}:\${this.firebaseUser.uid}')
        .get();`;
  assert.deepEqual(rules(code), []);
});

test("control: a plain full-collection read is still flagged", () => {
  const code = `
    final snap = await FirebaseFirestore.instance
        .collection('users')
        .get();`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});