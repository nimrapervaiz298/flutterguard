import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { parseLabelFile } from "./bench";
import type { DiagLike, LabelFile } from "./bench";
import { buildReport } from "./report";
import type { ReportDeps } from "./report";
import { resetScanners } from "./scanner";

const MIN_LABELS = 10; // below this, a precision number is not trustworthy

export interface ProjectEntry {
  name: string;
  dir: string; // relative to the benchmark root
  labels: string; // relative to the manifest file
  tuned: boolean; // true when a rule was written or tuned while looking at this project
}
export interface KnownBug {
  project: string;
  file: string;
  description: string;
  rule: string | null; // null = no rule catches this yet
}
export interface ProjectInput {
  entry: ProjectEntry;
  diagnostics: DiagLike[];
  labels: LabelFile;
}
export interface Tally {
  tp: number;
  fp: number;
  unsure: number;
}
export interface RuleResult {
  rule: string;
  all: Tally;
  untuned: Tally;
}
export interface Evaluation {
  rules: RuleResult[];
  lostTrue: string[];
  resolvedFalse: number;
  unlabeled: { project: string; rule: string; file: string; line: number }[];
  unmeasured: string[];
  known: { total: number; detected: number; missed: string[] };
}
export interface Baseline {
  version: 1;
  rules: Record<string, Tally>;
}

const posix = (p: string): string => p.replace(/\\/g, "/");
const emptyTally = (): Tally => ({ tp: 0, fp: 0, unsure: 0 });
const pct = (p: number | null): string => (p === null ? "n/a" : `${Math.round(p * 100)}%`);
const DECIDED = new Set(["true", "false", "unsure"]);

export function precisionOf(t: Tally): number | null {
  const n = t.tp + t.fp;
  return n === 0 ? null : t.tp / n;
}

function bump(t: Tally, verdict: string): void {
  if (verdict === "true") t.tp++;
  else if (verdict === "false") t.fp++;
  else if (verdict === "unsure") t.unsure++;
}

/** Pure function: compares what the tool finds now against the hand-labelled findings. */
export function evaluate(inputs: ProjectInput[], known: KnownBug[]): Evaluation {
  const labeledRules = new Set<string>();
  for (const inp of inputs) {
    for (const l of inp.labels.labels) if (DECIDED.has(l.verdict)) labeledRules.add(l.rule);
  }

  const byRule = new Map<string, RuleResult>();
  const ruleOf = (rule: string): RuleResult => {
    let r = byRule.get(rule);
    if (!r) {
      r = { rule, all: emptyTally(), untuned: emptyTally() };
      byRule.set(rule, r);
    }
    return r;
  };

  const lostTrue: string[] = [];
  let resolvedFalse = 0;
  const unlabeled: Evaluation["unlabeled"] = [];
  const seenRules = new Set<string>();

  for (const inp of inputs) {
    const present = new Map(inp.diagnostics.map((x) => [x.id, x] as const));
    const decidedIds = new Set<string>();
    for (const l of inp.labels.labels) {
      if (!DECIDED.has(l.verdict)) continue;
      decidedIds.add(l.id);
      if (!present.has(l.id)) {
        if (l.verdict === "true") lostTrue.push(`${inp.entry.name}: ${l.file}:${l.line} (${l.rule})`);
        else if (l.verdict === "false") resolvedFalse++;
        continue;
      }
      const r = ruleOf(l.rule);
      bump(r.all, l.verdict);
      if (!inp.entry.tuned) bump(r.untuned, l.verdict);
    }
    for (const x of inp.diagnostics) {
      seenRules.add(x.rule);
      if (labeledRules.has(x.rule) && !decidedIds.has(x.id)) {
        unlabeled.push({
          project: inp.entry.name,
          rule: x.rule,
          file: x.location?.file ?? "",
          line: x.location?.line ?? 0,
        });
      }
    }
  }

  const knownResult = { total: 0, detected: 0, missed: [] as string[] };
  for (const kb of known) {
    const inp = inputs.find((i) => i.entry.name === kb.project);
    if (!inp) continue; // project not on this machine: not counted
    knownResult.total++;
    const file = posix(kb.file);
    const hit = kb.rule !== null && inp.diagnostics.some((x) => x.rule === kb.rule && x.location?.file === file);
    if (hit) knownResult.detected++;
    else knownResult.missed.push(`${kb.project}: ${file} - ${kb.description}`);
  }

  lostTrue.sort();
  knownResult.missed.sort();
  unlabeled.sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      a.rule.localeCompare(b.rule) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return {
    rules: [...byRule.values()].sort((a, b) => a.rule.localeCompare(b.rule)),
    lostTrue,
    resolvedFalse,
    unlabeled,
    unmeasured: [...seenRules].filter((r) => !labeledRules.has(r)).sort(),
    known: knownResult,
  };
}

