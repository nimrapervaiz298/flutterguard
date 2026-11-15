import test from "node:test";
import assert from "node:assert/strict";
import { findSecretsInText, shouldScanFile } from "../src/secrets";

const long = "x".repeat(1500);

test("a minified line with a token-like pattern is not reported", () => {
  const text = `!function(){var a="${long}";var token="abcdefghij1234567890";}();`;
  assert.deepEqual(findSecretsInText(text, "web/app.min.js"), []);
});

test("a vendored Firebase JS folder is not scanned", () => {
  assert.equal(shouldScanFile("web/__/firebase/8.10.1/firebase-auth.js"), false);
});

test("a normal source file is still scanned", () => {
  assert.equal(shouldScanFile("lib/config.dart"), true);
});

test("control: a normal line with a real-looking secret is still reported", () => {
  const hits = findSecretsInText('const apiKey = "Zk39sdf82hsd9f823hf";', "lib/a.dart");
  assert.equal(hits.length, 1);
});

test("control: a real Google key on a short line is still reported", () => {
  const key = "AIza" + "A".repeat(35);
  assert.equal(findSecretsInText(`final k = "${key}";`, "lib/a.dart").length, 1);
});