import test from "node:test";
import assert from "node:assert/strict";
import { collectionRules } from "../src/firestore-rules";

const sum = (code: string) =>
  collectionRules(code).map((c) => `${c.collection}:${c.loginOnlyWrite ? "login-only" : "other"}`);

test("a top-level collection with a login-only write is reported", () => {
  const code = "match /databases/{d}/documents {\n  match /calendar/{id} {\n    allow read, write: if request.auth != null;\n  }\n}";
  assert.deepEqual(sum(code), ["calendar:login-only"]);
});

test("a collection with an ownership check is not login-only", () => {
  const code = "match /databases/{d}/documents {\n  match /users/{uid} {\n    allow write: if request.auth.uid == uid;\n  }\n}";
  assert.deepEqual(sum(code), ["users:other"]);
});

test("a read-only login rule is not login-only write", () => {
  const code = "match /databases/{d}/documents {\n  match /posts/{id} {\n    allow read: if request.auth != null;\n  }\n}";
  assert.deepEqual(sum(code), ["posts:other"]);
});

test("two collections are reported separately", () => {
  const code = "match /databases/{d}/documents {\n  match /a/{id} {\n    allow write: if request.auth != null;\n  }\n  match /b/{id} {\n    allow write: if false;\n  }\n}";
  assert.deepEqual(sum(code), ["a:login-only", "b:other"]);
});

test("the recursive wildcard and the database match are not collections", () => {
  const code = "match /databases/{d}/documents {\n  match /{document=**} {\n    allow write: if request.auth != null;\n  }\n}";
  assert.deepEqual(sum(code), []);
});