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
test("a FLUTTER_BIN path that does not exist is a failed check with a clear reason", () => {
  const dir = tmp();
  const saved = process.env.FLUTTER_BIN;
  try {
    fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
    fs.mkdirSync(path.join(dir, ".dart_tool"));
    fs.writeFileSync(path.join(dir, ".dart_tool", "package_config.json"), "{}");
    process.env.FLUTTER_BIN = path.join(dir, "no-such", "flutter.bat");
    const r = runAnalyze(dir);
    assert.equal(r.failed, true);
    assert.match(r.reason, /FLUTTER_BIN/);
  } finally {
    if (saved === undefined) delete process.env.FLUTTER_BIN;
    else process.env.FLUTTER_BIN = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});