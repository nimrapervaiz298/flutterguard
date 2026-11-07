import path from "node:path";
import { readText, walk } from "./scanner";

const PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  // key name, optional closing quote, then a value of 8+ characters with no spaces
  ["Generic secret", /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

export const SCAN_EXT: ReadonlySet<string> = new Set([
  ".dart", ".js", ".ts", ".py", ".java", ".go", ".kt", ".swift",
  ".json", ".yaml", ".yml", ".env", ".xml", ".plist", ".gradle", ".properties",
]);

const FIREBASE_FILES = new Set([
  "firebase_options.dart", "google-services.json", "GoogleService-Info.plist",
]);

export type TextSecretHit = { level: "ALERT" | "INFO"; name: string; line: number };
export type SecretHit = TextSecretHit & { file: string; preview: string };

export function shouldScanFile(file: string): boolean {
  return SCAN_EXT.has(path.extname(file)) || path.basename(file) === ".env";
}

/** Pure function: finds secret-like text. It never returns the secret value itself. */
export function findSecretsInText(text: string, fileName: string): TextSecretHit[] {
  const base = path.basename(fileName);
  const hits: TextSecretHit[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (!re.test(line)) continue;
      const isFirebase =
        FIREBASE_FILES.has(base) && (name === "Google API key" || name === "Generic secret");
      hits.push({ level: isFirebase ? "INFO" : "ALERT", name, line: i + 1 });
      break; // one report per line
    }
  });
  return hits;
}

export function findSecrets(dir: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of walk(dir)) {
    if (!shouldScanFile(f)) continue;
    for (const h of findSecretsInText(readText(f), f)) {
      hits.push({ ...h, file: f, preview: "[redacted]" });
    }
  }
  return hits;
}