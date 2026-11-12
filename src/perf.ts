import type { Command } from "commander";
import path from "node:path";

export type PerfFinding = {
  rule: "firestore-unbounded-read" | "firestore-query-without-limit" | "sequential-await-in-loop" | "foreach-async-not-awaited";
  severity: "warning" | "info";
  line: number;
  message: string;
  collection?: string;
};

/**
 * Tests, scripts and dev tools are skipped: sequential await is normal there.
 * Only the path inside the project is looked at, so a project that lives in a
 * folder called "test" or "tools" is still checked.
 */
export function shouldCheckPerf(file: string, root?: string): boolean {
  const rel = root ? path.relative(root, file) : file;
  if (path.extname(rel) !== ".dart") return false;
  if (/\.(g|freezed)\.dart$/.test(rel)) return false;
  if (/_test\.dart$/i.test(rel)) return false;
  if (/(^|[\\/])(test|tests|integration_test|test_driver|tool|tools|scripts|bin)[\\/]/i.test(rel)) return false;
  return true;
}

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

// End of a single-statement loop body: the first ";" that is outside any brackets.
function statementEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i; // ran past the enclosing block
      depth--;
    } else if (c === ";" && depth === 0) return i;
  }
  return -1;
}

// End of an expression-bodied closure ("async => ..."): the first "," or ";" at depth 0, or the closing bracket.
function expressionEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if ((c === "," || c === ";") && depth === 0) return i;
  }
  return text.length;
}

