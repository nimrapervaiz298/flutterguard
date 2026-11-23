export type Verdict = "true" | "false" | "unsure";

export interface KeyEntry {
  n: number;
  id: string;
  project: string;
  rule: string;
  verdict: string;
}

export interface Agreement {
  compared: number; // both gave true or false
  agree: number;
  disagree: KeyEntry[]; // key entries where the reviewer said the opposite
  unsure: number; // either side said unsure
  unanswered: number; // reviewer left it blank or wrote something else
}

const VALID = new Set(["true", "false", "unsure"]);

export function parseAnswers(md: string): Map<number, Verdict> {
  const out = new Map<number, Verdict>();
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (!m) continue;
    const v = m[2].trim().toLowerCase();
    if (VALID.has(v)) out.set(Number(m[1]), v as Verdict);
  }
  return out;
}

export function agreement(key: KeyEntry[], answers: Map<number, string>): Agreement {
  const r: Agreement = { compared: 0, agree: 0, disagree: [], unsure: 0, unanswered: 0 };
  for (const k of key) {
    const a = answers.get(k.n);
    if (a === undefined) {
      r.unanswered++;
      continue;
    }
    if (a === "unsure" || k.verdict === "unsure") {
      r.unsure++;
      continue;
    }
    r.compared++;
    if (a === k.verdict) r.agree++;
    else r.disagree.push(k);
  }
  return r;
}
