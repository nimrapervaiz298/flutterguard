import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Runs the real CLI. Tests are run from the project root, so src/index.ts is found from cwd.
const CLI = path.join(process.cwd(), "src", "index.ts");

function runCli(args: string): { out: string; code: number } {
  const r = spawnSync(`npx tsx "${CLI}" ${args}`, { shell: true, encoding: "utf8", timeout: 120_000 });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? -1 };
}

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-cli-"));
  try {
    fs.mkdirSync(path.join(dir, "lib"));
    fs.writeFileSync(path.join(dir, "lib", "a.dart"), "void a() {}\n");
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("scan prints no health score", () => {
  withProject((dir) => {
    const { out } = runCli(`scan "${dir}" --no-analyze`);
    assert.ok(!/score/i.test(out), `output still mentions a score:\n${out}`);
    assert.match(out, /Scanned 1 file/);
  });
});

test("scan and report give the same summary and the same exit code", () => {
  withProject((dir) => {
    const scan = runCli(`scan "${dir}" --no-analyze`);
    const report = runCli(`report "${dir}" --no-analyze`);
    assert.equal(scan.code, 0);
    assert.equal(report.code, 0);
    assert.match(scan.out, /By severity:/);
    assert.match(scan.out, /Exit code 0/);
    assert.match(report.out, /Exit code 0/);
  });
});

test("scan on a missing folder exits with 2", () => {
  const { out, code } = runCli(`scan "${path.join(os.tmpdir(), "fg-no-such-folder-123")}"`);
  assert.equal(code, 2);
  assert.match(out, /not found/i);
});