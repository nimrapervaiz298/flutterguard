# FlutterGuard

A command-line tool that scans a Flutter/Dart project for security, reliability and performance problems and prints one report.

**Status: early and experimental.** The rules are heuristics, and measured precision is low (see [Accuracy](#accuracy)). Treat every finding as a hint to check, not as a verdict.

## What it checks

| Check | What it looks for | How sure it is |
|---|---|---|
| `secrets` | Hardcoded API keys, AWS keys, private keys, passwords. Firebase client config keys are reported as `info` only. Placeholder values and generic secrets in test files are ignored. | Pattern match (medium) |
| `bloat` | Very long methods (80+ lines), estimated by counting braces. It is a heuristic, not a parser. Top-level functions are not reported. | Estimate (medium) |
| `analyze` | Runs `flutter analyze` and sorts its output into error, bug-risk, migration, cleanup and style. | The official Dart analyzer (high) |
| `perf` | Firestore reads of a whole collection (`firestore-unbounded-read`), queries with `where()` but no `limit()` (`firestore-query-without-limit`), `forEach` with an async closure (`foreach-async-not-awaited`), and `await` inside a loop (`sequential-await-in-loop`). Test, tool and script folders are skipped. | Heuristic (medium to low) |
| `firestore-rules` | In `firestore.rules` files: `allow` rules with no condition or `if true` (`open-access`) and write rules that only check the user is logged in (`auth-only-write`). | Pattern match, not measured |

Secret values are never printed. Reports contain the rule, the file and the line, not the secret.

## Requirements

- Node.js 18 or newer
- For the `analyze` check: Flutter installed, and `flutter pub get` already run in the project

## Install and run

```bash
git clone https://github.com/nimrapervaiz298/flutterguard.git
cd flutterguard
npm install
npx tsx src/index.ts report /path/to/your/flutter/project
```

## Commands

```text
report <dir>   run every check and print one report (alias: scan)
  --no-analyze      skip flutter analyze (much faster)
  --json            print the full report as JSON
  --out <file>      also write the JSON report to a file
  --stable          leave out timestamps, timings and absolute paths,
                    so two runs on the same project print identical JSON
  --max-file-kb <n> skip files bigger than this (default 1000)
  --fail-on <sev>   exit 1 when a finding has this severity or higher
                    (critical, high, medium, low, info; default: high)

check <dir>    count files and lines per language
secrets <dir>  run only the secrets check
bloat <dir>    run only the long-method check (--min <lines>)
analyze <dir>  run only flutter analyze
perf <dir>     run only the performance rules (--json)
bench ...      measure rule accuracy from hand-labelled findings
accuracy       score every labelled benchmark project and compare to a baseline
```

If `flutter` is not on your PATH, point to it with an environment variable:

```powershell
$env:FLUTTER_BIN = "C:\src\flutter\bin\flutter.bat"
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every requested check ran and there are no high or critical findings |
| 1 | There are high or critical findings |
| 2 | A check or the tool itself failed (for example Flutter was not found), so the report is incomplete |

`--fail-on medium` is noisy on `perf` findings today, because their measured precision is about 50%.

A check that was skipped on purpose (`--no-analyze`) or does not apply (not a Flutter project) is reported as `skipped` and does not change the exit code. A check that should have run but could not is reported as `failed` and makes the exit code 2.

## Report format

`report --json` prints one JSON object: project, scan statistics (files scanned and skipped), a status for every check (`ok`, `skipped` or `failed`), and a list of diagnostics. Each diagnostic has a stable `id` that does not change when lines shift, plus `rule`, `category`, `severity`, `confidence`, `location`, `evidence`, `why` and `fix`.

## Safety

- The scanner never reads outside the project folder and does not follow symlinks.
- Files that cannot be read, or that are over the size limit, are skipped and counted instead of crashing the run.
- Generated and dependency folders (`build`, `.dart_tool`, `node_modules`, `.git`, and similar) are skipped.

## Accuracy

Precision means: of the findings a rule reported, how many were real problems. It was measured by reading the code behind each finding by hand and labelling it true, false or unsure, on 14 open-source Flutter projects. "Untuned" means the project was not used to write or change the rule.

| Rule | Untuned precision | Notes |
|---|---|---|
| `perf/firestore-unbounded-read` | 50% (6 true, 6 false, 2 unsure) | Cannot tell a small per-user list from a large global collection. |
| `perf/sequential-await-in-loop` | unmeasured since the last change (55% before it: 6 true, 5 false, 1 unsure) | Loops over `limit(<number>)` or documentId-equality queries are now skipped. That change was written from 2 false alarms in one project, so precision on new projects is unmeasured. Most true labels are one pattern (one independent read or write per item). |
| `perf/firestore-query-without-limit` | 0 of 1 labelled (0 true labels exist) | Skips queries that only use `isEqualTo`. That change was made after seeing 4 false alarms in 4 projects, so its precision on new projects is unmeasured. |
| `secrets/hardcoded-secret` | 0 of 2 (1 unsure) | Only 3 labels. Flagged a vendored Firebase JS file and a class of UI test keys. |
| `bloat/long-method`, `secrets/firebase-config-key` | not measured | |
| `firestore-rules/*` | not measured | 5 findings in 8 rules files. `auth-only-write`: 3 findings, all true, 2 of them in the project the rule was written from. `open-access`: 2 findings, 1 true (in the project the fix was written from) and 1 false (an intentionally public catalog). 5 files had no findings; recall unknown. |
| Known bugs caught | 1 of 2 | The `forEach` bug is caught by a rule written from that same project, so this says nothing about recall elsewhere. The wrong-document update (`docs.first`) is still missed. |
| `perf/foreach-async-not-awaited` | 1 of 1, not a meaningful number | One example in 14 projects, the project the rule was written from. Precision and recall on other projects are unmeasured. |

Read these numbers with care:

- The samples are small (a few to about a dozen labels per rule), so the percentages can move a lot with a few more labels.
- All labels were made by the author, with an AI assistant's help. There is no independent reviewer yet.
- Recall (problems the tool misses) is not measured, except for the two known bugs above.
- One fix so far (`.document()` of the old Firestore API counts as a single-document read) came from a false alarm found in one benchmark project, so that project is counted as tuned.

The labels, the baseline and the latest results are in `benchmark/`. `npx tsx src/index.ts accuracy --root <folder with the projects>` recomputes them and reports any regression against the saved baseline. Numbers above are a snapshot and may be out of date; `benchmark/RESULTS.md` is the current one.

To label a new project:

```bash
npx tsx src/index.ts report <project> --no-analyze --out report.json
npx tsx src/index.ts bench template report.json --rule perf/ --project myproject --out benchmark/myproject.labels.json
# open the labels file and set each verdict to "true", "false" or "unsure"
npx tsx src/index.ts bench score report.json benchmark/myproject.labels.json
```

## Known limits

- Roughly half of the performance findings were false alarms in our measurements. Check each one before acting.
- A secret whose value is on the line after its name is not detected.
- `bloat` is estimated from braces and can be wrong on unusual syntax.
- The secrets check does not skip vendored or minified files.
- A Firestore read through a variable (for example `final ref = collection(path); await ref.get()`) is not detected.
- `firestore-rules` only understands single-statement `allow` lines, and treats a helper function as login-only only if its whole body is a login check.
- `firestore-rules` only looks at `match` scope roughly: `open-access` is reported as high severity under a recursive wildcard (`{document=**}`) and as low severity under a specific collection. The scope is found by counting braces, which is a heuristic, not a parser. That change was written from two projects, so it is not measured on new ones. The rule does not understand multi-line conditions.
- Only Dart and Flutter are supported so far.

## Tests

```powershell
npx tsx --test (Get-ChildItem test\*.test.ts).FullName
```

On macOS or Linux: `npx tsx --test test/*.test.ts`.

## License

MIT. See [LICENSE](LICENSE).