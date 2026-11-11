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

test("report includes firestore.rules findings and a firestore-rules check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-rules-"));
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  fs.writeFileSync(
    path.join(dir, "firestore.rules"),
    "service cloud.firestore {\n  match /a/{id} {\n    allow read, write: if request.auth != null;\n  }\n}\n",
  );
  const r = buildReport(dir, deps as any, { analyze: false });
  const d = r.diagnostics.filter((x) => x.rule === "firestore-rules/auth-only-write");
  assert.equal(d.length, 1);
  assert.equal(d[0].location.file, "firestore.rules");
  assert.equal(d[0].location.line, 3);
  assert.ok(r.checks.some((c) => c.name === "firestore-rules" && c.status === "ok"));
});