/** Regressions make the command exit with 1. Improvements are only reported. */
export function compare(ev: Evaluation, base: Baseline | null): { regressions: string[]; improvements: string[] } {
  const regressions = ev.lostTrue.map((s) => `a finding labelled as a real problem is no longer found: ${s}`);
  const improvements: string[] = [];
  if (!base) return { regressions, improvements };
  for (const [rule, b] of Object.entries(base.rules)) {
    const cur = ev.rules.find((r) => r.rule === rule);
    if (!cur) continue;
    const pb = precisionOf(b);
    const pc = precisionOf(cur.all);
    if (cur.all.fp > b.fp) regressions.push(`${rule}: false alarms went from ${b.fp} to ${cur.all.fp}`);
    if (cur.all.fp < b.fp) improvements.push(`${rule}: false alarms went from ${b.fp} to ${cur.all.fp}`);
    if (pb !== null && pc !== null && pc < pb - 1e-9) regressions.push(`${rule}: precision fell from ${pct(pb)} to ${pct(pc)}`);
    if (pb !== null && pc !== null && pc > pb + 1e-9) improvements.push(`${rule}: precision rose from ${pct(pb)} to ${pct(pc)}`);
  }
  return { regressions, improvements };
}

function precisionCell(t: Tally): string {
  const n = t.tp + t.fp;
  return `${pct(precisionOf(t))} (${t.tp} of ${n})`;
}

/** No timestamps and no machine paths, so the file only changes when the results change. */
export function toMarkdown(ev: Evaluation, measured: string[]): string {
  const out: string[] = [];
  out.push("# Accuracy results", "");
  out.push(
    "Generated by `flutterguard accuracy`. Precision = true / (true + false) over hand-labelled findings. " +
      "\"Unsure\" labels are left out of the number. Recall is not measured, except for the small list of known bugs below.",
    "",
  );
  out.push(`Projects measured: ${measured.join(", ")}`, "");
  out.push("| Rule | true | false | unsure | precision | precision on untuned projects |");
  out.push("|---|---|---|---|---|---|");
  for (const r of ev.rules) {
    const n = r.all.tp + r.all.fp;
    const few = n > 0 && n < MIN_LABELS ? " (few labels)" : "";
    out.push(`| ${r.rule} | ${r.all.tp} | ${r.all.fp} | ${r.all.unsure} | ${precisionCell(r.all)}${few} | ${precisionCell(r.untuned)} |`);
  }
  out.push("");
  out.push(`- Labelled false alarms that no longer appear: ${ev.resolvedFalse}`);
  out.push(`- Labelled real problems that are no longer found: ${ev.lostTrue.length}`);
  out.push(`- Findings still waiting for a label: ${ev.unlabeled.length}`);
  out.push(`- Known bugs detected: ${ev.known.detected} of ${ev.known.total}`);
  for (const m of ev.known.missed) out.push(`  - missed: ${m}`);
  out.push("");
  out.push(`Rules with no labels at all (accuracy unknown): ${ev.unmeasured.length ? ev.unmeasured.join(", ") : "none"}`);
  out.push("");
  return out.join("\n");
}

function readJson<T>(file: string, what: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    throw new Error(`could not read ${what} (${file}): ${(e as Error).message}`);
  }
}

