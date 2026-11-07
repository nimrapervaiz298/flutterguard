import test from "node:test";
import assert from "node:assert/strict";
import { findSecretsInText, shouldScanFile } from "../src/secrets";

const GOOGLE = "AIza" + "a".repeat(35);
const AWS = "AKIA" + "B".repeat(16);
const scan = (text: string, file = "lib/x.dart") => findSecretsInText(text, file);

test("flags a Google API key in normal source", () => {
  const hits = scan(`final k = '${GOOGLE}';`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, "ALERT");
  assert.equal(hits[0].name, "Google API key");
  assert.equal(hits[0].line, 1);
});

test("the same key in firebase_options.dart is only INFO", () => {
  const hits = scan(`apiKey: '${GOOGLE}',`, "lib/firebase_options.dart");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, "INFO");
});

test("the same key in google-services.json is only INFO", () => {
  const hits = scan(`"current_key": "${GOOGLE}"`, "android/app/google-services.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, "INFO");
});

test("flags an AWS access key", () => {
  const hits = scan(`const id = "${AWS}";`);
  assert.equal(hits[0].name, "AWS access key");
  assert.equal(hits[0].level, "ALERT");
});

test("flags a private key header", () => {
  const hits = scan("-----BEGIN RSA PRIVATE KEY-----");
  assert.equal(hits[0].name, "Private key");
});

test("flags a hardcoded password", () => {
  const hits = scan(`const password = "s3cretvalue99";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Generic secret");
  assert.equal(hits[0].level, "ALERT");
});

test("flags JSON-style quoted keys", () => {
  const hits = scan(`"token": "abcdefgh12345"`, "config.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Generic secret");
});

test("does not flag placeholder text with spaces", () => {
  assert.deepEqual(scan(`"password": "Enter your password"`, "strings.json"), []);
});

test("does not flag keys that are read from the environment", () => {
  assert.deepEqual(scan(`final k = dotenv.env['GEMINI_API_KEY']!;`), []);
  assert.deepEqual(scan(`apiKey: dotenv.env['X'],`), []);
});

test("does not flag short values", () => {
  assert.deepEqual(scan(`password = "abc"`), []);
});

test("reports one hit per line even if two patterns match", () => {
  const hits = scan(`final a = {'apiKey': '${GOOGLE}'};`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Google API key");
});

test("line numbers start at 1", () => {
  const hits = scan(`a\nb\nk = '${GOOGLE}'`);
  assert.equal(hits[0].line, 3);
});

test("a secret inside a comment is still reported", () => {
  const hits = scan(`// ${GOOGLE}`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, "ALERT");
});

test("hits never contain the secret value", () => {
  const hits = scan(`k = '${GOOGLE}'`, "a.dart");
  assert.ok(!JSON.stringify(hits).includes("AIza"));
  assert.deepEqual(Object.keys(hits[0]).sort(), ["level", "line", "name"]);
});

test("shouldScanFile picks source and config files only", () => {
  assert.equal(shouldScanFile("lib/a.dart"), true);
  assert.equal(shouldScanFile("config.json"), true);
  assert.equal(shouldScanFile(".env"), true);
  assert.equal(shouldScanFile("assets/logo.png"), false);
  assert.equal(shouldScanFile("pubspec.lock"), false);
});