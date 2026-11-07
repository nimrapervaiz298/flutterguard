import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport, fromAnalyzer, fromSecret, makeDiagnostic } from "../src/report";
import { resetScanners } from "../src/scanner";

const base = {
  rule: "x/y",
  category: "style" as const,
  severity: "info" as const,
  confidence: "high" as const,
  source: "static" as const,
  message: "m",
};

test("id is stable for the same finding", () => {
  const a = makeDiagnostic({ ...base, location: { file: "lib/a.dart", line: 3 } });
  const b = makeDiagnostic({ ...base, location: { file: "lib/a.dart", line: 3 } });
  assert.equal(a.id, b.id);
});

test("id does NOT change when the line changes", () => {
  const a = makeDiagnostic({ ...base, location: { file: "lib/a.dart", line: 3 } });
  const b = makeDiagnostic({ ...base, location: { file: "lib/a.dart", line: 40 } });
  assert.equal(a.id, b.id);
});

test("id changes when the file or anchor changes", () => {
  const a = makeDiagnostic({ ...base, anchor: "one", location: { file: "lib/a.dart", line: 3 } });
  const b = makeDiagnostic({ ...base, anchor: "one", location: { file: "lib/b.dart", line: 3 } });
  const c = makeDiagnostic({ ...base, anchor: "two", location: { file: "lib/a.dart", line: 3 } });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test("firebase config key becomes info, not a high severity secret", () => {
  const d = fromSecret(
    { level: "INFO", name: "Google API key", file: "/p/lib/firebase_options.dart", line: 9, preview: "[redacted]" },
    "/p",
  );
  assert.equal(d.severity, "info");
  assert.equal(d.rule, "secrets/firebase-config-key");
  assert.equal(d.location?.file, "lib/firebase_options.dart");
});

test("a real secret never appears in the report", () => {
  const d = fromSecret(
    { level: "ALERT", name: "Google API key", file: "/p/lib/x.dart", line: 3, preview: "AIzaSyDEMOKEY123" },
    "/p",
  );
  const json = JSON.stringify(d);
  assert.ok(!json.includes("AIzaSy"));
  assert.equal(d.severity, "high");
});

test("analyzer bug-risk maps to reliability/high with location, why and fix", () => {
  const d = fromAnalyzer(
    { kind: "warning", message: "msg", loc: "lib\\a\\b.dart:12:5", rule: "must_call_super" },
    "bug-risk",
  );
  assert.equal(d.category, "reliability");
  assert.equal(d.severity, "high");
  assert.deepEqual(d.location, { file: "lib/a/b.dart", line: 12, column: 5 });
  assert.ok(d.why && d.fix);
});

const fakeDeps = {
  findSecrets: () => [],
  findBloat: () => [],
  runAnalyze: () => ({ ran: false, reason: "not used", issues: [] }),
  tierOf: () => "style",
};

test("buildReport: ids are unique and stay the same when lines shift", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-report-"));
  try {
    fs.mkdirSync(path.join(dir, "lib"));
    const file = path.join(dir, "lib", "a.dart");
    const code =
      "Future<void> f() async {\n" +
      "  final a = await db.collection('items').get();\n" +
      "  final b = await db.collection('items').get();\n" +
      "}\n";

    fs.writeFileSync(file, code);
    resetScanners();
    const r1 = buildReport(dir, fakeDeps, { analyze: false });

    fs.writeFileSync(file, "\n\n" + code); // everything moves down 2 lines
    resetScanners();
    const r2 = buildReport(dir, fakeDeps, { analyze: false });

    const ids1 = r1.diagnostics.map((d) => d.id);
    const ids2 = r2.diagnostics.map((d) => d.id);
    assert.equal(ids1.length, 2);
    assert.equal(new Set(ids1).size, 2); // same finding twice, two different ids
    assert.deepEqual(ids1, ids2);
    assert.equal(r2.diagnostics[0].location?.line, r1.diagnostics[0].location!.line + 2);
    assert.equal(r1.scan.filesListed, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});