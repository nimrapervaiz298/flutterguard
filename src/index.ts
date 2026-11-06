import { Command } from "commander";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { registerPerf } from "./perf";


const LANGS: Record<string, string> = {
  ".dart": "Dart", ".js": "JavaScript", ".ts": "TypeScript",
  ".py": "Python", ".java": "Java", ".go": "Go",
  ".kt": "Kotlin", ".swift": "Swift",
};
const SKIP = new Set(["node_modules", ".git", "build", ".dart_tool", "dist"]);

// ---------- file walking and reading (cached: each runs once per process) ----------
function walkRaw(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRaw(p, out);
    else out.push(p);
  }
  return out;
}

const walkCache = new Map<string, string[]>();
function walk(dir: string): string[] {
  let r = walkCache.get(dir);
  if (!r) {
    r = walkRaw(dir);
    walkCache.set(dir, r);
  }
  return r;
}

const textCache = new Map<string, string>();
function readText(f: string): string {
  let t = textCache.get(f);
  if (t === undefined) {
    t = fs.readFileSync(f, "utf8");
    textCache.set(f, t);
  }
  return t;
}

// ---------- secrets ----------
const PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  ["Generic secret", /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/i],
];
const SCAN_EXT = new Set([
  ...Object.keys(LANGS), ".json", ".yaml", ".yml", ".env",
  ".xml", ".plist", ".gradle", ".properties",
]);
const FIREBASE_FILES = new Set([
  "firebase_options.dart", "google-services.json", "GoogleService-Info.plist",
]);

type SecretHit = { level: "ALERT" | "INFO"; name: string; file: string; line: number; preview: string };

function findSecrets(dir: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of walk(dir)) {
    const base = path.basename(f);
    if (!SCAN_EXT.has(path.extname(f)) && base !== ".env") continue;
    if (fs.statSync(f).size > 1_000_000) continue;
    readText(f).split("\n").forEach((line, i) => {
      for (const [name, re] of PATTERNS) {
        const m = line.match(re);
        if (!m) continue;
        const isFirebase = FIREBASE_FILES.has(base) &&
          (name === "Google API key" || name === "Generic secret");
        hits.push({
          level: isFirebase ? "INFO" : "ALERT",
          name, file: f, line: i + 1, preview: m[0].slice(0, 6) + "***",
        });
        break; // one report per line
      }
    });
  }
  return hits;
}

// ---------- bloat ----------
const BRACE_EXT = new Set([".dart", ".js", ".ts", ".java", ".kt", ".swift", ".go"]);
type BloatRow = { file: string; line: number; len: number; name: string };

function findBloat(dir: string, min: number): BloatRow[] {
  const rows: BloatRow[] = [];
  for (const f of walk(dir)) {
    if (!BRACE_EXT.has(path.extname(f))) continue;
    if (/\.(g|freezed)\.dart$/.test(f)) continue; // skip generated code
    let depth = 0, start = -1, startText = "";
    readText(f).split("\n").forEach((raw, i) => {
      const line = raw
        .replace(/\/\/.*$/, "")
        .replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          if (depth === 2) { start = i; startText = raw.trim().slice(0, 50); }
        } else if (ch === "}") {
          if (depth === 2 && start >= 0) {
            const len = i - start + 1;
            if (len >= min) rows.push({ file: f, line: start + 1, len, name: startText });
            start = -1;
          }
          depth--;
        }
      }
    });
  }
  return rows.sort((a, b) => b.len - a.len);
}

