export type RulesFinding = {
  rule: "auth-only-write" | "open-access";
  line: number;
  methods: string[];
  message: string;
};

const WRITE_METHODS = new Set(["write", "create", "update", "delete"]);

// Blank out comments. Length and newlines are kept, so line numbers stay correct.
function maskComments(text: string): string {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  t = t.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return t;
}

// "request.auth != null" or "request.auth.uid != null" and nothing else.
const LOGIN_ONLY = /^request\.auth(\.uid)?\s*!=\s*null$/;

export function findRulesIssues(text: string): RulesFinding[] {
  const masked = maskComments(text);
  const out: RulesFinding[] = [];
  const re = /\ballow\s+([a-z,\s]+?)\s*(?::\s*if\s+([^;]*?))?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const methods = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!methods.length) continue;
    const cond = (m[2] ?? "").replace(/\s+/g, " ").trim();
    const line = masked.slice(0, m.index).split("\n").length;
    if (cond === "true") {
      out.push({
        rule: "open-access",
        line,
        methods,
        message: "This rule allows everyone, signed in or not. Anyone who knows the project can use it.",
      });
      continue;
    }
    if (!methods.some((x) => WRITE_METHODS.has(x))) continue;
    if (LOGIN_ONLY.test(cond)) {
      out.push({
        rule: "auth-only-write",
        line,
        methods,
        message: "Any signed-in user can change this data. The rule checks that the user is logged in, not that the data belongs to them.",
      });
    }
  }
  return out;
}