import type { Command } from "commander";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findPerfInText, shouldCheckPerf } from "./perf";
import { configureScanner, getScanner, readText, walk } from "./scanner";

export const SCHEMA_VERSION = 1;
const TOOL = { name: "flutterguard", version: "0.1.0" };

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "security" | "reliability" | "performance" | "maintainability" | "style";
export type Confidence = "high" | "medium" | "low";
export type Source = "static" | "analyzer" | "runtime";

export interface Diagnostic {
  schemaVersion: 1;
  id: string; // stable: rule + file + anchor, never the line number
  rule: string; // "<check>/<name>", for example "perf/firestore-unbounded-read"
  category: Category;
  severity: Severity;
  confidence: Confidence;
  source: Source;
  message: string;
  location?: { file: string; line: number; column?: number };
  evidence?: string; // the fact that backs this finding (never a secret value)
  why?: string;
  fix?: string;
}

/** ok = ran. skipped = not run on purpose or not applicable. failed = should have run but could not. */
export type CheckState = "ok" | "skipped" | "failed";

export interface CheckStatus {
  name: string;
  status: CheckState;
  reason?: string;
  durationMs: number;
}

export interface ScanSummary {
  filesListed: number;
  dirsSkipped: number;
  symlinksSkipped: number;
  unreadableDirs: number;
  filesTooLarge: number;
  filesUnreadable: number;
  outsideBlocked: number;
  maxFileBytes: number;
}

export interface Report {
  schemaVersion: 1;
  tool: { name: string; version: string };
  project: string;
  generatedAt: string;
  durationMs: number;
  scan: ScanSummary;
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byCategory: Record<Category, number>;
  };
  checks: CheckStatus[];
  diagnostics: Diagnostic[];
}

// Names used in the Day 2 plan
export type Finding = Diagnostic;
export type ScanResult = Report;

// ---------- helpers ----------
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const CATEGORIES: Category[] = ["security", "reliability", "performance", "maintainability", "style"];

const toPosix = (p: string): string => p.replace(/\\/g, "/");
const sha = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 12);

export type DiagnosticInput = Omit<Diagnostic, "schemaVersion" | "id"> & {
  /** What identifies this finding inside its file (a method signature, a collection name...). Not output. */
  anchor?: string;
};

export function makeDiagnostic(input: DiagnosticInput): Diagnostic {
  const { anchor, ...d } = input;
  const key = `${d.rule}|${d.location?.file ?? ""}|${anchor ?? d.evidence ?? d.message}`;
  return { schemaVersion: 1, id: sha(key), ...d };
}

/**
 * Exit code policy:
 *   0 = every requested check ran and there are no high or critical findings
 *   1 = high or critical findings
 *   2 = a check (or the tool itself) failed, so the report is incomplete
 */
export function exitCodeFor(report: Report): number {
  if (report.checks.some((c) => c.status === "failed")) return 2;
  const blocking = report.summary.bySeverity.critical + report.summary.bySeverity.high;
  return blocking > 0 ? 1 : 0;
}

/** Same report with everything that changes between runs removed, so two runs print identical JSON. */
export function stabilizeReport(report: Report): Report {
  return {
    ...report,
    project: ".",
    generatedAt: "1970-01-01T00:00:00.000Z",
    durationMs: 0,
    checks: report.checks.map((c) => ({ ...c, durationMs: 0 })),
  };
}

// ---------- shapes of the existing checks ----------
export interface SecretHitLike {
  level: "ALERT" | "INFO";
  name: string;
  file: string;
  line: number;
  preview: string;
}
export interface BloatRowLike { file: string; line: number; len: number; name: string }
export interface AnalyzeIssueLike {
  kind: "error" | "warning" | "info";
  message: string;
  loc: string;
  rule: string;
}
export interface AnalyzeResultLike {
  ran: boolean;
  failed?: boolean;
  reason: string;
  issues: AnalyzeIssueLike[];
}