export function registerAccuracy(program: Command, deps: ReportDeps): void {
  program
    .command("accuracy")
    .description("run the tool on the benchmark projects, compare with hand labels, and fail on regressions")
    .option("--root <dir>", "folder that contains the benchmark projects (default: FG_BENCH_ROOT, or the parent of the current folder)")
    .option("--manifest <file>", "list of benchmark projects", "benchmark/projects.json")
    .option("--baseline <file>", "accepted results to compare against", "benchmark/baseline.json")
    .option("--known <file>", "list of known real bugs (for recall)", "benchmark/known-bugs.json")
    .option("--results <file>", "markdown summary to write", "benchmark/RESULTS.md")
    .option("--update-baseline", "accept the current results as the new baseline")
    .option("--strict", "also fail when findings are still unlabeled")
    .action(
      (opts: {
        root?: string;
        manifest: string;
        baseline: string;
        known: string;
        results: string;
        updateBaseline?: boolean;
        strict?: boolean;
      }) => {
        try {
          const manifestPath = path.resolve(opts.manifest);
          const manifest = readJson<ProjectEntry[]>(manifestPath, "the manifest");
          if (!Array.isArray(manifest)) throw new Error("the manifest must be a JSON array");
          const root = path.resolve(opts.root ?? process.env.FG_BENCH_ROOT ?? path.join(process.cwd(), ".."));

          const inputs: ProjectInput[] = [];
          const skipped: string[] = [];
          for (const raw of manifest) {
            const e: ProjectEntry = { ...raw, tuned: raw.tuned === true };
            if (typeof e.name !== "string" || typeof e.dir !== "string" || typeof e.labels !== "string") {
              throw new Error("every manifest entry needs name, dir and labels");
            }
            const dir = path.resolve(root, e.dir);
            if (!fs.existsSync(dir)) {
              skipped.push(`${e.name} (folder not found: ${dir})`);
              continue;
            }
            const labelsPath = path.resolve(path.dirname(manifestPath), e.labels);
            if (!fs.existsSync(labelsPath)) {
              skipped.push(`${e.name} (labels file not found: ${labelsPath})`);
              continue;
            }
            const labels = parseLabelFile(fs.readFileSync(labelsPath, "utf8"));
            resetScanners();
            const report = buildReport(dir, deps, { analyze: false });
            const failed = report.checks.filter((c) => c.status === "failed");
            if (failed.length) {
              throw new Error(`${e.name}: check failed (${failed.map((c) => `${c.name}: ${c.reason}`).join("; ")})`);
            }
            inputs.push({ entry: e, diagnostics: report.diagnostics, labels });
          }
          if (inputs.length === 0) throw new Error(`no benchmark project was found under ${root}`);

          const knownPath = path.resolve(opts.known);
          const known = fs.existsSync(knownPath) ? readJson<KnownBug[]>(knownPath, "the known-bugs file") : [];
          const ev = evaluate(inputs, known);

          const measured = inputs.map((i) => i.entry.name);
          const resultsPath = path.resolve(opts.results);
          fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
          fs.writeFileSync(resultsPath, toMarkdown(ev, measured));

          console.log(`Projects measured: ${measured.join(", ")}`);
          skipped.forEach((s) => console.log(`Skipped: ${s}`));
          for (const r of ev.rules) {
            const n = r.all.tp + r.all.fp;
            console.log(
              `\n${r.rule}\n  all labelled   : true ${r.all.tp}, false ${r.all.fp}, unsure ${r.all.unsure} -> precision ${pct(precisionOf(r.all))}` +
                (n > 0 && n < MIN_LABELS ? `  (only ${n} labelled: too few to trust)` : ""),
            );
            console.log(`  untuned projects: true ${r.untuned.tp}, false ${r.untuned.fp}, unsure ${r.untuned.unsure} -> precision ${pct(precisionOf(r.untuned))}`);
          }
          console.log(`\nLabelled false alarms that no longer appear: ${ev.resolvedFalse}`);
          console.log(`Known bugs detected: ${ev.known.detected} of ${ev.known.total}`);
          ev.known.missed.forEach((m) => console.log(`  missed: ${m}`));
          console.log(`Findings still waiting for a label: ${ev.unlabeled.length}`);
          ev.unlabeled.slice(0, 10).forEach((u) => console.log(`  ${u.project}: ${u.rule} ${u.file}:${u.line}`));
          if (ev.unmeasured.length) console.log(`Rules with no labels (accuracy unknown): ${ev.unmeasured.join(", ")}`);
          console.log("\nPrecision only. Recall is measured only for the known bugs listed above.");

          const baselinePath = path.resolve(opts.baseline);
          if (opts.updateBaseline) {
            const base: Baseline = { version: 1, rules: Object.fromEntries(ev.rules.map((r) => [r.rule, r.all])) };
            fs.writeFileSync(baselinePath, JSON.stringify(base, null, 2) + "\n");
            console.log(`\nBaseline updated: ${baselinePath}`);
            ev.lostTrue.forEach((s) => console.log(`WARNING: a finding labelled as a real problem is no longer found: ${s}`));
            process.exitCode = 0;
            return;
          }

          const base = fs.existsSync(baselinePath) ? readJson<Baseline>(baselinePath, "the baseline") : null;
          if (!base) console.log("\nNo baseline yet. Run with --update-baseline to accept these results.");
          const { regressions, improvements } = compare(ev, base);
          improvements.forEach((s) => console.log(`IMPROVED: ${s}`));
          regressions.forEach((s) => console.log(`REGRESSION: ${s}`));
          if (regressions.length === 0) console.log(base ? "\nNo regressions against the baseline." : "");
          const unlabeledFail = opts.strict === true && ev.unlabeled.length > 0;
          if (unlabeledFail) console.log("FAILED (--strict): some findings are still unlabeled");
          process.exitCode = regressions.length > 0 || unlabeledFail ? 1 : 0;
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 2;
        }
      },
    );
}