// ---------- flutter analyze ----------
type Tier = "error" | "bug-risk" | "migration" | "cleanup" | "style";
type Issue = { kind: "error" | "warning" | "info"; message: string; loc: string; rule: string };
type AnalyzeResult = {
  ran: boolean; reason: string;
  errors: number; warnings: number; infos: number; issues: Issue[];
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
const MIGRATION = new Set([
  "deprecated_member_use",
  "deprecated_member_use_from_same_package",
]);

function tierOf(i: Issue): Tier {
  if (i.kind === "error") return "error";
  if (BUG_RISK.has(i.rule)) return "bug-risk";
  if (MIGRATION.has(i.rule)) return "migration";
  if (/^(unused_|duplicate_import|unnecessary_|prefer_final|dead_code|avoid_print)/.test(i.rule)) return "cleanup";
  return "style";
}

function countTiers(issues: Issue[]): Record<Tier, number> {
  const t: Record<Tier, number> = { error: 0, "bug-risk": 0, migration: 0, cleanup: 0, style: 0 };
  for (const i of issues) t[tierOf(i)]++;
  return t;
}

function analyzePenalty(a: AnalyzeResult): number {
  if (!a.ran) return 0;
  const t = countTiers(a.issues);
  return Math.min(30, t.error * 5 + t["bug-risk"] * 3 + Math.round(t.cleanup * 0.1) + Math.round(t.migration * 0.1));
}

function runAnalyze(dir: string): AnalyzeResult {
  const res: AnalyzeResult = { ran: false, reason: "", errors: 0, warnings: 0, infos: 0, issues: [] };
  if (!fs.existsSync(path.join(dir, "pubspec.yaml"))) {
    res.reason = "no pubspec.yaml (not a Flutter/Dart project)";
    return res;
  }
  if (!fs.existsSync(path.join(dir, ".dart_tool", "package_config.json"))) {
    res.reason = "dependencies not installed - run `flutter pub get` in the project first";
    return res;
  }
  const bin = process.env.FLUTTER_BIN || "flutter";
  const r = spawnSync(`"${bin}" analyze --no-pub`, {
    cwd: dir, shell: true, encoding: "utf8",
    timeout: 300_000, maxBuffer: 100 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (process.env.FG_DEBUG) {
    console.log(`[debug] bin: ${bin}, exit: ${r.status}, error: ${r.error?.message ?? "none"}`);
  }
  if (r.error) {
    res.reason = `could not run flutter: ${r.error.message}`;
    return res;
  }
  if (r.status === 9009 || r.status === 127) {
    res.reason = "flutter command not found (set FLUTTER_BIN or add Flutter to PATH)";
    return res;
  }
  // line format: "  warning - message - lib\x.dart:12:3 - rule_name"
  const full = /^\s*(error|warning|info)\s+-\s+(.*)\s+-\s+(\S+:\d+:\d+)\s+-\s+(\S+)\s*$/;
  const loose = /^\s*(error|warning|info)\s+-\s/;
  for (const line of out.split("\n")) {
    const m = line.match(full);
    let issue: Issue | null = null;
    if (m) {
      issue = { kind: m[1] as Issue["kind"], message: m[2], loc: m[3], rule: m[4] };
    } else {
      const l = line.match(loose);
      if (l) issue = { kind: l[1] as Issue["kind"], message: line.trim(), loc: "", rule: "unknown" };
    }
    if (!issue) continue;
    res.issues.push(issue);
    if (issue.kind === "error") res.errors++;
    else if (issue.kind === "warning") res.warnings++;
    else res.infos++;
  }
  if (r.status !== 0 && r.status !== 1) {
    res.reason = `flutter analyze failed (exit ${r.status}); run with FG_DEBUG=1 to see why`;
    return res;
  }
  res.ran = true;
  return res;
}

function printAnalyze(a: AnalyzeResult): void {
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

// ---------- commands ----------
const program = new Command().name("flutterguard");

program.command("check <dir>").action((dir: string) => {
  const stats: Record<string, { files: number; lines: number }> = {};
  const big: { file: string; lines: number }[] = [];
  for (const f of walk(dir)) {
    const lang = LANGS[path.extname(f)];
    if (!lang) continue;
    const lines = readText(f).split("\n").length;
    stats[lang] ??= { files: 0, lines: 0 };
    stats[lang].files++;
    stats[lang].lines += lines;
    big.push({ file: f, lines });
  }
  console.table(stats);
  console.log("Largest files:");
  big.sort((a, b) => b.lines - a.lines).slice(0, 5)
    .forEach((b) => console.log(`${b.lines} lines  ${b.file}`));
});

program.command("secrets <dir>").action((dir: string) => {
  const hits = findSecrets(dir);
  hits.forEach((h) =>
    console.log(`${h.level === "ALERT" ? "ALERT" : "INFO "}  ${h.name}  ${h.file}:${h.line}  ${h.preview}`));
  const alerts = hits.filter((h) => h.level === "ALERT").length;
  console.log(`ALERT: ${alerts}, INFO (Firebase config): ${hits.length - alerts}`);
  process.exitCode = alerts ? 1 : 0;
});

program
  .command("bloat <dir>")
  .option("--min <n>", "minimum method length in lines", "80")
  .action((dir: string, opts: { min: string }) => {
    const rows = findBloat(dir, Number(opts.min));
    console.log(`${rows.length} long method(s) (${opts.min}+ lines)`);
    rows.slice(0, 10).forEach((r) => console.log(`${r.len} lines  ${r.file}:${r.line}  ${r.name}`));
  });

program.command("analyze <dir>").action((dir: string) => {
  console.log("Running flutter analyze (this can take a minute)...");
  const t0 = Date.now();
  const a = runAnalyze(dir);
  if (!a.ran) {
    console.log(`Skipped: ${a.reason}`);
    return;
  }
  printAnalyze(a);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = a.errors ? 1 : 0;
});

program
  .command("scan <dir>")
  .option("--no-analyze", "skip flutter analyze (faster)")
  .action((dir: string, opts: { analyze: boolean }) => {
    const t0 = Date.now();

    const tFiles = Date.now();
    const hits = findSecrets(dir);
    const alerts = hits.filter((h) => h.level === "ALERT");
    const infos = hits.length - alerts.length;
    const rows = findBloat(dir, 80);
    const huge = rows.filter((r) => r.len >= 200).length;
    const filesMs = Date.now() - tFiles;

    let a: AnalyzeResult = { ran: false, reason: "skipped (--no-analyze)", errors: 0, warnings: 0, infos: 0, issues: [] };
    let analyzeMs = 0;
    if (opts.analyze) {
      console.log("Running flutter analyze (this can take a minute)...");
      const tA = Date.now();
      a = runAnalyze(dir);
      analyzeMs = Date.now() - tA;
    }

    const secretPenalty = Math.min(45, alerts.length * 15);
    const bloatPenalty = Math.min(40, huge * 3 + (rows.length - huge));
    const aPenalty = analyzePenalty(a);
    const score = Math.max(0, 100 - secretPenalty - bloatPenalty - aPenalty);

    console.log(`\nFlutterGuard score: ${score}/100\n`);
    console.log(`Secrets : ${alerts.length} ALERT, ${infos} INFO (Firebase config)  [-${secretPenalty}]`);
    console.log(`Bloat   : ${rows.length} long methods (80+ lines), ${huge} very long (200+)  [-${bloatPenalty}]`);
    if (a.ran) console.log(`Analyze : ${a.errors} errors, ${a.warnings} warnings, ${a.infos} infos  [-${aPenalty}]`);
    else console.log(`Analyze : skipped (${a.reason})`);

    if (alerts.length) {
      console.log("\nSecrets:");
      alerts.slice(0, 5).forEach((h) => console.log(`  ${h.name}  ${h.file}:${h.line}`));
    }
    if (a.ran) {
      console.log("");
      printAnalyze(a);
    }
    if (rows.length) {
      console.log("\nLongest methods:");
      rows.slice(0, 5).forEach((r) => console.log(`  ${r.len} lines  ${r.file}:${r.line}  ${r.name}`));
    }
    console.log("\nNote: the score formula is a first version. It is an estimate, not a guarantee.");
    console.log(
      `\nTiming: file checks ${filesMs}ms, analyze ${(analyzeMs / 1000).toFixed(1)}s, total ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    process.exitCode = alerts.length || a.errors ? 1 : 0;
  });
  registerPerf(program, walk, readText);
program.parse();