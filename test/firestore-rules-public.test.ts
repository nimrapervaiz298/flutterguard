import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";

const rules = (code: string) => findRulesIssues(code).map((f) => f.rule);

test("allow read with no condition is flagged as open access", () => {
  assert.deepEqual(rules("allow read;"), ["open-access"]);
});

test("allow read, write with no condition is flagged as open access", () => {
  assert.deepEqual(rules("allow read, write;"), ["open-access"]);
});

test("real shape from e-school: public read plus login-only write", () => {
  const code = "match /{document=**} {\n  allow read;\n  allow write: if request.auth != null;\n}";
  assert.deepEqual(rules(code), ["open-access", "auth-only-write"]);
});

test("control: read with a login condition is not flagged", () => {
  assert.deepEqual(rules("allow read: if request.auth != null;"), []);
});

test("control: read with an ownership condition is not flagged", () => {
  assert.deepEqual(rules("allow read: if request.auth.uid == userId;"), []);
});