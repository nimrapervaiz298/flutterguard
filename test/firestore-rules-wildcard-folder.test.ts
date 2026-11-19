import test from "node:test";
import assert from "node:assert/strict";
import { findRulesIssues } from "../src/firestore-rules";

const scopes = (code: string) => findRulesIssues(code).map((f) => `${f.rule}:${f.scope}`);

test("a wildcard directly under the bucket is wide", () => {
  const code = "service firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read;\n    }\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:wide"]);
});

test("a wildcard inside a folder is narrow", () => {
  const code = "service firebase.storage {\n  match /b/{bucket}/o {\n    match /agencies/{agencyId}/{allPaths=**} {\n      allow read: if true;\n    }\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:narrow"]);
});

test("a wildcard inside a folder with an open write is still reported as open-access", () => {
  const code = "service firebase.storage {\n  match /b/{bucket}/o {\n    match /agencies/{agencyId}/{allPaths=**} {\n      allow write: if true;\n    }\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:narrow"]);
});

test("the firestore recursive wildcard stays wide", () => {
  const code = "match /databases/{d}/documents {\n  match /{document=**} {\n    allow read;\n  }\n}";
  assert.deepEqual(scopes(code), ["open-access:wide"]);
});