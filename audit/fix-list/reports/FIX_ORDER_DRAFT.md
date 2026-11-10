# DRAFT builder fix order — Concord live lens audit

**This is a draft.** The walk is not complete (204 of 267 lenses DONE as of 2026-11-10 6:40 AM ET). Dutch's rule: builders start fixing only after the full walk is finished, then clear the whole ticket list. Refresh these counts from `fix_tickets.jsonl` before the real pass. Highs first, grouped by shared component, with the few design calls for Dutch at the top.

Ticket source: 2,145 unique ids in `fix_tickets.jsonl`, later lines merged field-by-field. Severity after merge: **220 high, 945 medium, 979 low, 1 unrated**. Almost all are still OPEN. Three are FIXED_PENDING_VERIFY (FIX-chat-006, FIX-chat-007, FIX-government-006). Honor follow-up flags: FIX-automotive-001 NOT_REPRODUCED, FIX-hvac-002 RETRACTED/REVERIFIED_OK, FIX-plumbing-007 SUPERSEDED, FIX-bridge-001 downgraded to low.

RCA totals below use explicit `RCA-*` tags in titles and `root_cause` / `rca` fields, with aliases merged (`RCA-empty-export` / `RCA-export-empty` → `RCA-export-nothing`; `RCA-esc-focus` → `RCA-escape-focus-trap`; `RCA-delete-confirm` → `RCA-missing-delete-confirm`; dated hotkey/contrast tags folded into the parent RCA).

---

## 0. Design calls for Dutch (do these first)

Do not start a cosmetic or "just remove it" fix until Dutch answers.

