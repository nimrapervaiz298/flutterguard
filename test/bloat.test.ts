import test from "node:test";
import assert from "node:assert/strict";
import { findBloatInText } from "../src/bloat";

const method = (name: string, inner: number) =>
  `  void ${name}() {\n` + "    work();\n".repeat(inner) + "  }\n";
const cls = (body: string) => "class A {\n" + body + "}\n";

test("reports a long method with line, length and signature", () => {
  const rows = findBloatInText(cls(method("m", 20)), 10);
  assert.deepEqual(rows, [{ line: 2, len: 22, name: "void m() {" }]);
});

test("does not report a short method", () => {
  assert.deepEqual(findBloatInText(cls(method("m", 3)), 10), []);
});

test("braces inside strings do not break the count", () => {
  const code = [
    "class A {",
    "  void m() {",
    "    final s = '{{{{';",
    '    final t = "}}}}";',
    "    work();",
    "    work();",
    "  }",
    "}",
    "",
  ].join("\n");
  const rows = findBloatInText(code, 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].len, 6);
  assert.equal(rows[0].line, 2);
});

test("braces inside line and block comments are ignored", () => {
  const code = [
    "class A {",
    "  void m() {",
    "    // }}}",
    "    /* { */",
    "    /*",
    "      }",
    "    */",
    "    work();",
    "  }",
    "}",
    "",
  ].join("\n");
  const rows = findBloatInText(code, 8);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].len, 8);
});

test("Dart string interpolation does not break the count", () => {
  const code = [
    "class A {",
    "  void m() {",
    "    final s = 'value ${a} and ${b}';",
    "    work();",
    "    work();",
    "    work();",
    "  }",
    "}",
    "",
  ].join("\n");
  const rows = findBloatInText(code, 6);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].len, 6);
});

test("two methods are reported separately, longest first", () => {
  const rows = findBloatInText(cls(method("a", 20) + method("b", 10)), 10);
  assert.deepEqual(rows.map((r) => r.len), [22, 12]);
  assert.deepEqual(rows.map((r) => r.line), [2, 24]);
  assert.deepEqual(rows.map((r) => r.name), ["void a() {", "void b() {"]);
});

test("known limitation: a top-level function is not reported", () => {
  const code = "void big() {\n" + "  work();\n".repeat(20) + "}\n";
  assert.deepEqual(findBloatInText(code, 10), []);
});

test("braces inside a multi-line string are ignored", () => {
  const code = [
    "class A {",
    "  void m() {",
    "    final s = '''",
    "      }}}",
    "    ''';",
    "    work();",
    "    work();",
    "  }",
    "}",
    "",
  ].join("\n");
  const rows = findBloatInText(code, 7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].len, 7);
});

test("a long commented-out class is not reported", () => {
  const commented = [
    "// class Old extends State<Old> {",
    "//   @override",
    "//   Widget build(BuildContext context) {",
    ...Array.from({ length: 30 }, () => "//     work();"),
    "//   }",
    "// }",
    "",
  ].join("\n");
  const code = "class Real {\n  void ok() {\n    work();\n  }\n}\n" + commented;
  assert.deepEqual(findBloatInText(code, 10), []);
});