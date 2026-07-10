# Expert Mode Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'register("expert_mode"' server/domains/expert-mode.js
```
→ **25** macros, all real, in `server/domains/expert-mode.js` (637 lines).
Note the file name is hyphenated (`expert-mode.js`) but the macro-registry
domain string is underscored (`expert_mode`) — this mismatch means
`scripts/lens-unsurfaced.mjs --lens expert-mode` reports "No registered
macros found" (its regex builds the domain-match pattern from the filename
stem, so it looks for `register("expert-mode", ...)`, which never appears).
`scripts/lens-rebuild-backlog.mjs`'s `DOMAIN_TO_LENS_ALIAS` table doesn't
cover this direction of mismatch either (it maps domain-name → lens-id for
hyphen-dropped domains, not the reverse). Verified manually instead:
`for m in answer sources_preview … share_resolve; do grep -rqE "['\"]$m['\"]"
concord-frontend/{app,components,lib} || echo "UNSURFACED: $m"; done` →
only `export_thread_markdown` unsurfaced (24/25 already wired).

Feature families (per the domain file's own header comment, a genuine
"Perplexity feature-parity" build): core cited answer (`answer`,
`sources_preview`, `extract_citations`, `focus_modes`), threaded
conversation (`ask`, `thread_list`, `thread_get`, `thread_delete`,
`related_questions`), live web search (`web_search`), Pages/Spaces
collections (`space_create/list/get/add_answer/remove_answer/share/delete`),
file/text upload as a query source (`upload_source/list/delete`,
`ask_with_upload`), and answer export (`export_markdown`,
`export_thread_markdown`, `share_answer`, `share_resolve`).

## Reference app

**Perplexity** — threaded cited research, focus modes (Academic/Writing/
Math/Video), Pages/Spaces, related questions, document upload grounding,
Markdown/link export. This lens is an explicit, faithful build against that
reference, not a generic "AI chat" surface.

## Classification (before this pass)

**Genuinely strong — the best-built lens audited so far in this wave.** Read
all 7 frontend files (1,832 lines total: `page.tsx` 451,
`AnswerActionPanel.tsx` 286, `BrainPoolStatus.tsx` 107, `ConversationTurn.tsx`
345, `FocusModeBar.tsx` 72, `SpacesPanel.tsx` 294, `ThreadSidebar.tsx` 120,
`UploadSourcePanel.tsx` 157) plus the full 637-line domain file.

1. **24/25 macros have real, live call sites** doing exactly what their
   name says — no generic artifact-store detour, no dead button walls.
   `answer`/`sources_preview` (cheap preview before committing the brain
   call, debounced 400ms), `ask` (threaded, focus-aware, live-web-toggle,
   returns grounded related questions), `thread_list/get/delete`
   (`ThreadSidebar`), `focus_modes` (`FocusModeBar`, drives the actual
   web/no-web + directive behavior, not just labels), `space_*` (full
   Pages/Spaces CRUD + share-token minting in `SpacesPanel`), `upload_*` +
   `ask_with_upload` (`UploadSourcePanel`, grounds an answer in pasted
   document text, cited as `[U]`), `export_markdown` + `share_answer`
   (per-turn "Copy as Markdown" / "Share link" in `ConversationTurn`),
   `share_resolve` (resolves a `?answer=` / `?space=` URL param into a
   read-only shared view on load), `extract_citations` (`AnswerActionPanel`,
   parses `[N]` chips out of an answer).
2. **`AnswerActionPanel` wires 3 macros from OTHER domains honestly** —
   `dtu.create` (Save Q+A as a private lineaged DTU / Publish as a public
   one, both with real recall/undo windows via `useRecallableAction`),
   `/api/social/dm` (send the full cited answer to a colleague), and
   `chat_agent.do` (agent proposes the next-best follow-up question). All
   three make real network calls with honest error surfacing
   (`pickMessage`), not simulated success.
3. **No fabrication signatures**: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/expert-mode/page.tsx components/expert-mode/*.tsx` → zero hits. `BrainPoolStatus` hits a real endpoint
   (`GET /api/brain/status`, confirmed at `server.js:56736`) with an honest
   "No brains reported" / "unreachable" empty/error state.
4. **The one genuine gap**: `export_thread_markdown` (export a whole
   conversation thread as one combined Markdown document, distinct from the
   existing per-turn "Copy as Markdown") had no UI anywhere —
   `ThreadSidebar` had per-thread open/delete but no export, and
   `ConversationTurn`'s export button only ever calls the per-turn
   `export_markdown`. A real, small, natural feature (the multi-turn
   equivalent of ChatGPT/Perplexity's "export conversation") with zero
   reachable path. Backend-side, it already had test coverage
   (`server/tests/expert-mode-domain-parity.test.js:331`) — this was purely
   a missing frontend door, not an unverified macro.

## What changed

- **`concord-frontend/components/expert-mode/ThreadSidebar.tsx`** — added a
  per-thread "Export thread as Markdown" download button (next to the
  existing delete button, same hover-reveal treatment) that calls
  `expert_mode.export_thread_markdown` and triggers a real browser file
  download (`Blob` + object URL + a synthetic anchor click), filename
  derived from the thread title. No backend change needed — the macro
  already existed and was already tested.

## Verification

- `cd concord-frontend && npx eslint components/expert-mode/ThreadSidebar.tsx` — clean, exit 0.
- `cd server && node --test tests/expert-mode-domain-parity.test.js tests/expert-mode.test.js` → `32 pass / 0 fail` (pre-existing `export_thread_markdown` backend test already covers the macro this pass surfaced).
- `node scripts/verify-lens-backends.mjs` → unaffected, `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260.
- Manual re-grep of all 25 macro names across the frontend confirms
  `export_thread_markdown` is now referenced (was the only miss).
- Did not touch `server/domains/expert-mode.js` or any of the other 6
  frontend files — no further gap found in any of them after a full read.
- Project-wide `tsc --noEmit` left to the orchestrator's single end-of-wave
  run, per the task's instructions (spot-checked with a domain-scoped
  filter during this pass and clean).
