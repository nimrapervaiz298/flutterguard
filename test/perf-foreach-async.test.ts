import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("real shape from easyshop: await on forEach with an async closure", () => {
  const code = `
    await cartCollection.docs.forEach((doc) async {
      await firebaseInstance.runTransaction((Transaction transaction) async {
        await transaction.delete(doc.reference);
      });
    });`;
  assert.deepEqual(rules(code), ["foreach-async-not-awaited"]);
});

test("forEach with an async closure and no await is flagged too", () => {
  const code = `items.forEach((x) async { await save(x); });`;
  assert.deepEqual(rules(code), ["foreach-async-not-awaited"]);
});

test("forEach with an async arrow closure is flagged", () => {
  const code = `items.forEach((x) async => await save(x));`;
  assert.deepEqual(rules(code), ["foreach-async-not-awaited"]);
});

test("forEach with a plain closure is not flagged", () => {
  const code = `items.forEach((x) { print(x); });`;
  assert.deepEqual(rules(code), []);
});

test("an async closure that is not passed to forEach is not flagged", () => {
  const code = `button.onTap = () async { await save(); };`;
  assert.deepEqual(rules(code), []);
});

test("a commented-out forEach is ignored", () => {
  const code = `// items.forEach((x) async { await save(x); });`;
  assert.deepEqual(rules(code), []);
});