export type CollectionWrite = {
  collection: string;
  method: "add" | "set" | "update" | "delete" | "setData" | "updateData";
  line: number;
};

// Blank out comments. Length and newlines are kept, so line numbers stay correct.
function maskComments(text: string): string {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  t = t.replace(/(?<!:)\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return t;
}

// Index of the ")" that closes the "(" at openIdx, or -1.
function closeParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const WRITE = /^\s*\.\s*(add|set|update|delete|setData|updateData)\s*\(/;
const DOC = /^\s*\.\s*(doc|document)\s*\(/;

// Top-level writes only: collection('literal') [.doc(...)|.document(...)] .add/.set/.update/.delete(...).
// Variable paths and nested collections (.doc(x).collection('y')) are skipped.
export function findCollectionWrites(text: string): CollectionWrite[] {
  const masked = maskComments(text);
  const out: CollectionWrite[] = [];
  const re = /\.collection\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    // nested: this collection() comes right after a .doc(...) / .document(...) call, so it is not top-level
    const before = masked.slice(Math.max(0, m.index - 300), m.index).replace(/\s+/g, "");
    if (/\)$/.test(before) && /\.(doc|document)\([^]*\)$/.test(before)) continue;
    let pos = m.index + m[0].length;
    const rest = masked.slice(pos);
    const d = DOC.exec(rest);
    if (d) {
      const open = pos + d[0].length - 1;
      const close = closeParen(masked, open);
      if (close === -1) continue;
      pos = close + 1;
    }
    const w = WRITE.exec(masked.slice(pos));
    if (!w) continue;
    out.push({
      collection: m[2],
      method: w[1] as CollectionWrite["method"],
      line: masked.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}