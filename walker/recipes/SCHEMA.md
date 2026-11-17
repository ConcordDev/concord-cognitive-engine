# Walker recipe schema (IMM-13 / MST-W1-13)

One JSON file per hand-written verification recipe lives in this directory.
`concord_walker/recipes.py` loads every `*.json` file here at Reverifier
start; the loaded registry is the **single authority** on which tickets hold
hand recipes. A ticket with no registered recipe — or whose recipe is
refused — is verified by the generic checks only, and its verdict is capped
at NEEDS_HUMAN (Dutch's Nov 15 rule: only a hand-written recipe can verify).
Refusal always fails toward the human queue, never toward a verification.

The registry's job is the immune property: **the seat that fixed a ticket
never grades it** — not by writing the recipe, not by reviewing it — and a
recipe written against an old build goes stale instead of silently grading
a new one.

## Fields

| field | required | meaning |
|---|---|---|
| `id` | yes | the ticket id this recipe verifies (e.g. `FIX-chem-003`) |
| `kind` | no (default `code`) | `code` — the recipe is a walker method; `repro-steps` — the recipe is the ticket's hand-written repro steps (reserved; dispatched by the repro executor, not the code dispatch); `template` — an IMM-14 template instance (LC-06, see below) |
| `handler` | for `code` | the walker method name in `reverify.py` that runs the recipe (e.g. `_prod_scan`). The loader refuses a dispatch whose registry handler does not match the walker's method of that name |
| `title` | no | one line: what the recipe proves |
| `author` | yes | who wrote the recipe (a seat id, e.g. `muse-b5`, or `zuko-2`) |
| `reviewer` | yes | who reviewed it — must be `dutch` or `zuko-desk` (the reviewers of record), and must differ from the ticket's fixer |
| `status` | no (default `active`) | `active` · `draft` (never loaded — drafts live in `recipes/drafts/` once IMM-15 lands, and are refused here too) · `stale` (retired by hand) |
| `authored_on` | yes | ISO date the recipe was written, `YYYY-MM-DD` |
| `verified_against` | no | the walker build sha the recipe was last verified against; when the loader is given a current build sha and they differ, the recipe is stale |
| `max_age_days` | no (default 90) | staleness window: a recipe older than this is refused as stale |
| `expect_endpoints` | no | optional assertions the recipe makes about network behaviour: a list of `{method, path, expect_status}` — e.g. "control X hits `POST /api/lens/run` with `domain.action` and gets 2xx" is `{method: "POST", path: "/api/lens/run", expect_status: 200}` plus `expect_action` |
| `expect_action` | no | optional `domain.action` string the recipe expects the surface to invoke |
| `override_reason` + `override_by` | no | a refusal override. Usable by **Dutch only**: when `override_by` is `dutch` and the reason is non-empty, the recipe loads despite its refusal and the override is reported in the load result. An override signed by anyone else is itself a refusal |

## Template instances (kind = "template", LC-06)

A template instance binds one of the seven IMM-14 templates
(`concord_walker/recipe_templates.py`) to a ticket: `template` names one of
`escape` · `overflow-390` · `contrast` · `load-5xx` · `export-file` ·
`endpoint-hit` · `value-assert`, `params` is an object whose keys stay within the template's
declared parameter list, and `handler` must be omitted — instances dispatch
through the Reverifier's generic template runner, never a code handler.
Every other rule in this schema applies unchanged (authorship, reviewers,
staleness, status). The LC-06 generator emits instances as **drafts** from
the LC-05 census (`audit/reverify/RECIPE-GAPS.md`); a draft verifies
nothing until a reviewer of record flips it to `active`.

Two fields carry the documentation standard's corpus rules (CB-0810):

| field | meaning |
|---|---|
| `tier` | priority tier — 1: discriminating + safety/money-adjacent/persistence (always runs) · 2: adversarial (within the per-lens cap) · 3: extended regression (rotates). Generated instances are tiered at birth from their template's tier; the reviewer may re-tier at acceptance. An **active** template instance must carry one. |
| `discriminator` | the failure transcript from replaying this recipe against the pre-fix shape, stored in the file — not a screenshot. The reviewer records it at activation; an **active** template instance without one is refused. The template-level fixture transcripts live in `recipe_templates.py` (`TEMPLATES[name]["discriminator"]`). |

### The value-assertion form (corrections #8 + #9)

Surface is not correctness: a `value-assert` instance asserts a VALUE for a
declared reference case — known inputs → the expected value inside the
declaration's validity range — never merely that the screen rendered. Its
`params` must carry the `declaration` key:

- `declaration: null` — the action is filed **UNDECLARED** in the open: the
  entry loads as a corpus record of the correctness gap and its replay
  returns NEEDS_HUMAN naming the gap. (Baseline of record at f4f1f77ff:
  146 compute actions undeclared, 2 declared.)
- `declaration: {reference, validity_range, review_source}` — `reference`
  cites the source the expected value comes from, `validity_range` is text
  or `[lo, hi]`, and `review_source` is `"independent"` (the expected value
  comes from outside the system — a pass is a **correctness check**) or
  `"self-referenced"` (the expected value comes from the system itself — a
  pass is **drift coverage only**, and the verdict says so in its notes and
  evidence, everywhere it is reported).

Value assertions are Tier 1 wherever a declaration exists.

### Case provenance (ruling #11) and DevTools read-back (ruling #12)

| field | meaning |
|---|---|
| `case_source` | per-case provenance: `"observed"` (generated from route shape + fixture data of record — reachable, counts toward coverage) or `"extrapolated"` (enumerated from imagination — speculative coverage only). The counts are reported separately and **never summed**. Generated instances are born tagged `observed`; an **active** template instance must carry the tag. A template verdict carries its instance's tag, so run reports keep the two apart. |
| `readback` (result-side) | the endpoint + status + response shape the run **actually captured** (DevTools/observation, never hand-typed), attached to the net-observing templates' results (`load-5xx` · `export-file` · `endpoint-hit`). Rows dedupe by method/route/status with an `occurrences` count; failed requests (status ≥ 400) are filed first at `"weight": "high"`. The recipe's `expect_endpoints[]` / `expect_action` state the expectation; the read-back is the evidence it is judged against. |

## Refusals (each carries its reasons, printed on the load report)

- malformed file, missing/invalid fields, unknown `kind` or `status`
- `reviewer` outside the reviewers of record
- `status` is `draft` or `stale`
- computed staleness: `authored_on` older than `max_age_days`, or a pinned
  `verified_against` that does not match the build under verification
- authorship: `author` == the ticket's fixer, or `reviewer` == the ticket's
  fixer (checked at load when the fixer is known, and again at dispatch
  against the ticket row)
- duplicate `id` across files (first file wins; the later file is refused)
- a code handler exists but no registry entry names it (the handler is not
  dispatched), or a registered `code` recipe names no existing handler

## The builtin set

The eight recipes the walker already carried as code are registered here,
one file each: `FIX-007`, `FIX-deities-002` (the seed pair) and the six
WALK-04g post-deploy rows (`FIX-chem-003`, `FIX-docs-015`, `FIX-global-016`,
`FIX-metalearning-014`, `FIX-repos-002`, `FIX-ingest-001`). Registering a new
hand recipe = write the walker method, add its JSON file here with a Dutch
or Zuko-desk review, and it dispatches on the next run.
