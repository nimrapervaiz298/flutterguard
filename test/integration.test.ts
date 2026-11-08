import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBloat } from "../src/bloat";
import { runAnalyze, tierOf } from "../src/analyzer";
import { buildReport, exitCodeFor, stabilizeReport } from "../src/report";
import type { ReportDeps } from "../src/report";
import { resetScanners } from "../src/scanner";
import { findSecrets } from "../src/secrets";

const G1 = "AIza" + "a".repeat(35);
const G2 = "AIza" + "b".repeat(35);
const deps: ReportDeps = { findSecrets, findBloat, runAnalyze, tierOf };

function write(root: string, rel: string, text: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

/** A small project with a known set of problems. Created fresh in a temp folder for every test. */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-fix-"));
  write(dir, "pubspec.yaml", "name: fixture\n");
  // 1 real-looking secret (line 1); a placeholder on line 2 must be ignored
  write(dir, "lib/main.dart", `const key = '${G1}';\nconst password = 'password';\n`);
  // Firebase client key: info only
  write(dir, "lib/firebase_options.dart", `const apiKey = '${G2}';\n`);
  // full-collection read on line 4, await in a loop on line 5, a capped read on line 6 (must be ignored)
  write(
    dir,
    "lib/data.dart",
    [
      "import 'package:cloud_firestore/cloud_firestore.dart';",
      "",
      "Future<void> load(FirebaseFirestore db, List<String> ids) async {",
      "  final all = await db.collection('products').get();",
      "  for (final id in ids) {",
      "    await db.collection('items').doc(id).get();",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  // a 92 line method starting on line 2
  write(dir, "lib/big_screen.dart", "class Big {\n  void build() {\n" + "    work();\n".repeat(90) + "  }\n}\n");
  // test files: generic secrets and sequential awaits are fine here
  write(
    dir,
    "test/auth_test.dart",
    [
      'const password = "s3cretvalue99";',
      "Future<void> t() async {",
      "  for (final x in [1, 2]) {",
      "    await Future.value(x);",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  return dir;
}

function withFixture(fn: (dir: string) => void): void {
  const dir = makeFixture();
  try {
    resetScanners();
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const labelOf = (d: { rule: string; location?: { file: string; line: number } }) =>
  `${d.rule} ${d.location?.file}:${d.location?.line}`;

test("fixture project gives exactly the expected findings and nothing else", () => {
  withFixture((dir) => {
    const r = buildReport(dir, deps, { analyze: false });
    assert.deepEqual(r.diagnostics.map(labelOf).sort(), [
      "bloat/long-method lib/big_screen.dart:2",
      "perf/firestore-unbounded-read lib/data.dart:4",
      "perf/sequential-await-in-loop lib/data.dart:5",
      "secrets/firebase-config-key lib/firebase_options.dart:1",
      "secrets/hardcoded-secret lib/main.dart:1",
    ]);
  });
});

test("summary counts and exit code match the fixture", () => {
  withFixture((dir) => {
    const r = buildReport(dir, deps, { analyze: false });
    assert.deepEqual(r.summary.bySeverity, { critical: 0, high: 1, medium: 1, low: 2, info: 1 });
    assert.equal(r.summary.total, 5);
    assert.equal(r.diagnostics[0].rule, "secrets/hardcoded-secret"); // most severe comes first
    assert.equal(exitCodeFor(r), 1);
    assert.ok(r.checks.every((c) => c.status === "ok" || c.name === "analyze"));
    assert.equal(r.checks.find((c) => c.name === "analyze")?.status, "skipped");
  });
});

test("no secret value appears anywhere in the report", () => {
  withFixture((dir) => {
    const json = JSON.stringify(buildReport(dir, deps, { analyze: false }));
    assert.ok(!json.includes("AIza"));
    assert.ok(!json.includes("s3cretvalue99"));
  });
});

test("stabilizeReport removes time, timings and absolute paths but keeps every finding", () => {
  withFixture((dir) => {
    const r = buildReport(dir, deps, { analyze: false });
    const s = stabilizeReport(r);
    assert.equal(s.project, ".");
    assert.equal(s.generatedAt, "1970-01-01T00:00:00.000Z");
    assert.equal(s.durationMs, 0);
    assert.ok(s.checks.every((c) => c.durationMs === 0));
    assert.deepEqual(s.diagnostics, r.diagnostics);
  });
});

test("two runs on the same project give identical stable JSON", () => {
  withFixture((dir) => {
    resetScanners();
    const a = JSON.stringify(stabilizeReport(buildReport(dir, deps, { analyze: false })));
    resetScanners();
    const b = JSON.stringify(stabilizeReport(buildReport(dir, deps, { analyze: false })));
    assert.equal(a, b);
  });
});

test("a project that lives inside a folder named test still gets generic secrets reported", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-nested-"));
  try {
    const root = path.join(tmp, "test", "app");
    write(root, "lib/a.dart", 'const password = "s3cretvalue99";\n');
    resetScanners();
    const hits = findSecrets(root);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].level, "ALERT");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- the real command line ----
const CLI = path.join(process.cwd(), "src", "index.ts");
function runCli(args: string): { out: string; code: number } {
  const r = spawnSync(`npx tsx "${CLI}" ${args}`, { shell: true, encoding: "utf8", timeout: 120_000 });
  return { out: r.stdout ?? "", code: r.status ?? -1 };
}

test("CLI: report --json --stable prints identical JSON twice and exits with 1", () => {
  const dir = makeFixture();
  try {
    const a = runCli(`report "${dir}" --no-analyze --json --stable`);
    const b = runCli(`report "${dir}" --no-analyze --json --stable`);
    assert.equal(a.code, 1);
    assert.equal(b.code, 1);
    assert.equal(a.out, b.out);
    const parsed = JSON.parse(a.out);
    assert.equal(parsed.summary.total, 5);
    assert.equal(parsed.project, ".");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: check lists the Dart files and exits with 0", () => {
  const dir = makeFixture();
  try {
    const { out, code } = runCli(`check "${dir}"`);
    assert.equal(code, 0);
    assert.match(out, /Dart/);
    assert.match(out, /Largest files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});