// ---------- adapters: old shapes -> Diagnostic ----------
export function fromSecret(h: SecretHitLike, projectDir: string): Diagnostic {
  // h.preview is deliberately ignored: no part of a secret may appear in a report.
  const location = { file: toPosix(path.relative(projectDir, h.file)), line: h.line };
  if (h.level === "INFO") {
    return makeDiagnostic({
      rule: "secrets/firebase-config-key",
      category: "security",
      severity: "info",
      confidence: "high",
      source: "static",
      message: `Firebase client config key found (${h.name})`,
      location,
      evidence: `pattern: ${h.name}`,
      anchor: h.name,
      why: "Firebase client keys identify your project. They are not secrets by themselves; real protection comes from Firestore/Storage security rules and API key restrictions.",
      fix: "Check your security rules and restrict the key in the Google Cloud console.",
    });
  }
  return makeDiagnostic({
    rule: "secrets/hardcoded-secret",
    category: "security",
    severity: "high",
    confidence: "medium", // pattern match only
    source: "static",
    message: `Possible hardcoded secret (${h.name})`,
    location,
    evidence: `pattern: ${h.name}`,
    anchor: h.name,
    why: "Secrets stored in source code can be extracted from the app or leaked through the repository.",
    fix: "Move it out of the source (environment config or a secret manager). If it was ever committed, rotate it.",
  });
}

export function fromBloat(b: BloatRowLike, projectDir: string): Diagnostic {
  return makeDiagnostic({
    rule: "bloat/long-method",
    category: "maintainability",
    severity: b.len >= 200 ? "medium" : "low",
    confidence: "medium", // method boundaries are estimated from braces (heuristic)
    source: "static",
    message: `Long method (${b.len} lines, estimated)`,
    location: { file: toPosix(path.relative(projectDir, b.file)), line: b.line },
    evidence: `${b.len} lines: ${b.name}`,
    anchor: b.name,
    why: "Very long methods are hard to read and test. In Flutter, a long build() rebuilds everything inside it on every setState.",
    fix: "Split it into smaller widgets or methods.",
  });
}

const ANALYZER_HELP: Record<string, { why: string; fix: string }> = {
  must_call_super: {
    why: "This method overrides one that Flutter requires you to call. Skipping it can skip Flutter's own setup or cleanup.",
    fix: "Call super.initState() first, or super.dispose() last, inside the override.",
  },
  unawaited_return_in_try_block: {
    why: "A Future returned without await inside try is not covered by the catch block, so its errors skip your error handling.",
    fix: "Use `return await ...` inside the try block.",
  },
  use_build_context_synchronously: {
    why: "After an await the widget may be gone. Using its BuildContext then can misbehave or crash.",
    fix: "Check `if (!mounted) return;` (or `context.mounted`) after the await, before using context.",
  },
  unawaited_futures: {
    why: "A Future is started and nobody waits for it, so its errors and completion are ignored.",
    fix: "Add await, or wrap it in unawaited(...) if ignoring it is intentional.",
  },
  cancel_subscriptions: {
    why: "A stream subscription that is never cancelled keeps running and leaks memory.",
    fix: "Cancel the subscription in dispose().",
  },
  close_sinks: {
    why: "A sink or controller that is never closed leaks resources.",
    fix: "Call close() in dispose().",
  },
  deprecated_member_use: {
    why: "This API is deprecated and may be removed in a future Flutter version.",
    fix: "Replace it with the API recommended in the message.",
  },
};

export function fromAnalyzer(i: AnalyzeIssueLike, tier: string): Diagnostic {
  const m = i.loc.match(/^(.*):(\d+):(\d+)$/);
  const location = m
    ? { file: toPosix(m[1]), line: Number(m[2]), column: Number(m[3]) }
    : undefined;
  let category: Category = "style";
  let severity: Severity = "info";
  if (tier === "error" || tier === "bug-risk") { category = "reliability"; severity = "high"; }
  else if (tier === "migration" || tier === "cleanup") { category = "maintainability"; severity = "low"; }
  const help = ANALYZER_HELP[i.rule];
  return makeDiagnostic({
    rule: `analyzer/${i.rule}`,
    category,
    severity,
    confidence: "high", // reported by the official Dart analyzer
    source: "analyzer",
    message: i.message,
    location,
    evidence: i.message,
    anchor: i.message,
    why: help?.why,
    fix: help?.fix,
  });
}

