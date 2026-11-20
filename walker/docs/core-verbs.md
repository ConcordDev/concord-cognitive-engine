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
  replaced with the walk's unique fixture label. `null` = the default
  `{title, name}` template.
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
