import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";
import { fromRules } from "../src/report";

const sev = (code: string) =>
  findRulesIssues(code).map((f) => fromRules(f, "/p/firestore.rules", "/p").severity);

test("public write on a specific collection is high", () => {
  assert.deepEqual(sev("match /cats/{id} {\n  allow write;\n}"), ["high"]);
});

test("public create on a specific collection is high", () => {
  assert.deepEqual(sev("match /cats/{id} {\n  allow create: if true;\n}"), ["high"]);
});

test("public read on a specific collection is info", () => {
  assert.deepEqual(sev("match /cats/{id} {\n  allow read;\n}"), ["info"]);
});

test("public read under a recursive wildcard is high", () => {
  assert.deepEqual(sev("match /{document=**} {\n  allow read;\n}"), ["high"]);
});

test("login-only write stays medium", () => {
  assert.deepEqual(sev("match /cats/{id} {\n  allow write: if request.auth != null;\n}"), ["medium"]);
});