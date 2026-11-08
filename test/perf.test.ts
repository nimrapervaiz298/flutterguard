import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("flags unbounded collection read", () => {
  const code = `final s = await _firestore.collection('products').get();`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});

test("ignores read with limit", () => {
  const code = `final s = await _firestore.collection('products').limit(10).get();`;
  assert.deepEqual(rules(code), []);
});

test("where without limit is reported with the lower-level rule", () => {
  const code = `final s = await db.collection('products').where('a', isEqualTo: 1).get();`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("ignores single document read (multi-line)", () => {
  const code = `final d = await _firestore
      .collection('products')
      .doc(id)
      .get();`;
  assert.deepEqual(rules(code), []);
});

test("flags unbounded sub-collection read", () => {
  const code = `final o = await db.collection('users').doc(uid).collection('orders').get();`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});

test("flags await inside for loop", () => {
  const code = `
    for (final id in ids) {
      await save(id);
    }`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});

test("flags single-statement loop body", () => {
  const code = `for (var i = 0; i < 3; i++) await save(i);`;
  assert.deepEqual(rules(code), ["sequential-await-in-loop"]);
});

test("ignores loop without await", () => {
  const code = `
    for (final x in items) {
      total += x;
    }`;
  assert.deepEqual(rules(code), []);
});

test("ignores commented-out code", () => {
  const code = `
    // await db.collection('a').get();
    /* for (final x in xs) { await f(x); } */`;
  assert.deepEqual(rules(code), []);
});

test("ignores await for (stream loop)", () => {
  const code = `
    await for (final e in stream) {
      await handle(e);
    }`;
  assert.deepEqual(rules(code), []);
});

test("real shape from a student project: one of each", () => {
  const code = `
    Future<List<Product>> getRecommendations(String userId) async {
      try {
        final recentIds = await _interactionService.getRecentProductIds(userId);
        for (final productId in recentIds.take(5)) {
          final doc = await _firestore
              .collection('product_embeddings')
              .doc(productId)
              .get();
          if (doc.exists) { embeddings.add([]); }
        }
        final snapshot =
            await _firestore.collection('product_embeddings').get();
        for (final doc in snapshot.docs) {
          scored.add(doc.id);
        }
        return _getProductsByIds(topIds);
      } catch (e) {
        return _getPopularProducts();
      }
    }`;
  assert.deepEqual(
    rules(code).sort(),
    ["firestore-unbounded-read", "sequential-await-in-loop"],
  );
});