// An await inside a nested async closure does not run as part of the loop, so that code is blanked out.
function blankNestedAsync(body: string): string {
  const chars = body.split("");
  const re = /\basync\s*\*?\s*(\{|=>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let start: number;
    let end: number;
    if (m[1] === "{") {
      start = m.index + m[0].length - 1;
      end = matchClose(body, start, "{", "}");
    } else {
      start = m.index + m[0].length;
      end = expressionEnd(body, start);
    }
    if (end === -1) end = body.length - 1;
    for (let k = start; k <= end && k < chars.length; k++) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

// These cap the size of the result (a single document, a limit, or an aggregate).
const CAPS_RESULT = /\.(doc|document|limit|limitToLast|count)\s*\(/;
// where() filters, but does not cap the number of documents that come back.
const FILTERS = /\.where\s*\(/;
// Operators other than isEqualTo. A query that only uses isEqualTo returns few documents in practice.
const NON_EQUALITY = /\b(isNotEqualTo|isLessThan|isLessThanOrEqualTo|isGreaterThan|isGreaterThanOrEqualTo|arrayContains|arrayContainsAny|whereIn|whereNotIn|isNull)\b/;

// Rules 1 and 2: reading a whole collection, or a filtered query with no limit.
function firestoreReads(masked: string, original: string): PerfFinding[] {
  const out: PerfFinding[] = [];
  const re = /\.collection\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const end = masked.indexOf(";", m.index);
    const seg = masked.slice(m.index, end === -1 ? undefined : end);
    // a later .collection( in the same statement is handled by its own match
    if (seg.slice(1).search(/\.collection\s*\(/) !== -1) continue;
    if (!/\.get\s*\(\s*\)/.test(seg)) continue;
    if (CAPS_RESULT.test(seg)) continue;
    // masking keeps offsets, so the real collection name is read from the original text
    const name = original.slice(m.index).match(/^\.collection\s*\(\s*['"]([^'"]+)['"]/)?.[1];
    if (FILTERS.test(seg)) {
      if (!NON_EQUALITY.test(seg)) continue; // only isEqualTo filters: small result, not reported
      out.push({
        rule: "firestore-query-without-limit",
        severity: "info",
        line: lineOf(masked, m.index),
        message: "This query has where() but no limit(). where() filters documents but does not cap how many come back.",
        collection: name,
      });
    } else {
      out.push({
        rule: "firestore-unbounded-read",
        severity: "warning",
        line: lineOf(masked, m.index),
        message: "Reads a whole Firestore collection with no limit() or where(). Cost and load time grow with the collection size.",
        collection: name,
      });
    }
  }
  return out;
}

// True when the nearest query above the loop has a fixed small bound: limit(<number>) or documentId equality.
function loopSourceIsBounded(masked: string, loopIdx: number): boolean {
  const before = masked.slice(Math.max(0, loopIdx - 800), loopIdx);
  const at = before.lastIndexOf(".collection");
  if (at === -1) return false;
  const seg = before.slice(at);
  return /\.limit\s*\(\s*\d+\s*\)/.test(seg) || /documentId[\s\S]{0,40}isEqualTo/.test(seg);
}

// Rule 3: await inside a for loop
function loopAwaits(masked: string): PerfFinding[] {
  const out: PerfFinding[] = [];
  const seen = new Set<number>();
  const re = /\bfor\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (/await\s*$/.test(masked.slice(Math.max(0, m.index - 8), m.index))) continue; // "await for" streams
    // "for" right after [ , or ( is a collection-for inside a list/set/map, not a statement loop
    const prev = masked.slice(0, m.index).trimEnd().slice(-1);
    if (prev === "[" || prev === "," || prev === "(") continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open, "(", ")");
    if (close === -1) continue;
    let i = close + 1;
    while (i < masked.length && /\s/.test(masked[i])) i++;
    const bodyEnd = masked[i] === "{" ? matchClose(masked, i, "{", "}") : statementEnd(masked, i);
    if (bodyEnd === -1) continue;
    if (loopSourceIsBounded(masked, m.index)) continue;
    const body = blankNestedAsync(masked.slice(i, bodyEnd));
    const rel = body.search(/\bawait\b/);
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

// Rule 4: forEach with an async closure. forEach ignores the Future the closure returns,
// so the code after it runs before the work inside is finished, even with "await" in front.
function forEachAsync(masked: string): PerfFinding[] {
  const out: PerfFinding[] = [];
  const re = /\.forEach\s*\(\s*(?:\([^()]*\)|\w+)\s*async\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    out.push({
      rule: "foreach-async-not-awaited",
      severity: "warning",
      line: lineOf(masked, m.index),
      message: "forEach does not wait for an async closure. The code after it runs before the work inside is done.",
    });
  }
  return out;
}
export function findPerfInText(text: string): PerfFinding[] {
  const masked = mask(text);
  return [...firestoreReads(masked, text), ...loopAwaits(masked), ...forEachAsync(masked)].sort((a, b) => a.line - b.line);
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
        if (!shouldCheckPerf(file, dir)) continue;
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
      const queries = all.filter((x) => x.f.rule === "firestore-query-without-limit");
      const loops = all.filter((x) => x.f.rule === "sequential-await-in-loop");
      console.log(
        `${all.length} performance finding(s): ${reads.length} full-collection read(s), ` +
          `${queries.length} query without limit, ${loops.length} await-in-loop`,
      );

      const group = (items: typeof all): Map<string, { file: string; line: number }[]> => {
        const byCol = new Map<string, { file: string; line: number }[]>();
        for (const { file, f } of items) {
          const key = f.collection ?? "(unknown collection)";
          const list = byCol.get(key) ?? [];
          list.push({ file, line: f.line });
          byCol.set(key, list);
        }
        return byCol;
      };

      const readGroups = group(reads);
      if (readGroups.size) {
        console.log("\nFull-collection reads (cost and load time grow with collection size):");
        for (const [col, spots] of readGroups) {
          console.log(`  '${col}' is read in full in ${spots.length} place(s):`);
          spots.forEach((s) => console.log(`    ${rel(s.file)}:${s.line}`));
          if (spots.length > 1) {
            console.log("    Tip: read it once and cache it (or filter/limit on the server side).");
          }
        }
      }
      const queryGroups = group(queries);
      if (queryGroups.size) {
        console.log("\nQueries with where() but no limit() (fine if few documents can match):");
        for (const [col, spots] of queryGroups) {
          console.log(`  '${col}' in ${spots.length} place(s):`);
          spots.forEach((s) => console.log(`    ${rel(s.file)}:${s.line}`));
        }
      }
      if (loops.length) {
        console.log("\nawait inside loops (independent iterations could run with Future.wait):");
        loops.slice(0, 20).forEach(({ file, f }) => console.log(`  ${rel(file)}:${f.line}`));
        if (loops.length > 20) console.log(`  ...and ${loops.length - 20} more`);
      }
    });
}