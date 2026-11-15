import test from "node:test";
import assert from "node:assert/strict";
import { findSecretsInText } from "../src/secrets";

test("a UI key constant whose value is the snake_case of its name is not a secret", () => {
  const t = "  static const String emailPassword = 'email_password';";
  assert.deepEqual(findSecretsInText(t, "lib/keys.dart"), []);
});

test("another UI key constant with the same shape is not a secret", () => {
  const t = "  static const String apiToken = 'api-token';";
  assert.deepEqual(findSecretsInText(t, "lib/keys.dart"), []);
});

test("control: a real-looking password is still reported", () => {
  const t = "  static const String dbPassword = 'Zk39sdf82hsd9f';";
  assert.equal(findSecretsInText(t, "lib/keys.dart").length, 1);
});