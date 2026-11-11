import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";

const rules = (code: string) => findRulesIssues(code).map((f) => f.rule);

test("login-only check on a write is flagged", () => {
  const code = `
    match /calendar/{calendarId} {
      allow read, write: if request.auth.uid != null;
    }`;
  assert.deepEqual(rules(code), ["auth-only-write"]);
});

test("login-only check with request.auth != null is flagged for create", () => {
  assert.deepEqual(rules("allow read, create: if request.auth != null;"), ["auth-only-write"]);
});

test("login-only check on read alone is not flagged", () => {
  assert.deepEqual(rules("allow read: if request.auth != null;"), []);
});

test("an ownership check on a write is not flagged", () => {
  assert.deepEqual(rules("allow write: if request.auth.uid == userId;"), []);
});

test("a membership check on a write is not flagged", () => {
  assert.deepEqual(rules("allow read, write: if request.auth.uid in resource.data.members;"), []);
});

test("if true is flagged as open access", () => {
  assert.deepEqual(rules("allow read, write: if true;"), ["open-access"]);
});

test("a commented-out allow is ignored", () => {
  assert.deepEqual(rules("// allow write: if true;"), []);
});

test("a function call with extra conditions is not flagged", () => {
  const code = `
    allow create: if isSignedIn()
                     && request.resource.data.size() == 0;`;
  assert.deepEqual(rules(code), []);
});

test("the finding carries the line number and methods", () => {
  const code = "service cloud.firestore {\n  allow update, delete: if request.auth != null;\n}";
  const f = findRulesIssues(code);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
  assert.deepEqual(f[0].methods, ["update", "delete"]);
});