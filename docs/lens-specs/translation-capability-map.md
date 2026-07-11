# translation — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'register("translation"' server/domains/translation.js` → 4

## Reference app + parity target

**DeepL / Google Translate** — the real best-in-class machine-translation
product: single-text translate, source-language auto-detect, a formality
register control (DeepL's signature differentiator), and a "document"/batch
mode for translating a list of strings in one pass rather than one round trip
per string. Concord's version is deliberately narrower in scope (text only,
no document upload, no glossary/TM) but is genuinely **sovereignty-first**:
every call routes through Concord's own local LLM (`ctx.llm.chat`, "utility"
brain slot) — no external API, no data egress — which is the one dimension
DeepL/Google structurally cannot match.

## Macro inventory (`server/domains/translation.js`, 393 lines)

Registered via `registerTranslationMacros(register)`, called from
`server.js:25852-25853`. All four handlers are stateless (verified:
`grep -n "STATE\.\|ctx\.db\|db\.prepare\|db\.exec" server/domains/translation.js`
→ no matches) and every handler is wrapped in try/catch, never throwing.

| Macro | Behavior | I/O |
|---|---|---|
| `translation.languages` | Static 25-language ISO 639-1 catalog + 3 formality registers. Pure, no LLM call. | none |
| `translation.detect` | **Real deterministic offline detector** (Unicode-script ranges for 10 non-Latin scripts + stopword-frequency scoring for 13 Latin-script languages) is the ground truth; an available LLM only *refines* it, never replaces it on failure. | LLM optional |
| `translation.translate` | Single-string translation via the local LLM (`TASK_PROMPTS.machineTranslate`). Honest `{ok:false, error:'translation_unavailable'}` when the brain is down or replies empty — never fabricates. | LLM required |
| `translation.batch` | Array translation, one LLM pass, order-preserving, `MAX_BATCH=50` / `MAX_TEXT_LEN=8000` combined chars. Same honest-failure contract as `translate`. | LLM required |

## Findings

### `translation.batch` — REAL GAP (fixed): zero frontend callers

Confirmed by exhaustive re-grep of the whole `concord-frontend/` tree before
touching anything:

```
$ grep -rn "'batch'" --include="*.tsx" --include="*.ts" concord-frontend | grep -i transl   → (no matches)
$ grep -rn "translation.*batch\|batch.*translation" --include="*.tsx" --include="*.ts" concord-frontend   → (no matches)
$ grep -rn "lensRun.*translation" --include="*.tsx" --include="*.ts" concord-frontend
  components/voice/VoiceRecordingStudio.tsx:82:  lensRun('voice', 'transcript-translations-list', { id });
```

That one hit is a *different* domain (`voice`, a per-recording transcript
list) that merely has "translation" in its macro name — not a caller of the
`translation` domain. There is also no bulk-import/citation/DTU pipeline
anywhere that already exercises `translation.batch`; it was genuinely dead —
a real, non-trivial (order-preserving array translation with its own
validation/cap contract) backend capability with no UI path to it.

**Disposition: wired, not deferred.** The natural home is a "translate a
list" workflow — the same shape DeepL/Google Translate's document/batch mode
offers, and the one Concord's own single-text flow can't do efficiently (N
separate round-trips vs. one LLM pass). Forcing this into the existing
single-text form would have been dishonest scaffolding (a fake "batch"
toggle bolted onto unrelated state); instead `app/lenses/translation/page.tsx`
gained a genuine second mode:

- A `role="tablist"` **Single / Batch translate** toggle (`aria-selected`,
  each tab has its own accessible name) switches between the existing
  single-text flow and a new batch flow. Switching modes never discards
  in-progress single-text work — batch state (`batchText`, `batchResults`,
  `batchBusy`, `batchError`) is fully separate React state, not reused/
  aliased single-mode state.
- Batch mode: a labeled multi-line textarea (`aria-label="Lines to batch
  translate"`, one item per line, live `N/50 lines` counter derived from the
  actual split+trim+filter of the textarea content — not a hardcoded cap
  display), a "Translate all" button that calls
  `lensRun('translation', 'batch', { items, targetLanguage, formality })`
  with the **real** split lines (no synthetic items), and a results list
  showing each `input → output` pair in the order the macro returned them
  (order-preservation is asserted by the new test, not just assumed).
  Reuses the existing `To`/`Register` selects (the `batch` macro takes no
  `sourceLanguage` param, so the `From` select is hidden in batch mode
  rather than shown-but-ignored, which would have been a UI lie).
- Every batch result row has its own **Save** button wired to the same
  `saveTranslation` (`useLensData('translation', 'translation', {noSeed:
  true})`) call the single-text flow already uses — no new persistence
  surface invented, the existing "Saved translations" section (shared by
  both modes) picks up batch saves automatically.
- Honest failure path: `batchError` renders `role="alert"` with a working
  Retry, using the same `friendlyError()` mapper as the single-text flow,
  extended with two batch-specific messages (`batch_translation_malformed`,
  the `too many items` cap message) — no fabricated batch output is ever
  shown; `ok:false` from the macro always surfaces as an honest error state.
