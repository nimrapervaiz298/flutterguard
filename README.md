# FlutterGuard

A command-line tool that scans a Flutter/Dart project for security, reliability and performance problems and prints one report.

**Status: early and experimental.** The rules are heuristics. Accuracy has only been measured on two projects (see [Accuracy](#accuracy)), so treat the findings as hints to check, not as verdicts.

## What it checks

| Check | What it looks for | How sure it is |
|---|---|---|
| `secrets` | Hardcoded API keys, AWS keys, private keys, passwords. Firebase client config keys are reported as `info` only. Placeholder values and generic secrets in test files are ignored. | Pattern match (medium) |
| `bloat` | Very long methods (80+ lines), estimated by counting braces. It is a heuristic, not a parser. Top-level functions are not reported. | Estimate (medium) |
| `analyze` | Runs `flutter analyze` and sorts its output into error, bug-risk, migration, cleanup and style. | The official Dart analyzer (high) |
| `perf` | Firestore reads of a whole collection (`firestore-unbounded-read`), queries with `where()` but no `limit()` (`firestore-query-without-limit`), and `await` inside a loop (`sequential-await-in-loop`). Test, tool and script folders are skipped. | Heuristic (medium to low) |

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

check <dir>    count files and lines per language
secrets <dir>  run only the secrets check
bloat <dir>    run only the long-method check (--min <lines>)
analyze <dir>  run only flutter analyze
perf <dir>     run only the performance rules (--json)
bench ...      measure rule accuracy from hand-labelled findings
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

A check that was skipped on purpose (`--no-analyze`) or does not apply (not a Flutter project) is reported as `skipped` and does not change the exit code. A check that should have run but could not is reported as `failed` and makes the exit code 2.

## Report format

`report --json` prints one JSON object: project, scan statistics (files scanned and skipped), a status for every check (`ok`, `skipped` or `failed`), and a list of diagnostics. Each diagnostic has a stable `id` that does not change when lines shift, plus `rule`, `category`, `severity`, `confidence`, `location`, `evidence`, `why` and `fix`.

## Safety

- The scanner never reads outside the project folder and does not follow symlinks.
- Files that cannot be read, or that are over the size limit, are skipped and counted instead of crashing the run.
- Generated and dependency folders (`build`, `.dart_tool`, `node_modules`, `.git`, and similar) are skipped.

## Accuracy

Rules can be measured against hand-labelled findings:

```bash
npx tsx src/index.ts report <project> --no-analyze --out report.json
npx tsx src/index.ts bench template report.json --rule perf/ --project myproject --out benchmark/myproject.labels.json
# open the labels file and set each verdict to "true", "false" or "unsure"
npx tsx src/index.ts bench score report.json benchmark/myproject.labels.json
```

This gives precision per rule. It does not measure recall (problems the tool misses). So far only two projects have been labelled, with a handful of findings each, which is too little to quote an accuracy figure. The labels are in `benchmark/`.

## Known limits

- A secret whose value is on the line after its name is not detected.
- `bloat` is estimated from braces and can be wrong on unusual syntax.
- `firestore-query-without-limit` has not yet been checked on a real project and may be noisy.
- Only Dart and Flutter are supported so far.

## Tests

```powershell
npx tsx --test (Get-ChildItem test\*.test.ts).FullName
```

On macOS or Linux: `npx tsx --test test/*.test.ts`.

## License

MIT. See [LICENSE](LICENSE).