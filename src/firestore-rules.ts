export type RulesFinding = {
  rule: "auth-only-write" | "open-access";
  line: number;
  methods: string[];
  scope: "wide" | "narrow";
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

// "wide" when an enclosing match block has a recursive wildcard such as {document=**}.
function scopeAt(masked: string, idx: number): "wide" | "narrow" {
  const stack: boolean[] = [];
  const re = /\bmatch[ \t]+((?:[^{}\n]|\{[^{}\n]*\})*)\{|\{|\}/g;
  const before = masked.slice(0, idx);
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    if (m[0] === "}") stack.pop();
    else if (m[0] === "{") stack.push(false);
    else stack.push(/=\*\*/.test(m[1]));
  }
  return stack.some(Boolean) ? "wide" : "narrow";
}

export function findRulesIssues(text: string): RulesFinding[] {
  const masked = maskComments(text);
  // helpers whose whole body is a login check, for example: function isSignedIn() { return request.auth != null; }
  const loginHelpers = new Set<string>();
  const fn = /function\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+([^;]*?)\s*;?\s*\}/g;
  let fm: RegExpExecArray | null;
  while ((fm = fn.exec(masked)) !== null) {
    if (LOGIN_ONLY.test(fm[2].replace(/\s+/g, " ").trim())) loginHelpers.add(fm[1]);
  }
  const out: RulesFinding[] = [];
  const re = /\ballow\s+([a-z,\s]+?)\s*(?::\s*if\s+([^;]*?))?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const methods = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!methods.length) continue;
    const cond = (m[2] ?? "").replace(/\s+/g, " ").trim();
    const line = masked.slice(0, m.index).split("\n").length;
    if (cond === "true" || m[2] === undefined) {
      out.push({
        rule: "open-access",
        line,
        methods,
        scope: scopeAt(masked, m.index),
        message: "This rule allows everyone, signed in or not. Anyone who knows the project can use it.",
      });
      continue;
    }
    if (!methods.some((x) => WRITE_METHODS.has(x))) continue;
    const helperCall = cond.match(/^(\w+)\(\)$/);
    if (LOGIN_ONLY.test(cond) || (helperCall !== null && loginHelpers.has(helperCall[1]))) {
      out.push({
        rule: "auth-only-write",
        line,
        methods,
        scope: scopeAt(masked, m.index),
        message: "Any signed-in user can change this data. The rule checks that the user is logged in, not that the data belongs to them.",
      });
    }
  }
  return out;
}

export type CollectionRule = {
  collection: string;
  line: number;
  loginOnlyWrite: boolean;
};

function closeOf(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Top-level collections: match /name/{id} directly inside match /databases/{db}/documents.
// Nested matches are cut out of the body, so their allow lines are not attributed to the parent.
export function collectionRules(text: string): CollectionRule[] {
  const masked = maskComments(text);
  const out: CollectionRule[] = [];
  const dbRe = /match[ \t]+\/databases\/\{[^}\n]*\}\/documents[ \t]*\{/;
  const db = dbRe.exec(masked);
  if (!db) return out;
  const dbOpen = db.index + db[0].length - 1;
  const dbClose = closeOf(masked, dbOpen);
  if (dbClose === -1) return out;
  const inner = masked.slice(dbOpen + 1, dbClose);
  const base = dbOpen + 1;

  const re = /match[ \t]+\/([A-Za-z0-9_]+)\/\{[A-Za-z0-9_]+\}[ \t]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(inner, open);
    if (close === -1) continue;
    let body = inner.slice(open + 1, close);
    // cut nested match blocks out of the body
    const nested = /match[ \t]+[^{\n]*\{/g;
    let n: RegExpExecArray | null;
    while ((n = nested.exec(body)) !== null) {
      const nOpen = n.index + n[0].length - 1;
      const nClose = closeOf(body, nOpen);
      if (nClose === -1) break;
      body = body.slice(0, n.index) + " ".repeat(nClose - n.index + 1) + body.slice(nClose + 1);
      nested.lastIndex = n.index;
    }
    let loginOnlyWrite = false;
    const allow = /\ballow\s+([a-z,\s]+?)\s*:\s*if\s+([^;]*?)\s*;/g;
    let a: RegExpExecArray | null;
    while ((a = allow.exec(body)) !== null) {
      const methods = a[1].split(",").map((s) => s.trim());
      const cond = a[2].replace(/\s+/g, " ").trim();
      if (methods.some((x) => WRITE_METHODS.has(x)) && LOGIN_ONLY.test(cond)) loginOnlyWrite = true;
    }
    const line = masked.slice(0, base + m.index).split("\n").length;
    out.push({ collection: m[1], line, loginOnlyWrite });
    re.lastIndex = close + 1;
  }
  return out;
}