# Saved Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Category leader: X (Twitter) Bookmarks + Pocket — cross-content save/read-later
with folders, tags, search, and export. `saved` is Concord's cross-lens
equivalent: save any kind of thing (social posts, DTUs, articles, lens
artifacts, links), organise into folders/collections, tag freeform,
search/sort/filter, flip read-later/archive state, export the list.

## Backend surface (real, durable, self-contained)

`server/domains/saved.js` registers 11 macros through the canonical
`register()`/MACROS path (`registerSavedMacros`, wired in `server.js`):
`saved.add`, `saved.remove`, `saved.update`, `saved.list`, `saved.stats`,
`saved.tags`, `saved.folderCreate`, `saved.folderUpdate`,
`saved.folderDelete`, `saved.folderList`, `saved.export`.

Persistence is a real relational store — migration 356 (`saved_items` +
`saved_folders`, keyed per `user_id`) reached via `ctx.db`, with a
`globalThis._concordSTATE.savedLens` in-memory fallback for minimal/test
builds (same db-or-memory facade pattern as `domains/ar.js`). Every handler
self-scopes by `ctx.actor.userId` and never throws (try/catch everywhere).
This domain and its migration were **already reachable and durable before
this Wave-3 pass** — a prior "Quote & Clip DB" commit (`925c5f00`) added
per-item A/V clip timecodes (`clipStartMs`/`clipEndMs`, ms, nullable) and an
optional provenance stamp (`provenance`, the `dtu-protocol.js#stampProvenance`
shape: `sourceUrl`/`sourceId`/`contentSha256`/`timecode`/`fetchedAt`/`signer`)
to the item schema and round-trips them through `add`/`update`/`list`.

Macro classification — all 11 DESIGNED, none GENERIC-STRIP-ONLY or
UNSURFACED, reached through bespoke components, not a button wall:
- `add` → `SaveItemForm` (bespoke inline form)
- `remove`/`update` → `SavedItemCard` (bespoke card: state cycle, tag/note
  editor, folder move, remove)
- `list` → the page's own search/sort/filter bar + item list
- `stats`/`tags` → header counts + tag-chip filter rail
- `folderCreate`/`folderUpdate`/`folderDelete`/`folderList` → `FoldersSidebar`
  (bespoke collections rail with inline rename/delete)
- `export` → header JSON/CSV download buttons

## What this Wave-3 pass found and fixed (real defect, hard-20% class)

**The Clip DB capability was backend-real but 100% unreachable from any UI.**
`clipStartMs`/`clipEndMs`/`provenance` were persisted and returned by
`saved.add`/`saved.update`/`saved.list` (verified against
`server/tests/saved-db-persistence.test.js`, which pins the full round-trip
+ validation contract), but:
- `components/saved/types.ts`'s `SavedItem` interface omitted all three
  fields — a genuine field-shape mismatch (defect class (b) from the rebuild
  brief): the JS values were present on every list response but no code
  ever read `item.clipStartMs`/`item.provenance`.
- `SaveItemForm` had no inputs to set a clip range when saving something.
- `SavedItemCard` had no rendering for either field.
- `grep -rln "clipStartMs" concord-frontend/` returned zero hits before this
  fix — confirmed with a repo-wide grep, not assumed.

Fixed within this lens's own scope (ENGINEERING — no external data
dependency, pure UI wiring to an already-real backend field):
1. `components/saved/types.ts` — added `clipStartMs`, `clipEndMs` (ms,
   nullable) and a new `SavedProvenance` type + `provenance` field to
   `SavedItem`, matching `server/domains/saved.js#publicItem`'s shape
   exactly.
2. `components/saved/SaveItemForm.tsx` — added an optional "Add a clip
   timecode" disclosure with `m:ss` start/end inputs (`timecodeToMs` parses
   `1:05`/`65`/`1:02:03`), client-side mirrors the backend's fail-closed
   validation (`clip end must be after clip start`) before submit so a
   malformed timecode never round-trips to the network only to bounce.
3. `components/saved/SavedItemCard.tsx` — renders a clip badge
   (`0:32–1:15` or `starts 0:12`) and a provenance badge (title tooltip with
   source URL / fetch time / content-hash prefix) when the fields are
   present, using real values only — no fabricated confidence score or
   invented "verified" language beyond what the stamp actually proves.

