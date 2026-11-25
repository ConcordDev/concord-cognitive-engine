# Core-verb truth (GB-1576 W5a)

The W1 redesign study's recurring shape: in nearly every redesigned lens,
the defining feature was hollow under a working-looking UI. The walker's
checks measured surfaces — controls, contrast, wiring, isolation — but
nothing measured whether the lens's ONE defining verb actually works end
to end, persists, and is visible to exactly the accounts it should be.
W5a is that measurement.

## The spec — `walker/specs/core_verbs.json`

One entry per lens (all 270, keyed by the `walker/inventory.json` slug):

- `verb` — the defining act, in words ("create a song project").
- `action` — `{domain, name}` of the registered lens action that performs
  it, or `null` when unpinned (the check then verdicts UNSPECIFIED).
- `args` — a minimal argument template for the drive; `{label}` is
  replaced with the walk's unique fixture label, recursively — inside
  nested objects and lists too, wherever the action's schema puts the
  label-bearing field. `null` = the default `{title, name}` template.
- `visibility` — who should see the verb's result: `private` (the maker
  only), `shared`, or `public`.
- `cleanup_action` — the domain's delete/remove sibling of the verb
  action, where one exists, used to delete the created data via the
  write account.
- `expect`, `steps` — the expected persisted result, and the human repro.
- `status` — `confirmed` (hand-grounded in the W1 study record, action
  names registry-verified: the 13 redesigns of GB-1575 + Photos + Chat)
  or `draft` (derived mechanically from the `registerLensAction` scan of
  the server tree at the walk build; the verb choice and the private
  default are unreviewed). Drafts are derivation-grade, not truth.

Regenerate with `walker/analysis/gen_core_verbs.py` (inventory + a
domain→actions scan JSON → the spec file). Edit the spec by hand to pin
or correct a lens; a hand-pinned spec is how an UNSPECIFIED lens becomes
judgeable.

## The check — `LensWalk.core_verb_phase`

Rides the isolation phase beside the trust probes (same gates: a
write-capable member walk with an observer session). Pure planning and
verdicts live in `concord_walker/core_verbs.py`; the leg only drives:

1. Performs the verb through `POST /api/lens/run` as the writer (the
   shard's write account), the labelled marker in the args.
2. Verifies persistence by a fresh read-back — the reload witness:
   object GET when the verb's response carried an id, else the domain
   list searched for the marker/id.
3. Reads back as the observer: visibility must match the spec both ways
   (a private result the observer can see fails; a public one they
   cannot see fails).
4. Cleans up via the write account (the spec's cleanup action + the
   created id), and names the cleanup state in the block either way.

Money-class actions (buy / tender / transfer / escrow / …) are never
driven; they verdict UNSPECIFIED with the reason named.

## The pinning pass (2026-11-21, CB-1054 seating)

Walk 3's core-verb tally was 228 UNSPECIFIED, of which 55 were the
spec's action-null entries. Those 55 are now hand-resolved (B3, checker
B2) against a corrected registry scan: the W5a derivation had scanned
one registration form (`registerLensAction`, 263 domains); the server
registers macros through a second form too (`register(domain, action)`
inside per-domain `register…Macros` functions), and the full two-form,
case-sensitive scan of the deployed build finds 593 domains / 11,363
actions.

- **33 pinned** — each with the minimal valid args read off the action
  handler's own validation. One of them, chat, sits in the W1-confirmed
  set: the study grounded its verb and expressly left the action
  unpinned "until the desk pins it"; this pass is that pinning, and
  the entry keeps its confirmed status with the pin recorded in its
  note. (required fields, enum sets, numeric
  ranges), the design visibility, and the grounding in the entry's
  `note`. Where the domain's cleanup sibling cannot be driven by the
  cleanup machinery as it stands (the created id is nested deeper than
  the extractor reads, or the sibling takes a differently-named id
  argument), `cleanup_action` stays null and the created data stands
  under the walk's fixture label — the note says which case applies.
