import { Command } from "commander";
import path from "node:path";
import { analyzePenalty, printAnalyze, runAnalyze, tierOf } from "./analyzer";
import type { AnalyzeResult } from "./analyzer";
import { findBloat } from "./bloat";
import { registerPerf } from "./perf";
import { registerReport } from "./report";
import { readText, walk } from "./scanner";
import { findSecrets } from "./secrets";

const LANGS: Record<string, string> = {
  ".dart": "Dart", ".js": "JavaScript", ".ts": "TypeScript",
  ".py": "Python", ".java": "Java", ".go": "Go",
  ".kt": "Kotlin", ".swift": "Swift",
};

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
    console.log(`${rows.length} long method(s) (${opts.min}+ lines, estimated from braces)`);
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
registerReport(program, { findSecrets, findBloat, runAnalyze, tierOf });

program.parse();