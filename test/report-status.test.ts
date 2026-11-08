import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport, exitCodeFor } from "../src/report";
import type { ReportDeps } from "../src/report";
import { resetScanners } from "../src/scanner";

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-status-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "a.dart"), "void a() {}\n");
  return dir;
}

const okDeps: ReportDeps = {
  findSecrets: () => [],
  findBloat: () => [],
  runAnalyze: () => ({ ran: true, reason: "", issues: [] }),
  tierOf: () => "style",
};

function withProject(fn: (dir: string) => void): void {
  const dir = makeProject();
  try {
    resetScanners();
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const status = (r: ReturnType<typeof buildReport>, name: string) =>
  r.checks.find((c) => c.name === name);

test("analyze that ran is ok and the exit code is 0", () => {
  withProject((dir) => {
    const r = buildReport(dir, okDeps, { analyze: true });
    assert.equal(status(r, "analyze")?.status, "ok");
    assert.equal(exitCodeFor(r), 0);
  });
});

test("analyze that could not run is failed, keeps its reason, and the exit code is 2", () => {
  withProject((dir) => {
    const deps: ReportDeps = {
      ...okDeps,
      runAnalyze: () => ({ ran: false, failed: true, reason: "flutter command not found", issues: [] }),
    };
    const r = buildReport(dir, deps, { analyze: true });
    assert.equal(status(r, "analyze")?.status, "failed");
    assert.equal(status(r, "analyze")?.reason, "flutter command not found");
    assert.equal(exitCodeFor(r), 2);
  });
});

test("analyze on a non-Flutter project is skipped, not failed", () => {
  withProject((dir) => {
    const deps: ReportDeps = {
      ...okDeps,
      runAnalyze: () => ({ ran: false, reason: "no pubspec.yaml (not a Flutter/Dart project)", issues: [] }),
    };
    const r = buildReport(dir, deps, { analyze: true });
    assert.equal(status(r, "analyze")?.status, "skipped");
    assert.equal(exitCodeFor(r), 0);
  });
});

test("--no-analyze is skipped with a clear reason and the exit code stays 0", () => {
  withProject((dir) => {
    const r = buildReport(dir, okDeps, { analyze: false });
    assert.equal(status(r, "analyze")?.status, "skipped");
    assert.match(status(r, "analyze")?.reason ?? "", /--no-analyze/);
    assert.equal(exitCodeFor(r), 0);
  });
});

test("a check that throws is marked failed and the other checks still run", () => {
  withProject((dir) => {
    const deps: ReportDeps = {
      ...okDeps,
      findSecrets: () => {
        throw new Error("boom");
      },
    };
    const r = buildReport(dir, deps, { analyze: false });
    assert.equal(status(r, "secrets")?.status, "failed");
    assert.equal(status(r, "secrets")?.reason, "boom");
    assert.equal(status(r, "bloat")?.status, "ok");
    assert.equal(status(r, "perf")?.status, "ok");
    assert.equal(exitCodeFor(r), 2);
  });
});

test("a high severity finding gives exit code 1", () => {
  withProject((dir) => {
    const deps: ReportDeps = {
      ...okDeps,
      findSecrets: () => [
        { level: "ALERT", name: "Google API key", file: path.join(dir, "lib", "a.dart"), line: 1, preview: "" },
      ],
    };
    const r = buildReport(dir, deps, { analyze: false });
    assert.equal(r.summary.bySeverity.high, 1);
    assert.equal(exitCodeFor(r), 1);
  });
});

test("a failed check beats findings: exit code 2, not 1", () => {
  withProject((dir) => {
    const deps: ReportDeps = {
      findSecrets: () => [
        { level: "ALERT", name: "Google API key", file: path.join(dir, "lib", "a.dart"), line: 1, preview: "" },
      ],
      findBloat: () => [],
      runAnalyze: () => ({ ran: false, failed: true, reason: "analyze crashed", issues: [] }),
      tierOf: () => "style",
    };
    const r = buildReport(dir, deps, { analyze: true });
    assert.equal(r.summary.bySeverity.high, 1);
    assert.equal(exitCodeFor(r), 2);
  });
});