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

program.parse();