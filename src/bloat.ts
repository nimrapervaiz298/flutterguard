import path from "node:path";
import { readText, walk } from "./scanner";

export const BRACE_EXT: ReadonlySet<string> = new Set([
  ".dart", ".js", ".ts", ".java", ".kt", ".swift", ".go",
]);

export type TextBloatRow = { line: number; len: number; name: string };
export type BloatRow = TextBloatRow & { file: string };

// Blank out strings and comments but keep every newline, so line numbers stay right.
function maskText(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  let t = text.replace(/('''|""")[\s\S]*?\1/g, blank); // multi-line strings
  t = t.replace(/(["'])(?:\\.|(?!\1)[^\n\\])*\1/g, blank); // single-line strings
  t = t.replace(/\/\*[\s\S]*?\*\//g, blank); // block comments
  t = t.replace(/\/\/[^\n]*/g, blank); // line comments
  return t;
}

/**
 * HEURISTIC: counts braces. A "method" is a block one level inside a class body,
 * so top-level functions are not reported. Method length is an estimate.
 */
export function findBloatInText(text: string, min: number): TextBloatRow[] {
  const masked = maskText(text).split("\n");
  const original = text.split("\n");
  const rows: TextBloatRow[] = [];
  let depth = 0;
  let start = -1;
  masked.forEach((line, i) => {
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        if (depth === 2) start = i;
      } else if (ch === "}") {
        if (depth === 2 && start >= 0) {
          const len = i - start + 1;
          if (len >= min) rows.push({ line: start + 1, len, name: original[start].trim().slice(0, 50) });
          start = -1;
        }
        depth = Math.max(0, depth - 1);
      }
    }
  });
  return rows.sort((a, b) => b.len - a.len);
}

export function findBloat(dir: string, min: number): BloatRow[] {
  const rows: BloatRow[] = [];
  for (const f of walk(dir)) {
    if (!BRACE_EXT.has(path.extname(f))) continue;
    if (/\.(g|freezed)\.dart$/.test(f)) continue; // generated code
    for (const r of findBloatInText(readText(f), min)) rows.push({ ...r, file: f });
  }
  return rows.sort((a, b) => b.len - a.len);
}