import path from "node:path";
import { readText, walk } from "./scanner";

// Key-shaped secrets: the format itself is strong evidence.
const KEY_PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
];

// Generic "name = value" secrets: weaker evidence, so placeholders and test files are skipped.
// Group 1 is the key name, group 2 is the value.
const GENERIC = /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;

export const SCAN_EXT: ReadonlySet<string> = new Set([
  ".dart", ".js", ".ts", ".py", ".java", ".go", ".kt", ".swift",
  ".json", ".yaml", ".yml", ".env", ".xml", ".plist", ".gradle", ".properties",
]);

const FIREBASE_FILES = new Set([
  "firebase_options.dart", "google-services.json", "GoogleService-Info.plist",
]);

const PLACEHOLDERS = new Set([
  "password", "passwd", "secret", "token", "apikey",
  "changeme", "example", "sample", "dummy", "placeholder",
  "12345678", "yourpassword", "yourapikey", "yourtoken", "yoursecret",
]);

const norm = (s: string): string => s.toLowerCase().replace(/[_-]/g, "");

/** True for obviously fake values: the key's own name, common placeholder words, or repeated characters. */
export function isPlaceholder(key: string, value: string): boolean {
  const v = norm(value);
  return (
    v === norm(key) ||
    PLACEHOLDERS.has(v) ||
    /^(.)\1+$/.test(value) ||
    /^[x*#.]+$/i.test(value)
  );
}

export function isTestFile(file: string): boolean {
  return (
    /(^|[\\/])(test|tests|__tests__|integration_test)[\\/]/i.test(file) ||
    /(_test\.dart|\.(test|spec)\.(ts|js|tsx|jsx))$/i.test(file)
  );
}

export type TextSecretHit = { level: "ALERT" | "INFO"; name: string; line: number };
export type SecretHit = TextSecretHit & { file: string; preview: string };

export function shouldScanFile(file: string): boolean {
  return SCAN_EXT.has(path.extname(file)) || path.basename(file) === ".env";
}

/** Pure function: finds secret-like text. It never returns the secret value itself. */
export function findSecretsInText(text: string, fileName: string): TextSecretHit[] {
  const base = path.basename(fileName);
  const inTest = isTestFile(fileName);
  const hits: TextSecretHit[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of KEY_PATTERNS) {
      if (!re.test(line)) continue;
      const isFirebase = FIREBASE_FILES.has(base) && name === "Google API key";
      hits.push({ level: isFirebase ? "INFO" : "ALERT", name, line: i + 1 });
      return; // one report per line
    }
    const m = line.match(GENERIC);
    if (!m) return;
    if (isPlaceholder(m[1], m[2])) return;
    if (inTest) return;
    const isFirebase = FIREBASE_FILES.has(base);
    hits.push({ level: isFirebase ? "INFO" : "ALERT", name: "Generic secret", line: i + 1 });
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