- **22 stay null**, each with the specific blocker named in its note:
  a required id from live world state a static spec cannot name
  (detective, ghost-tracker, housing, dreams, courtship, auction), an
  operator/admin gate (announcements, repair-telemetry), a read-only
  surface by design or founder ruling (codex, world-observatory,
  training-room, ledger, personas, narrative-walk, achievements), a
  money-adjacent or role-gated create (civic-bonds, death-insurance),
  a composite lens (strategic-adds), a system-only domain (lattice,
  plugins), or a core verb that is not a lens action at all (dtus,
  literary).

Four pinned verbs are perform-only or witness-poor (math, translation,
forecast, spectate): they return their result but carry no
label-bearing field the generic read-back can witness, so they are
expected to verdict UNSPECIFIED rather than PASS until the read-back
witness widens — the entries' `expect`/`note` say so per lens.

## The cleanup pass (2026-11-21, CB-1066)

The pinning pass left cleanup unpinned everywhere: the created id
usually sits deeper in the response than the extractor read, and the
cleanup siblings name their id argument per domain. Three machinery
changes fix that:

- `extract_object_id` now reads, after the plain holders (unchanged,
  first), the object nested one level under a holder — `result.monitor`,
  `result.task`, the world object — and deeper within a bounded search.
- A spec may carry `cleanup_id_arg`: the argument name its cleanup
  action takes the id under (default `id`). `cleanup_body` sends the
  id under that name.
- 17 of the 33 pins gained a handler-verified `cleanup_action`
  (resonance `pairId`, lfg `lfgId`, cognition `exportId`, crisis
  `resourceId`, expert-mode `threadId`, goddess `subscriptionId`,
  sessions `sessionId`, garage `vehicleId`; the rest under the default
  `id`). The other 16 stay cleanup-null with the reason in their notes —
  a role-gated delete (goals), a sibling for a different object class
  (mail), a slot-keyed remove (byo-keys), a scalar id field the
  object-shaped extractor cannot read (deities), or no sibling at all.
  The 202 drafts' cleanup entries keep the default `id` behaviour.

## Verdicts

- `CORE_VERB_PASS` — performed, persisted on read-back, visibility per spec.
- `CORE_VERB_FAIL` — the verb was genuinely exercised and the truth
  failed: the call itself broke for its own user (5xx, or 401/403), the
  result was not there on the fresh read-back, or the visibility was
  wrong. A FAIL also files a walk finding (class greeting-dead-surfaces).
- `CORE_VERB_UNSPECIFIED` — the probe could not judge: no spec, no
  pinned action, a validation refusal to the probe's minimal args, a
  missing read-back surface, a money-class verb. The reason is always
  named in the block. UNSPECIFIED is never a PASS in disguise — and the
  dossier prices it (below).

The block lands in the lens record as `result["core_verb"]`, beside the
isolation and trust blocks, with the repro steps attached.

## The dossier gate (W2 consumption)

`concord_walker/dossier.py` reads the record's verdict:

- `polished` cannot be PASS when the verdict is `CORE_VERB_FAIL`
  (GB-1576: a lens cannot be called polished if its core verb fails).
- The `core_verb` gate carries the verdict in every dossier + INDEX.
- Distance-to-bar: FAIL −40, a present UNSPECIFIED −10, an absent block
  (the phase did not run) deducts nothing — so dossiers over runs that
  predate the phase keep their hand-computed scores.

## Named limits

The driving leg is browser-live machinery: it is verified by the pure
layer's selftests (`selftest/test_core_verbs.py`) plus wiring checks and
the standing battery; its first live exercise is the desk's, on the v3
PR's walk-behind pass. Draft specs will produce UNSPECIFIED verdicts
wherever the walk cannot drive them (unpinned actions, arg-hungry
creates, no list/object read surface) — that is the spec system working
as designed: pin the spec to make the lens judgeable.
