import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectScanner } from "../src/scanner";

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-scan-"));
  const put = (rel: string, text: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  put("lib/a.dart", "void a() {}\n");
  put("lib/b.dart", "void b() {}\n");
  put("big.dart", "x".repeat(500));
  put("build/gen.dart", "void g() {}\n");
  put("node_modules/p/index.js", "module.exports = 1;\n");
  put(".dart_tool/c.json", "{}\n");
  return dir;
}

const rel = (dir: string, files: string[]) =>
  files.map((f) => path.relative(dir, f).replace(/\\/g, "/"));

test("lists project files and skips generated and dependency folders", () => {
  const dir = makeProject();
  try {
    const s = new ProjectScanner(dir, { maxFileBytes: 100 });
    assert.deepEqual(rel(dir, s.files()), ["big.dart", "lib/a.dart", "lib/b.dart"]);
    assert.equal(s.stats.dirsSkipped, 3); // build, node_modules, .dart_tool
    assert.equal(s.stats.filesListed, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reads small files and skips files over the size limit", () => {
  const dir = makeProject();
  try {
    const s = new ProjectScanner(dir, { maxFileBytes: 100 });
    s.files();
    assert.equal(s.read(path.join(dir, "lib", "a.dart")), "void a() {}\n");
    assert.equal(s.read(path.join(dir, "big.dart")), null);
    assert.equal(s.stats.filesTooLarge, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("never reads outside the project", () => {
  const dir = makeProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fg-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    const s = new ProjectScanner(dir);
    assert.equal(s.read(path.join(outside, "secret.txt")), null);
    assert.equal(s.read(path.join(dir, "..", path.basename(outside), "secret.txt")), null);
    assert.equal(s.stats.outsideBlocked, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("a missing or unreadable file returns null instead of crashing", () => {
  const dir = makeProject();
  try {
    const s = new ProjectScanner(dir);
    assert.equal(s.read(path.join(dir, "lib", "missing.dart")), null);
    assert.equal(s.stats.filesUnreadable, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not follow symlinks out of the project", (t) => {
  const dir = makeProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fg-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "leak.dart"), "void leak() {}\n");
    try {
      fs.symlinkSync(outside, path.join(dir, "link"), "junction");
    } catch {
      t.skip("cannot create symlinks on this machine");
      return;
    }
    const s = new ProjectScanner(dir);
    const files = rel(dir, s.files());
    assert.ok(!files.some((f) => f.includes("leak.dart")));
    assert.ok(s.stats.symlinksSkipped >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("a missing project folder gives a clear error", () => {
  assert.throws(() => new ProjectScanner(path.join(os.tmpdir(), "fg-does-not-exist-123")), /not found/i);
});