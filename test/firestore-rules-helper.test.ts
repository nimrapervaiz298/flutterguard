import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";

const rules = (code: string) => findRulesIssues(code).map((f) => f.rule);

test("a helper that only checks login is flagged when it is the whole write condition", () => {
  const code = `
    function isSignedIn() { return request.auth != null; }
    match /a/{id} { allow write: if isSignedIn(); }`;
  assert.deepEqual(rules(code), ["auth-only-write"]);
});

test("a helper with an extra check is not flagged", () => {
  const code = `
    function isAdmin() { return request.auth != null && request.auth.token.admin == true; }
    match /a/{id} { allow write: if isAdmin(); }`;
  assert.deepEqual(rules(code), []);
});

test("a login helper combined with an ownership check is not flagged", () => {
  const code = `
    function isSignedIn() { return request.auth != null; }
    match /a/{id} { allow write: if isSignedIn() && request.auth.uid == id; }`;
  assert.deepEqual(rules(code), []);
});