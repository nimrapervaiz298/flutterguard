import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

const LANGS: Record<string, string> = {
  ".dart": "Dart", ".js": "JavaScript", ".ts": "TypeScript",
  ".py": "Python", ".java": "Java", ".go": "Go",
  ".kt": "Kotlin", ".swift": "Swift",
};
const SKIP = new Set(["node_modules", ".git", "build", ".dart_tool", "dist"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------- secrets ----------
const PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  ["Generic secret", /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/i],
];
const SCAN_EXT = new Set([
  ...Object.keys(LANGS), ".json", ".yaml", ".yml", ".env",
  ".xml", ".plist", ".gradle", ".properties",
]);
const FIREBASE_FILES = new Set([
  "firebase_options.dart", "google-services.json", "GoogleService-Info.plist",
]);

type SecretHit = { level: "ALERT" | "INFO"; name: string; file: string; line: number; preview: string };

function findSecrets(dir: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of walk(dir)) {
    const base = path.basename(f);
    if (!SCAN_EXT.has(path.extname(f)) && base !== ".env") continue;
    if (fs.statSync(f).size > 1_000_000) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      for (const [name, re] of PATTERNS) {
        const m = line.match(re);
        if (!m) continue;
        const isFirebase = FIREBASE_FILES.has(base) &&
          (name === "Google API key" || name === "Generic secret");
        hits.push({
          level: isFirebase ? "INFO" : "ALERT",
          name, file: f, line: i + 1, preview: m[0].slice(0, 6) + "***",
        });
        break; // one report per line
      }
    });
  }
  return hits;
}

// ---------- bloat ----------
const BRACE_EXT = new Set([".dart", ".js", ".ts", ".java", ".kt", ".swift", ".go"]);
type BloatRow = { file: string; line: number; len: number; name: string };

function findBloat(dir: string, min: number): BloatRow[] {
  const rows: BloatRow[] = [];
  for (const f of walk(dir)) {
    if (!BRACE_EXT.has(path.extname(f))) continue;
    if (/\.(g|freezed)\.dart$/.test(f)) continue; // skip generated code
    let depth = 0, start = -1, startText = "";
    fs.readFileSync(f, "utf8").split("\n").forEach((raw, i) => {
      const line = raw
        .replace(/\/\/.*$/, "")
        .replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          if (depth === 2) { start = i; startText = raw.trim().slice(0, 50); }
        } else if (ch === "}") {
          if (depth === 2 && start >= 0) {
            const len = i - start + 1;
            if (len >= min) rows.push({ file: f, line: start + 1, len, name: startText });
            start = -1;
          }
          depth--;
        }
      }
    });
  }
  return rows.sort((a, b) => b.len - a.len);
}

// ---------- commands ----------
const program = new Command().name("flutterguard");

program.command("check <dir>").action((dir: string) => {
  const stats: Record<string, { files: number; lines: number }> = {};
  const big: { file: string; lines: number }[] = [];
  for (const f of walk(dir)) {
    const lang = LANGS[path.extname(f)];
    if (!lang) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n").length;
    stats[lang] ??= { files: 0, lines: 0 };
    stats[lang].files++;
    stats[lang].lines += lines;
    big.push({ file: f, lines });
  }
  console.table(stats);
  console.log("Largest files:");
  big.sort((a, b) => b.lines - a.lines).slice(0, 5)
    .forEach((b) => console.log(`${b.lines} lines  ${b.file}`));
});

program.command("secrets <dir>").action((dir: string) => {
  const hits = findSecrets(dir);
  hits.forEach((h) =>
    console.log(`${h.level === "ALERT" ? "ALERT" : "INFO "}  ${h.name}  ${h.file}:${h.line}  ${h.preview}`));
  const alerts = hits.filter((h) => h.level === "ALERT").length;
  console.log(`ALERT: ${alerts}, INFO (Firebase config): ${hits.length - alerts}`);
  process.exitCode = alerts ? 1 : 0;
});

program
  .command("bloat <dir>")
  .option("--min <n>", "minimum method length in lines", "80")
  .action((dir: string, opts: { min: string }) => {
    const rows = findBloat(dir, Number(opts.min));
    console.log(`${rows.length} long method(s) (${opts.min}+ lines)`);
    rows.slice(0, 10).forEach((r) => console.log(`${r.len} lines  ${r.file}:${r.line}  ${r.name}`));
  });

program.command("scan <dir>").action((dir: string) => {
  const hits = findSecrets(dir);
  const alerts = hits.filter((h) => h.level === "ALERT");
  const infos = hits.length - alerts.length;
  const rows = findBloat(dir, 80);
  const huge = rows.filter((r) => r.len >= 200).length;

  const secretPenalty = Math.min(45, alerts.length * 15);
  const bloatPenalty = Math.min(40, huge * 3 + (rows.length - huge));
  const score = Math.max(0, 100 - secretPenalty - bloatPenalty);

  console.log(`\nFlutterGuard score: ${score}/100\n`);
  console.log(`Secrets : ${alerts.length} ALERT, ${infos} INFO (Firebase config)  [-${secretPenalty}]`);
  console.log(`Bloat   : ${rows.length} long methods (80+ lines), ${huge} very long (200+)  [-${bloatPenalty}]`);
  if (alerts.length) {
    console.log("\nSecrets:");
    alerts.slice(0, 5).forEach((h) => console.log(`  ${h.name}  ${h.file}:${h.line}`));
  }
  if (rows.length) {
    console.log("\nLongest methods:");
    rows.slice(0, 5).forEach((r) => console.log(`  ${r.len} lines  ${r.file}:${r.line}  ${r.name}`));
  }
  console.log("\nNote: the score formula is a first version. It is an estimate, not a guarantee.");
  process.exitCode = alerts.length ? 1 : 0;
});

program.parse();