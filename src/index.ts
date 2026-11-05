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

const program = new Command().name("flutterguard");

// ---------- check ----------
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
  console.log("Sab se bari files:");
  big.sort((a, b) => b.lines - a.lines).slice(0, 5)
    .forEach((b) => console.log(`${b.lines} lines  ${b.file}`));
});

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

program.command("secrets <dir>").action((dir: string) => {
  let real = 0, info = 0;
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
        if (isFirebase) info++; else real++;
        console.log(`${isFirebase ? "INFO " : "ALERT"}  ${name}  ${f}:${i + 1}  ${m[0].slice(0, 6)}***`);
        break;
      }
    });
  }
  console.log(`ALERT: ${real}, INFO (Firebase config): ${info}`);
  if (info) console.log("Firebase keys aam tor par secret nahi hoti, lekin Firestore/Storage rules aur Google Cloud mein key restrictions zaroor check karein.");
  process.exitCode = real ? 1 : 0;
});

// ---------- bloat ----------
const BRACE_EXT = new Set([".dart", ".js", ".ts", ".java", ".kt", ".swift", ".go"]);

program
  .command("bloat <dir>")
  .option("--min <n>", "kam az kam kitni lines", "80")
  .action((dir: string, opts: { min: string }) => {
    const min = Number(opts.min);
    const rows: { file: string; line: number; len: number; name: string }[] = [];
    for (const f of walk(dir)) {
      if (!BRACE_EXT.has(path.extname(f))) continue;
      if (/\.(g|freezed)\.dart$/.test(f)) continue;
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
    rows.sort((a, b) => b.len - a.len);
    console.log(`${rows.length} lamba method(s) (${min}+ lines)`);
    rows.slice(0, 10).forEach((r) => console.log(`${r.len} lines  ${r.file}:${r.line}  ${r.name}`));
  });

program.parse();