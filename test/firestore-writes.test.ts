import test from "node:test";
import assert from "node:assert/strict";
import { findCollectionWrites } from "../src/firestore-writes";

const sum = (code: string) => findCollectionWrites(code).map((w) => `${w.collection}:${w.method}`);

test("add on a top-level collection", () => {
  assert.deepEqual(sum("await db.collection('calendar').add({a: 1});"), ["calendar:add"]);
});

test("set after doc", () => {
  assert.deepEqual(sum("await db.collection('users').doc(uid).set(data);"), ["users:set"]);
});

test("multi-line chain with update", () => {
  const code = "await FirebaseFirestore.instance\n    .collection(\"posts\")\n    .doc(id)\n    .update({x: 1});";
  assert.deepEqual(sum(code), ["posts:update"]);
});

test("old API setData and document", () => {
  assert.deepEqual(sum("await Firestore.instance.collection('likes').document(id).setData({});"), ["likes:setData"]);
});

test("delete", () => {
  assert.deepEqual(sum("await db.collection('cats').doc(id).delete();"), ["cats:delete"]);
});

test("a read is not a write", () => {
  assert.deepEqual(sum("final s = await db.collection('users').get();"), []);
});

test("nested collection is skipped", () => {
  assert.deepEqual(sum("await db.collection('users').doc(u).collection('cart').add({});"), []);
});

test("variable path is skipped", () => {
  assert.deepEqual(sum("await db.collection(path).add({});"), []);
});

test("commented-out write is ignored", () => {
  assert.deepEqual(sum("// await db.collection('a').add({});"), []);
});

test("line number is reported", () => {
  const f = findCollectionWrites("final x = 1;\nawait db.collection('a').add({});");
  assert.equal(f[0].line, 2);
});