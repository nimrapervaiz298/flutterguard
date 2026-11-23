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

export function formatAgreement(r: Agreement): string {
  const pct = r.compared === 0 ? "n/a" : `${r.agree} of ${r.compared} (${Math.round((r.agree / r.compared) * 100)}%)`;
  const out: string[] = [];
  out.push(`compared: ${r.compared}`);
  out.push(`agree: ${pct}`);
  out.push(`unsure on either side: ${r.unsure}`);
  out.push(`unanswered: ${r.unanswered}`);
  if (r.disagree.length) {
    out.push("disagreements:");
    for (const d of r.disagree) out.push(`  #${d.n} ${d.rule} (${d.project}): key says ${d.verdict}`);
  }
  out.push("");
  out.push("Agreement is only over items where both gave true or false. It is not precision, and 30 items is a small sample.");
  return out.join("\n");
}