# Forge Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface — split across THREE registration sites (tooling gap)

Forge is the one lens in this wave whose macros for a single domain string
(`"forge"`) are **split across `server/domains/forge.js` and four separate
inline sites in `server/server.js`**. This defeats the standard audit tool:

```
grep -c 'registerLensAction("forge"' server/domains/forge.js   # → 13
grep -n  'register("forge"'          server/server.js          # → 9
```

- **`server/domains/forge.js`** (763 lines) — **13** macros via
  `registerLensAction`: `createProject`, `refine`, `thread`, `versions`,
  `diff`, `restoreVersion`, `files`, `regenerateSection`, `sandbox`, `share`,
  `openShare`, `fromImage`, `listProjects`. This is the **v0.dev / Bolt.new
  interaction model** — iterative app builder.
- **`server/server.js`** — **9** more macros under the *same* `"forge"`
  domain string, at four unrelated line clusters:
  - `verify_constraints` (`server.js:16626`) — a publish-gate helper.
  - `manual`, `hybrid`, `auto` (`server.js:24870`–`24908`) — legacy
    prompt→DTU "forge a knowledge unit" macros.
  - `fromSource` (`server.js:28538`) — legacy web-source→DTU macro.
  - `list`, `sections`, `validate`, `generate` (`server.js:32066`–`32084`) —
    the template-catalogue / generator cluster (Phase B / 6a wire-up).

**Tooling blind spot (documented per task-brief precedent):**
`node scripts/lens-unsurfaced.mjs --lens forge` only reads
`server/domains/forge.js`, so it sees **13 of the 22** macros and is blind to
the 9 registered inline in `server.js`. Same failure mode as the
`filmstudios.js` filename mismatch, except here it's **split-across-files**
rather than differently-named. All 9 server.js macros were checked manually
against the frontend with the same loose token-match the script uses.

**22 unique macros total** — confirmed no name collisions between the two
sites (`server.js` uses `list`/`sections`/`validate`/`generate`;
`domains/forge.js` uses `createProject`/`refine`/… — disjoint sets).

There is ALSO a parallel `/api/forge/*` REST surface
(`server/routes/forge.js`, mounted at `server.js:32058`) exposing
`templates`/`sections`/`generate`/`validate`/`export`/`repair-log`/
`check-avoidance`. `ForgeWorkbench` calls this REST route directly (via
`fetch`), NOT the `runMacro` path — the four macros are runMacro *parity*
wrappers over the same `lib/forge-template-generator.js` engine, so a
capability reached only via REST still counts as a real designed feature.

## Reference apps

**v0.dev** (describe/refine an app conversationally, iterate on versions) +
**Bolt.new** (in-browser full-stack scaffold with a live preview + shareable
project link + "your projects" resume). Parity target: describe an app → get
a polyglot single-file generated app with **iterative refinement, version
history + diff, component-level regeneration, live preview sandbox, a
shareable link that actually opens, image/screenshot → starter config, and
project resume**. The distinctive Concord twist (honest by construction):
refinement is a **deterministic transform engine** over real generated code,
not an LLM hallucination — every edit is reproducible and the diff is
computed server-side.

## Classification (before this pass)