- `EMPTY` state (`translation-batch-empty` testid) is the honest
  "nothing translated yet" idle state, matching the single-text lens's
  existing EMPTY-state pattern rather than inventing a different idiom.

Verified with two new tests in `tests/translation-lens-states.test.tsx`
(BATCH: mode switch → real macro call with the exact split items, in-order
render, per-row Save → `createMock` called; BATCH ERROR: `role="alert"` +
Retry) — 7/7 passing (`npx vitest run tests/translation-lens-states.test.tsx`).

### `badNumericField` — dead but harmless defensive helper (documented, not "fixed")

`server/domains/translation.js:77-84` defines a fail-closed numeric-field
guard (rejects `NaN`/`Infinity`/negative/`>1e6` — the same pattern
`literary.js` uses to reject a poisoned `limit`/`candidateK`). It is
exported and unit-tested (`server/tests/translation.test.js`'s
`detectOffline + badNumericField unit helpers` suite) but **never called by
any of the four registered macros**:

```
$ grep -n "badNumericField" server/domains/translation.js
77:function badNumericField(input, keys) {
390:  badNumericField,
```

This is not a defect to fix, because there is nothing for it to guard: none
of `languages` / `detect` / `translate` / `batch` accept a numeric input
field (confirmed against `content/contracts/derived/translation.json` — the
derived contract's `inputs` for all four macros are `text`/`items`/
`targetLanguage`/`sourceLanguage`/`formality`, all strings or an array, zero
numerics). It reads as copy-pasted defensive infrastructure from
`literary.js` that was never wired because the domain that received it has
no numeric surface to protect. Left as-is — removing tested, harmless,
correctly-behaving code for its own sake isn't a fix, and inventing a fake
numeric parameter just to give the guard a job would be the dishonest
direction. Noted here so a future numeric macro addition to this domain
knows the guard is already available and unit-pinned.

### Authz — confirmed N/A for the four `translation.*` macros

All four macros are stateless (no `STATE.*`, `ctx.db`, `db.prepare/exec`
anywhere in the file — grep above). There is no per-user row, no shared
mutable state, and therefore no cross-user leak surface: `languages` returns
a static catalog, `detect`/`translate`/`batch` are pure request/response
transforms through the LLM with no persistence. The "missing authz" pattern
found elsewhere in Wave 3 (per-user records reachable without an ownership
check) does not apply here because there is no user-owned record in this
domain to fail to check.

The one per-user surface this *lens* touches — "Saved translations" — goes
through the **generic** lens-artifact REST routes (`GET/POST/PUT/DELETE
/api/lens/:domain`, `concord-frontend/lib/hooks/use-lens-data.ts`), not
through any `translation.*` macro. That generic runtime's authz is shared
infrastructure serving ~200 lenses and is audited under its own scope (the
Wave 3 `security` lens audit, which found and fixed an IDOR in the sibling
`lens.run`/`lens.export`/`lens.update` macro path — a different code path
than the `list`/`create`/`update`/`delete` REST routes `useLensData` calls
here). Re-auditing that shared runtime is out of scope for this lens's
capability map; it is not translation-specific.

### `tests/translation-lens-states.test.tsx` — confirmed real, passing

The page's header comment references this file; it exists
(`concord-frontend/tests/translation-lens-states.test.tsx`, pre-existing 5
tests + 2 new BATCH tests added this pass = 7 total) and drives the real
`TranslationLens` component against a mocked `lensRun`/`useLensData`,
asserting the exact shapes `server/domains/translation.js` returns (no
fabricated fixture shapes). `npx vitest run
tests/translation-lens-states.test.tsx` → 7/7 passing.

### `docs/lens-specs/translation.md` — does not exist

No older spec file was found at that path (`ls docs/lens-specs/ | grep
translation` → only this capability map and the pre-existing test file). No
stale doc to reconcile.

### Field-shape audit — clean

Every field the page reads off `res.data.result` matches what the macro
actually returns: `languages`/`formalities`/`count` (from `languages`),
`translated`/`targetLanguage`/`chars` (from `translate`),
`language`/`code`/`confidence`/`method` (from `detect`),
`translations`/`count` (from `batch`, newly wired). No hardcoded language
list masquerading as a dynamic fetch — the dropdown is populated from the
real `languages` macro call, not a client-side constant. No fake success
states — every `ok:false` path (including the two new batch ones) renders
an honest error, never a silently-empty or fabricated result.

## Verify gate

- `npx eslint app/lenses/translation/page.tsx tests/translation-lens-states.test.tsx` — 0 errors/warnings.
- `npx vitest run tests/translation-lens-states.test.tsx` — 7/7 passing.
- `node --test server/tests/translation.test.js` (from `server/`) — 27/27 passing, unchanged (backend was not modified — `translation.batch` already existed and was already correct; only the frontend caller was missing).
- `node scripts/verify-lens-backends.mjs` (repo root) — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` (repo root) — `translation`: `tier: "polished"`, `isGenericScaffold: false`, unchanged from the pre-change baseline (`pillarsPresent: 4`, `antiPatterns: 0`).