export function fromPerf(
  f: ReturnType<typeof findPerfInText>[number],
  file: string,
  projectDir: string,
): Diagnostic {
  const location = { file: toPosix(path.relative(projectDir, file)), line: f.line };
  if (f.rule === "firestore-unbounded-read") {
    return makeDiagnostic({
      rule: "perf/firestore-unbounded-read",
      category: "performance",
      severity: "medium",
      confidence: "medium",
      source: "static",
      message: "Reads a whole Firestore collection with no limit() or where()",
      location,
      evidence: f.collection ? `collection: ${f.collection}` : undefined,
      anchor: f.collection ?? "unknown-collection",
      why: "Cost and load time grow with the size of the collection.",
      fix: "Add limit() or where(), or read once and cache the result.",
    });
  }
  if (f.rule === "firestore-query-without-limit") {
    return makeDiagnostic({
      rule: "perf/firestore-query-without-limit",
      category: "performance",
      severity: "low",
      confidence: "low", // many where() queries legitimately return only a few documents
      source: "static",
      message: "Firestore query has where() but no limit()",
      location,
      evidence: f.collection ? `collection: ${f.collection}` : undefined,
      anchor: f.collection ?? "unknown-collection",
      why: "where() filters documents but does not cap how many come back. If many documents can match, cost and load time grow.",
      fix: "Add limit() if the screen only needs the first N results, or paginate.",
    });
  }
  return makeDiagnostic({
    rule: "perf/sequential-await-in-loop",
    category: "performance",
    severity: "low",
    confidence: "low", // sometimes the order really matters
    source: "static",
    message: "await inside a loop runs iterations one after another",
    location,
    anchor: "loop",
    why: "If the iterations are independent, running them together is faster.",
    fix: "Consider Future.wait() when iterations do not depend on each other.",
  });
}

// ---------- the report ----------
export interface ReportDeps {
  findSecrets(dir: string): SecretHitLike[];
  findBloat(dir: string, min: number): BloatRowLike[];
  runAnalyze(dir: string): AnalyzeResultLike;
  tierOf(i: AnalyzeIssueLike): string;
}

export function buildReport(
  dir: string,
  deps: ReportDeps,
  opts: { analyze: boolean },
): Report {
  const t0 = Date.now();
  const scanner = getScanner(dir); // throws a clear error if the folder does not exist
  scanner.files();

  const diagnostics: Diagnostic[] = [];
  const checks: CheckStatus[] = [];

  // A check that throws is recorded as failed; the other checks still run.
  const timed = (name: string, fn: () => void) => {
    const s = Date.now();
    try {
      fn();
      checks.push({ name, status: "ok", durationMs: Date.now() - s });
    } catch (e) {
      checks.push({ name, status: "failed", reason: (e as Error).message, durationMs: Date.now() - s });
    }
  };

  timed("secrets", () => {
    deps.findSecrets(dir).forEach((h) => diagnostics.push(fromSecret(h, dir)));
  });
  timed("bloat", () => {
    deps.findBloat(dir, 80).forEach((b) => diagnostics.push(fromBloat(b, dir)));
  });
  timed("perf", () => {
    for (const file of walk(dir)) {
      if (!shouldCheckPerf(file, dir)) continue;
      for (const f of findPerfInText(readText(file))) {
        diagnostics.push(fromPerf(f, file, dir));
      }
    }
  });

  if (opts.analyze) {
    const s = Date.now();
    try {
      const a = deps.runAnalyze(dir);
      if (a.ran) {
        a.issues.forEach((i) => diagnostics.push(fromAnalyzer(i, deps.tierOf(i))));
        checks.push({ name: "analyze", status: "ok", durationMs: Date.now() - s });
      } else {
        checks.push({
          name: "analyze",
          status: a.failed ? "failed" : "skipped",
          reason: a.reason,
          durationMs: Date.now() - s,
        });
      }
    } catch (e) {
      checks.push({ name: "analyze", status: "failed", reason: (e as Error).message, durationMs: Date.now() - s });
    }
  } else {
    checks.push({ name: "analyze", status: "skipped", reason: "skipped (--no-analyze)", durationMs: 0 });
  }

  // Same finding twice in one file: keep the first id, give later ones a numbered id.
  // Order is by file and line, so ids stay the same when lines shift.
  const byPosition = [...diagnostics].sort(
    (a, b) =>
      (a.location?.file ?? "").localeCompare(b.location?.file ?? "") ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );
  const seen = new Map<string, number>();
  for (const d of byPosition) {
    const n = (seen.get(d.id) ?? 0) + 1;
    seen.set(d.id, n);
    if (n > 1) d.id = sha(`${d.id}#${n}`);
  }

  const rank = (s: Severity) => SEVERITY_ORDER.indexOf(s);
  diagnostics.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      (a.location?.file ?? "").localeCompare(b.location?.file ?? "") ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );

  const bySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const d of diagnostics) {
    bySeverity[d.severity]++;
    byCategory[d.category]++;
  }

  return {
    schemaVersion: 1,
    tool: TOOL,
    project: path.resolve(dir),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    scan: { ...scanner.stats, maxFileBytes: scanner.options.maxFileBytes },
    summary: { total: diagnostics.length, bySeverity, byCategory },
    checks,
    diagnostics,
  };
}