1. **FIX-black-market-010** (high, OPEN, marked **design**) — Kid-suitability: intercepted private messages, payload decryption, and black-market framing on a platform meant to be kid-friendly (Dutch's nephews play). Content is simulated and labelled Sparks only, but the framing itself is the concern. Related highs on the same lens: FIX-black-market-007 (Ask contradicts the Sparks-only copy), FIX-black-market-005 (auction min bid / duration accept negative and huge values), FIX-black-market-006 (Ask appends to the wrong thread).
2. No other ticket is explicitly tagged `(design)`. Nearby product calls, not formally marked, that Dutch may want in the same sitting:
   - Whether opening Council should auto-join the shared voter pool (FIX-council-008).
   - Whether a published storefront with no products should expose the whole catalog (FIX-retail-002) — also a security default.
   - Whether Foundry / World Creator may mint a live public world with no unpublish/delete path (FIX-foundry-007, FIX-world-creator-013).

---

## 1. Highs, grouped by shared root cause

### 1a. RCA-form-hotkey-steal — 42 tickets (14 high, 20 medium, 8 low)

Bare-letter lens shortcuts and Space/Enter on `role="button"` dialogs steal keystrokes from create forms, close dialogs, or jump tabs. This is why council, household, trades, and several other lenses are still BLOCKED.

**Fix target:** `hooks/useLensCommand.ts` (form-tag / focus guard) plus stop keydown on modal `role="button"` wrappers from bubbling out of inputs. Diagnosis: `reports/RCA-form-hotkey-steal-2026-11-09.md`. A masonry ContractorSuite comment already shows the Space/Enter fix pattern.

**High tickets (tagged):** FIX-agents-008, FIX-aviation-012, FIX-council-009, FIX-environment-001, FIX-ethics-005, FIX-government-006 (FIXED_PENDING_VERIFY — re-check before closing), FIX-markets-006, FIX-photos-001, FIX-science-001, FIX-security-002, FIX-services-001, FIX-sim-001, FIX-voice-003, FIX-wallet-001.

**Lenses (high, tagged):** agents, aviation, council, environment, ethics, government, markets, photos, science, security, services, sim, voice, wallet.

**Same pattern, high, not tagged:** FIX-003 (food), FIX-004 (trades; same as FIX-trades-001), FIX-healthcare-004, FIX-household-002.

Fixing the shared hook should unblock council, household, and trades for a re-walk.

### 1b. RCA-missing-delete-confirm — 69 tickets (11 high, 28 medium, 30 low)

Deletes have no confirm, a confirm that vanishes or reverts before it can be clicked, or no delete control at all. HVAC's confirmed t1 bug is the vanishing in-row confirm (FIX-hvac-013 / 015 / 001).

**Fix target:** one shared delete control: named confirm, no auto-dismiss, undo or equivalent, and an actual delete path on every record type the user can create. Until that ships, testers cannot clean many leftovers.

**High tickets (tagged):** FIX-creator-002, FIX-landscaping-002, FIX-masonry-001, FIX-masonry-015, FIX-masonry-017, FIX-pharmacy-009, FIX-plumbing-001, FIX-plumbing-010, FIX-plumbing-011, FIX-plumbing-012, FIX-plumbing-013.

**Lenses (high, tagged):** creator, landscaping, masonry, pharmacy, plumbing.

**Same idea, high, often untagged:** FIX-classroom-002, FIX-creative-writing-001, FIX-disputes-003, FIX-education-010, FIX-legal-001, FIX-mental-health-001, FIX-move-builder-008, FIX-paper-006, FIX-pharmacy-013 (orphaned refill after archive), FIX-questmarket-001, FIX-supplychain-001 (instant delete, no undo; already deleted a pre-existing scenario), FIX-foundry-007, FIX-world-creator-013.

### 1c. RCA-export-nothing — 77 tickets (4 high, 49 medium, 24 low)

The shared Export menu reports "Nothing to export yet" (or downloads an empty/unrelated file) while the lens clearly has panel records. Finance is the dangerous inverse: it dumps other lenses.

**Fix target:** the shared Export menu / packager must export that lens's own panel records, scoped to the current user, and must not pull other lenses or other people's Chat Context. Also finish the encrypted-archive decrypt bug (section 1g). See `reports/SEC-export-system-dtu-leak-2026-11-09.md`.

**High tickets (tagged empty-export):** FIX-all-001, FIX-landscaping-006, FIX-pharmacy-006, FIX-plumbing-002.

**Related highs, untagged or different symptom:** FIX-finance-004 (unscoped dump — privacy), FIX-productivity-002 (omits tasks/projects), FIX-music-001 (export is mostly silence), FIX-paper-002 (PDF export is a truncated .txt), FIX-export-001 (encrypted archive will not decrypt).

### 1d. RCA-contrast-theme-tokens — 72 tickets (8 high, 21 medium, 43 low)

Light/dark theme tokens compute dark-on-dark or near-black surfaces, so labels and controls are unreadable.

**Fix target:** shared theme tokens (`text-white` / `text-zinc-*` and background pairs). Diagnosis: `reports/RCA-contrast-theme-tokens-2026-11-09.md`.

**High tickets (tagged):** FIX-automotive-015, FIX-billing-001, FIX-black-market-002, FIX-creatures-008, FIX-dreams-005, FIX-ethics-008, FIX-marketing-004, FIX-markets-009.

**Lenses (high, tagged):** automotive, billing, black-market, creatures, dreams, ethics, marketing, markets.

**Same pattern, high, not tagged:** FIX-calendar-001, FIX-household-004, FIX-personas-009, FIX-sim-002.

### 1e. RCA-mobile-clip-fab — 57 tickets (2 high, 23 medium, 32 low)

At official 390×844, tab strips clip and the FAB or primary actions sit under the fixed bottom nav.

**Fix target:** shared lens shell / bottom nav / FAB offset at 390px (z-index and safe-area), not one-off padding in each lens. Also covers untagged mobile highs such as FIX-006, FIX-015, FIX-board-012, FIX-calendar-010, FIX-creative-writing-006/009, FIX-education-006/007, FIX-personas-007, FIX-studio-005, FIX-black-market-003.

**High tickets (tagged):** FIX-disputes-008, FIX-telecommunications-009.

### 1f. RCA-escape-focus-trap — 112 tickets (0 high, 64 medium, 48 low)

Escape does not close Share, Export, or other dialogs; focus is not trapped or restored. No highs are tagged, but this is the largest single RCA and should ride with the shared modal work.

**Fix target:** one shared Modal/dialog (focus in, trap, Escape closes, focus returns). Today almost no lenses share a real Modal; many roll their own.

### 1g. Security, privacy, and data-loss highs (mixed RCA; fix as their own package)

Do these with a security review, not as drive-by UI tweaks. Details are in `HANDOFF_2026-11-10.md`.

| Id | Lens | Note |
|---|---|---|
| FIX-export-001 | export | Encrypted archive will not decrypt with the correct password |
| FIX-finance-004 | finance | Unscoped JSON/CSV may include other lenses and other people's Chat Context |
| FIX-retail-002 | retail | Empty published storefront exposes the whole catalog |
| FIX-whiteboard-001 | whiteboard | Code-read only: socket join is auth-only, no membership check |
| FIX-whiteboard-002 | whiteboard | Code-read only: join-shared adds anyone with the board id |
| FIX-pharmacy-008 | pharmacy | Date picker turns 2026 into 52026 when the time is edited |
| FIX-music-001 | music | Export is ~17 s of silence with audio only at the end |
| FIX-crafting-001 | crafting | Publish is one click, no confirm |
| FIX-sentinel-001 | sentinel | Already alerted: shared Shield score slashed, no retract |
| FIX-xl-ws-001 | cross-lens | Global DTU emit without user scoping (code-side) |
| FIX-council-008 | council | Opening the lens silently adds the viewer to the shared voter pool |
| FIX-mail-011 | mail | Unresolved recipient still sends mail and a CC gift |
| FIX-cognition-009 | cognition | `/dtu/<id>` fails for a signed-in non-owner |
| FIX-fitness-001 | fitness | Related privacy (see ticket) |
| — | construction | Contract value 1000→1100 saved as $10,001,100 (evidenced, no FIX id) |

Also close out hidden AI-agent text on pages (findings on graph, calendar search, Lens Hub; FIX-byo-keys-001 downgraded to low/UNPROVEN). Isolate the DOM node before treating it as a live injection.

### 1h. Persistence and data-corruption highs

Saves that do not stick, stale aggregates, or values that mutate on edit. **Fix target:** shared list/detail fetch after save, and numeric/date inputs that replace (not concatenate) the previous value. Re-verify anything flagged for the session flip before spending a large fix.

Examples (high unless noted): FIX-board-001, FIX-chat-002, FIX-classroom-001, FIX-carpentry-001, FIX-code-001, FIX-landscaping-009, FIX-pharmacy-008, FIX-pharmacy-013, FIX-services-002, FIX-voice-002, FIX-finance-002 (net-worth math), FIX-finance-003 (cash-flow sign/amount), FIX-healthcare-002 (Temp 200 stored as 2), FIX-legal-002 (huge time entry accepted and then hidden). FIX-automotive-001 was high but is NOT_REPRODUCED on zuko_qa_t1. FIX-electrical-007 and FIX-veterinary-012 are medium and may still need a t1 re-check after the session flip.

### 1i. RCA-ask-silent — 22 tickets (2 high, 15 medium, 5 low)

Ask fails silently, or appends to an unrelated Link Frontier / Chat thread.

**Fix target:** Ask must open or reuse a thread for the current lens, not silently append to whatever chat is already open, and must show a real error instead of vanishing.

**High, tagged:** FIX-fractal-001, FIX-hvac-004.

**High, same routing bug, untagged:** FIX-black-market-006, FIX-marketing-003, FIX-all-002 (raw `run_lens_action` / `db.status` admin error), FIX-goals-001, FIX-staking-009, FIX-voice-004, FIX-goddess-001, FIX-ethics-001, FIX-ar-014, FIX-crisis-ops-001.

### 1j. Dead controls, missing create paths, loading / 404

Headline actions that do nothing, pages that error on load, or missing workbenches. **Fix target:** per-lens after the shared shell work, except where a common pattern appears (FAB no-op, error boundary on empty state).

Examples: FIX-landscaping-008 (New design FAB is a no-op — the lens's main job cannot start), FIX-disputes-010 (File a case FAB is a no-op), FIX-retail-001 (no product create UI), FIX-whiteboard-004 (load error for a user with no boards — this one also blocks the lens), FIX-podcast-006 (audio upload never attaches), FIX-lock-007 (deadlock detector never receives events), FIX-offline-001/002, FIX-achievements-001, FIX-announcements-001 (403 masked as empty), FIX-expedition-journal-001, FIX-mesh-001/002, FIX-realestate-001, FIX-security-001, FIX-marketplace-001, FIX-aviation-002, FIX-creatures-001/002, FIX-database-001 (tab crash), FIX-meta-001 (tab crash, unvirtualized 3973 rows), FIX-voice-001 (Aw, Snap).

### 1k. RCA-arrow-tablist — 8 tickets (0 high, 3 medium, 5 low)

ArrowRight on tablists does not move focus. No highs. Fix with the shared tablist component; include it in the a11y pass.

### 1l. Other remaining highs

After the groups above, a few highs are still one-off product bugs (insurance deductible ignored, death-insurance double-charge, staking early-exit with no confirm, nonprofit gifts not counting, ML inference/AutoML unwired, social unfollow missing, and similar). Work those after the shared-component batches, still high-first, grouped by lens family when two tickets share a desk (for example plumbing/masonry/hvac contractor suites).

---

## 2. Mediums and lows, same groups (counts only)

Do these after the highs in each group, while the shared component is already open. Do not open a second pass per lens until the shared fix is in.

| Group | Medium | Low | All (incl. high) |
|---|---|---|---|
| RCA-escape-focus-trap | 64 | 48 | 112 |
| RCA-export-nothing (aliases merged) | 49 | 24 | 77 |
| RCA-contrast-theme-tokens | 21 | 43 | 72 |
| RCA-missing-delete-confirm | 28 | 30 | 69 |
| RCA-mobile-clip-fab | 23 | 32 | 57 |
| RCA-form-hotkey-steal | 20 | 8 | 42 |
| RCA-ask-silent | 15 | 5 | 22 |
| RCA-arrow-tablist | 3 | 5 | 8 |
| RCA-listing-needs-owned-item | 0 | 0 | 1 (high: FIX-auction-001) |

Many untagged mediums and lows will collapse into the same buckets once a builder greps for "Nothing to export", "Escape does not", "390", and "no confirm". A second keyword pass after the RCA-tagged work is enough; do not treat every untagged ticket as unique.

---

## 3. Suggested batch order (when the walk is actually done)

1. Dutch answers the design calls in section 0.
2. Shared `useLensCommand` + modal Space/Enter (1a) — unblocks several BLOCKED lenses for re-walk.
3. Shared Modal Escape/focus (1f) and theme tokens (1d) — large medium/low clear-out for little extra risk.
4. Shared Export packager + encrypted decrypt (1c, 1g export items).
5. Shared delete confirm / missing delete (1b), including the vanishing HVAC confirm.
6. Mobile 390 shell / FAB (1e).
7. Ask thread scoping (1i).
8. Security/data-loss leftovers in 1g that are not covered by export or delete.
9. Persistence/date-number corruption (1h) and per-lens dead controls (1j).
10. Remaining one-off highs, then the mediums and lows already grouped above.

Re-walk each affected lens after the shared fix, including the currently BLOCKED hotkey lenses, before marking a ticket VERIFIED.
