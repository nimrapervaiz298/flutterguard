import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("arrayContains alone returns a small slice and is not flagged", () => {
  const code = `firestore.collection('groups').where('members', arrayContains: userId).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), []);
});

test("known limitation: an equality filter next to isNotEqualTo on the same field is still flagged", () => {
  const code = `FirebaseFirestore.instance.collection('users').where('userName', isEqualTo: q).where('userName', isNotEqualTo: me).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("whereIn is not flagged", () => {
  const code = `FirebaseFirestore.instance.collection('users').where('id', whereIn: ids).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), []);
});

test("isNotEqualTo alone is still flagged (real shape from videocall)", () => {
  const code = `FirebaseFirestore.instance.collection('users').where('uId',isNotEqualTo: me).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("a range filter alone is still flagged", () => {
  const code = `FirebaseFirestore.instance.collection('posts').where('likes', isGreaterThan: 5).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});