import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

export type Verdict = "true" | "false" | "unsure" | "unlabeled";
const VERDICTS: readonly Verdict[] = ["true", "false", "unsure", "unlabeled"];
const MIN_LABELS = 10; // below this, a precision number is not trustworthy

export interface LabelEntry {
  id: string;
  rule: string;
  file: string;
  line: number;
  verdict: Verdict; // "true" = real problem, "false" = false alarm
  note: string;
}
export interface LabelFile {
  project: string;
  labels: LabelEntry[];
}
export interface DiagLike {
  id: string;
  rule: string;
  location?: { file: string; line: number };
}
export interface RuleScore {
  rule: string;
  truePositives: number;
  falsePositives: number;
  unsure: number;
  unlabeled: number;
  precision: number | null; // null when nothing is labeled true/false yet
}

export function parseLabelFile(text: string): LabelFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("labels file is not valid JSON");
  }
  const obj = data as { project?: unknown; labels?: unknown };
  if (!obj || typeof obj.project !== "string" || !Array.isArray(obj.labels)) {
    throw new Error('labels file must look like {"project": "...", "labels": [...]}');
  }
  const labels: LabelEntry[] = obj.labels.map((raw, i) => {
    const l = raw as Partial<LabelEntry>;
    if (typeof l.id !== "string" || typeof l.rule !== "string") {
      throw new Error(`label #${i + 1}: id and rule are required`);
    }
    const verdict = (l.verdict ?? "unlabeled") as Verdict;
    if (!VERDICTS.includes(verdict)) {
      throw new Error(
        `label #${i + 1} (${l.file ?? l.id}): verdict must be one of ${VERDICTS.join(", ")}, got "${String(l.verdict)}"`,
      );
    }
    return { id: l.id, rule: l.rule, file: l.file ?? "", line: l.line ?? 0, verdict, note: l.note ?? "" };
  });
  return { project: obj.project, labels };
}

/** Builds a labels file for findings whose rule starts with rulePrefix. Existing verdicts are kept. */
export function makeTemplate(
  diags: DiagLike[],
  rulePrefix: string,
  project: string,
  existing?: LabelFile,
): LabelFile {
  const prev = new Map((existing?.labels ?? []).map((l) => [l.id, l] as const));
  const out = new Map<string, LabelEntry>();
  for (const d of diags) {
    if (!d.rule.startsWith(rulePrefix)) continue;
    const old = prev.get(d.id);
    out.set(d.id, {
      id: d.id,
      rule: d.rule,
      file: d.location?.file ?? "",
      line: d.location?.line ?? 0,
      verdict: old?.verdict ?? "unlabeled",
      note: old?.note ?? "",
    });
  }
  for (const l of existing?.labels ?? []) if (!out.has(l.id)) out.set(l.id, l);
  const labels = [...out.values()].sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
  );
  return { project, labels };
}

/** Precision per rule = true / (true + false). "unsure" and "unlabeled" are left out of the number. */
export function scoreLabels(
  diags: DiagLike[],
  lf: LabelFile,
): { rules: RuleScore[]; stale: number } {
  const present = new Set(diags.map((d) => d.id));
  const byRule = new Map<string, RuleScore>();
  let stale = 0;
  for (const l of lf.labels) {
    if (!present.has(l.id)) {
      stale++; // labelled finding no longer appears in the report
      continue;
    }
    const s =
      byRule.get(l.rule) ??
      { rule: l.rule, truePositives: 0, falsePositives: 0, unsure: 0, unlabeled: 0, precision: null };
    if (l.verdict === "true") s.truePositives++;
    else if (l.verdict === "false") s.falsePositives++;
    else if (l.verdict === "unsure") s.unsure++;
    else s.unlabeled++;
    byRule.set(l.rule, s);
  }
  for (const s of byRule.values()) {
    const n = s.truePositives + s.falsePositives;
    s.precision = n === 0 ? null : s.truePositives / n;
  }
  return { rules: [...byRule.values()].sort((a, b) => a.rule.localeCompare(b.rule)), stale };
}

function loadDiagnostics(file: string): DiagLike[] {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { diagnostics?: DiagLike[] };
  if (!Array.isArray(data.diagnostics)) throw new Error(`${file} is not a FlutterGuard report`);
  return data.diagnostics;
}

export function registerBench(program: Command): void {
  const bench = program
    .command("bench")
    .description("measure rule accuracy from hand-labelled findings");

  bench
    .command("template <report>")
    .requiredOption("--project <name>", "name of the project the report came from")
    .requiredOption("--out <file>", "labels file to create or update")
    .option("--rule <prefix>", "only findings whose rule starts with this", "")
    .action((report: string, opts: { project: string; out: string; rule: string }) => {
      try {
        const diags = loadDiagnostics(report);
        const existing = fs.existsSync(opts.out)
          ? parseLabelFile(fs.readFileSync(opts.out, "utf8"))
          : undefined;
        const lf = makeTemplate(diags, opts.rule, opts.project, existing);
        fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
        fs.writeFileSync(opts.out, JSON.stringify(lf, null, 2));
        const todo = lf.labels.filter((l) => l.verdict === "unlabeled").length;
        console.log(`Wrote ${lf.labels.length} label(s) to ${opts.out}; ${todo} still unlabeled`);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exitCode = 2;
      }
    });

  bench
    .command("score <report> <labels>")
    .action((report: string, labelsFile: string) => {
      try {
        const diags = loadDiagnostics(report);
        const lf = parseLabelFile(fs.readFileSync(labelsFile, "utf8"));
        const { rules, stale } = scoreLabels(diags, lf);
        console.log(`Project: ${lf.project}`);
        if (!rules.length) console.log("No labels match this report.");
        for (const s of rules) {
          const n = s.truePositives + s.falsePositives;
          const p = s.precision === null ? "n/a" : `${(s.precision * 100).toFixed(0)}%`;
          console.log(
            `${s.rule}\n  true ${s.truePositives}, false ${s.falsePositives}, unsure ${s.unsure}, unlabeled ${s.unlabeled}  ->  precision ${p}` +
              (n > 0 && n < MIN_LABELS ? `  (only ${n} labelled: too few to trust)` : ""),
          );
        }
        if (stale) console.log(`\n${stale} label(s) no longer match any finding in this report (skipped)`);
        console.log("\nPrecision only. Recall (missed problems) is not measured here.");
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exitCode = 2;
      }
    });
}