export function registerReport(program: Command, deps: ReportDeps): void {
  program
    .command("report <dir>")
    .alias("scan")
    .description("run all checks and print a report. Exit code: 0 clean, 1 high/critical findings, 2 a check or the tool failed")
    .option("--no-analyze", "skip flutter analyze (faster)")
    .option("--json", "print the full report as JSON")
    .option("--out <file>", "write the JSON report to a file")
    .option("--max-file-kb <n>", "skip files larger than this many KB", "1000")
    .option("--stable", "omit timestamps, timings and absolute paths so two runs print identical JSON")
    .action((dir: string, opts: { analyze: boolean; json?: boolean; out?: string; maxFileKb: string; stable?: boolean }) => {
      try {
        const kb = Number(opts.maxFileKb);
        if (!Number.isFinite(kb) || kb <= 0) throw new Error("--max-file-kb must be a positive number");
        configureScanner({ maxFileBytes: Math.round(kb * 1024) });

        const report = buildReport(dir, deps, { analyze: opts.analyze });
        const shown = opts.stable ? stabilizeReport(report) : report;

        if (opts.out) {
          fs.writeFileSync(opts.out, JSON.stringify(shown, null, 2));
          console.log(`Report written to ${opts.out}`);
        }
        if (opts.json) {
          console.log(JSON.stringify(shown, null, 2));
        } else {
          const s = report.summary;
          const sc = report.scan;
          console.log(`\n${s.total} diagnostic(s) in ${(report.durationMs / 1000).toFixed(1)}s`);
          const skipped: string[] = [];
          if (sc.filesTooLarge) skipped.push(`${sc.filesTooLarge} file(s) over ${Math.round(sc.maxFileBytes / 1024)} KB`);
          if (sc.filesUnreadable) skipped.push(`${sc.filesUnreadable} unreadable file(s)`);
          if (sc.unreadableDirs) skipped.push(`${sc.unreadableDirs} unreadable folder(s)`);
          if (sc.symlinksSkipped) skipped.push(`${sc.symlinksSkipped} symlink(s)`);
          console.log(`Scanned ${sc.filesListed} file(s)` + (skipped.length ? `; skipped: ${skipped.join(", ")}` : ""));
          console.log("By severity: " + SEVERITY_ORDER.map((k) => `${k} ${s.bySeverity[k]}`).join(", "));
          console.log("By category: " + CATEGORIES.map((k) => `${k} ${s.byCategory[k]}`).join(", "));
          report.checks
            .filter((c) => c.status === "failed")
            .forEach((c) => console.log(`Check FAILED: ${c.name} (${c.reason}). This report is incomplete.`));
          report.checks
            .filter((c) => c.status === "skipped")
            .forEach((c) => console.log(`Check skipped: ${c.name} (${c.reason})`));

          const top = report.diagnostics
            .filter((d) => d.severity !== "info" && d.severity !== "low")
            .slice(0, 15);
          if (top.length) {
            console.log("\nMost important:");
            top.forEach((d) => {
              const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
              console.log(`  [${d.severity}/${d.confidence}] ${d.rule}  ${loc}`);
            });
          }
        }

        process.exitCode = exitCodeFor(report);
        if (!opts.json) {
          console.log(`\nExit code ${process.exitCode} (0 clean, 1 high/critical findings, 2 a check failed)`);
        }
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exitCode = 2; // the tool itself failed, not a finding
      }
    });
}