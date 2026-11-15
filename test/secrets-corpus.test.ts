import test from "node:test";
import assert from "node:assert/strict";
import { findSecretsInText, shouldScanFile } from "../src/secrets";

// All values below are made up. They only copy the format of real keys.
const MUST_FLAG: [string, string, string][] = [
  ["Google API key", "lib/config.dart", 'const k = "AIza' + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q".slice(0, 35) + '";'],
  ["Google API key, JSON", "lib/cfg.json", '{"key": "AIza' + "B".repeat(35) + '"}'],
  ["AWS access key", "lib/aws.dart", 'final id = "AKIA' + "IOSFODNN7EXAMPLE".slice(0, 16) + '";'],
  ["AWS key in yaml", "ci/deploy.yml", "aws_access_key_id: AKIA" + "ABCDEFGHIJKLMNOP"],
  ["Private key header", "lib/k.dart", "const pem = '-----BEGIN PRIVATE KEY-----';"],
  ["RSA private key header", "keys/a.js", "-----BEGIN RSA PRIVATE KEY-----"],
  ["EC private key header", "keys/b.js", "-----BEGIN EC PRIVATE KEY-----"],
  ["generic apiKey", "lib/svc.dart", 'const apiKey = "Zk39sdf82hsd9f823hf";'],
  ["generic secret", "lib/svc.dart", "final clientSecret = 'q8W3e7R1t5Y9u2I4o6P0';"],
  ["generic token, json", "lib/x.json", '{"authToken": "x9Y8z7W6v5U4t3S2r1"}'],
  ["generic password", "lib/db.dart", 'static const dbPassword = "Zk39sdf82hsd9f";'],
  ["api_key python", "app/cfg.py", 'api_key = "m4N5b6V7c8X9z0L1k2J3"'],
];

const MUST_SKIP: [string, string, string][] = [
  ["placeholder password", "lib/a.dart", 'const password = "password";'],
  ["placeholder key", "lib/a.dart", 'const apiKey = "YOUR_API_KEY";'],
  ["x-fill", "lib/a.dart", 'const secret = "xxxxxxxxxxxx";'],
  ["UI key constant", "lib/keys.dart", "static const String emailPassword = 'email_password';"],
  ["generic in test file", "test/a_test.dart", 'const apiKey = "Zk39sdf82hsd9f823hf";'],
  ["short value", "lib/a.dart", 'const token = "abc123";'],
  ["env read", "lib/a.dart", "final k = String.fromEnvironment('API_KEY');"],
  ["plain text with word secret", "lib/a.dart", "// this is a secret recipe for the app"],
  ["minified line", "web/app.min.js", 'var a="' + "x".repeat(1500) + '";var token="abcdefghij1234567890";'],
  ["vendored firebase js", "web/__/firebase/8.10.1/firebase-auth.js", 'var token="abcdefghij1234567890";'],
  ["firebase config key is info only", "lib/firebase_options.dart", 'apiKey: "AIza' + "C".repeat(35) + '",'],
];

// Formats a real tool should know but this one does not. Counted, never failing.
const KNOWN_GAPS: [string, string, string][] = [
  ["Stripe live key", "lib/pay.dart", 'const k = "sk_live_' + "a".repeat(24) + '";'],
  ["GitHub token", "lib/gh.dart", 'const t = "ghp_' + "a".repeat(36) + '";'],
  ["Slack token", "lib/s.dart", 'const t = "xoxb-' + "1".repeat(12) + "-" + "a".repeat(24) + '";'],
  ["JWT", "lib/j.dart", 'const t = "eyJhbGciOiJIUzI1NiJ9.' + "a".repeat(20) + "." + "b".repeat(20) + '";'],
  ["secret on the next line", "lib/n.dart", "const password =\n    'Zk39sdf82hsd9f';"],
];

const alerts = (file: string, text: string) => (shouldScanFile(file) ? findSecretsInText(text, file).filter((h) => h.level === "ALERT") : []);

test("synthetic corpus: every format the tool claims to know is flagged", () => {
  const missed = MUST_FLAG.filter(([, f, t]) => alerts(f, t).length === 0).map(([n]) => n);
  console.log(`recall on MUST_FLAG: ${MUST_FLAG.length - missed.length} of ${MUST_FLAG.length}`);
  assert.deepEqual(missed, []);
});

test("synthetic corpus: safe lines are not flagged", () => {
  const wrong = MUST_SKIP.filter(([, f, t]) => alerts(f, t).length > 0).map(([n]) => n);
  console.log(`false alarms on MUST_SKIP: ${wrong.length} of ${MUST_SKIP.length}`);
  assert.deepEqual(wrong, []);
});

test("synthetic corpus: known gaps are counted, not failed", () => {
  const caught = KNOWN_GAPS.filter(([, f, t]) => alerts(f, t).length > 0).map(([n]) => n);
  console.log(`KNOWN_GAPS caught: ${caught.length} of ${KNOWN_GAPS.length} (${caught.join(", ") || "none"})`);
  assert.ok(true);
});