Read in full: `app/lenses/forge/page.tsx` (159 lines), `ForgeStudio.tsx`
(800 lines — the iterative builder), `ForgeWorkbench.tsx` (706 lines — the
13-subsystem config/generate/preview/export surface), `TemplateCatalogue.tsx`
(73 lines), `PublishForgeAppDialog.tsx` (234 lines).
`grep -ni "math.random\|mock\|fake\|lorem\|placeholder"` across the forge
frontend → **zero fabrication hits** (only a doc comment reading "No mock
data" and an sr-only accessibility sentinel). No generic
`<UniversalActions>` / `<LensFeaturePanel>` button wall anywhere — every
surfaced macro is behind a real designed form with a real rendered result.

Of the **22** macros:

**ALREADY REAL & DESIGNED — 15**

*App-builder cluster (11 of 13 in `domains/forge.js`):*
`createProject` (name + template picker → generate) · `refine`
(conversational recolour/rename/port/banner/strip-console → forks a version)
· `thread` (refinement conversation log) · `versions` (history list +
timeline) · `diff` (line-level, two-version selector, +/- rendering) ·
`restoreVersion` (restore a past version) · `files` (multi-file project
tree + per-file viewer) · `regenerateSection` (per-subsystem regenerate) ·
`sandbox` (live manifest preview in a sandboxed iframe) · `share` (mint a
share link — *see gap below: the mint side only*) · `fromImage`
(caption + detected-label hints → recommended template + domain tables).

*Template/generator cluster (4 in `server.js`):* `list` (TemplateCatalogue,
via `forge.list` macro) · `sections` (ForgeWorkbench, via `/api/forge/sections`
REST) · `validate` (ForgeWorkbench, via `/api/forge/validate` REST) ·
`generate` (ForgeWorkbench, via `/api/forge/generate` REST).

**BACKEND-CAPABLE-BUT-UNSURFACED — 2 real gaps (fixed this pass)**

1. **`openShare`** — a genuine **dead path**. `share` mints a
   `/lenses/forge?share=<token>` URL and the "Copy" button implies success,
   but **nothing in the frontend read `?share=` or called `openShare`**
   (`grep -rn "openShare\|?share=" app/lenses/forge components/forge` → zero
   hits before this pass). Every shared link silently loaded the plain
   builder — the exact "share link that implies success but goes nowhere"
   defect class CLAUDE.md's zero-demo-content invariant calls out. The
   backend is fully real and round-trip tested (share → openShare by a
   *different* user, `forge-lens-domain-parity.test.js`).
2. **`listProjects`** — real backend (returns all of a user's server-side
   projects) with **no UI**. Forge projects live in in-memory
   `STATE.forgeLens` keyed by userId (they survive server-side across a page
   reload), but the frontend had no way to reopen one — a reload stranded the
   user on a blank create form. `RecentMineCard domain="forge"` does NOT
   cover this: it reads the generic `forge.recent_mine` DTU macro, not the
   in-memory project store.

**GENUINELY OUT OF SCOPE / not surfaced by design — 5**

- **`verify_constraints`** (`server.js:16626`) — a niche publish-gate that
  surfaces constraint blockers as a typed list. Not part of the v0/Bolt
  interaction model; left unsurfaced (documented, low value in this lens).
- **`manual`, `hybrid`, `auto`, `fromSource`** — these are a **different
  product** that happens to share the `"forge"` domain string: the *legacy
  prompt/source → knowledge-DTU* "forge" (CRETI-pack a prompt into a DTU,
  auto-derive summary/risks/next-steps, cite a web source). They predate the
  app-generator meaning, are reached via their own `/api/forge/{manual,
  hybrid,auto,fromSource}` REST routes (`server/routes/domain.js`) and a
  mobile "Quick Forge" action, and would be **confusing** if mixed into the
  app-builder lens ("generate an app" vs "convert a prompt into a knowledge
  unit" are unrelated). Left alone deliberately.

## What changed

- **`concord-frontend/components/forge/ForgeSharedView.tsx`** (new, 214
  lines) — reads `?share=<token>` from the URL (client-only, no Suspense
  boundary needed), calls `forge.openShare`, and renders the shared app
  **read-only**: app identity badges, the partitioned file tree with line
  counts, copy-source / download-`.mjs` actions, and the real sandbox
  manifest document in a sandboxed iframe — plus an honest "no longer
  available" state when the token is stale. Renders `null` when the page
  wasn't opened via a share link. Closes the dead-path half of `share`.
- **`concord-frontend/app/lenses/forge/page.tsx`** — mounts
  `<ForgeSharedView />` above the builder so a shared link now resolves.
- **`concord-frontend/components/forge/ForgeStudio.tsx`** — added a
  **"Resume a project"** surface on the create screen (`forge.listProjects`):
  loads the user's projects whenever the builder is at the no-project state,
  shows appName / template / version-count / relative-time per row, and
  reopens on click. Reopen rehydrates the full builder by calling
  `restoreVersion` on the current version (the one call that returns the code
  string for a project the client doesn't hold locally) then refreshing
  files / thread / versions. Optimistic per-row spinner; refresh button.
- **`server/tests/forge-lens-domain-parity.test.js`** — +2 tests pinning the
  two contracts the new UI depends on: `restoreVersion` returns a non-empty
  `code` string (the reopen rehydration path), and `listProjects` returns the
  exact metadata fields the resume list renders.

## Verification

- `cd concord-frontend && npx eslint components/forge/ForgeSharedView.tsx components/forge/ForgeStudio.tsx app/lenses/forge/page.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `forge` — 0 errors.
- `cd server && node --test tests/forge-lens-domain-parity.test.js tests/forge-wire.test.js` → **47 pass / 0 fail** (parity 22, was 20 → +2 new; wire 15; 0 regressions).
- Manual re-grep of the 2 fixed macro names: `openShare` + `listProjects` now surfaced; `verify_constraints`, `manual`, `hybrid`, `auto`, `fromSource` remain unsurfaced by design (documented above).
- Left untouched: `ForgeWorkbench.tsx`, `TemplateCatalogue.tsx`,
  `PublishForgeAppDialog.tsx` — all already real, designed, and fabrication-free.
