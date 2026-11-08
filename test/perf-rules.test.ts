import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { findPerfInText, shouldCheckPerf } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("a collection-for in a widget list is not an awaited loop", () => {
  const code = `
    children: [
      for (Period p in Period.values)
        Section(
          children: [
            for (Event e in events.sorted(p))
              Row(
                onTap: () async {
                  final updated = await Navigator.of(context).push(route);
                  events.update(e, updated);
                },
              ),
          ],
        ),
    ],`;
  assert.deepEqual(rules(code), []);
});

test("an await inside an async closure created in a loop is not flagged", () => {
  const code = `
    for (final x in xs) {
      handlers.add(() async {
        await save(x);
      });
    }`;
  assert.deepEqual(rules(code), []);
});

test("an await inside an async arrow function created in a loop is not flagged", () => {
  const code = `
    for (final x in xs) {
      handlers.add(() async => await save(x));
    }`;
  assert.deepEqual(rules(code), []);
});

test("a real await is still flagged when the loop also creates a closure", () => {
  const code = `
    for (final x in xs) {
      await save(x);
      handlers.add(() async { await other(x); });
    }`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});

test("real shape from a student project: await in a loop with nested calls", () => {
  const code = `
    for (final productId in recentIds.take(5)) {
      final doc = await _firestore
          .collection('product_embeddings')
          .doc(productId)
          .get();
      if (doc.exists) { embeddings.add([]); }
    }`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});

test("single-statement body ends at the first semicolon outside brackets", () => {
  const code = `
    for (final x in xs) log(() { a(); b(); });
    final y = await later();`;
  assert.deepEqual(rules(code), []);
});

test("shouldCheckPerf skips tests, scripts, tools and generated files", () => {
  const root = path.join(path.sep, "p");
  const f = (...parts: string[]) => path.join(root, ...parts);
  assert.equal(shouldCheckPerf(f("lib", "a.dart"), root), true);
  assert.equal(shouldCheckPerf(f("lib", "a.g.dart"), root), false);
  assert.equal(shouldCheckPerf(f("lib", "a_test.dart"), root), false);
  assert.equal(shouldCheckPerf(f("test", "a.dart"), root), false);
  assert.equal(shouldCheckPerf(f("integration_test", "a.dart"), root), false);
  assert.equal(shouldCheckPerf(f("tool", "release.dart"), root), false);
  assert.equal(shouldCheckPerf(f("scripts", "x.dart"), root), false);
  assert.equal(shouldCheckPerf(f("lib", "a.js"), root), false);
});

test("shouldCheckPerf only looks at the path inside the project", () => {
  const root = path.join(path.sep, "work", "test", "app");
  assert.equal(shouldCheckPerf(path.join(root, "lib", "a.dart"), root), true);
});