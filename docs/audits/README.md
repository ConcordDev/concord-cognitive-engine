# Expedition Audits

Black/grey-box audits of the live Concord/Concordia stack, run against a
full-feature server (all kill-switches enabled). Each finding was verified
against the running system or the live DB schema; false positives are flagged
and retracted honestly.

| Round | Focus | Findings |
|---|---|---|
| [1](EXPEDITION_1_findings.md) | Macro dispatch, consolidation, dialogue, perf, dtu.create persistence, spell licensing | 30 (2 minor retracted) |
| [2](EXPEDITION_2_findings.md) | Write-path crashes, locked routers, **column schema-drift** | 35 |
| [3](EXPEDITION_3_findings.md) | **Ghost tables** (never-created), self-action logic, more drift | 32 |
| [4](EXPEDITION_4_findings.md) | Deep interior: concurrency, money-math, **SQL injection**, event contracts | 2 (1 HIGH) + honest negatives |
| [5](EXPEDITION_5_findings.md) | Authorization boundaries, content integrity, **full lens-system health** | 3 + verified-sound auth |
| [6](EXPEDITION_6_findings.md) | Frontend runtime: migrations, schema-source-of-truth, `next build`, white-screen risk | 3 + verified-sound migrations/build |
| [7](EXPEDITION_7_findings.md) | LLM prompt-safety + **the actual test suite** (21,622 pass / 3 real fails) | 5 (1 injection · 3 red tests · 1 stale artifact) |

## Root-cause summary
The large bug mass (rounds 2–3) collapses to **one cause**: the schema was
renamed/consolidated over time and a swath of code still references old
table/column names. Nothing in CI dry-runs the SQL, so each one ships (most
fail silently inside `try/catch`).

## Highest-leverage fixes
1. **EXPEDITION_4 #L2** — SQL identifier injection via user-authored skill `resource_bar` (the one adversary-abusable edge).
2. **A boot-time SQL-schema gate** — `prepare()` every statement against the live schema in CI. Retires the entire rounds 2–3 drift class at once and counts the remainder exactly.

## Verified-sound (honest negatives)
Money math (royalty cascade / XP curve / fees), concurrency (sync better-sqlite3
serializes), dynamic SQL (parameterized), frontend `tsc` + ESLint (0 errors),
privacy/consent gates, combat damage caps, hub no-violence law.
