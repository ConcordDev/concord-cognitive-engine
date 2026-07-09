# answers — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("answers"' server/domains/answers.js` → 31

## Reference app + parity target

**Stack Overflow / Quora (2026 shape)** — the real best-in-class Q&A
product: ask/answer, up/down-vote, accept-answer reputation, bounties,
tag-watch + subscriptions, edit history with diffs, duplicate detection,
close-vote/reopen moderation, privilege tiers gated by reputation. This
lens had already been through a prior rebuild wave (`components/answers/`
has 14 files, 2,838 LOC, 73% bespoke — `AnswersQA.tsx` alone is a 679-line
purpose-built Q&A workbench with 9 supporting panels: `RichMarkdownEditor`,
`RevisionHistory`, `PrivilegePanel`, `NotificationsBell`, `ModerationQueue`,
`FlagButton`, `DuplicatePanel`, `RelatedSidebar`, `TagWatchPanel`). This
audit found the remaining gap was narrow, not structural.

## `node scripts/lens-unsurfaced.mjs --lens answers` (after fix)

```
answers: 0/31 macros never referenced in the frontend
```

Before this pass, 6 of 31 macros were unreferenced: `question-delete`,
`answer-delete`, `tag-list`, `search`, `user-reputation`, `feed`.

## Findings

### `question-delete` / `answer-delete` — REAL GAP (fixed)

The Q&A workspace is per-user (`server/domains/answers.js`'s state model
scopes questions/answers by the acting user — comment: "a per-user Q&A
workspace... consistent with music/message/whiteboard lens domains"), so
the asker always owns their own questions/answers. There was no way to
retract a question or answer once posted — a real, missing capability, not
a permissions question. **Fix:** added a "Delete" action next to "Edit" in
both the question-detail header and each answer's action row
(`AnswersQA.tsx`), gated by a `window.confirm`, wired to
`answers.question-delete` / `answers.answer-delete`.

### `tag-list` — REAL GAP (fixed)

`TagWatchPanel.tsx` let a user watch/unwatch tags by typing a name blind —
there was no way to *discover* which tags exist or how active they are.
`tag-list` returns per-tag `{questionCount, answeredCount}` and was never
called. **Fix:** extended `TagWatchPanel` with a "Browse tags" section
showing every tag with its counts; clicking a tag both toggles the filter
(via a new `onFilterTag` callback threaded up to `AnswersQA.tsx`) and can
still be watched from the existing watch-list UI. `AnswersQA.tsx` now
passes `tag` through to `question-list` and shows an active-filter chip.

### `user-reputation` — REAL GAP (fixed)

The dashboard already showed a numeric reputation count via `dashboard`,
but the badge tier (`newcomer`/`contributor`/`established`/`trusted`) that
`user-reputation` computes was never surfaced. **Fix:** `AnswersQA.tsx`
now fetches `user-reputation` alongside `dashboard` and renders the badge
inline next to the Reputation stat (tooltip shows asked/answered/accepted
breakdown).

### `feed` — ALREADY WIRED (false negative in the initial grep)

`page.tsx` mounts `<LensFeedButton domain="answers" />`, which calls the
domain's `feed` action generically by name — a plain-text grep for the
literal action name missed this indirection. No fix needed.

### `search` — DISPOSITION: effectively covered, not wired separately

`answers.search` does a weighted, hand-rolled relevance scan (title/body/
tag/answer-body matches) distinct from `question-list`'s simpler
title/body substring filter. The list view's search box already calls
`question-list` with a `query` param and gets a materially similar
experience. Given the marginal differentiation, this was left as a
documented, lower-priority enhancement rather than added — the honest
call is "not missing functionality a user would notice," not "fixed."

## Verify gate

- `npx eslint components/answers/AnswersQA.tsx components/answers/TagWatchPanel.tsx app/lenses/answers/page.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to these files (project-wide run had unrelated errors in other agents' concurrently-edited files: `app/lenses/daily`, `app/lenses/electrical`, `app/lenses/council`, `components/dtus/KnowledgeWorkbench.tsx` — none touch `answers`).
- `node scripts/verify-lens-backends.mjs` — `answers` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `answers`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.743`.
