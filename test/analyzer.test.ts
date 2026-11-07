import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzeOutput, tierOf } from "../src/analyzer";

// Real lines from `flutter analyze` on a student project. The last issue is wrapped onto two lines.
const SAMPLE = String.raw`Analyzing fyp-copy...

warning - Unused import: 'package:cloud_firestore/cloud_firestore.dart'. Try removing the import directive - lib\main.dart:1:8 - unused_import
   info - The import of 'dart:ui' is unnecessary because all of the used elements are also provided by the import of 'package:flutter/material.dart'. Try removing the import directive - lib\screens\admin\addproduct\addproduct_controller.dart:4:8 - unnecessary_import
warning - This method overrides a method annotated as '@mustCallSuper' in 'State', but doesn't invoke the overridden method - lib\screens\checkout\checkout_screen.dart:65:8 - must_call_super
   info - 'withOpacity' is deprecated and shouldn't be used. Use .withValues() to avoid precision loss. Try replacing the use of the deprecated member with the replacement - lib\screens\admin\addproduct\addproduct_screen.dart:267:63 - deprecated_member_use
warning - Returning a 'Future' without 'await' inside a try block. Try adding an 'await' - lib\services\recommendation_service.dart:27:30 - unawaited_return_in_try_block
   info - Don't use 'BuildContext's across async gaps. Try rewriting the code to not use the 'BuildContext', or guard the use with a 'mounted' check - lib\screens\admin\addproduct\addproduct_screen.dart:458:35 - use_build_context_synchronously
   info - The file name 'Category_model.dart' isn't a lower_case_with_underscores identifier. Try changing the name to follow the lower_case_with_underscores style - lib\models\Category_model.dart:1:1 -
          file_names

134 issues found. (ran in 69.0s)
`;

test("parses issues and ignores the header and summary lines", () => {
  assert.equal(parseAnalyzeOutput(SAMPLE).length, 7);
});

test("parses kind, message, location and rule", () => {
  const first = parseAnalyzeOutput(SAMPLE)[0];
  assert.equal(first.kind, "warning");
  assert.equal(first.rule, "unused_import");
  assert.equal(first.loc, "lib\\main.dart:1:8");
  assert.equal(
    first.message,
    "Unused import: 'package:cloud_firestore/cloud_firestore.dart'. Try removing the import directive",
  );
});

test("joins a line that the terminal wrapped", () => {
  const issue = parseAnalyzeOutput(SAMPLE).find((i) => i.rule === "file_names");
  assert.ok(issue);
  assert.equal(issue.kind, "info");
  assert.equal(issue.loc, "lib\\models\\Category_model.dart:1:1");
  assert.ok(issue.message.startsWith("The file name"));
});

test("keeps a message that itself contains ' - '", () => {
  const out = "  error - Undefined name 'x' - maybe a typo - lib\\a.dart:3:4 - undefined_identifier";
  const [i] = parseAnalyzeOutput(out);
  assert.equal(i.kind, "error");
  assert.equal(i.message, "Undefined name 'x' - maybe a typo");
  assert.equal(i.loc, "lib\\a.dart:3:4");
  assert.equal(i.rule, "undefined_identifier");
});

test("assigns tiers from the rule name", () => {
  const tier = (rule: string, kind: "error" | "warning" | "info" = "warning") =>
    tierOf({ kind, message: "", loc: "", rule });
  assert.equal(tier("must_call_super"), "bug-risk");
  assert.equal(tier("unawaited_return_in_try_block"), "bug-risk");
  assert.equal(tier("use_build_context_synchronously", "info"), "bug-risk");
  assert.equal(tier("deprecated_member_use", "info"), "migration");
  assert.equal(tier("unused_import"), "cleanup");
  assert.equal(tier("file_names", "info"), "style");
  assert.equal(tier("anything", "error"), "error");
});

test("empty output gives no issues", () => {
  assert.deepEqual(parseAnalyzeOutput(""), []);
  assert.deepEqual(parseAnalyzeOutput("No issues found! (ran in 3.0s)"), []);
});

test("an indented line after a blank line is not glued onto the previous issue", () => {
  const out = "warning - A - lib\\a.dart:1:1 - r1\n\n      indented junk\n";
  const issues = parseAnalyzeOutput(out);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].message, "A");
  assert.equal(issues[0].rule, "r1");
});

test("a line without a location becomes an 'unknown' rule instead of being lost", () => {
  const [i] = parseAnalyzeOutput("warning - something odd without a location");
  assert.equal(i.rule, "unknown");
  assert.equal(i.loc, "");
  assert.equal(i.kind, "warning");
  assert.ok(i.message.includes("something odd"));
});