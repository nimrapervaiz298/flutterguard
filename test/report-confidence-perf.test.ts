import test from "node:test";
import assert from "node:assert/strict";
import { fromPerf } from "../src/report";

test("unbounded-read is a hint: low confidence, severity unchanged", () => {
  const d = fromPerf({ rule: "firestore-unbounded-read", severity: "warning", line: 3, message: "x", collection: "users" } as any, "/p/lib/a.dart", "/p");
  assert.equal(d.confidence, "low");
  assert.equal(d.severity, "medium");
});