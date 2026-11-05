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


// secrets scan (hardcoded keys
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
        break; // ek line par ek hi report
      }
    });
  }
  console.log(`ALERT: ${real}, INFO (Firebase config): ${info}`);
  if (info) console.log("Firebase keys aam tor par secret nahi hoti, lekin Firestore/Storage rules aur Google Cloud mein key restrictions zaroor check karein.");
  process.exitCode = real ? 1 : 0;
});

// program.command("secrets <dir>").action((dir: string) => {
//   let found = 0;
//   for (const f of walk(dir)) {
//     if (!SCAN_EXT.has(path.extname(f)) && path.basename(f) !== ".env") continue;
//     if (fs.statSync(f).size > 1_000_000) continue;
//     fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
//       for (const [name, re] of PATTERNS) {
//         const m = line.match(re);
//         if (m) {
//           found++;
//           console.log(`${name}  ${f}:${i + 1}  ${m[0].slice(0, 6)}***`);
//         }
//       }
//     });
//   }
//   console.log(found ? `${found} possible secret(s) mili` : "Koi secret nahi mili");
//   process.exitCode = found ? 1 : 0;
// });
program.parse();