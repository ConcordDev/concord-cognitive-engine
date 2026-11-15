# HV-03 — Export-leak hotfix convergence proof

Mega Plan v2, Track A (§3 HV-G0). Seat: B9. Claim: bridge CB-0629.
Proof head (HV-01 census head of record): **759265ae8** on
`fix/audit-sweep-20261110` (PR #2356). File-history recon was begun at
f4f9ee8a13; every check below was re-run at the proof head. B8's HV-01
census carries the export line AGREE — this document is the proof
behind that line. Nothing was carried: the hotfix is already on the
branch; this row proves it, and proves the branch's later export work
strengthened rather than reverted it.

## 1. Ancestry

`git merge-base --is-ancestor 7d522b454 759265ae8` = **true**
(also true at the recon head f4f9ee8a13). The hotfix commit
7d522b454 ("hotfix: stop lens export leaking private activity as
public system mirrors", 2026-11-09, cut from dae9e10a6) is an ancestor
of the fix branch. It needs no cherry-pick, and must never get one —
see §5.

## 2. The hotfix's files, and what the branch changed later

| Hotfix file | Later branch changes (commit — what) |
|---|---|
| server/domains/meditation.js (+37: export provider) | **none** |
| server/lib/integrity-check.js (repair-mint guard) | **none** |
| server/lib/lens-export.js | 8 commits: 96a7c62769 (keep an export inside its lens + caller) · 176548acdc (caller records outside the Lens bag) · bcc898ff49 (state-leg exports) · 9e985beb25 (FIX-feed-001 caller-scope) · 505dc5443b (CB-0588 owner-scoped artifacts leg) · bc65b854fa (CB-0594 ownerless rows fall, B5 reading) · dac2e8d99a (CB-0610 Leg A canonical owner chain) · 71168dd247 (B5 meditation-001 meta carry, on the landed shape) |
| server/routes/universal-export.js | 2 commits: 9b63395114 (CB-0442 CSV data columns) · 61de981d75 (import-002 row-split) |
| server/server.js (2 hunks) | many (the monolith) — governed per-hunk in §3 |
| server/tests/lens-export.test.js | 6 commits, riding the lens-export.js line above |
| server/tests/universal-export-download.test.js | 1 commit (9b63395114); fixtures aligned by this row — see §4 |
| audit/hotfixes/* (3 status files) | none (the pre-image patch file is SB-40's subject, not this row's) |

## 3. Per-hunk non-reversion (git log -L over each hunk's head range)

- **meditation.js provider hunk** (head :905–945): the only post-creation
  commit touching the range is 7d522b4542 itself. Present at the proof
  head (registerLensExportProvider("meditation") at :910). NOT REVERTED.
- **integrity-check.js guard hunk** (head :476–515): same — only
  7d522b4542 after the file's creation commit. The guard comment stands
  at :479, the inherited-owner line at :493. NOT REVERTED.
- **server.js hunk 1 — lens.list activity-mint filter** (proof-head
  :50389–50440): two commits ever touched the range — the hotfix, and
  GB-1536's a71f3fcb0d, which HOISTED `isActivityMint` above the branch
  so its new anonymous-actor path could exclude mints too
  (`artifacts.filter(a => !isActivityMint(a) && _lensAnonVisible(a))`
  at :50407), leaving the hotfix's signed-in filter block — comment and
  owner-only mint rule at :50413 — byte-identical below it.
  NOT REVERTED; STRENGTHENED.
- **server.js hunk 2 — syncDTUToLensArtifacts guard** (proof-head
  :91448–91510): the only commit touching the range is 7d522b4542
  itself; the guard comment stands at :91454. NOT REVERTED.

## 4. Behavioural acceptance at the proof head

- `server/tests/lens-export.test.js` — **13/13**.
- `server/tests/lens-export-owner-scope-pair.test.js` — **4/4**.
- `server/tests/universal-export-download.test.js` — **6/6**, after a
  fixture alignment landed with this row: the suite's download fixtures
  still seeded OWNERLESS rows, which under the CB-0588/CB-0594
  owner-scoped contract correctly fall, so the route rightly answered
  404 nothing_to_export (3 fails at head as found). The fixtures now
  carry the harness caller's owner stamp (u1); the download mechanics
  the suite pins (attachment headers, CSV columns/quoting, data
  columns, the anon 401 AUTH_REQUIRED the hotfix added) are unchanged.
  The contract governed the fixtures, never the reverse.
- **New pin** `server/tests/sec-export-no-foreign-rows.test.js` —
  **2/2 at the proof head; 0/2 on dae9e10a6** (run against dae's own
  lens-export.js). End-to-end through collectLensExport, both legs:
  user B's export holds no row owned by user A (private or public) and
  no system mirror of A's private DTU; symmetric for A; the mirrored
  private content string itself is absent.

Environment note: the download suite imports express and was run with
a borrowed node_modules (the sparse VM tree carries none); the other
three suites are dependency-free. CI runs all four natively.

## 5. Note for HV-51 (plan F5)

Because 7d522b454 is an ancestor of this branch, #2356 must reach main
as a **merge commit** — a squash or rebase merge would drop the
ancestry and locked-deploy's fast-forward from the live hotfix tree
would fail (rc=3). Recorded here per the plan row; the merge itself is
Dutch-only.

— B9, 2026-11-14. Nothing in this row is marked VERIFIED; the
post-deploy re-walk governs verification.