This closes the gap for the lens's own save path. Full closure (other
lenses — a video/podcast/music player wiring a real "clip this moment"
button that calls `saved.add` with `clipStartMs`/`clipEndMs`/`provenance`
pre-filled) is out of this unit's scope and is a separate ENGINEERING item
per-lens, not a `saved`-lens defect.

## Fluidity (hard invariant 5)

The lens had zero discoverable keyboard shortcuts before this pass (no
`useLensCommand` registration at all). Added three, namespaced under
`lens:saved:*`, registered via `useLensCommand` so they surface in the
existing `mod+?` keyboard-shortcuts help modal (verified: the modal reads
from the same `useKeyboard()` shortcut registry `registerShortcut` writes
into — no new discoverability surface needed):
- `n` — open the save form (kbd chip shown on the closed "Save something"
  button itself, `<kbd>N</kbd>`)
- `/` — focus the search input (placeholder text hints it: "… (/)")
- `r` — refresh (items + folders + stats)

None are `global`, so they don't fire while a user is typing in a form
field (matches the existing platform convention — see `hooks/useLensCommand.ts`'s
`enableOnFormTags` gate).

## Reference-parity checklist

| X Bookmarks / Pocket feature | Disposition |
|---|---|
| Save anything (not just posts) | ALREADY-REAL — 6 kinds (`post`/`dtu`/`article`/`artifact`/`link`/`other`) |
| Folders / collections | ALREADY-REAL — `FoldersSidebar`, create/rename/delete, live item counts |
| Tags | ALREADY-REAL — freeform, dedupe-on-save, tag-chip filter rail |
| Search | ALREADY-REAL — text search over title/author/excerpt/note/url/tags |
| Sort + filter | ALREADY-REAL — by date saved/updated/title/author, asc/desc, by kind/state/folder/tag |
| Read-later / archive states | ALREADY-REAL — 3-state cycle (unread → read → archived) |
| Export | ALREADY-REAL — JSON + CSV, client-side download |
| Clip a moment (timecode) — Pocket's "highlight," podcast-app "clip" pattern | **FIXED THIS PASS** — was backend-real, frontend-dark; now surfaced (this lens's save/display side) |
| Provenance / source-verified save | **FIXED THIS PASS** — badge with source/fetch/hash tooltip when a real stamp is present; never fabricated |
| Four honest UX states (loading/error/empty/populated) | ALREADY-REAL — `data-testid="saved-{loading,error,empty,list}"`, retry button re-issues the real call |
| Keyboard shortcuts | **FIXED THIS PASS** — `n`/`/`/`r`, discoverable via `mod+?` |

Caliber judgment: this lens already held up well against Pocket/X
Bookmarks on the CRUD-shaped 80% before this pass (real durable backend,
bespoke components throughout, honest 4-state handling, no fabricated
data). The gap this pass closed was a defining feature that was fully
built server-side and invisible client-side — exactly the class of defect
CLAUDE.md's hard-20%-closure invariant calls out. It now clears the bar
end-to-end, including the piece that most differentiates it from a plain
bookmark list.

## Verification

- `npx eslint app/lenses/saved/page.tsx components/saved/SaveItemForm.tsx components/saved/SavedItemCard.tsx components/saved/types.ts` — clean, 0 errors/warnings.
- `npx vitest run tests/saved-lens-states.test.tsx tests/genesis-saved-searches.test.tsx` — 9/9 passing (4 four-UX-state tests updated to mock `useLensCommand`, matching the established pattern used by 150+ other rebuilt lenses; genesis test is an unrelated sibling feature in the same directory, confirmed unaffected).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged, as expected — no wiring regression).
- `node scripts/grade-ux-polish.mjs --honest` — `saved`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.581`, `antiPatterns: 0`.
- No `tsc` run per standing container-OOM rule for this batch; all edits are additive/type-safe against the existing envelope shapes, reviewed by hand against `server/domains/saved.js#publicItem` field-for-field.
- `git checkout -- audit/` run after grading to avoid committing regenerated artifacts.
- Backend (`server/domains/saved.js`, migration 356) was **not modified** — no server test run was needed for this pass; the existing `server/tests/saved-db-persistence.test.js`, `saved-domain-macros.test.js`, `saved-domain-parity.test.js` already pin the exact shapes this frontend fix now consumes.
