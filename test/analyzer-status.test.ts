import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAnalyze } from "../src/analyzer";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fg-an-"));
}

test("a folder without pubspec.yaml is skipped, not failed", () => {
  const dir = tmp();
  try {
    const r = runAnalyze(dir);
    assert.equal(r.ran, false);
    assert.ok(!r.failed);
    assert.match(r.reason, /pubspec/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a Flutter project without installed packages is a failed check", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
    const r = runAnalyze(dir);
    assert.equal(r.ran, false);
    assert.equal(r.failed, true);
    assert.match(r.reason, /pub get/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});