# Recipe-gap census (LC-05 / MST-W1-15)

*Compiled 2026-11-17 by B5 from the walker's own classification of record —
`walker/analysis/FPV-ROWS-CLASSIFIED-20261114.csv` (2,322 FIXED_PENDING_VERIFY
rows) — against the IMM-13 recipe registry as landed on `v1/immune-p1-recipe`
at `769355052`. Method and counts are reproducible from those two sources;
nothing here is estimated.*

## Why this census exists

Under the recipe-only rule (Dutch, Nov 15), a ticket can reach VERIFIED only
through a hand-written recipe replayed against the deployed build; a
keyword-only FIXED caps at NEEDS_HUMAN. The registry today holds **8 builtin
recipes** (FIX-007 · FIX-deities-002 · the six WALK-04g prod rows). None of
the 2,322 classified FPV rows is among those 8 ids — so the recipe gap over
the classified corpus is the whole corpus:

**Gap: 2,322 of 2,322 classified FPV rows have no registered hand recipe.**

The gap closes three ways: template instances (this layer), bespoke hand
recipes (per programme), and rows that should never get a Muse recipe at
all (money, held-out lanes). This census sorts every row into exactly one
of those, by the classification's own fields.

## Template-fit rows — 745 (32%)

By `walker_class`, the rows whose verification shape is one of the six
IMM-14 templates:

| walker_class | rows | template | instance binds | gate? |
|---|---|---|---|---|
| escape | 206 | escape | an opener control (usually the surface's own menu control, named in the ticket) | no |
| export | 171 | export-file | the Export control (platform-standard) + the export path | no |
| overflow390 | 150 | overflow-390 | nothing — lens only | no |
| contrast | 145 | contrast | nothing — lens only (min_ratio default 4.5) | no |
| http + pageerror | 73 | load-5xx | nothing — lens only | no |

**368 of the 745 bind no control names at all** (overflow · contrast ·
load classes) — their instances are pure (lens, params) and are buildable
today with no capture map. The escape and export instances bind only
platform-standard controls that the ticket text itself names.

## Endpoint-hit rows — 71, GATE-DEPENDENT

`human_category = dead_click_fake_success` (71 rows): a click that must
produce a real request is exactly the endpoint-hit template's shape — but a
faithful instance binds the ticket's REAL control id and expected endpoint,
which come from the W0 capture map / endpoint packets. Per the CB-0807
premise these are **not built under this release**; they are listed here so
the desk can release them when the capture map lands. The same applies to
the write-shaped share of `persistence_readback` (147 rows), whose
instances additionally need the walker's labelled write lane.

## The rest — 1,506 rows, by owner

| destination | rows (human_category / walker_class) | note |
|---|---|---|
| form bad-input programme (WALK-04a) | validation_messages 412 | the generic validation recipe exists; hand instances are per-form bespoke work |
| keyboard / a11y bespoke | keyboard_a11y 201 · walker_class keyboard/hotkey/focus 91 | per-lens key maps differ; no honest generic instance |
| visual / layout / copy bespoke | visual_layout_copy 328 | judgment-shaped; the vision judge's 10% spot-check lane, not recipes |
| missing control / CRUD bespoke | missing_control_or_crud 209 · delete_confirm class 220 · tab_error class 228 · persistence class 127 | each needs its ticket's own controls; template machinery does not fit |
| chat / LLM (WALK-04h) | llm_ai_output 134 | the chat recipe + send budget own these |
| cross-account privacy (WALK-04c) | cross_account_privacy 80 | two-account recipes, B4's programme shape |
| canvas / 3D / maps (WALK-04f) | 3d_webgl_canvas_map 99 | media/canvas probes own these |
| hidden text (WALK-04g) | hidden_text_or_test_data 21 | the hidden_text category check + the six prod recipes own this genus |
| computed / displayed values | computed_or_displayed_value 97 | bespoke read-back assertions per lens |
| uploads / media | file_upload_media 44 | fixture-media lane |
| realtime / sockets | realtime_socket 26 | two-client shapes, bespoke |
| external APIs | email_oauth_external_api 38 | no-egress rules keep these human |
| non-lens code tickets | non_lens_code_ticket 52 | CI-lane verification, not walker recipes |
| **payments / money** | **payments_money 56** | **money OFF — no recipe is written; these verify only under the founder's money-live trigger** |
| other / unclear | other_unclear 239 | needs a human read before any recipe is priced |

(Rows can carry both a walker_class and a human_category; the table assigns
each row once, template-fit and endpoint-hit first, so the three sections
sum to 2,322.)

## What LC-06 is approved to build (this census's recommendation)

1. **Template-instance machinery**: the registry learns `kind: "template"`
   (template name + params, validated against the template's param list),
   and reverify gains ONE generic runner that materializes a driver from
   the LensWalk and runs the bound instance — so a reviewed instance
   dispatches exactly like a code recipe.
2. **The first instance batch, generated deterministically from this
   census's rows** for the three zero-control-name classes (overflow-390 ·
   contrast · load-5xx — 368 rows) plus the escape/export rows whose
   control the ticket itself names — every generated instance landing as
   **status "draft"**: the loader refuses drafts, so nothing verifies
   until a Dutch / Zuko-desk review flips an instance to active, per the
   parent ticket's rule (*VERIFIED needs a reviewed per-ticket instance*).
3. **Selftests** proving: a draft instance does not dispatch; an active
   instance dispatches through the generic runner and returns the
   template's verdict on the fixture driver; the generator is idempotent
   (same census in, same instances out).

Not approved here: endpoint-hit instances (gate-dependent, above) ·
bespoke recipes for the 1,506 (they price per programme) · any instance
status flip (the reviewer's act, never the generator's).
