import test from "node:test";
import assert from "node:assert/strict";
import { fromSecret } from "../src/report";

const hit = (name: string) => ({ level: "ALERT" as const, name, line: 3, file: "/p/lib/a.dart", preview: "[redacted]" });

test("a format-based secret has high confidence", () => {
  for (const n of ["Google API key", "AWS access key", "Private key", "Stripe key", "GitHub token", "Slack token"]) {
    assert.equal(fromSecret(hit(n), "/p").confidence, "high", n);
  }
});

test("a generic name = value secret stays medium", () => {
  assert.equal(fromSecret(hit("Generic secret"), "/p").confidence, "medium");
});

test("severity is unchanged: still high for both", () => {
  assert.equal(fromSecret(hit("Stripe key"), "/p").severity, "high");
  assert.equal(fromSecret(hit("Generic secret"), "/p").severity, "high");
});