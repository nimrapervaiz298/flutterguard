import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRulesIssues } from "../src/firestore-rules";
import { buildReport } from "../src/report";

const kinds = (code: string) => findRulesIssues(code).map((f) => `${f.rule}:${f.scope}`);

test("public read under the storage wildcard is open-access, wide", () => {
  const code = "service firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read;\n    }\n  }\n}";
  assert.deepEqual(kinds(code), ["open-access:wide"]);
});

test("login-only read and write under the storage wildcard", () => {
  const code = "service firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read, write: if request.auth!=null;\n    }\n  }\n}";
  assert.deepEqual(kinds(code), ["auth-only-write:wide"]);
});

test("report reads storage.rules files too", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-storage-"));
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  fs.writeFileSync(path.join(dir, "storage.rules"), "service firebase.storage {\n  match /b/{b}/o {\n    match /{allPaths=**} {\n      allow read;\n    }\n  }\n}\n");
  const deps = { findSecrets: () => [], findBloat: () => [], runAnalyze: () => ({ ran: false, issues: [], reason: "x" }) as any, tierOf: () => "style" };
  const r = buildReport(dir, deps as any, { analyze: false });
  assert.equal(r.diagnostics.filter((d) => d.rule === "firestore-rules/open-access").length, 1);
});