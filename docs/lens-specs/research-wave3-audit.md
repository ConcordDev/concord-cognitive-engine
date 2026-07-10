# research — Wave 3 unsurfaced-macro audit

Frontend Rebuild Program, Wave 3. `research` scored `polished` under
`grade-ux-polish.mjs --honest` (dodges the generic-scaffold detector), but
`node scripts/lens-unsurfaced.mjs --lens research` flagged 7/54 macros with
zero frontend references:

```
reference-* (3): reference-relate, reference-related, reference-update
annotation-* (1): annotation-list
cite-* (1): cite-format
note-* (1): note-snapshot-get
tag-* (1): tag-list
```

Method: read every listed macro's implementation in `server/domains/research.js`,
then read every component under `concord-frontend/components/research/` and
`concord-frontend/app/lenses/research/page.tsx` in full to check whether the
capability is actually reachable some other way before concluding it's a gap.

## Findings

### `reference-update` — REAL GAP (fixed)
`server/domains/research.js:736` lets a caller patch title/authors/year/journal/doi/tags
on an existing reference. `ResearchLibraryPanel.tsx` (pre-fix) only called
`reference-add` (create), `reference-delete`, and `reference-set-status` — there
was no way to correct a typo or add tags to a reference after saving it short of
deleting and re-adding. Genuine missing feature.

**Fix:** added an inline edit mode on the reference-detail view (`Pencil` button →
form with the same fields as "Add" → `reference-update`). Wired through
`startEdit`/`saveEdit` in `ResearchLibraryPanel.tsx`.

### `tag-list` — REAL GAP (fixed)
`server/domains/research.js:792` aggregates tag→count across a user's library.
References already carry a `tags` array (visible as static chips on each list
row), but nothing called `tag-list` and there was no way to filter the library
by tag — only free-text search (`reference-list`'s `query` param, which already
had a `tag` param too, also unused by the frontend). A tag taxonomy that can't
be browsed is dead weight.

**Fix:** `ResearchLibraryPanel.tsx` now fetches `tag-list` on load and renders a
row of clickable tag chips (with counts) above the library list; clicking one
sets `activeTag` and re-runs `reference-list` with `{ tag }`.

### `reference-relate` / `reference-related` — REAL GAP (fixed)
`server/domains/research.js:852,871` — Zotero-style cross-linking between two
references in a user's own library (mutual, undoable via `unrelate: true`).
Every reference already carries a `relatedIds` array, but no component ever
read or wrote it. This is a distinct, load-bearing feature Zotero users expect
("see also") and it had literally 0% UI coverage.

**Fix:** added a "Related references" section to the detail view — a picker to
link another reference from the same library (`reference-relate`), a list of
currently-linked ones (`reference-related`, refetched after link/unlink), and an
unlink (X) button per item (`reference-relate` with `unrelate: true`).

### `cite-format` — PARTIAL GAP (fixed)
`reference-detail` already returns `apa`/`mla`/`bibtex` citations inline (that's
why `cite-format` looked unused — the equivalent data was already surfaced a
different way for those three styles). But `formatCitation` in the domain file
also supports a fourth style, `chicago` (`server/domains/research.js:653`), which
`reference-detail` does NOT include — `cite-format` is the only macro that can
produce it. The citations panel was silently missing an entire supported style.

**Fix:** `openRef` now additionally calls `cite-format` with `style: 'chicago'`
and merges the result into the citations block, so all four styles the backend
actually supports are shown (previously three of four).

### `annotation-list` — FALSE POSITIVE (no change)
`server/domains/research.js:901` returns a user's annotations, optionally
filtered by `referenceId`. `reference-detail` (`:714`) already returns
`annotations` pre-filtered to the open reference — which is exactly the shape
`ResearchLibraryPanel` renders in the detail view. The static-grep detector
can't see that `reference-detail`'s inline annotation list satisfies the same
UI need `annotation-list` would; there's no unmet capability here for the
current per-reference annotation view. (An "all annotations across every
reference" browsing mode is imaginable but not demanded by any existing UI
element or user flow — not treated as a gap.) No change made.

### `note-snapshot-get` — REAL GAP (fixed)
`server/domains/research.js:1102` returns a specific note snapshot's full body.
`ResearchWorkbench.tsx`'s note-history panel listed snapshots (via
`note-snapshots`, metadata only: timestamp/label/char-count) and let the user
`note-restore` blind — there was no way to see what a version actually
contained before overwriting the live note with it.

**Fix:** added a per-snapshot "Preview" toggle that calls `note-snapshot-get`
and renders the historical body inline before the user commits to Restore.

## Files touched
- `concord-frontend/components/research/ResearchLibraryPanel.tsx` — edit form,
  tag filter chips, related-references section, chicago citation.
- `concord-frontend/components/research/ResearchWorkbench.tsx` — snapshot
  preview.

No generic button walls were added — every new control is a designed field of
the existing detail/edit surfaces, wired to the specific macro it exercises.
