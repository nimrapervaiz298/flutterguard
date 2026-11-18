import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport } from "../src/report";

const deps = {
  findSecrets: () => [],
  findBloat: () => [],
  runAnalyze: () => ({ ran: false, issues: [], reason: "x" }) as any,
  tierOf: () => "style",
};

function severities(rules: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-sev-"));
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  fs.writeFileSync(path.join(dir, "firestore.rules"), rules);
  const r = buildReport(dir, deps as any, { analyze: false });
  return r.diagnostics.filter((d) => d.rule === "firestore-rules/open-access").map((d) => d.severity);
}

const wrap = (body: string) => "match /databases/{d}/documents {\n" + body + "\n}\n";

test("open write on a specific collection is high", () => {
  assert.deepEqual(severities(wrap("match /cats/{id} {\n allow write: if true;\n}")), ["high"]);
});

test("open create without a condition on a specific collection is high", () => {
  assert.deepEqual(severities(wrap("match /cats/{id} {\n allow create;\n}")), ["high"]);
});

test("open read on a specific collection is info", () => {
  assert.deepEqual(severities(wrap("match /cats/{id} {\n allow read;\n}")), ["info"]);
});

test("open read under a recursive wildcard is high", () => {
  assert.deepEqual(severities(wrap("match /{document=**} {\n allow read;\n}")), ["high"]);
});