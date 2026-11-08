import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Tier = "error" | "bug-risk" | "migration" | "cleanup" | "style";
export type Issue = { kind: "error" | "warning" | "info"; message: string; loc: string; rule: string };
export type AnalyzeResult = {
  ran: boolean;
  /** Set when the check was supposed to run but could not (as opposed to "not applicable"). */
  failed?: boolean;
  reason: string;
  errors: number;
  warnings: number;
  infos: number;
  issues: Issue[];
};

// Rules that often point to real bugs
const BUG_RISK = new Set([
  "must_call_super",
  "unawaited_return_in_try_block",
  "use_build_context_synchronously",
  "unawaited_futures",
  "cancel_subscriptions",
  "close_sinks",
]);
const MIGRATION = new Set(["deprecated_member_use", "deprecated_member_use_from_same_package"]);

export function tierOf(i: Issue): Tier {
  if (i.kind === "error") return "error";
  if (BUG_RISK.has(i.rule)) return "bug-risk";
  if (MIGRATION.has(i.rule)) return "migration";
  if (/^(unused_|duplicate_import|unnecessary_|prefer_final|dead_code|avoid_print)/.test(i.rule)) return "cleanup";
  return "style";
}

export function countTiers(issues: Issue[]): Record<Tier, number> {
  const t: Record<Tier, number> = { error: 0, "bug-risk": 0, migration: 0, cleanup: 0, style: 0 };
  for (const i of issues) t[tierOf(i)]++;
  return t;
}

export function analyzePenalty(a: AnalyzeResult): number {
  if (!a.ran) return 0;
  const t = countTiers(a.issues);
  return Math.min(30, t.error * 5 + t["bug-risk"] * 3 + Math.round(t.cleanup * 0.1) + Math.round(t.migration * 0.1));
}

// line format: "  warning - message - lib\x.dart:12:3 - rule_name"
const START = /^\s*(error|warning|info)\s+-\s/;
const FULL = /^\s*(error|warning|info)\s+-\s+(.*)\s+-\s+(.+?:\d+:\d+)\s+-\s+(\S+)\s*$/;

/** Pure function: turns `flutter analyze` text into issues. Handles lines the terminal wrapped. */
export function parseAnalyzeOutput(out: string): Issue[] {
  const entries: string[] = [];
  let open = false;
  for (const line of out.split(/\r?\n/)) {
    if (START.test(line)) {
      entries.push(line);
      open = true;
    } else if (open && /^\s{4,}\S/.test(line) && !FULL.test(entries[entries.length - 1])) {
      entries[entries.length - 1] += " " + line.trim(); // wrapped continuation
    } else {
      open = false;
    }
  }
  const issues: Issue[] = [];
  for (const e of entries) {
    const m = e.match(FULL);
    if (m) {
      issues.push({ kind: m[1] as Issue["kind"], message: m[2].trim(), loc: m[3], rule: m[4] });
    } else {
      const kind = (e.match(START) as RegExpMatchArray)[1] as Issue["kind"];
      issues.push({ kind, message: e.trim(), loc: "", rule: "unknown" });
    }
  }
  return issues;
}

export function runAnalyze(dir: string): AnalyzeResult {
  const res: AnalyzeResult = { ran: false, reason: "", errors: 0, warnings: 0, infos: 0, issues: [] };
  const fail = (reason: string): AnalyzeResult => {
    res.failed = true;
    res.reason = reason;
    return res;
  };

  // Not applicable: this is not a Flutter/Dart project, so there is nothing to run.
  if (!fs.existsSync(path.join(dir, "pubspec.yaml"))) {
    res.reason = "no pubspec.yaml (not a Flutter/Dart project)";
    return res;
  }
  // From here on the check was supposed to run, so any problem is a failure, not a skip.
  if (!fs.existsSync(path.join(dir, ".dart_tool", "package_config.json"))) {
    return fail("dependencies not installed - run `flutter pub get` in the project first");
  }
  const bin = process.env.FLUTTER_BIN || "flutter";
  const r = spawnSync(`"${bin}" analyze --no-pub`, {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 100 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (process.env.FG_DEBUG) {
    console.log(`[debug] bin: ${bin}, exit: ${r.status}, error: ${r.error?.message ?? "none"}`);
  }
  if (r.error) {
    return fail(`could not run flutter: ${r.error.message}`);
  }
  if (r.status === 9009 || r.status === 127) {
    return fail("flutter command not found (set FLUTTER_BIN or add Flutter to PATH)");
  }
  if (r.status !== 0 && r.status !== 1) {
    return fail(`flutter analyze failed (exit ${r.status}); run with FG_DEBUG=1 to see why`);
  }
  const issues = parseAnalyzeOutput(out);
  if (r.status === 1 && issues.length === 0) {
    return fail("flutter analyze reported a problem but its output could not be read; run with FG_DEBUG=1");
  }
  res.issues = issues;
  for (const i of issues) {
    if (i.kind === "error") res.errors++;
    else if (i.kind === "warning") res.warnings++;
    else res.infos++;
  }
  res.ran = true;
  return res;
}

export function printAnalyze(a: AnalyzeResult): void {
  const t = countTiers(a.issues);
  console.log(`${a.errors} errors, ${a.warnings} warnings, ${a.infos} infos`);
  console.log(
    `By tier: error ${t.error}, bug-risk ${t["bug-risk"]}, migration ${t.migration}, cleanup ${t.cleanup}, style ${t.style}`,
  );
  const byRule = new Map<string, number>();
  for (const i of a.issues) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);
  const top = [...byRule.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
  if (top.length) {
    console.log("\nTop rules:");
    top.forEach(([rule, n]) => console.log(`  ${String(n).padStart(3)}  ${rule}`));
  }
  const important = a.issues.filter((i) => ["error", "bug-risk"].includes(tierOf(i)));
  if (important.length) {
    console.log("\nFix first (errors and bug-risk):");
    important.slice(0, 10).forEach((i) => console.log(`  [${i.rule}] ${i.loc}`));
  }
}