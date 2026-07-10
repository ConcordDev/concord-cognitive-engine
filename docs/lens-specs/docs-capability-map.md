# Docs Lens — Capability Map (Frontend Rebuild Program, Wave 3 — confirming, no changes)

Reproduce the macro list: `grep -c 'registerLensAction("docs"' server/domains/docs.js` → 42
Reproduce unsurfaced check: `node scripts/lens-unsurfaced.mjs --lens docs` → `docs: 0/42 macros never referenced in the frontend`

## Reference apps

- **Notion** — nested pages, block editor, databases/views, comments,
  version history, backlinks, sharing/permissions.
- **Confluence** — page hierarchy, templates, mentions graph.

Parity target: "the only difference should be workspace size, nothing
else." This lens is flagged by the orchestrator as a large/important
documentation-management lens warranting thorough audit — it received the
full per-macro cross-check below, not a spot-check.

## Audit finding: already a comprehensive, honest Notion-class workspace — every one of 42 macros is genuinely wired

`components/docs/DocsWorkspace.tsx` (383 LOC) is the centerpiece: nested
page tree (create/list/detail/update/delete/move), a real block editor
(`BlockEditorRow.tsx`, add/update/delete/reorder blocks), full-text search
(`docs-search`), a live workspace dashboard (`docs-dashboard` — page count,
total blocks, open/done to-dos, word count, all computed server-side from
real block data, not client-guessed), version snapshot/list/restore
(`VersionHistoryPanel.tsx`), threaded comments with resolve
(`CommentsPanel.tsx`), a suggestion-accept flow, live multi-user presence
(`usePagePresence.ts` — ping/list/leave), database views (`DatabaseViews.tsx`
— create/list/detail/delete/column-add/row-add/row-update/row-delete, an
Airtable-style grid), templates (`TemplatePicker.tsx`), a backlinks panel
and a mentions graph (`BacklinksPanel.tsx`), and page sharing with invite/
revoke (`SharePanel.tsx`). A separate "AI Document Analysis" panel in
`page.tsx` wires 3 more macros (`readabilityScore`, `crossReference`,
`versionDiff`) each with its own bespoke result rendering (Flesch score
gauge, cross-reference list, version diff), the same idiom already
established in `debate`/other rebuilt lenses' AI-action panels.

Per-macro cross-check (all 39 STATE-based macros + all 3 AI macros
individually grepped against `app/lenses/docs` + `components/docs`; every
one returns ≥1 hit):

```
page-create/list/detail/update/delete/move   → DocsWorkspace.tsx
block-add/update/delete/reorder              → BlockEditorRow.tsx
docs-search, docs-dashboard                   → DocsWorkspace.tsx / page.tsx
version-snapshot/list/restore                 → VersionHistoryPanel.tsx
comment-add/list/resolve/delete               → CommentsPanel.tsx
suggestion-accept                             → DocsWorkspace.tsx
presence-ping/list/leave                      → usePagePresence.ts
db-create/list/detail/delete/column-add/row-add/row-update/row-delete → DatabaseViews.tsx
template-list/apply                           → TemplatePicker.tsx
backlinks, mentions-graph                     → BacklinksPanel.tsx
share-set/get/invite/revoke                   → SharePanel.tsx
readabilityScore/crossReference/versionDiff   → page.tsx AI Analysis panel
```

No `Math.random()` in a render path, no hardcoded placeholder arrays, no
generic-scaffold body found across the 13 files (2,850 total component LOC
+ 1,021 page LOC).

## Checklist

| Item | Disposition |
|---|---|
| Nested pages + block editor | ALREADY REAL |
| Full-text search | ALREADY REAL |
| Live workspace dashboard (computed, not fabricated) | ALREADY REAL |
| Version history + restore | ALREADY REAL |
| Threaded comments + resolve + suggestion-accept | ALREADY REAL |
| Live multi-user presence | ALREADY REAL |
| Database views (Airtable-style grid) | ALREADY REAL |
| Templates | ALREADY REAL |
| Backlinks + mentions graph | ALREADY REAL |
| Page sharing (set/get/invite/revoke) | ALREADY REAL |
| AI document analysis (readability/cross-ref/version-diff) | ALREADY REAL |

Every one of the 42 registered macros closes as ALREADY REAL. No
GENUINELY MISSING items found; no changes made.

## Verification

- `node scripts/verify-lens-backends.mjs` — `docs`: `WIRED` (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — `docs`: `tier: "polished"`,
  `isGenericScaffold: false`, bespoke ratio 0.615 (10 files, 2,652 LOC
  total, 1,630 LOC bespoke-component).
