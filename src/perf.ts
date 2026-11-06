import type { Command } from "commander";
import path from "node:path";

export type PerfFinding = {
  rule: "firestore-unbounded-read" | "sequential-await-in-loop";
  severity: "warning" | "info";
  line: number;
  message: string;
  collection?: string;
};

// Blank out comments and string contents. Length and newlines are kept,
// so line numbers and offsets stay correct.
function mask(text: string): string {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  t = t.replace(/(?<!:)\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  t = t.replace(/(["'])(?:\\.|(?!\1)[^\n\\])*\1/g, (m) => m[0] + " ".repeat(m.length - 2) + m[0]);
  return t;
}

function lineOf(text: string, idx: number): number {
  return text.slice(0, idx).split("\n").length;
}

function matchClose(text: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Rule 1: .collection(...).get() with no .doc / .where / .limit / .count
const BOUNDS = /\.(doc|where|limit|limitToLast|count)\s*\(/;

function unboundedReads(masked: string, original: string): PerfFinding[] {
  const out: PerfFinding[] = [];
  const re = /\.collection\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const end = masked.indexOf(";", m.index);
    const seg = masked.slice(m.index, end === -1 ? undefined : end);
    // a later .collection( in the same statement is handled by its own match
    if (seg.slice(1).search(/\.collection\s*\(/) !== -1) continue;
    if (!/\.get\s*\(\s*\)/.test(seg)) continue;
    if (BOUNDS.test(seg)) continue;
    // masking keeps offsets, so the real collection name is read from the original text
    const name = original.slice(m.index).match(/^\.collection\s*\(\s*['"]([^'"]+)['"]/)?.[1];
    out.push({
      rule: "firestore-unbounded-read",
      severity: "warning",
      line: lineOf(masked, m.index),
      message: "Reads a whole Firestore collection with no limit() or where(). Cost and load time grow with the collection size.",
      collection: name,
    });
  }
  return out;
}

// Rule 2: await inside a for loop
function loopAwaits(masked: string): PerfFinding[] {
  const out: PerfFinding[] = [];
  const seen = new Set<number>();
  const re = /\bfor\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (/await\s*$/.test(masked.slice(Math.max(0, m.index - 8), m.index))) continue; // "await for" streams
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open, "(", ")");
    if (close === -1) continue;
    let i = close + 1;
    while (i < masked.length && /\s/.test(masked[i])) i++;
    const bodyEnd = masked[i] === "{" ? matchClose(masked, i, "{", "}") : masked.indexOf(";", i);
    if (bodyEnd === -1) continue;
    const rel = masked.slice(i, bodyEnd).search(/\bawait\b/);
    if (rel === -1) continue;
    const key = i + rel;
    if (seen.has(key)) continue; // nested loops: report each await once
    seen.add(key);
    out.push({
      rule: "sequential-await-in-loop",
      severity: "info",
      line: lineOf(masked, m.index),
      message: "await inside a loop runs iterations one after another. If iterations are independent, consider Future.wait().",
    });
  }
  return out;
}

export function findPerfInText(text: string): PerfFinding[] {
  const masked = mask(text);
  return [...unboundedReads(masked, text), ...loopAwaits(masked)].sort((a, b) => a.line - b.line);
}

export function registerPerf(
  program: Command,
  walk: (dir: string) => string[],
  readText: (file: string) => string,
): void {
  program
    .command("perf <dir>")
    .option("--json", "print findings as JSON")
    .action((dir: string, opts: { json?: boolean }) => {
      const all: { file: string; f: PerfFinding }[] = [];
      for (const file of walk(dir)) {
        if (path.extname(file) !== ".dart") continue;
        if (/\.(g|freezed)\.dart$/.test(file)) continue;
        for (const f of findPerfInText(readText(file))) all.push({ file, f });
      }

      if (opts.json) {
                console.log(JSON.stringify(
          all.map(({ file, f }) => ({ file: path.relative(dir, file).replace(/\\/g, "/"), ...f })),
          null,
          2,
        ));
        return;
      }

      const rel = (p: string) => path.relative(dir, p);
      const reads = all.filter((x) => x.f.rule === "firestore-unbounded-read");
      const loops = all.filter((x) => x.f.rule === "sequential-await-in-loop");
      console.log(`${all.length} performance finding(s): ${reads.length} full-collection read(s), ${loops.length} await-in-loop`);

      const byCol = new Map<string, { file: string; line: number }[]>();
      for (const { file, f } of reads) {
        const key = f.collection ?? "(unknown collection)";
        const list = byCol.get(key) ?? [];
        list.push({ file, line: f.line });
        byCol.set(key, list);
      }
      if (byCol.size) {
        console.log("\nFull-collection reads (cost and load time grow with collection size):");
        for (const [col, spots] of byCol) {
          console.log(`  '${col}' is read in full in ${spots.length} place(s):`);
          spots.forEach((s) => console.log(`    ${rel(s.file)}:${s.line}`));
          if (spots.length > 1) {
            console.log("    Tip: read it once and cache it (or filter/limit on the server side).");
          }
        }
      }
      if (loops.length) {
        console.log("\nawait inside loops (independent iterations could run with Future.wait):");
        loops.slice(0, 20).forEach(({ file, f }) => console.log(`  ${rel(file)}:${f.line}`));
        if (loops.length > 20) console.log(`  ...and ${loops.length - 20} more`);
      }
    });
}