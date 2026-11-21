# FlutterGuard

A command-line tool that scans a Flutter/Dart project for security, reliability and performance problems and prints one report.

**Status: early and experimental.** The rules are heuristics, and measured precision is low (see [Accuracy](#accuracy)). Treat every finding as a hint to check, not as a verdict.

## What it checks

| Check | What it looks for | How sure it is |
|---|---|---|
| `secrets` | Hardcoded API keys, AWS keys, private keys, Stripe, GitHub and Slack tokens, and generic `name = value` passwords. Firebase client config keys are reported as `info` only. Placeholder values and generic secrets in test files are ignored. | Fixed-format keys: high confidence. Generic `name = value`: medium. Not measured on real keys |
| `bloat` | Very long methods (80+ lines), estimated by counting braces. It is a heuristic, not a parser. Top-level functions are not reported. | Estimate (medium) |
| `analyze` | Runs `flutter analyze` and sorts its output into error, bug-risk, migration, cleanup and style. | The official Dart analyzer (high) |
| `perf` | Firestore reads of a whole collection (`firestore-unbounded-read`), queries with `where()` but no `limit()` (`firestore-query-without-limit`), `forEach` with an async closure (`foreach-async-not-awaited`), and `await` inside a loop (`sequential-await-in-loop`). Test, tool and script folders are skipped. | Heuristic (medium to low) |
| `firestore-rules` | In `firestore.rules` and `storage.rules` files: `allow` rules with no condition or `if true` (`open-access`) and write rules that only check the user is logged in (`auth-only-write`). | Pattern match; `open-access` is mostly false alarms, see Accuracy |

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
  --min-confidence <level>
                    only count findings of this confidence or higher for the exit code
                    (high, medium, low; default: low, i.e. all findings count)

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

`--fail-on medium` is noisy on `perf` findings today, because their measured precision is about 50%. `--fail-on high --min-confidence high` fails the build only on findings with a recognisable fixed format; today that means mostly secrets.

A check that was skipped on purpose (`--no-analyze`) or does not apply (not a Flutter project) is reported as `skipped` and does not change the exit code. A check that should have run but could not is reported as `failed` and makes the exit code 2.

## Report format

`report --json` prints one JSON object: project, scan statistics (files scanned and skipped), a status for every check (`ok`, `skipped` or `failed`), and a list of diagnostics. Each diagnostic has a stable `id` that does not change when lines shift, plus `rule`, `category`, `severity`, `confidence`, `location`, `evidence`, `why` and `fix`.

## Confidence tiers

The text report groups findings by confidence: **Confirmed** (a fixed, recognisable key format), **Likely**, and **Hints** (heuristics that are often false alarms). Only findings of medium severity or higher are listed in the text report; the JSON report has everything.

Confidence is not a measured precision. `high` on a secret means the key has a recognisable format; no real key of these formats was found in the 20 benchmark projects. `unbounded-read` is a hint because its measured precision is only about 55-65%. By default confidence does not change the exit code: `--fail-on` looks at severity only. With `--min-confidence`, only findings of that confidence or higher count.

No rule is "supported" yet. We would call a rule supported only with 30 or more independent labels at 80% precision or better, checked on a sealed set. No rule meets that today, so treat every finding as a hint, including the Confirmed tier: that tier means a recognisable key format, not a measured precision. The current numbers are in `benchmark/RESULTS.md`.

## Safety

- The scanner never reads outside the project folder and does not follow symlinks.
- Files that cannot be read, or that are over the size limit, are skipped and counted instead of crashing the run.
- Generated and dependency folders (`build`, `.dart_tool`, `node_modules`, `.git`, and similar) are skipped.

## Accuracy

Precision means: of the findings a rule reported, how many were real problems. It was measured by reading the code behind each finding by hand and labelling it true, false or unsure, on 20 open-source Flutter projects. "Untuned" means the project was not used to write or change the rule.

| Rule | Untuned precision | Notes |
|---|---|---|
| `perf/firestore-unbounded-read` | 57% (16 true, 12 false, 4 unsure) | Cannot tell a small per-user list from a large global collection. At least 10 of the true labels are realtime listeners on chat or post collections, which are easy to call true, so this is not an improvement of the rule. Some false and unsure labels are guesses about collection size. |
| `perf/sequential-await-in-loop` | 60% (9 true, 6 false, 1 unsure) | Loops over `limit(<number>)` or documentId-equality queries are skipped; that change was written from 2 false alarms in one project, so the number is mixed. Most true labels are one pattern (one independent read or write per item). |
| `perf/firestore-query-without-limit` | 2 true, 2 false (too few labels for a percentage) | Skips queries that only use `isEqualTo`. That change was written after seeing 4 false alarms. |
| `secrets/hardcoded-secret` | 6 true, 0 false, 1 unsure (too few labels for a percentage) | The 6 true labels are one Google Maps key repeated in one project (mini-project-2), labelled weak because Maps keys can be restricted. The unsure label is an Agora-style token in another project. Earlier false alarms (a vendored Firebase JS file, a UI test key constant) led to two fixes written from them, so those fixes are not evidence of precision. Recall unknown. |
| `bloat/long-method`, `secrets/firebase-config-key` | not measured | |
| `firestore-rules/*` | `auth-only-write`: 6 true, 0 false, 2 unsure. `open-access`: 2 true, 19 false, 1 unsure | 26 benchmark projects. Most labels were made after the findings had been seen, and 2 of the `auth-only-write` findings are in the project the rule was written from, so there is no clean unseen number for `auth-only-write`. First unseen set (4 projects, rules files only): `open-access` gave 13 findings, 1 true and 12 false, nearly all public reads the author documented as intended; the rule cannot read intent. Second unseen set (8 Flutter repos that claim to have security rules): 4 findings in one project (2 `open-access` false, already info severity, and 2 `auth-only-write` unsure); the other 7 rules files gave no findings, and a shape check found no open or login-only write rules in them. Note that the table counts a finding as a false alarm even when its severity is info, so the low `open-access` precision measures how often the rule fires on intended public rules, not how much noise the text report shows. The severity and scope fixes were written after seeing the first unseen set. Recall unknown. `auth-only-write` only fires when the whole condition is a bare login check, so a write like `isSignedIn() && size && contentType` is outside what it flags by design. Of 20 such candidates in the benchmark rules files, 1 had no ownership check (a `storage.rules` attachment upload, which may be intended) and 5 were unclear (one depends on a helper function, four are long bracketed conditions that were not read in full); the rest check ownership. One example is too few to change the rule. |
| Known bugs caught | 4 of 6 | Two of the 4 are in projects the rule was written from (easyshop `forEach`, timy `calendar`). `who-app` storage was already seen when its finding was labelled. `feelview` (open database) was in the first unseen set and is the closest to an independent catch, but later scope fixes were written after seeing that set. Two bugs have no rule (collections `docs.first`, videocall client-side filter). Only 2 rules are covered. Recall on unseen projects is not measured. |
| `perf/foreach-async-not-awaited` | 1 of 1, not a meaningful number | One example in 14 projects, the project the rule was written from. Precision and recall on other projects are unmeasured. |

Read these numbers with care:

- The samples are small (a few to about a dozen labels per rule), so the percentages can move a lot with a few more labels.
- All labels were made by the author, with an AI assistant's help. There is no independent reviewer yet.
- Recall (problems the tool misses) is not measured, except for the six known bugs listed above, which are few, mostly seen, and cover only two rules.
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
- The secrets check knows Google API keys, AWS access keys, private key headers, Stripe, GitHub and Slack tokens, and generic `name = value` secrets. It does not detect JWTs, and a secret whose value is on the line after its name is not detected. On a small author-made test set it caught all 16 examples of the formats it knows and 0 of 2 of the others. No real key of these formats was found in the 20 benchmark projects, so real-world precision and recall are unmeasured. The token lengths come from memory and were not checked against provider documentation.
- `bloat` is estimated from braces and can be wrong on unusual syntax.
- The secrets check skips `web/__/firebase/` and lines over 1000 characters, a rule written from one false alarm; other vendored folders are still scanned.
- A Firestore read through a variable (for example `final ref = collection(path); await ref.get()`) is not detected.
- `firestore-rules` only understands single-statement `allow` lines, and treats a helper function as login-only only if its whole body is a login check.
- `firestore-rules` only looks at `match` scope roughly, by counting braces (a heuristic, not a parser). `open-access` is high severity for any public write and for a public read under a recursive wildcard (`{document=**}` or `{allPaths=**}`), and info for a public read of one collection. Only a wildcard directly under the root counts as database-wide; a wildcard inside a folder (for example `agencies/{id}/{allPaths=**}`) is treated as one collection. Both the info rule and the folder rule were written after seeing the unseen set (one false alarm for the folder rule), so that set no longer measures them. The rule cannot tell a public catalog from private data (`/users`, `/messages`), `match ... {` must be on one line, and multi-line conditions are not understood.
- Only Dart and Flutter are supported so far.

## Tests

```powershell
npx tsx --test (Get-ChildItem test\*.test.ts).FullName
```

On macOS or Linux: `npx tsx --test test/*.test.ts`.

## License

MIT. See [LICENSE](LICENSE).