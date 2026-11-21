# GB-1580 items 1–3 + 5 — B9 dossier delta: census + hand-check

Base: walker/ulw-v3 @ 13738efbd5 (delta composed on B2's landing-1
head 7d78d62d245d for landing 2; zero file overlap with landing 1).
Corpus for the census: all 458 files of server/domains at the
deployed build 21303b4672 (the desk's table in GB-1580 was per-lens
over 270 lenses, so absolute numbers differ; the delta is the
measurement). Method: dossier._code_scan per domain file, old code
vs new code, same corpus.

## Before / after per flag

| flag | before | after | removed |
|---|---|---|---|
| money_action_without_ledger_call | 171 | 119 | 52 |
| raw_fetch_user_url | 94 | 25 | 69 net (72 removed, 3 conservative adds) |
| write_without_owner_check | 255 | 232 | 23 |
| fabricated_data | 192 | 190 | 2 |
| balance_mutation_outside_ledger | 20 | 20 | 0 (not in scope) |
| upload_via_json_endpoint | 8 | 8 | 0 (not in scope) |

## What changed (dossier.py)

1. money_action_without_ledger_call: the name alone no longer fires.
   The span must carry real money semantics (coin/CC/Sparks/balance/
   escrow/payout/price/purchase/tip/royalty/amount tokens or a
   ledger/wallet call site) and still lack a ledger token.
2. fabricated_data: the GB-1577 veto gains the legitimate-randomness
   contexts (shuffle / random-order / mix / sampling / jitter /
   backoff).
3. write_without_owner_check: the owner-evidence tokens gain the
   platform's actor-identity shapes (actorId( · actorIdFor( ·
   actorIdentity · requireActor · requireOwner) — actorId( appears
   500+ times in the server tree and was invisible to the old set.
4. raw_fetch_user_url: judged on host control, file-level. A fetch
   flags only when its host can be user-controlled (the expression
   traces to args/params/input/body/query, or cannot be traced —
   kept conservatively). Fixed hosts pass: literal hosts, templates
   over CONSTANT bases (`${MACROSTRAT_API}/...`), literal-host
   templates (`https://api.stripe.com/v1${path}`). Literal/template
   expressions are judged host-first (an API's own `query[term]`
   parameter is not user input); template capture extends past
   commas inside the literal.
5. Hidden actions: backend reach now also computes uncalled_actions
   (exposed actions with no "domain.action" call site anywhere in
   concord-frontend, one cached tree-wide scan). Only uncalled
   actions deduct; walk-hidden is a reported statistic.
6. Orphans: components with no imports anywhere are dead_components
   (info, cleanup list, no deduction); imported-but-unmounted stays
   orphaned and deducts.
7. Score split: live_quality (causes, replay, gates, core verb) and
   code_smell (scan flags, orphans, uncalled) sub-scores printed in
   every dossier + INDEX; combined = 100 − live − min(25, smell).
   The security_detector gate fails on live evidence only (two-
   account / ownership premap / trust); scan flags count on the gate
   block as code-smell: security. The W2 hand-pinned fixture re-pins
   to combined 51 / live 76 / smell 41 with the arithmetic in the
   test comment; CB-1014 (continuity vs re-pin) rides desk-pending.

## Hand-checked sample of removed hits (all true false positives)

- money: education "quiz-mint-deck" (mint in the name, quiz span) ·
  mentorship "mentor-withdraw" (session withdrawal, no money span) ·
  law-enforcement "evidenceTransfer" (custody transfer) · cri
  "stakeholderImpact" ("stake" inside "stakeholder").
- raw_fetch: geology `${MACROSTRAT_API}/geologic_units/map?...` ·
  retail `https://api.stripe.com/v1${path}` with the server key ·
  atlas/wiki + ocean API templates over constant bases.
- write: inheritance add_asset / assign_executor, dtus saveView /
  deleteView — spans resolve the actor via actorId( (the guard the
  old token set missed).
- fabricated: conkay scene `jitter: 0.06 + Math.random() * 0.14` ·
  a neuro component doc line describing Math.random jitter.
- Surviving write hits sampled (marketplace saved-searches-save,
  tournaments removeEntrant, materials import-test-csv, import
  createSchedule): no actor/owner evidence in span — plausible true
  positives, kept for human review.

## Named limits

- Fetch resolution is first-assignment, depth 2, file-level: a
  lowercase variable base it cannot prove fixed stays flagged
  (pets.js `${base}/breeds` ×3 are the census's conservative keeps).
- The 3 added raw_fetch rows are exactly those conservative keeps.
- Music's confirming measurement is the desk's dossier re-run over
  Walk 2 on the combined head (post-landing).

## Evidence on the composed tree (7d78d62d245d + this delta)

test_dossier 0 · test_scan_precision 0 · test_core_verbs 0 ·
test_fakedata_tuning 0 · test_durability 0 · B2's test_main_region 0 ·
test_coverage PASS. Full aggregator comparison vs the base battery
runs with the landing verification.
