# Feature-build walk status (resume point)

**Read this first if you're picking up where a previous session left off.**

This tracks a specific follow-up pass to `audit/LENS_DESIGN_UPGRADE_PLAN.md`'s doc-order visual-polish walk (2026-08-21). That earlier walk went through all 258 lens entries and, for each one, either fixed it, marked it reviewed/no-change-needed, or explicitly deferred a "genuine feature build" as out of scope for a polish pass. This doc tracks building those 25 deferred feature-builds, one at a time, in the same session-continuation style.

**Nothing in this pass has been built (`npm run build`) or deployed yet.** Everything below is verified via `node --check` / `tsc --noEmit` / `eslint` / the relevant test files only — real code changes sitting in the working tree, not yet bundled or pushed live. No `git commit` has been made this pass either (per standing instruction: only commit when explicitly asked) — the files are saved to disk in this pod's working directory, which is how this state survives between sessions.

## How to resume

1. Read this file's "Remaining" table below — pick the next unstarted item (in order, unless the user says otherwise).
2. For each item: read its entry in `audit/LENS_DESIGN_UPGRADE_PLAN.md` (search for the lens name) for the original finding + reasoning, find the real backend data it should be built from (don't invent data — same discipline as the 9 already done), build the real feature, typecheck + lint + run existing tests for every touched file, then:
   - Add a new dated note to `audit/LENS_DESIGN_UPGRADE_PLAN.md`'s entry for that lens (pattern: `**T1 CODE COMPLETE (<date>, feature-build follow-up pass, #N of 25):** ...` — see any of the 9 completed entries for the exact style).
   - Update the tables below (move the row from Remaining → Done, fill in the Verified column).
3. When the whole list is done (or the user says stop), that's when a batched frontend/backend build + pm2 restart happens — not before, per the user's own cost-saving instruction from earlier in this pass.

## Done (9 of 25)

| # | Lens | What was built | Files | Verified |
|---|---|---|---|---|
| 1 | `creator` | Real per-node lineage-cascade graph (not just aggregated bar counts) — backend returns actual DTU nodes + real parent-citation edges; frontend renders a real inline-SVG node-link tree | `server/lib/creator-dashboard.js` (`computeCascadeTree`), `concord-frontend/app/lenses/creator/page.tsx` (`LineageTree`) | `server/tests/creator-cascade-tree-nodes.test.js` 3/3 |
| 2 | `inference` | Syllogism tab: real 3-box derivation diagram (Major → Minor → ∴ Conclusion) replacing a raw JSON dump, + honest error state | `concord-frontend/app/lenses/inference/page.tsx` | typecheck/lint clean, no dedicated test file existed |
| 3 | `death-insurance` | Real SVG inheritance graph — pacts naming you as beneficiary (in, left) / pacts you wrote (out, right), colored by real pact status, real share % | `concord-frontend/components/death-insurance/InheritanceGraph.tsx` (new), wired into `page.tsx` | `tests/death-insurance-lens-states.test.tsx` 6/6 |
| 4 | `careers` | Real vertical SVG career-ladder path — node per real tier, filled to the real "current rung" derived from the real `skill` value vs each tier's `skillGate` | `concord-frontend/components/careers/CareerLadderPath.tsx` (new), wired into `page.tsx` | `tests/careers-lens-states.test.tsx` 12/12 |
| 5 | `linguistics` | Real IPA phoneme-segmentation + chip visualization (real IPA vowel/diacritic/tie-bar inventory, not a lookup call) | `concord-frontend/components/linguistics/IpaBreakdown.tsx` (new + `.test.ts`), wired into `page.tsx` (detail view + live create-form preview) | `IpaBreakdown.test.ts` 10/10 — **caught and fixed a real affricate-segmentation bug** |
| 6 | `experience` | New bespoke `credential-badge` icon (medallion+check+ribbon) replacing tiny generic Briefcase on the empty-portfolio state | `concord-frontend/components/icons/icon-paths.ts`, `components/experience/CareerPortfolio.tsx` | `CareerPortfolio.test.tsx` 6/6 |
| 7 | `household` | Family tab: each member card now leads with a large colored-avatar-circle + real initials (from existing `color`/`name` fields), not a 3px dot | `concord-frontend/app/lenses/household/page.tsx` | typecheck/lint clean. **Pre-existing, unrelated 3-test failure found in `ChoreBoard.tsx`** (untouched by this change, confirmed via `git diff`) — flagged, not fixed |
| 8 | `garage` | 3 new bespoke vehicle-kind icons (`cart-vehicle`, `boat-hull`, `canal-taxi`) replacing generic lucide Car/Sailboat/Ship in the fleet table | `concord-frontend/components/icons/icon-paths.ts`, `app/lenses/garage/page.tsx` | `tests/lenses/garage-page.test.tsx` 7/7 |
| 9 | `forum` | Categories re-scoped: names are free-form/user-created (no fixed enum to build per-name icons against), so each category now gets a deterministic hash-color + real-initials badge instead of one shared static folder icon | `concord-frontend/components/forum/FmCategoriesPanel.tsx` | `tests/forum-lens-states.test.tsx` 5/5 |

## Remaining (16 of 25) — in priority/risk order

**Diagram/visualization builds (same shape as #1-5 above — reuse that pattern):**

| Lens | Ask (from the doc) | Notes for whoever picks this up |
|---|---|---|
| `global` | Real choropleth map (World Bank data lens) | Data source already real (World Bank integration exists per the doc); the gap is the map rendering itself — likely needs a real geo/SVG world-map projection, more involved than the tree/graph builds done so far. |
| `logistics` | Real map-based route visualization | Check what shipment/route data the backend already exposes before building — same "verify real data first" discipline. |
| `law` | Citation-network graph (same class as `creator`/`inference`) | **Deliberately skipped this pass** — CourtListener's opinion-detail API has real `opinions_cited`/citing-opinion data, but I couldn't verify the exact field names live (no web access in this session) and didn't want to guess at an external API shape for a real network call. Whoever picks this up should verify the real CourtListener v4 opinion endpoint schema first (courtlistener.com/help/api/rest/), then reuse the same SVG-tree pattern from `creator`. |
| `astronomy` | Full Three.js celestial dome (explicitly flagged T3-scale, i.e. a genuinely large 3D engineering task) | Don't rush this one — it's real 3D scene work, budget a dedicated session for it, not a slot in a batch walk. |

**Illustration/design builds:**

| Lens | Ask | Notes |
|---|---|---|
| `creatures` | 33 bespoke species silhouettes | Large, dedicated illustration effort — 33 distinct real SVGs is a lot of surface area; consider whether a smaller representative subset + an honest "more coming" framing is more realistic per-session than trying all 33 at once. |
| `landscaping` | Real photo-based plant-identification preview | Also gated on a `TREFLE_API_KEY` (external, operator-supplied) per the original finding — check whether that's configured before investing in the UI for it. |

**Editor/interactive-tool builds (genuinely large):**

| Lens | Ask | Notes |
|---|---|---|
| `kingdoms` | Real polygon-drawing editor (the lens's own copy already discloses this as planned "v1.1") | A real interactive map/polygon editor — canvas or SVG click-to-place-vertex UI, non-trivial state management. Budget a dedicated session. |
| `dx-platform` | Real IDE-chrome visual treatment (window titlebar, tab strip, syntax-highlighted panel) | A real "mini design project," per the original note — not a quick swap. |

**Systemic/family-wide design decisions (each spans multiple lenses — decide the shared pattern once, don't reinvent per-lens):**

| Lens(es) | Ask |
|---|---|
| `ethics` (+5 siblings in its family) | Accent-color differentiation across the family |
| `fractal` (+ Studio-group family) | Accent differentiation across the Studio-group family |
| `game` | A distinct cross-cutting meta-progression visual identity |
| `grounding` | Family-wide accent differentiation |

These four are really "pick one shared accent-color-per-family convention, then apply it everywhere" — worth doing as ONE design decision + implementation pass across all four/their families, not four separate one-off changes.

**Backend/data gap (not visual — flagged ENGINEERING/DATA-SOURCING):**

| Lens | Ask |
|---|---|
| `finance` | Real external market-data feed integration — this is backend plumbing, not a frontend visualization; scope and effort unknown until someone investigates what's already there. |

**Blocked on their own prerequisite (do these LAST, after re-checking whether they're even still applicable):**

| Lens | Ask |
|---|---|
| `defense` | Was deferred "pending its own T2 re-verification" in the original walk — re-read its `LENS_DESIGN_UPGRADE_PLAN.md` entry fresh before deciding what (if anything) to build. |
| `deities` | Same — real work (reusing existing glyph/rune icons + the real base-6 glyph algebra output) once unblocked, per the original note. |

## Session discipline reminder (carried over from the parent walk)

- Every visualization must be built from REAL backend data traced end-to-end (grep the actual macro/route, read its real return shape) — never fabricate a data model to make a diagram look good. Every one of the 9 done items above followed this; several required extending a real backend function additively (e.g. `computeCascadeTree`) rather than inventing new data.
- Typecheck (`npx tsc --noEmit -p .` in `concord-frontend/`) + lint (`npx eslint <file>`) + run whatever existing test file covers the touched lens, every time, before considering an item done.
- Writing a NEW pinning test for genuinely new logic (not just UI wiring) is worth it — it caught a real bug in the IPA affricate segmentation (#5) that would otherwise have shipped broken.
- If you find a pre-existing, unrelated test failure while verifying (like `household`'s `ChoreBoard.tsx` — see #7), confirm via `git diff` that you didn't cause it, flag it honestly in both this doc and the `LENS_DESIGN_UPGRADE_PLAN.md` entry, and move on — don't silently ignore it, and don't burn the session fixing something unrelated to the current task (per CLAUDE.md's "pre-existing is an explanation, never an excuse" — reclassify as debt, name it, don't own it if it's not yours to fix right now).
