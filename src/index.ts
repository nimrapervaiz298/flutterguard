import { Command } from "commander";
import path from "node:path";
import { printAnalyze, runAnalyze, tierOf } from "./analyzer";
import { registerBench } from "./bench";
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
    console.log(`${a.failed ? "Check FAILED" : "Skipped"}: ${a.reason}`);
    process.exitCode = a.failed ? 2 : 0;
    return;
  }
  printAnalyze(a);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = a.errors ? 1 : 0;
});

registerPerf(program, walk, readText);
// "scan" is an alias of "report": one command, one summary, no health score.
registerReport(program, { findSecrets, findBloat, runAnalyze, tierOf });
registerBench(program);

program.parse();