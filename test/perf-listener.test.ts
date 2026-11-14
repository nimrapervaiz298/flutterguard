import test from "node:test";
import assert from "node:assert/strict";
import { findPerfInText } from "../src/perf";

const rules = (code: string) => findPerfInText(code).map((f) => f.rule);

test("real shape from videocall: orderBy and snapshots, no limit, is flagged", () => {
  const code = `return FirebaseFirestore.instance.collection(callsCollection).orderBy('createAt',descending: true).snapshots().listen((event) {});`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});

test("a StreamBuilder on a whole collection is flagged", () => {
  const code = `StreamBuilder(stream: FirebaseFirestore.instance.collection('products').snapshots(), builder: (c, s) { return Text(''); })`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});

test("snapshots with a limit is not flagged", () => {
  const code = `FirebaseFirestore.instance.collection('calls').limit(20).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), []);
});

test("snapshots with an equality filter only is not flagged", () => {
  const code = `FirebaseFirestore.instance.collection('chats').where('uid', isEqualTo: me).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), []);
});

test("snapshots with a non-equality filter and no limit is the lower rule", () => {
  const code = `FirebaseFirestore.instance.collection('users').where('uId', isNotEqualTo: me).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), ["firestore-query-without-limit"]);
});

test("a single document listener is not flagged", () => {
  const code = `FirebaseFirestore.instance.collection('users').doc(id).snapshots().listen((e) {});`;
  assert.deepEqual(rules(code), []);
});

test("a limit() later in the builder does not hide the listener", () => {
  const code = `StreamBuilder(stream: FirebaseFirestore.instance.collection('p').snapshots(), builder: (c, s) { final x = list.limit(3); return Text(''); })`;
  assert.deepEqual(rules(code), ["firestore-unbounded-read"]);
});