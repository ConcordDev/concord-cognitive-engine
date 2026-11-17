# Repro rewrites (beside the verbatim originals)

`batch-NNN.jsonl` = one JSON object per ticket, 50 tickets per batch, in `id` order over the tickets that have
`repro_steps` in the fold at **272e62f41** (the pool `tools/mapped_rate.py --all` measures). `PROGRESS.json`
= `{batch: {tickets, rewritten, human_only, committed_sha}}`. Nothing here is ever written back to
`fix_tickets.jsonl`, the `records/`, or the fold: the ticket text stays byte-for-byte as filed.

A rewrite is the structured twin of the prose, in the walker's own vocabulary. It compiles to the mapper's own step /
clause text (`rewrites.compile_step` / `compile_clause`), so replay, safety (own fixture, `--allow-write`, non-admin,
HARD_DENY, FIELD_NEVER) and the single VERIFIED gate (`ledger.assert_verifiable`) are unchanged.

## Record (schema 1)
```
ticket_id, lens, fold_sha:"272e62f41", orig_hash, author:"sonnet", date:"YYYY-MM-DD", schema:1,
status: "rewritten" | "original_sufficient" | "human_only",
human_only_reason: lighthouse | code_read | cross_account | visual | other_with_note   (+ "note" for other_with_note)
steps:    [{op, target?, value?, count?, src, from_orig:[orig step idx]}]
dropped:  [{orig: idx, reason: observe_moved_to_expected | no_text}]
expected: [{kind, args, from_orig_clause:[clause idx | "s<step idx>"], orig_span}]
```
* `orig_hash` = sha256 of `json.dumps({"repro_steps":…, "expected":…}, sort_keys=True, ensure_ascii=False)` of the ORIGINAL fields
  as the fold returns them (`rewrites.orig_hash`). A rewrite bound to different text is stale and fails closed.
* `op` ∈ open, open_tab, click, type, press, reload, viewport, scheme, tab_sweep, export, submit, fill_form, delete_own, open_first, wait
  (each compiles to text the executor already maps), plus `keep` (the original step verbatim — it must map exactly as the original does)
  and `needs_human_step` (the original step verbatim — it must stay unmapped; a person runs it).
* `kind` ∈ the predicate kinds `expected.py` already classifies, plus `keep` (original clause verbatim, must classify) and
  `needs_human` (original clause verbatim, must NOT classify). `orig_span` is the exact original text the clause comes from.
* `src` of a control name: `text` (a literal of the original step), `live:<lens>` (seen on the live lens by a real walk), `manifest:<x>`, `alias`, or `frontend:<path>:<line>` (visible text / aria-label / title / tab label at that line of the frontend at fold sha 272e62f41; `agree()` checks that the path exists at that sha and the label literally appears on that line).
  A control that is on neither the live labels nor the manifest is never invented: the step stays `needs_human_step`.

## agree(ticket, rw) — deterministic, fail closed (`rewrites.agree`)
1. bound to the current original (`orig_hash`), same `ticket_id`/`lens`, valid schema, author + date present;
2. no added steps (every step has `from_orig` at existing original steps) and no dropped steps (every original step is covered, or listed in `dropped` as an observe moved to expected / no text);
3. no added or dropped expectations: every clause points at existing original clause(s) with an `orig_span` that is in them, spans of an original clause cover all of it, and the clause's key literal / anchor word is in the original text;
4. a typed value appears verbatim in the original (or is an `N-char` string whose `N-char` is in the original);
5. a control name is the SAME control the original names (literal, alias, or resolves to the same live label) and, for `live:` sources, is a live label of the lens;
6. `human_only` records are never replayed from a rewrite.
Any failure: replay yields NEEDS_HUMAN `rewrite_disagrees:<reason>` (never a looser fallback). Tools: `tools/rewrite_check.py --batch NNN` (validates + agree() every record), `tools/rewrite_draft.py` (proposes a batch; a person reviews it), `tools/mapped_rate.py --rewrites walker/rewrites` (measurement).

## Hand-authored (course correction 2026-11-16)
Every record is written by reading the ticket (title, steps, expected, actual, lens) and translating each unmapped step / unchecked clause by hand
(`tools/rewrite_author.py` only attaches provenance + indices from a per-ticket spec; it drafts nothing).
* `original_sufficient`: every step is `keep`/`needs_human_step` and every clause `keep`/`needs_human` — nothing was converted; replay uses the original text, and the record is NOT counted as rewrite-backed.
* `needs_human_step` / `needs_human` must carry a one-line `why` naming the concrete blocker.
* `human_only` + `other_with_note` must carry a `note`.
