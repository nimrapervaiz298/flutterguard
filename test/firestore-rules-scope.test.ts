import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";

const scopes = (code: string) => findRulesIssues(code).map((f) => `${f.rule}:${f.scope}`);

test("public read under a recursive wildcard is wide", () => {
  const code = "match /databases/{d}/documents {\n  match /{document=**} {\n    allow read;\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:wide"]);
});

test("public read under a specific collection is narrow", () => {
  const code = "match /databases/{d}/documents {\n  match /cats/{catId} {\n    allow read;\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:narrow"]);
});

test("a closed sibling block does not leak its wildcard", () => {
  const code = "match /a/{x=**} {\n  allow write: if false;\n}\nmatch /cats/{id} {\n  allow read;\n}";
  assert.deepEqual(scopes(code), ["open-access:narrow"]);
});

test("auth-only-write under a wildcard is wide", () => {
  const code = "match /{document=**} {\n  allow write: if request.auth != null;\n}";
  assert.deepEqual(scopes(code), ["auth-only-write:wide"]);
});

test("no match block at all is narrow", () => {
  assert.deepEqual(scopes("allow read;"), ["open-access:narrow"]);
});