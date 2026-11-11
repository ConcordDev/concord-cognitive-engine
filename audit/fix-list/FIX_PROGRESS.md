# Audit fix progress

Branch: `fix/audit-sweep-20261110`. Status `FIXED_PENDING_VERIFY` means the fix is in this branch and still needs a live re-walk. Nothing here is `VERIFIED`.

Counts are merged from `fix_tickets.jsonl` (later lines override earlier fields for the same id). Design-call tickets are still open and were not changed: FIX-black-market-010, FIX-council-008, FIX-retail-002, FIX-foundry-007, FIX-world-creator-013.

## Running tally

| Severity | Fixed pending verify | Remaining open | Closed another way |
|---|---:|---:|---:|
| high | 183 | 36 | 2 |
| medium | 688 | 257 | 0 |
| low | 256 | 724 | 0 |
| unrated | 0 | 5 | 0 |
| **total** | **1127** | **1022** | **2** |

"Closed another way" is a status flag on a ticket that stays out of the open count: FIX-automotive-001 is NOT_REPRODUCED and FIX-hvac-002 is RETRACTED/REVERIFIED_OK. FIX-plumbing-007 is SUPERSEDED and already pending verify, so it is counted there. Two of the pending tickets (FIX-chat-006, FIX-chat-007) were already pending before this sweep.

## RCA-form-hotkey-steal

Shared fix: `shouldIgnoreLensHotkey` in `concord-frontend/lib/a11y/editable-target.ts`, used by `useLensCommand` and `useShortcut`. Clickable wrappers that turned Space/Enter into `.click()` now call `activateOnEnterOrSpace`, which ignores keys that start in a nested field.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-003 | food | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-004 | trades | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-agents-008 | agents | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-aviation-012 | aviation | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-council-009 | council | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-environment-001 | environment | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-ethics-005 | ethics | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-food-001 | food | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-government-006 | government | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-healthcare-004 | healthcare | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-household-002 | household | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-markets-006 | markets | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-photos-001 | photos | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-science-001 | science | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-security-002 | security | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-services-001 | services | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-sim-001 | sim | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-trades-001 | trades | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-voice-003 | voice | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-wallet-001 | wallet | high | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-auction-005 | auction | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-byo-keys-002 | byo-keys | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-dreams-003 | dreams | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-electrical-004 | electrical | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-fitness-019 | fitness | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-hr-006 | hr | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-materials-003 | materials | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-move-builder-011 | move-builder | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-pets-004 | pets | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-questmarket-005 | questmarket | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-veterinary-004 | veterinary | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-wallet-007 | wallet | medium | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-cognitive-replay-006 | cognitive-replay | low | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-forecast-009 | forecast | low | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-housing-010 | housing | low | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-manufacturing-012 | manufacturing | low | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-marketplace-007 | marketplace | low | FIXED_PENDING_VERIFY | ffdc6205c |
| FIX-voice-016 | voice | low | FIXED_PENDING_VERIFY | ffdc6205c |

The header Export menu's Ctrl+E binding yields to a focused field as well.

Reviewed and left open (not this root cause): command-palette Ctrl+K in fields (global by design: FIX-creator-004, FIX-energy-004, FIX-genesis-002, FIX-poetry-003, FIX-understanding-001), Escape-led FIX-government-004, arrow-key tablists, FIX-council-002 (`QAQAQA` is not explained by the hotkey map), FIX-game-010 (shortcuts while focus is outside a field), FIX-ml-010 (no steal observed; tab URL), FIX-finance-002/003 (math; the word "keystroke" is a caveat only).

## RCA-missing-delete-confirm (vanishing confirm only)

The in-row confirm armed for 4 seconds and then reverted, so the click never landed. `StickyDeleteConfirm` stays armed until Confirm or Cancel. HVAC Jobs/Estimates/other desk rows use it. The same timer was removed from the code file tree, snippet delete, and git discard arm.

Tickets that have no delete control at all are still open. FIX-hvac-002 stays retracted.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-hvac-001 | hvac | high | FIXED_PENDING_VERIFY | bd4c4cf98 |
| FIX-hvac-013 | hvac | medium | FIXED_PENDING_VERIFY | bd4c4cf98 |
| FIX-hvac-015 | hvac | medium | FIXED_PENDING_VERIFY | bd4c4cf98 |

## RCA-contrast-theme-tokens

Light mode inverted `text-white` and the zinc ramp to near-black while `bg-lattice-*` stayed a compiled dark hex, so labels sat on a dark surface. Lattice utilities now read theme RGB channels, and text inside a `bg-black` island stays light.

Muted-on-dark tickets that are not this invert (Lighthouse-only, FIX-education-009, FIX-studio-007, and the other secondary notes in the RCA) stay open. Mixed tickets that also have a non-contrast bug stay open (FIX-finance-002, FIX-ethics-003, FIX-voice-012, FIX-parenting-001, and similar).

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-automotive-015 | automotive | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-billing-001 | billing | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-black-market-002 | black-market | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-calendar-001 | calendar | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-creatures-008 | creatures | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-dreams-005 | dreams | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-ethics-008 | ethics | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-household-004 | household | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-marketing-004 | marketing | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-markets-009 | markets | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-personas-009 | personas | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-sim-002 | sim | high | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-app-maker-003 | app-maker | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-ar-009 | ar | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-atlas-004 | atlas | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-crypto-003 | crypto | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-eco-008 | eco | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-finance-005 | finance | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-fitness-007 | fitness | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-geology-006 | geology | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-healthcare-009 | healthcare | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-hvac-006 | hvac | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-integrations-004 | integrations | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-logistics-011 | logistics | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-manufacturing-002 | manufacturing | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-masonry-009 | masonry | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-mining-004 | mining | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-ml-008 | ml | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-parenting-004 | parenting | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-repair-telemetry-002 | repair-telemetry | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-retail-005 | retail | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-sandbox-008 | sandbox | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-self-012 | self | medium | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-agents-006 | agents | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-aviation-009 | aviation | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-cognition-006 | cognition | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-command-center-005 | command-center | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-concord-link-frontier-005 | concord-link-frontier | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-debate-017 | debate | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-desert-005 | desert | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-disputes-006 | disputes | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-game-design-007 | game-design | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-goals-008 | goals | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-insurance-010 | insurance | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-lattice-007 | lattice | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-legal-011 | legal | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-ocean-008 | ocean | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-poetry-005 | poetry | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-psyops-001 | psyops | low | FIXED_PENDING_VERIFY | 35df41d9e |
| FIX-spectate-004 | spectate | low | FIXED_PENDING_VERIFY | 35df41d9e |

## RCA-export-nothing

`collectLensExport` now reads the caller's own `STATE.<lens>Lens` panel records (per-user maps, and owned rows in arrays). Shared maps that are not keyed by the caller are not exported. Domains that already register a provider are deduped by id.

Lenses with no `*Lens` state bag are still open (their records live somewhere else): FIX-move-builder-014, FIX-lfg-007, FIX-creatures-005, FIX-quests-002, FIX-forecast-002, FIX-sentinel-008, FIX-creative-writing-003, FIX-construction-006, and the other no-bag skips in this pass. Estate, earned achievements, the garage fleet, and vault submissions now have their own export rows. FIX-finance-004 (unscoped dump), FIX-export-001 (decrypt), FIX-music-001, and FIX-paper-002 are different bugs and stay open.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-all-001 | all | high | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-landscaping-006 | landscaping | high | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-pharmacy-006 | pharmacy | high | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-plumbing-002 | plumbing | high | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-productivity-002 | productivity | high | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-animation-001 | animation | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-animation-004 | animation | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-astronomy-003 | astronomy | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-automotive-013 | automotive | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-billing-003 | billing | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-black-market-009 | black-market | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-bridge-005 | bridge | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-carpentry-003 | carpentry | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-command-center-003 | command-center | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-consulting-001 | consulting | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-debate-003 | debate | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-debug-008 | debug | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-desert-001 | desert | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-diy-006 | diy | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-dx-platform-006 | dx-platform | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-energy-003 | energy | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-ethics-002 | ethics | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-expert-mode-004 | expert-mode | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-forestry-003 | forestry | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-forge-008 | forge | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-fork-006 | fork | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-geology-003 | geology | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-hr-002 | hr | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-hvac-011 | hvac | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-lab-002 | lab | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-legacy-005 | legacy | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-linguistics-001 | linguistics | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-lock-008 | lock | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-marketing-007 | marketing | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-markets-010 | markets | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-masonry-007 | masonry | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-mental-health-002 | mental-health | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-mentorship-002 | mentorship | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-meta-003 | meta | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-mining-001 | mining | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-nonprofit-005 | nonprofit | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-pets-001 | pets | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-platform-006 | platform | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-podcast-003 | podcast | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-productivity-003 | productivity | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-questmarket-004 | questmarket | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-queue-009 | queue | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-social-002 | social | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-supplychain-002 | supplychain | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-tools-001 | tools | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-travel-001 | travel | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-understanding-003 | understanding | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-voice-005 | voice | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-wallet-005 | wallet | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-welding-004 | welding | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-worldmodel-007 | worldmodel | medium | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-admin-002 | admin | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-alliance-005 | alliance | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-analytics-008 | analytics | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-artistry-006 | artistry | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-atlas-005 | atlas | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-calendar-015 | calendar | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-cognition-004 | cognition | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-council-011 | council | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-crypto-010 | crypto | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-custom-003 | custom | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-goddess-004 | goddess | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-history-006 | history | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-observe-005 | observe | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-ocean-007 | ocean | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-offline-006 | offline | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-parenting-009 | parenting | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-projects-003 | projects | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-repos-005 | repos | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-resonance-006 | resonance | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-sandbox-011 | sandbox | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-self-008 | self | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-sub-worlds-008 | sub-worlds | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-sync-006 | sync | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-system-008 | system | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-tick-004 | tick | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-timeline-007 | timeline | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-veterinary-002 | veterinary | low | FIXED_PENDING_VERIFY | bf88fd41f |
| FIX-world-002 | world | low | FIXED_PENDING_VERIFY | bf88fd41f |

## RCA-mobile-clip-fab

At widths under 768px, fixed corner actions (`bottom-4` through `bottom-12`) are lifted by the mobile-nav safe-area offset so they sit above the bottom nav. `role="tablist"` scrolls horizontally instead of clipping. Table-column clip, tap-target size, and dead FABs that do nothing are not this change.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-black-market-003 | black-market | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-calendar-010 | calendar | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-creative-writing-006 | creative-writing | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-creative-writing-009 | creative-writing | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-disputes-008 | disputes | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-dreams-006 | dreams | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-education-007 | education | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-fitness-008 | fitness | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-government-011 | government | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-marketing-005 | marketing | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-personas-007 | personas | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-telecommunications-009 | telecommunications | high | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-accounting-008 | accounting | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-agents-017 | agents | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-agriculture-008 | agriculture | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-all-005 | all | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-app-maker-004 | app-maker | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-astronomy-006 | astronomy | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-automotive-016 | automotive | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-bridge-007 | bridge | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-carpentry-006 | carpentry | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-classroom-005 | classroom | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-code-006 | code | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-cognitive-replay-002 | cognitive-replay | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-cooking-006 | cooking | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-council-005 | council | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-council-012 | council | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-creative-004 | creative | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-creator-006 | creator | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-creatures-009 | creatures | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-debate-006 | debate | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-electrical-011 | electrical | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-energy-006 | energy | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-environment-004 | environment | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ethics-009 | ethics | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-expedition-journal-004 | expedition-journal | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-food-007 | food | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-forecast-003 | forecast | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-forestry-007 | forestry | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-foundry-001 | foundry | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-genesis-004 | genesis | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-goals-004 | goals | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-graph-005 | graph | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-healthcare-006 | healthcare | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-hr-007 | hr | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-hvac-007 | hvac | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-landscaping-007 | landscaping | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-law-006 | law | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-logistics-010 | logistics | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-masonry-010 | masonry | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-materials-007 | materials | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ml-009 | ml | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-narrative-walk-005 | narrative-walk | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-nonprofit-010 | nonprofit | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ops-007 | ops | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ops-009 | ops | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-paper-008 | paper | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-pets-006 | pets | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-pharmacy-003 | pharmacy | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-photography-005 | photography | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-photos-005 | photos | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-plumbing-004 | plumbing | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-plumbing-008 | plumbing | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-podcast-005 | podcast | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-poetry-006 | poetry | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-projects-002 | projects | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-queue-011 | queue | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-realestate-006 | realestate | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-repos-006 | repos | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-retail-004 | retail | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-robotics-006 | robotics | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-robotics-008 | robotics | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-schema-009 | schema | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-schema-010 | schema | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-science-005 | science | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-security-008 | security | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sentinel-010 | sentinel | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sentinel-012 | sentinel | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-services-004 | services | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sim-008 | sim | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sponsorship-005 | sponsorship | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-srs-006 | srs | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-staking-010 | staking | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-timeline-005 | timeline | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-understanding-005 | understanding | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-veterinary-005 | veterinary | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-voice-013 | voice | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-wallet-006 | wallet | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-worldmodel-009 | worldmodel | medium | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-analytics-010 | analytics | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-animation-007 | animation | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-answers-003 | answers | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ar-011 | ar | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-aviation-010 | aviation | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-byo-keys-016 | byo-keys | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-civic-bonds-013 | civic-bonds | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-code-quality-009 | code-quality | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-codex-002 | codex | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-cognition-007 | cognition | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-collab-008 | collab | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-concord-link-frontier-006 | concord-link-frontier | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-construction-009 | construction | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-consulting-008 | consulting | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-crafting-006 | crafting | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-crypto-012 | crypto | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-custom-010 | custom | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-database-006 | database | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-desert-004 | desert | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-dx-platform-010 | dx-platform | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-eco-009 | eco | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-electrical-009 | electrical | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-event-timeline-004 | event-timeline | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-events-010 | events | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-expert-mode-007 | expert-mode | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-finance-011 | finance | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-fishing-005 | fishing | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-forge-012 | forge | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-fork-009 | fork | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-fractal-009 | fractal | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-frontier-006 | frontier | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-game-011 | game | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-garage-005 | garage | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-global-015 | global | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-goddess-010 | goddess | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-history-008 | history | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-household-006 | household | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-housing-008 | housing | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-import-008 | import | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-inheritance-009 | inheritance | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-insurance-009 | insurance | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-invariant-002 | invariant | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-lab-008 | lab | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ledger-002 | ledger | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-legacy-007 | legacy | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-linguistics-004 | linguistics | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-literary-004 | literary | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-lock-010 | lock | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-maker-002 | maker | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-mentorship-005 | mentorship | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-mesh-008 | mesh | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-meta-008 | meta | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-move-builder-015 | move-builder | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-observe-006 | observe | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-offline-008 | offline | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-ops-011 | ops | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-philosophy-003 | philosophy | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-platform-009 | platform | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-plugins-004 | plugins | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-queue-012 | queue | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-reasoning-007 | reasoning | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-retail-011 | retail | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-saved-007 | saved | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-society-014 | society | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-space-003 | space | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sports-006 | sports | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sub-worlds-009 | sub-worlds | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-supplychain-006 | supplychain | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-sync-008 | sync | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-tools-010 | tools | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-translation-009 | translation | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-travel-006 | travel | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-vault-006 | vault | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-welding-008 | welding | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-wellness-009 | wellness | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-world-004 | world | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-world-creator-009 | world-creator | low | FIXED_PENDING_VERIFY | bdd52fb6e |
| FIX-world-observatory-006 | world-observatory | low | FIXED_PENDING_VERIFY | bdd52fb6e |

## RCA-escape-focus-trap

One capture listener closes the top dialog by activating its Close control, and keeps Tab inside an aria-modal dialog. Share and Export are dialogs, so Escape reaches them. A button whose name is Close, starts with Close (Close settings, Close inspector), or is exactly Cancel or Dismiss counts, in any case, including when that name is the button text. Dialogs whose dismiss uses another word (Stay private, Enter the mirror, Skip onboarding, Cancel install) carry `data-overlay-close` so Escape hits that button. Help and the command palettes have a Close button. The board task drawer and Filters panel are overlays: Escape uses their Close control, and a press outside them dismisses them. The goals inline delete confirm is an overlay so Escape hits Cancel. Compose, Quick capture, the music-library detail, bloodline, brawl, the soul vault, the world menu, friends, the HUD panel host, the global panel host, cross-domain connections, and the domain assistant each have a `data-overlay-close` button. Bloodline, brawl, and the soul vault had been labeled Open.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-agriculture-004 | agriculture | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-all-003 | all | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-all-007 | all | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-analytics-006 | analytics | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-app-maker-002 | app-maker | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-ar-008 | ar | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-artistry-001 | artistry | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-astronomy-004 | astronomy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-atlas-002 | atlas | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-automotive-014 | automotive | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-aviation-004 | aviation | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-billing-004 | billing | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-black-market-001 | black-market | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-bridge-006 | bridge | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-calendar-012 | calendar | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-carpentry-005 | carpentry | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-code-004 | code | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-command-center-002 | command-center | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-concord-link-frontier-001 | concord-link-frontier | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-concord-link-frontier-010 | concord-link-frontier | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-construction-007 | construction | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-cooking-004 | cooking | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-crafting-003 | crafting | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creative-writing-004 | creative-writing | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creator-005 | creator | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creatures-007 | creatures | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-crypto-004 | crypto | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-custom-006 | custom | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-debate-004 | debate | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-debug-009 | debug | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-disputes-004 | disputes | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-dreams-001 | dreams | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-electrical-005 | electrical | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-energy-005 | energy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-energy-009 | energy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-entity-004 | entity | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-ethics-006 | ethics | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-events-005 | events | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-finance-008 | finance | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-fitness-006 | fitness | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-fork-007 | fork | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-genesis-003 | genesis | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-geology-005 | geology | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-government-004 | government | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-healthcare-007 | healthcare | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-household-003 | household | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-hr-005 | hr | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-hvac-005 | hvac | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-integrations-005 | integrations | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-landscaping-005 | landscaping | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-legacy-006 | legacy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-legal-007 | legal | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-lock-009 | lock | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-manufacturing-007 | manufacturing | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-marketing-002 | marketing | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-markets-007 | markets | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-markets-008 | markets | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-masonry-006 | masonry | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-materials-002 | materials | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mental-health-007 | mental-health | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mesh-006 | mesh | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mining-003 | mining | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-ml-006 | ml | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-move-builder-012 | move-builder | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-ocean-005 | ocean | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-parenting-003 | parenting | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-personas-006 | personas | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-pets-005 | pets | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-pharmacy-001 | pharmacy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-pharmacy-005 | pharmacy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-photography-004 | photography | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-podcast-002 | podcast | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-poetry-004 | poetry | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-quests-003 | quests | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-queue-010 | queue | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-realestate-005 | realestate | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-robotics-004 | robotics | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sandbox-007 | sandbox | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-schema-006 | schema | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-self-011 | self | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sentinel-006 | sentinel | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-services-003 | services | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sim-007 | sim | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-spectate-005 | spectate | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-staking-006 | staking | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sub-worlds-006 | sub-worlds | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-system-001 | system | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-telecommunications-003 | telecommunications | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-understanding-002 | understanding | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-veterinary-003 | veterinary | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-voice-011 | voice | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-wallet-003 | wallet | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-welding-005 | welding | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-world-creator-005 | world-creator | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-worldmodel-005 | worldmodel | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-accounting-006 | accounting | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-achievements-003 | achievements | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-admin-001 | admin | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-agents-003 | agents | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-alliance-004 | alliance | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-animation-005 | animation | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-anon-006 | anon | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-answers-002 | answers | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-art-004 | art | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-auction-006 | auction | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-bounties-007 | bounties | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-byo-keys-014 | byo-keys | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-calendar-007 | calendar | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-civic-bonds-010 | civic-bonds | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-code-005 | code | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-cognitive-replay-005 | cognitive-replay | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-collab-007 | collab | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-consulting-006 | consulting | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-council-004 | council | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-courtship-005 | courtship | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-crafting-008 | crafting | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creative-009 | creative | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-crisis-ops-006 | crisis-ops | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-database-005 | database | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-deities-006 | deities | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-desert-002 | desert | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-detective-002 | detective | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-dx-platform-007 | dx-platform | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-environment-006 | environment | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-event-timeline-003 | event-timeline | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-expedition-journal-003 | expedition-journal | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-expert-mode-005 | expert-mode | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-fishing-003 | fishing | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-forecast-008 | forecast | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-forge-010 | forge | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-fractal-008 | fractal | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-frontier-004 | frontier | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-game-009 | game | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-game-design-006 | game-design | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-garage-004 | garage | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-global-013 | global | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-goals-007 | goals | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-goddess-003 | goddess | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-graph-011 | graph | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-history-007 | history | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-housing-009 | housing | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-inheritance-007 | inheritance | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-insurance-005 | insurance | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-invariant-001 | invariant | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-lab-005 | lab | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-lfg-006 | lfg | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-linguistics-002 | linguistics | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-literary-003 | literary | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mail-008 | mail | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-market-006 | market | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-marketplace-006 | marketplace | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mentorship-003 | mentorship | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-mentorship-009 | mentorship | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-meta-007 | meta | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-narrative-walk-004 | narrative-walk | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-nonprofit-009 | nonprofit | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-observe-007 | observe | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-philosophy-001 | philosophy | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-platform-007 | platform | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-plugins-002 | plugins | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-productivity-011 | productivity | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-projects-004 | projects | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-psyops-002 | psyops | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-questmarket-006 | questmarket | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-reasoning-006 | reasoning | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-resonance-005 | resonance | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-retail-010 | retail | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-saved-006 | saved | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-science-008 | science | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-security-007 | security | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sessions-002 | sessions | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-social-008 | social | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-society-013 | society | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-space-002 | space | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sponsorship-004 | sponsorship | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sports-004 | sports | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-studio-004 | studio | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-supplychain-004 | supplychain | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sync-005 | sync | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-temporal-004 | temporal | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-tick-006 | tick | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-tools-009 | tools | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-trades-006 | trades | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-trades-011 | trades | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-training-room-003 | training-room | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-travel-004 | travel | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-vault-004 | vault | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-world-003 | world | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-world-observatory-004 | world-observatory | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-world-observatory-008 | world-observatory | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-board-008 | board | medium | FIXED_PENDING_VERIFY | 3d93e974a |
| FIX-goals-013 | goals | low | FIXED_PENDING_VERIFY | 3d93e974a |

## RCA-arrow-tablist

Arrow keys move focus to the next control in a `role="tablist"` and activate it.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-all-004 | all | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-landscaping-004 | landscaping | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-pharmacy-007 | pharmacy | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-sentinel-009 | sentinel | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-worldmodel-008 | worldmodel | medium | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-answers-005 | answers | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-astronomy-005 | astronomy | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-bridge-010 | bridge | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-cooking-001 | cooking | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creative-writing-005 | creative-writing | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-creative-writing-008 | creative-writing | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-debate-005 | debate | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-debate-016 | debate | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-disputes-001 | disputes | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-forestry-012 | forestry | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-global-010 | global | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-materials-011 | materials | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-narrative-walk-002 | narrative-walk | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-podcast-004 | podcast | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-robotics-005 | robotics | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-telecommunications-001 | telecommunications | low | FIXED_PENDING_VERIFY | a6242b1a4 |
| FIX-world-007 | world | low | FIXED_PENDING_VERIFY | a6242b1a4 |

## RCA-ask-silent

Ask about a lens reuses a thread already filed under that lens, or starts a new one, instead of appending to whatever chat is open. Permission failures and handler failures are explained without the internal tool name. FIX-tick-005 (abort) stays open.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-all-002 | all | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-ar-014 | ar | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-black-market-006 | black-market | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-ethics-001 | ethics | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-fractal-001 | fractal | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-goals-001 | goals | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-hvac-004 | hvac | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-marketing-003 | marketing | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-staking-009 | staking | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-voice-004 | voice | high | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-auction-008 | auction | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-black-market-008 | black-market | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-civic-bonds-011 | civic-bonds | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-command-center-004 | command-center | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-custom-009 | custom | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-fishing-002 | fishing | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-forge-011 | forge | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-game-design-004 | game-design | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-garage-003 | garage | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-graph-007 | graph | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-lab-007 | lab | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-market-007 | market | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-observe-004 | observe | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-parenting-005 | parenting | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-productivity-004 | productivity | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-questmarket-008 | questmarket | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-social-009 | social | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-spectate-003 | spectate | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-system-003 | system | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-training-room-001 | training-room | medium | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-app-maker-008 | app-maker | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-cognitive-replay-004 | cognitive-replay | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-event-timeline-002 | event-timeline | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-literary-005 | literary | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-meta-004 | meta | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-mining-006 | mining | low | FIXED_PENDING_VERIFY | 545ed1873 |
| FIX-timeline-008 | timeline | low | FIXED_PENDING_VERIFY | 545ed1873 |

## SEC-finance-export-scope

FIX-finance-004. A lens export's DTU leg keeps rows that belong to this caller and this domain. Other owners, other domains, `Lens:` exhaust, and Chat Context are dropped. Untagged notes the caller owns still export.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-finance-004 | finance | high | FIXED_PENDING_VERIFY | 96a7c6276 |

## SEC-whiteboard-membership

`join-shared` returns `not_a_member` unless the caller already owns the board or was named on `share-board`. The socket room `whiteboard:<id>` uses the same check.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-whiteboard-001 | whiteboard | high | FIXED_PENDING_VERIFY | 8f2f24760 |
| FIX-whiteboard-002 | whiteboard | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-mail-recipient

`sendMail` looks the recipient up in `users`. A typed display name returns `recipient_unresolved` and writes no mail row and no CC gift.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-mail-011 | mail | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-pharmacy-datetime

The appointment field keeps `YYYY-MM-DDTHH:mm` only. A concatenated year (`52026`) is dropped in the control and refused by `appointment-add` / `appointment-update`.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-pharmacy-008 | pharmacy | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-crafting-publish-confirm

Publish states that anyone who can list published pieces will see it, and waits for Confirm. Unpublish posts `{ unpublish: true }` on the same route.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-crafting-001 | crafting | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-sentinel-unverified-report

A user threat report is stored private with `verified: false`. It is not propagated into the lattice and it is skipped by the Shield score. The reporter can retract it.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-sentinel-001 | sentinel | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-lens-exhaust-emit

`dtu:created`, `lens:dtu_generated`, and `artifact:rendered` from lens exhaust go to `user:<ownerId>`. A missing or placeholder owner produces no emit.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-xl-ws-001 | cross-lens | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-fitness-leaderboard

Challenge totals drawn from other people's activities are included only when the caller has joined that challenge. A stranger gets an empty leaderboard and a zero of their own.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-fitness-001 | fitness | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## SEC-export-browser-decrypt

Decrypt reads the downloaded JSON envelope and runs `concord-xor-fnv/v1` in the browser. A wrong password fails the checksum and does not download plaintext. The server encrypt/decrypt pair still round-trips the same envelope.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-export-001 | export | high | FIXED_PENDING_VERIFY | 8f2f24760 |

## RCA-missing-delete-control

Records the user can create now have a delete that stays armed until Confirm names the record or Cancel. Archiving a medication also cancels its open refill requests.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-creator-002 | creator | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-landscaping-002 | landscaping | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-masonry-001 | masonry | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-masonry-015 | masonry | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-masonry-017 | masonry | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-pharmacy-009 | pharmacy | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-pharmacy-013 | pharmacy | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-plumbing-001 | plumbing | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-plumbing-010 | plumbing | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-plumbing-011 | plumbing | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-plumbing-012 | plumbing | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-plumbing-013 | plumbing | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-supplychain-001 | supplychain | high | FIXED_PENDING_VERIFY | 7724d5cf2 |
| FIX-classroom-002 | classroom | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-creative-writing-001 | creative-writing | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-disputes-003 | disputes | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-education-010 | education | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-legal-001 | legal | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-mental-health-001 | mental-health | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-move-builder-008 | move-builder | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-paper-006 | paper | high | FIXED_PENDING_VERIFY | 67d0069f5 |
| FIX-questmarket-001 | questmarket | high | FIXED_PENDING_VERIFY | 67d0069f5 |

Classroom assignments from another cohort stay listed and can be deleted. Creative-writing pages open into the title and body fields and save through project-update; delete confirms. A dispute filer can withdraw their own open case. Education flashcard decks (including a minted quiz deck) and exercises delete. Legal matters, docket cases, calendar events, and templates delete, and wiping the last template does not re-seed it. Mood check-ins and gratitude entries can be edited or deleted. A minted move can be renamed or deleted. A quest poster can edit the title and description or cancel and refund escrow. Reward is not changed by the edit.

FIX-foundry-007 and FIX-world-creator-013 stay design calls.

## RCA-export-no-lens-bag

Header export now reads a domain bag that is not named `<domain>Lens`: `writingLens`, `conLens`, `insLens`, a namesake object such as `cognitiveReplay`, and root maps named `<domain><CamelRest>` such as `sentinelCases`. Only the caller's bucket is included. A key that merely shares a prefix (`artifacts` for `art`) is not taken.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-sentinel-008 | sentinel | medium | FIXED_PENDING_VERIFY | 176548acd |
| FIX-creative-writing-003 | creative-writing | medium | FIXED_PENDING_VERIFY | 176548acd |
| FIX-insurance-003 | insurance | medium | FIXED_PENDING_VERIFY | 176548acd |
| FIX-cognitive-replay-001 | cognitive-replay | medium | FIXED_PENDING_VERIFY | 176548acd |
| FIX-construction-006 | construction | low | FIXED_PENDING_VERIFY | 176548acd |

FIX-creative-writing-007 stays open: that one is the per-row CSV omitting the body column, not the header pack. Lenses that keep records only in SQL, or in a map that is not keyed by the caller, are still open.

Still open in section 1g: FIX-cognition-009 (public and non-owner `/dtu/<id>` still needs a live response trace) and FIX-music-001 (export silence / start offset not yet located in the offline renderer).

## RCA-mobile-table-tap-fab

On a phone, a table's parent scrolls sideways and the table sizes to its columns, so End, Kind, Delete, and OEE stay reachable. Buttons, tabs, and role=button controls have a 44px minimum height only when the pointer is coarse and the viewport is a phone. A fine pointer, including a desktop window dragged narrow, keeps the dense toolbar. The landscaping New design button focuses the layout-name field on the yard designer. File a case opens the disputes filing form.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-manufacturing-001 | manufacturing | high | FIXED_PENDING_VERIFY | 4b78317fc |
| FIX-disputes-010 | disputes | high | FIXED_PENDING_VERIFY | 4b78317fc |
| FIX-landscaping-008 | landscaping | high | FIXED_PENDING_VERIFY | 4b78317fc |
| FIX-manufacturing-003 | manufacturing | medium | FIXED_PENDING_VERIFY | 4b78317fc |

## Persistence and corruption

A board title edit is written to the artifact title, and a reload prefers that saved title. A carpentry takeoff is stored and listed back. A landscaping proposal is stored even when the total is 0. A vital outside 20–250 bpm or 90–110 °F is refused, so 200 °F is not stored as 2 or as 200. A legal time entry above 336 hours is refused.

A fixture for FIX-finance-002 and FIX-finance-003 passes on the current macros: cash 10 + investments 5 − liabilities 3 is 12, and a cash-flow amount of 5 is stored as 5. Those two stay open until a failing UI path is found.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-board-001 | board | high | FIXED_PENDING_VERIFY | c6dd576e9 |
| FIX-carpentry-001 | carpentry | high | FIXED_PENDING_VERIFY | c6dd576e9 |
| FIX-healthcare-002 | healthcare | high | FIXED_PENDING_VERIFY | c6dd576e9 |
| FIX-landscaping-009 | landscaping | high | FIXED_PENDING_VERIFY | c6dd576e9 |
| FIX-legal-002 | legal | high | FIXED_PENDING_VERIFY | c6dd576e9 |

A payload field named `name` is no longer discarded when the request also has `action`. Mesh add-node and create-channel were posting that shape. Deadlock detection reads the locks on the call, not only an artifact bag. The database analysis tab tolerates a table with no columns array. The meta components list renders the first 48 names and a count of the rest. A voice take delete confirms, then removes the stored take. Expedition writes start on concordia-hub instead of an empty world id. Classroom lists compare cohort ids as numbers, and materials from another cohort stay on the page.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-classroom-001 | classroom | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-voice-002 | voice | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-expedition-journal-001 | expedition-journal | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-lock-007 | lock | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-mesh-001 | mesh | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-database-001 | database | high | FIXED_PENDING_VERIFY | c5cbdea57 |
| FIX-meta-001 | meta | high | FIXED_PENDING_VERIFY | c5cbdea57 |

## NEEDS_LIVE_REPRO

These stay `OPEN`. The code that was checked does not show the reported failure, so a live re-walk has to confirm or retire them. `needs_live_repro` is set on the ticket. They are not `FIXED_PENDING_VERIFY`.

| Ticket | What was checked |
|---|---|
| FIX-chat-002 | No single transcript loader found that blanks a selected thread after a successful load. |
| FIX-code-001 | Scratch Save posts a lens artifact then dtu.create. "symbol or position required" is only returned by find-references, lsp-hover, and lsp-signature. |
| FIX-services-002 | Desk artifacts and the booking-suite client store are separate. No create call was found that writes one and drops the other. |
| FIX-finance-002 | net-worth-snapshot of cash 10, investments 5, and liabilities 3 returns 12. |
| FIX-finance-003 | transactions-ingest of amount 5 stores 5. |
| FIX-retail-001 | No product-create handler was found missing from the retail desk in this pass. |
| FIX-whiteboard-004 | board-list renders an empty list. "Whiteboard not found" is the studio 404 mapper. |
| FIX-podcast-006 | MediaUpload's drop zone clicks the hidden file input and handles drop. |
| FIX-offline-001 | The lens connectivity card and the global offline banner were not found to share one status read. |
| FIX-offline-002 | No queue drain was found that claims auto-replay and then skips it. |
| FIX-achievements-001 | Sync unlocks was not found to ignore a real DTU count. |
| FIX-announcements-001 | GET /api/announcements is a public list. The 403 is on the admin POST. |
| FIX-mesh-002 | Mesh send is called with dtuId. "No DTU specified" lives in the test, not in mesh.js. |
| FIX-realestate-001 | The 422 validation_failed was not matched to a field the desk form omits. |
| FIX-security-001 | The 422 validation_failed was not matched to a field the case form omits. |
| FIX-marketplace-001 | No publish path was found that marks a listing published and then hides it from Browse. |
| FIX-aviation-002 | Log flight and the fleet dropdown were not found to be unwired no-ops. |
| FIX-creatures-001 | Open the pen was not found as a button with an empty handler. |
| FIX-creatures-002 | No creature-create macro was found missing from a create control that calls it. |
| FIX-voice-001 | No renderer path was found that crashes on a long recording title. |
| FIX-cognition-009 | A confirmed miss on /dtu/[id] already 404s via lookupOwnerDtu. The live 500 did not reduce to one throw. |
| FIX-music-001 | renderProject schedules from beat 0. No start offset puts a 4-bar 100 BPM arrangement at 16.75s. |
| FIX-001 | Opening a production enables Add scene and Rename. "Nothing selected." is the scene pane until a scene is clicked, and the lens tests pin that. |
| FIX-ethics-003 | Case titles render as text-white on the lattice surface. Archive Case opens the create form. The unreadable-title report was not reproduced from those classes. |
| FIX-ghost-tracker-001 | The residue map reads a residues prop. The only lens call found in that folder is ghost-hunt advance. The six 400s were not reduced to one bad action. |
| FIX-010 | GET /api/dtus/:id already maps a missing DTU to 404, and the page middleware rewrites a confirmed miss to /dtu-not-found with status 404. The live 500 was hypothesized as a front-door rewrite to localhost:3001, which this tree does not do. |
| FIX-government-008 | Open-data search returns a missing-key message when DATA_GOV_API_KEY is unset, and the upstream error when the keyed catalog throws. A parks result needs that key and a live catalog. |
| FIX-government-009 | Load 500/502s and the system-status failures were not reduced to one government handler. |
| FIX-government-013 | The offline banner follows the socket and /health, not a spending HTTP 400. |
| FIX-government-020 | Same open-data path as FIX-government-008. Ingest uses the same key and catalog. |
| FIX-government-023 | No ask context builder was found that hides the government dashboard from the agent. |
| FIX-masonry-012 | schedule-list, invoice-list, and proposal-list return ok with empty arrays. The repeated 400/422 was not reduced to one action. |
| FIX-lfg-003 | Post request is disabled only while the post is in flight. The note is labeled optional, and a blank note is stored as an empty string. |

## Highs with a local root cause

A growth entry above 500 kg, 300 cm, or 80 cm head circumference is refused. A plumbing invoice needs a client. A patient needs a real name of at most 80 characters and a date of birth that is not in the future. Paying a claim without an explicit payout uses claim amount minus the policy deductible. A donor gift tagged with a campaign name or id is added to that campaign. A pact beneficiary is refused when a user table is present and the id is not in it. Pay premium ignores a second click that arrives before the first call returns. Early exit asks for a confirm click before the penalty.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-parenting-001 | parenting | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-plumbing-009 | plumbing | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-healthcare-001 | healthcare | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-insurance-001 | insurance | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-nonprofit-001 | nonprofit | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-death-insurance-001 | death-insurance | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-death-insurance-003 | death-insurance | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-death-insurance-010 | death-insurance | high | FIXED_PENDING_VERIFY | a620c7658 |
| FIX-staking-002 | staking | high | FIXED_PENDING_VERIFY | a620c7658 |

A BOM compute tolerates a project whose materials array has not loaded. A shipment with no events array no longer reads length off undefined, and an unknown status still renders. A graph label that is missing no longer calls slice. A patient can be removed. A self reading must fall inside its metric range, and a logged reading can be deleted. A flight save requires ICAO codes, a Hobbs pair of at most 24 hours, fuel at most 5000 gallons, and an ETA that is not before ETD. An auction refuses a bid under 1 or over 1,000,000 and a duration outside 1 to 10,080 minutes. A campaign budget must be a number from 0 to 1,000,000,000.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-diy-001 | diy | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-logistics-001 | logistics | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-graph-001 | graph | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-healthcare-003 | healthcare | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-self-001 | self | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-aviation-001 | aviation | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-black-market-005 | black-market | high | FIXED_PENDING_VERIFY | 82af5ece0 |
| FIX-marketing-006 | marketing | high | FIXED_PENDING_VERIFY | 82af5ece0 |

A wallet is stored only when the address matches the selected chain: 40 hex characters after 0x, or a Bitcoin address when that chain is selected. The Verified badge is the default wallet that also has an address in that shape.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-crypto-001 | crypto | high | FIXED_PENDING_VERIFY | fd1a354f7 |

Empty or unparseable JSON and CSV are marked invalid, so Import stays off. Resolve refuses a species id that is not in the authored catalog. A beacon share token is 24 random bytes, and coordinates are returned only to the owner or a listed follower. A mind-map node delete stays visible. A task description is an editor and is stored on the task. Clearing the calendar start field clears the saved start, and a save without a start is refused. The staking lens header says Staking. The lens registry lists that lens once.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-import-001 | import | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-creatures-004 | creatures | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-fitness-002 | fitness | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-graph-002 | graph | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-board-002 | board | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-calendar-005 | calendar | high | FIXED_PENDING_VERIFY | 6b9044dd3 |
| FIX-staking-001 | staking | high | FIXED_PENDING_VERIFY | 6b9044dd3 |

A scheduled landscaping job can be edited. Government inspections, fines, FOIA drafts, 311 requests, and voter registrations can be removed, and a permit that is not issued can be cancelled. The debate voting phase has Vote Pro and Vote Con. Sign now asks the signer to type their name before the envelope is signed. Listing an auction shows the server's error and offers the caller's own items.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-landscaping-001 | landscaping | high | FIXED_PENDING_VERIFY | b02a020bf |
| FIX-government-018 | government | high | FIXED_PENDING_VERIFY | b02a020bf |
| FIX-debate-015 | debate | high | FIXED_PENDING_VERIFY | b02a020bf |
| FIX-insurance-011 | insurance | high | FIXED_PENDING_VERIFY | b02a020bf |
| FIX-auction-001 | auction | high | FIXED_PENDING_VERIFY | b02a020bf |

The Following list has an Unfollow control on the signed-in user's own list.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-social-013 | social | high | FIXED_PENDING_VERIFY | 5ecae04b7 |

Renaming an event rewrites the ticket tiers that named it, and a tier can also point at the event id. Removing an unclaimed gift from Sent returns the escrowed Concord Coin and says so. A task file chooser stores the chosen file name on the task. A market listing is posted with a picked item id, not the title.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-events-001 | events | high | FIXED_PENDING_VERIFY | 85819dccf |
| FIX-mail-012 | mail | high | FIXED_PENDING_VERIFY | 85819dccf |
| FIX-board-006 | board | high | FIXED_PENDING_VERIFY | 85819dccf |
| FIX-market-001 | market | high | FIXED_PENDING_VERIFY | 85819dccf |

Choosing Terrain, Anomalies, Privacy, or Coverage scrolls that panel into view instead of leaving the signals summary on screen. The finance book nav scrolls sideways so Wallet and More stay reachable on a phone. The robotics arXiv list is capped so the view under it is on the page.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-atlas-001 | atlas | high | FIXED_PENDING_VERIFY | 90b2eca5a |
| FIX-markets-012 | markets | high | FIXED_PENDING_VERIFY | 90b2eca5a |
| FIX-robotics-001 | robotics | high | FIXED_PENDING_VERIFY | 90b2eca5a |

Corner actions sit above the mobile nav and receive the tap. A board card can move to another lane without a drag. A dashboard name longer than 100 characters is refused and the message is shown. Market search runs as you type, and opening a card scrolls its detail into view. Refresh retries the price feed as well as the dashboard.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-006 | board | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-012 | goals | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-015 | cross-cutting | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-board-012 | board | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-analytics-001 | analytics | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-markets-014 | markets | high | FIXED_PENDING_VERIFY | fe006d27f |
| FIX-finance-001 | finance | high | FIXED_PENDING_VERIFY | fe006d27f |

A vision upload is sent to the vision model and the chosen image stays on the page. Submitting an assessment shows the grade or the error instead of staying silent.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-education-001 | education | high | FIXED_PENDING_VERIFY | 1b4f4b16a |
| FIX-education-002 | education | high | FIXED_PENDING_VERIFY | 1b4f4b16a |

A paper export is a one-page PDF that includes the body. A drain-slope question returns inches per foot. A webhook create is stored for the owner and a refusal is shown. Deleting a node also drops relations that point at it by target id. Ask about the black market is told prices are Sparks only. Locking an heir slot reads the listing id and says when it is missing.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-paper-002 | paper | high | FIXED_PENDING_VERIFY | 01d93532d |
| FIX-plumbing-003 | plumbing | high | FIXED_PENDING_VERIFY | 01d93532d |
| FIX-integrations-001 | integrations | high | FIXED_PENDING_VERIFY | 01d93532d |
| FIX-entity-008 | entity | high | FIXED_PENDING_VERIFY | 01d93532d |
| FIX-black-market-007 | black-market | high | FIXED_PENDING_VERIFY | 01d93532d |
| FIX-inheritance-004 | inheritance | high | FIXED_PENDING_VERIFY | 01d93532d |

A creator publishes to their own hub. Official posts for a catalog creator stay operator-only. A bond drive can be cancelled before it is funded, and escrowed pledges are refunded. A public profile stored in sqlite is readable by user id and by username when the memory cache already holds other social rows. An open market's description can be edited. The question stays put once a position exists, and cancel still refuses so those stakes are not wiped. Education's Open a lesson control sits in the header instead of a fixed overlay.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-sponsorship-003 | sponsorship | high | FIXED_PENDING_VERIFY | be58eeb32 |
| FIX-civic-bonds-001 | civic-bonds | high | FIXED_PENDING_VERIFY | be58eeb32 |
| FIX-social-012 | social | high | FIXED_PENDING_VERIFY | be58eeb32 |
| FIX-markets-003 | markets | high | FIXED_PENDING_VERIFY | be58eeb32 |
| FIX-education-006 | education | high | FIXED_PENDING_VERIFY | be58eeb32 |

Field Service has an Add client control on the clients card. The name is stored with clientAdd and the new client shows in the list.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-plumbing-007 | plumbing | high | FIXED_PENDING_VERIFY | 692efd45b |

Tab and Shift+Tab move focus in the studio. Arrange and Session are buttons. The arrange workspace scrolls sideways on a phone instead of squeezing the canvas off the screen. A hosted request that gets no response does not say it was the local API, and a detector sweep gives up after 25 seconds. A published AR link opens /ar/view/<slug> and shows the scene that was published.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-studio-006 | studio | high | FIXED_PENDING_VERIFY | ca9a0179a |
| FIX-studio-005 | studio | high | FIXED_PENDING_VERIFY | ca9a0179a |
| FIX-code-quality-008 | code-quality | high | FIXED_PENDING_VERIFY | ca9a0179a |
| FIX-ar-013 | ar | high | FIXED_PENDING_VERIFY | ca9a0179a |

## Mediums — shared delete confirm and a required denial reason

`StickyDeleteConfirm` can keep its own armed state, so a delete stays armed until Confirm or Cancel without each lens holding a timer. Foundry world delete, sub-world hard delete, and agent, trigger, graph, and task-definition delete use it. A permit denial requires a reason; an empty prompt can no longer store "no reason provided".

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-foundry-002 | foundry | medium | FIXED_PENDING_VERIFY | 7531a0d8f |
| FIX-sub-worlds-002 | sub-worlds | medium | FIXED_PENDING_VERIFY | 7531a0d8f |
| FIX-agents-014 | agents | medium | FIXED_PENDING_VERIFY | 7531a0d8f |
| FIX-government-019 | government | medium | FIXED_PENDING_VERIFY | 7531a0d8f |

## Mediums — shared number, date, and length checks

`finite-input` now has a model year, a reading, a length, and a calendar day. A permit fee that is negative or not a number is refused, and a blank permit form says which fields are required. A vehicle year has to be a whole year from 1886 through next year, and an odometer that is not a number is refused instead of stored as 0. A renewal needs a title and a real date. A document expiry that is not YYYY-MM-DD is refused. A takeoff name over 120 characters and a wall longer or taller than 1000 feet, or negative, cannot be computed.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-government-007 | government | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-automotive-003 | automotive | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-automotive-004 | automotive | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-automotive-005 | automotive | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-automotive-006 | automotive | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-masonry-002 | masonry | medium | FIXED_PENDING_VERIFY | 313e19a61 |
| FIX-masonry-003 | masonry | medium | FIXED_PENDING_VERIFY | 313e19a61 |

## Mediums — delete where there was no control

A session can be deleted by its owner. The delete removes that user's row and its events, and another user's id is not found. The detail page uses StickyDeleteConfirm. Photo albums keep the same owner check and the delete control stays visible, armed until confirm, instead of appearing only on hover. Photography albums use the same confirm.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-sessions-001 | sessions | medium | FIXED_PENDING_VERIFY | 1de860c9d |
| FIX-photos-004 | photos | medium | FIXED_PENDING_VERIFY | 1de860c9d |

## Mediums — empty library and a rejected write

The literary library uses the shared empty state and no longer tells a reader to run a script. A rejected write (HTTP 400) shows the server message. A background GET stays quiet.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-literary-001 | literary | medium | FIXED_PENDING_VERIFY | 7af8c55c6 |
| FIX-science-002 | science | medium | FIXED_PENDING_VERIFY | 7af8c55c6 |
| FIX-manufacturing-010 | manufacturing | medium | FIXED_PENDING_VERIFY | 7af8c55c6 |
| FIX-agents-002 | agents | medium | FIXED_PENDING_VERIFY | 7af8c55c6 |

## Mediums — range checks on five more lenses

A workout distance and duration must be real numbers in range. A CVSS score outside 0 to 10 is refused instead of clamped. An hourly rate above 10000 is refused. A donor name over 160 characters and a negative gift are refused. An expense or journal date that is not a real calendar day is refused.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-fitness-005 | fitness | medium | FIXED_PENDING_VERIFY | 0bb1350e4 |
| FIX-security-005 | security | medium | FIXED_PENDING_VERIFY | 0bb1350e4 |
| FIX-legal-005 | legal | medium | FIXED_PENDING_VERIFY | 0bb1350e4 |
| FIX-nonprofit-006 | nonprofit | medium | FIXED_PENDING_VERIFY | 0bb1350e4 |
| FIX-accounting-001 | accounting | medium | FIXED_PENDING_VERIFY | 0bb1350e4 |

## Mediums — confirm before delete on four more lenses

Asset, vulnerability, alert-rule, and camera delete stay visible and armed until confirm. Cancelling a sponsorship asks first. Environment record delete asks first. Deleting an artwork from the studio list asks first. Each still calls the existing owner-scoped delete.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-security-004 | security | medium | FIXED_PENDING_VERIFY | 37ac58a18 |
| FIX-sponsorship-002 | sponsorship | medium | FIXED_PENDING_VERIFY | 37ac58a18 |
| FIX-environment-005 | environment | medium | FIXED_PENDING_VERIFY | 37ac58a18 |
| FIX-art-007 | art | medium | FIXED_PENDING_VERIFY | 37ac58a18 |

## Mediums — range checks on eleven more lenses

A blank, over-long, or negative value is refused with a message on the form. Forestry acres, energy wattage, plumbing duration, civic-bond target, material density, electrical job name, carpentry quantity and project name, HVAC labor hours and material cost, a blank work order, a blank debate topic, and a blank AR scene name no longer get stored as zero or a default.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-forestry-002 | forestry | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-energy-002 | energy | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-plumbing-005 | plumbing | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-civic-bonds-002 | civic-bonds | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-materials-005 | materials | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-electrical-002 | electrical | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-carpentry-004 | carpentry | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-hvac-008 | hvac | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-manufacturing-005 | manufacturing | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-debate-001 | debate | medium | FIXED_PENDING_VERIFY | efa1dde7d |
| FIX-ar-001 | ar | medium | FIXED_PENDING_VERIFY | efa1dde7d |

## Mediums — confirm before delete on seventeen more lenses

The existing owner-scoped delete stays armed until confirm. Spot and session, field-log, robot, mission, saved search, child, campaign, export schedule, destination disconnect, workflow, mechanic, debate, feed post, materials row, garage child record, and saved dashboard.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-ocean-003 | ocean | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-geology-002 | geology | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-robotics-003 | robotics | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-robotics-007 | robotics | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-genesis-001 | genesis | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-parenting-008 | parenting | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-marketing-009 | marketing | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-export-004 | export | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-integrations-006 | integrations | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-game-design-002 | game-design | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-debate-013 | debate | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-creatures-006 | creatures | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-quests-004 | quests | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-staking-007 | staking | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-materials-001 | materials | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-automotive-008 | automotive | medium | FIXED_PENDING_VERIFY | f012a8f62 |
| FIX-analytics-002 | analytics | medium | FIXED_PENDING_VERIFY | f012a8f62 |

## Mediums — owner-scoped delete where the list already exists

Pest reports, replanting projects, sprints, the caller's own poll, observing sessions, and saved HVAC load estimates can be removed after confirm. Another user's record is not found. Deleting a sprint clears that sprint id on the owner's tasks and does not delete the tasks.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-forestry-004 | forestry | medium | FIXED_PENDING_VERIFY | 39bf2da56 |
| FIX-projects-001 | projects | medium | FIXED_PENDING_VERIFY | 39bf2da56 |
| FIX-vote-001 | vote | medium | FIXED_PENDING_VERIFY | 39bf2da56 |
| FIX-astronomy-008 | astronomy | medium | FIXED_PENDING_VERIFY | 39bf2da56 |
| FIX-hvac-003 | hvac | medium | FIXED_PENDING_VERIFY | 39bf2da56 |

## Mediums — delete on lists that already had a store

Studio Recent projects call the existing owner-scoped project delete after confirm. Mentorship goals, Forge projects, and draft lab notebook entries delete from the caller's store. A signed or witnessed notebook entry stays. Another caller is refused.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-studio-008 | studio | medium | FIXED_PENDING_VERIFY | b97869307 |
| FIX-music-003 | music | medium | FIXED_PENDING_VERIFY | b97869307 |
| FIX-mentorship-001 | mentorship | medium | FIXED_PENDING_VERIFY | b97869307 |
| FIX-forge-006 | forge | medium | FIXED_PENDING_VERIFY | b97869307 |
| FIX-lab-001 | lab | medium | FIXED_PENDING_VERIFY | b97869307 |

## Mediums — refuse blank and out-of-range form values

A bounty reward, assignment points, dashboard title, lesson title, recipe title, loadout name, sub-world capacity, and materials shortlist name are refused with a message. They are no longer rewritten into 1, 0, Untitled, or a weapon default.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-bounties-002 | bounties | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-classroom-003 | classroom | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-observe-002 | observe | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-008 | education | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-cooking-003 | cooking | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-sandbox-002 | sandbox | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-sub-worlds-003 | sub-worlds | medium | FIXED_PENDING_VERIFY | 89a618747 |
| FIX-materials-004 | materials | medium | FIXED_PENDING_VERIFY | 89a618747 |

## Mediums — song title, tempo, customer email, and playtest sessions

A blank song title and a tempo outside 30 to 300 show on the save control. A customer email without a name and a domain is refused. A playtest session can be renamed and deleted after confirm.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-studio-001 | studio | medium | FIXED_PENDING_VERIFY | ca9341948 |
| FIX-retail-006 | retail | medium | FIXED_PENDING_VERIFY | ca9341948 |
| FIX-game-002 | game | medium | FIXED_PENDING_VERIFY | ca9341948 |

## Mediums — empty reads and empty books

VO2max and the race predictor return an empty result when no run is logged, and the training board says why. A studio presence check with no session returns no collaborators instead of a 400. Inventory, payroll, purchase orders, budgets, and sales tax use the shared empty state. Posting an expense shows a message for a blank account, a non-positive amount, or a bad date.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-fitness-004 | fitness | medium | FIXED_PENDING_VERIFY | 4c07b5ce5 |
| FIX-accounting-003 | accounting | medium | FIXED_PENDING_VERIFY | 4c07b5ce5 |
| FIX-accounting-011 | accounting | medium | FIXED_PENDING_VERIFY | 4c07b5ce5 |
| FIX-music-007 | music | medium | FIXED_PENDING_VERIFY | 4c07b5ce5 |

## Mediums — bad numbers stay on the form and say why

Typed amounts are no longer rewritten as the user types. A share, salary, pet weight, plumbing cost, staking principal, queue capacity, flow-calculator beat, simulation step, and listing price that is out of range is refused with a sentence.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-staking-003 | staking | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-wallet-002 | wallet | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-inheritance-001 | inheritance | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-plumbing-015 | plumbing | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-pets-003 | pets | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-hr-001 | hr | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-market-003 | market | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-marketplace-002 | marketplace | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-queue-008 | queue | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-game-design-003 | game-design | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-sim-003 | sim | medium | FIXED_PENDING_VERIFY | 691623a9f |
| FIX-sim-004 | sim | medium | FIXED_PENDING_VERIFY | 691623a9f |

## Mediums — government, automotive, masonry

A permit lookup names the timeline in weeks, and a violation lookup names a tier. Notice subscriptions come back with the notice list. A TCO with only an odometer says so, and a second reading is counted. Deleting a masonry job removes its inspections, and deleting a takeoff clears the preview.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-government-002 | government | medium | FIXED_PENDING_VERIFY | 23ca5ec1c |
| FIX-government-016 | government | medium | FIXED_PENDING_VERIFY | 23ca5ec1c |
| FIX-automotive-002 | automotive | medium | FIXED_PENDING_VERIFY | 23ca5ec1c |
| FIX-masonry-016 | masonry | medium | FIXED_PENDING_VERIFY | 23ca5ec1c |
| FIX-masonry-004 | masonry | medium | FIXED_PENDING_VERIFY | 23ca5ec1c |

## Mediums — validation that used to stay quiet

A bad fleet vehicle, load weight, invoice total, spot name, market stake, monitor threshold, poll duration, harvest yield, or billing rate stays on the form and says why.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-logistics-006 | logistics | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-accounting-002 | accounting | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-accounting-015 | accounting | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-law-005 | law | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-ocean-004 | ocean | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-observe-001 | observe | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-vote-002 | vote | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-markets-001 | markets | medium | FIXED_PENDING_VERIFY | 76cac608a |
| FIX-agriculture-003 | agriculture | medium | FIXED_PENDING_VERIFY | 76cac608a |

## Mediums — government desks

Oversight counts open permit-desk permits and open service requests, and an empty emergency plan list is not 100% ready. Bills stop spinning and show the load error. A spending period that is not published yet falls back to the previous closed period.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-government-001 | government | medium | FIXED_PENDING_VERIFY | 1a995b79a |
| FIX-government-003 | government | medium | FIXED_PENDING_VERIFY | 1a995b79a |
| FIX-government-014 | government | medium | FIXED_PENDING_VERIFY | 1a995b79a |

## Mediums — edit and search on existing lists

A saved takeoff and a scheduled job load back into the form and save under the same id. The garage can be searched and sorted.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-masonry-005 | masonry | medium | FIXED_PENDING_VERIFY | 35f17daff |
| FIX-masonry-014 | masonry | medium | FIXED_PENDING_VERIFY | 35f17daff |
| FIX-automotive-012 | automotive | medium | FIXED_PENDING_VERIFY | 35f17daff |

## Mediums — 311 pin and a message to yourself

A click on the 311 map fills latitude and longitude, and the map keeps a size and a phone-sized zoom control. A direct message to yourself is refused and the recipient stays in the field.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-government-012 | government | medium | FIXED_PENDING_VERIFY | b292a2e77 |
| FIX-government-022 | government | medium | FIXED_PENDING_VERIFY | b292a2e77 |
| FIX-government-017 | government | medium | FIXED_PENDING_VERIFY | b292a2e77 |

## Mediums — garage records

Fuel, service, expense, trip, and document rows have an Edit control that updates the caller's record. The vehicle delete control stays visible and confirms before it runs. A VIN decode is stored and shown again after reload.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-automotive-007 | automotive | medium | FIXED_PENDING_VERIFY | c2b84e49a |
| FIX-automotive-010 | automotive | medium | FIXED_PENDING_VERIFY | c2b84e49a |
| FIX-automotive-011 | automotive | medium | FIXED_PENDING_VERIFY | c2b84e49a |

## Mediums — masonry lists

Takeoffs, proposals, jobs, and the price book say they are loading until the first read finishes. An empty price book says it has no rows. A rendered proposal can be copied or downloaded.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-masonry-008 | masonry | medium | FIXED_PENDING_VERIFY | fdeaecb37 |
| FIX-masonry-011 | masonry | medium | FIXED_PENDING_VERIFY | fdeaecb37 |
| FIX-masonry-013 | masonry | medium | FIXED_PENDING_VERIFY | fdeaecb37 |

## Mediums — range refusals

A past goal date counts as overdue, and a new goal cannot be saved on a past date. A blank task title, a blank crop name, a negative crop yield, an empty cash-flow row, a negative pit depth, a price over one million, a non-positive shipment weight, a non-positive watch price, a bad asset quantity, and a negative budget cap each say what is wrong instead of being rewritten.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-agriculture-010 | agriculture | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-board-007 | board | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-byo-keys-003 | byo-keys | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-black-market-011 | black-market | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-crisis-ops-003 | crisis-ops | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-finance-006 | finance | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-goals-002 | goals | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-logistics-013 | logistics | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-mining-002 | mining | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |
| FIX-plumbing-016 | plumbing | medium | FIXED_PENDING_VERIFY | 8b56e4a0e |

## Mediums — personas, eco, calendar, construction

A persona tagline, personality, greeting, or tag that is out of range is refused. A saved place needs a real coordinate and a label of at most 80 characters, and deleting it or a footprint snapshot asks first. An ESG score outside 0 to 100 is not counted. A calendar event with no title or an end before its start stays in the form. Construction deletes ask first. A negative amount, budget, or crew count, an empty punch item, and a cancelled daily-log draft are not saved.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-personas-001 | personas | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-personas-002 | personas | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-eco-001 | eco | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-eco-002 | eco | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-eco-003 | eco | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-eco-006 | eco | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-calendar-006 | calendar | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-construction-001 | construction | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-construction-002 | construction | medium | FIXED_PENDING_VERIFY | 80ba8aedc |
| FIX-construction-003 | construction | medium | FIXED_PENDING_VERIFY | 80ba8aedc |

## Mediums — confirm and limits

A schema, a veterinary patient, and a medication archive ask before they go. An agent interval has to be a positive whole number of milliseconds, and a token budget has to be greater than 0. A move name over 120 characters is refused, and a modifier cannot be raised past the budget.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-schema-002 | schema | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-veterinary-001 | veterinary | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-pharmacy-002 | pharmacy | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-agents-011 | agents | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-move-builder-001 | move-builder | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-move-builder-002 | move-builder | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |
| FIX-move-builder-009 | move-builder | medium | FIXED_PENDING_VERIFY | 7aa0b3704 |

## Mediums — entity, voice, marketing

A second entity with the same name is refused. A transcript duration that is not a number of minutes, including a negative or abc, says so before analysis, and a meeting duration does the same. A new campaign starts as a draft.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-entity-001 | entity | medium | FIXED_PENDING_VERIFY | 6d8961bba |
| FIX-voice-009 | voice | medium | FIXED_PENDING_VERIFY | 6d8961bba |
| FIX-marketing-014 | marketing | medium | FIXED_PENDING_VERIFY | 6d8961bba |

## Mediums — persona chat, calendar view, agent draft

Deleting a persona also removes its chats and ratings, and the delete stays armed until confirm. Editing a greeting updates the open chat preview. The week view follows the selected date, the visible month is remembered for the session, and a saved event opens on its own month. A half-typed year is not rewritten. Saving an agent stores a dormant draft. Reset usage still only clears spend; Remove budget clears the limit.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-personas-004 | personas | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-personas-005 | personas | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-002 | calendar | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-calendar-002 | calendar | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-calendar-008 | calendar | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-calendar-013 | calendar | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-agents-001 | agents | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-agents-012 | agents | medium | FIXED_PENDING_VERIFY | 585a56bf6 |
| FIX-marketing-010 | marketing | medium | FIXED_PENDING_VERIFY | 585a56bf6 |

## Mediums — clinic records and footprint edit

An unpaid veterinary invoice can be deleted. A paid one is voided and the payment stays. A prescription can be discontinued. Deleting a patient removes that patient's invoices and prescriptions. A pharmacy price, a journal note, and a taken dose can be removed, and undoing a taken dose puts the pill back. A footprint snapshot's label can be edited.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-veterinary-007 | veterinary | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |
| FIX-veterinary-008 | veterinary | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |
| FIX-pharmacy-010 | pharmacy | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |
| FIX-pharmacy-011 | pharmacy | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |
| FIX-pharmacy-012 | pharmacy | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |
| FIX-eco-005 | eco | medium | FIXED_PENDING_VERIFY | bd3d0e1b5 |

## Mediums — type, arguments, names, studio

An entity node can change type after it is created. A floor argument can be removed. A construction row is titled with the record name, not the default trade. The marketing studio stays on the tab you picked, and a typed ROI is labeled as the numbers you entered rather than the campaign's recorded ROAS.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-entity-002 | entity | medium | FIXED_PENDING_VERIFY | 16d7fe919 |
| FIX-debate-012 | debate | medium | FIXED_PENDING_VERIFY | 16d7fe919 |
| FIX-construction-004 | construction | medium | FIXED_PENDING_VERIFY | 16d7fe919 |
| FIX-marketing-001 | marketing | medium | FIXED_PENDING_VERIFY | 16d7fe919 |
| FIX-marketing-013 | marketing | medium | FIXED_PENDING_VERIFY | 16d7fe919 |

## Mediums — markets, pacts, board dates

Closing soon lists a market that is still open before one whose close has passed. Volume follows recorded trades. A Politics chip matches a politics market. A pact share of 0, or shares that do not add to 100, is refused, and a 0-day term is refused on write and on renew. A date-only due date is read as that calendar day, and In Progress counts Doing, review, and testing. A pledge over the single-entity cap says what the cap is. The logistics on-time card shows a dash when there is no delivered sample. FIX-logistics-004 stays open because the dashboard can still disagree with other panels until reload.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-markets-004 | markets | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-markets-005 | markets | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-death-insurance-002 | death-insurance | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-death-insurance-004 | death-insurance | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-board-003 | board | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-board-005 | board | medium | FIXED_PENDING_VERIFY | b4e5eb744 |
| FIX-civic-bonds-004 | civic-bonds | medium | FIXED_PENDING_VERIFY | b4e5eb744 |

## Mediums — records, drafts, and a trade confirm

A pickup, dock, appointment, load, proof of delivery, and freight invoice can be deleted, and deleting a shipment removes its proof. A shipment row shows its PO number and those fields can be saved. A new goal form clears its draft, category, and priority on cancel and after save. Checking a step sets the percent from the steps, and marking a goal complete checks every step. A quote compare refuses a ZIP that is not 5 digits before it asks a broker. Generate Abstract reads the manuscript sections, states both minimums in one message, and writes the abstract into the Abstract section. A manuscript can be deleted from the card and from the top of the detail panel. A pooled bet and a limit order ask for confirm before they fill. FIX-logistics-003 stays open for carrier, pickup, and dock renames. FIX-logistics-004 stays open because the dashboard can still disagree until reload.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-logistics-002 | logistics | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-goals-005 | goals | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-goals-003 | goals | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-insurance-013 | insurance | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-paper-009 | paper | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-paper-013 | paper | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |
| FIX-markets-016 | markets | medium | FIXED_PENDING_VERIFY | dfd9f2fb2 |

## Mediums — codebases, teams, and a stopped reply

A codebase and a team can be renamed and deleted by the owner. Teams you belong to are listed after reload. An invite code is shown once, can be copied, and then hidden. A question that names an indexed file quotes that file's stored lines. Chat history for that question still clears on reload. A weight lookup says what is missing instead of staying blank. Stopping a reply no longer toasts an abort error. A turn the server already accepted can still be in the history after reload. FIX-dx-platform-003 stays open because a one-character team name is still accepted. FIX-dx-platform-011 and FIX-dx-platform-012 stay open: the editor listings are not published here, and there is no API-keys page on that path.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-dx-platform-001 | dx-platform | medium | FIXED_PENDING_VERIFY | 817ac01c5 |
| FIX-dx-platform-002 | dx-platform | medium | FIXED_PENDING_VERIFY | 817ac01c5 |
| FIX-dx-platform-013 | dx-platform | medium | FIXED_PENDING_VERIFY | 817ac01c5 |
| FIX-dx-platform-014 | dx-platform | medium | FIXED_PENDING_VERIFY | 817ac01c5 |
| FIX-dx-platform-015 | dx-platform | medium | FIXED_PENDING_VERIFY | 817ac01c5 |
| FIX-chat-004 | chat | medium | FIXED_PENDING_VERIFY | 817ac01c5 |

## Mediums — shipment reference, names, and waste

Exceptions, damage, delay risk, and GPS accept the SHP reference, tracking number, or PO the list shows. A carrier, pickup confirmation, and dock name can be edited. The logistics dashboard refetches when you change views, and on-time stays a dash when nothing has been delivered. A team name has to be 2 to 80 characters, and a one-character name says so. A waste report shows kilograms only when the log is in kilograms, otherwise a dash. A trades job needs a name. A dream tag that is too long or past the twelfth is named instead of disappearing.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-logistics-005 | logistics | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-logistics-003 | logistics | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-logistics-004 | logistics | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-food-004 | food | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-trades-009 | trades | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-dreams-002 | dreams | medium | FIXED_PENDING_VERIFY | 99e9ad301 |
| FIX-dx-platform-003 | dx-platform | low | FIXED_PENDING_VERIFY | 99e9ad301 |

## Mediums — floor, mail, and a signature note

Creating a floor debate also creates the argument-map debate, and a floor argument is added to that map. The floor phase and the selected debate stay for the session when you leave and come back. An argument's text can be edited. A mail recipient that is blank, spaced, or not an address shows the error on the field, and a name the server does not know does too. An e-sign email is labeled as stored on the envelope, not sent.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-debate-009 | debate | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |
| FIX-debate-010 | debate | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |
| FIX-debate-011 | debate | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |
| FIX-debate-014 | debate | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |
| FIX-mail-001 | mail | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |
| FIX-insurance-007 | insurance | medium | FIXED_PENDING_VERIFY | 2cf9ea422 |

## Mediums — numbers, emails, and a water key

A model refuses a negative poly count, a file size that is not a size, and a source URL that is not http. A transform field keeps a minus sign while you type it. A board title over 200 characters and a shoot day below 1 say so, and a negative review duration is refused. A party email has to include a name and a domain. An experiment name over 200 characters, or epochs or a batch size below 1, stays in the form. Import accepts the word water as the Water reading, and the log form shows Metric and Value.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-ar-005 | ar | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-ar-002 | ar | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-creative-001 | creative | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-creative-002 | creative | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-tools-002 | tools | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-ml-005 | ml | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-self-009 | self | medium | FIXED_PENDING_VERIFY | 736b75bb5 |
| FIX-self-003 | self | medium | FIXED_PENDING_VERIFY | 736b75bb5 |

## Mediums — meals, objectives, and quotes

A generated meal keeps a calorie count only when that meal has one. The day's total is not copied onto every meal. Deleting an objective removes its check-ins. Using a template creates the objective and its key results, and a recurring goal only when you ask for one. A quote asks before it is sent, and a draft quote, a customer, and a job can be deleted after confirm. An accepted quote stays. Paying a pact premium moves the next due date out of the soon window, and a decline shows up for the writer. A tied debate has no winner. Index says to add a file before it will run. A mail subject shows how many of 120 characters are used.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-food-003 | food | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-goals-006 | goals | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-goals-011 | goals | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-trades-003 | trades | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-trades-010 | trades | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-death-insurance-005 | death-insurance | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-death-insurance-009 | death-insurance | medium | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-trades-012 | trades | low | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-dx-platform-004 | dx-platform | low | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-mail-005 | mail | low | FIXED_PENDING_VERIFY | e13c721d5 |
| FIX-debate-018 | debate | low | FIXED_PENDING_VERIFY | e13c721d5 |

## Mediums — readings, envelopes, and a blank principal

A wellness reading outside its range is refused, including sleep past 24 hours, negative water, HRV below zero, and minutes asleep greater than minutes in bed. The HRV field keeps a minus sign and says it cannot be negative, instead of turning -10 into 10. A logged self reading can be edited to another in-range value, and delete still asks first. An envelope can be voided only after confirm, deleted after confirm, and the list sorts by title. A new lesson type has an accessible name. The stake principal starts empty, with 10 as the placeholder, so typing does not append onto a prefilled 100. Slash focuses the species filter when the key is not already in a field.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-wellness-002 | wellness | medium | FIXED_PENDING_VERIFY | e71ac66ec |
| FIX-self-002 | self | medium | FIXED_PENDING_VERIFY | e71ac66ec |
| FIX-tools-003 | tools | medium | FIXED_PENDING_VERIFY | e71ac66ec |
| FIX-education-008 | education | medium | FIXED_PENDING_VERIFY | e71ac66ec |
| FIX-staking-011 | staking | medium | FIXED_PENDING_VERIFY | e71ac66ec |
| FIX-creatures-003 | creatures | medium | FIXED_PENDING_VERIFY | e71ac66ec |

## Mediums — playback, a transcript, and a path

A booth take shows elapsed time against its duration while it plays, and Best toggles off when it is already the best take. Adding a transcript says what is missing, Enter commits a segment edit, and a saved recording says it was added. A recent live session opens when its row is clicked, so an orphan session can be ended from the open session. Planning a learning path reads the returned steps, and a failed or empty plan says so on the panel.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-voice-006 | voice | medium | FIXED_PENDING_VERIFY | 5f94ffe27 |
| FIX-voice-007 | voice | medium | FIXED_PENDING_VERIFY | 5f94ffe27 |
| FIX-voice-008 | voice | medium | FIXED_PENDING_VERIFY | 5f94ffe27 |
| FIX-education-004 | education | medium | FIXED_PENDING_VERIFY | 5f94ffe27 |

## Mediums — a world name, a draft, and a persona

A world name over 64 characters is refused, and the field shows the count. Typing the name or the description is not replaced by a refresh, so the caret stays and the start of the description is what gets saved. Deleting a draft stays armed until confirm, then the delete is written before the response returns. Entering a playtested world uses the minted world id, and the world page opens on that id. Persona tabs wrap, so Create and NPC Packaging stay on the screen. Marketplace search and sort have names. A persona you authored has Save as DTU. A packaged NPC's id and DTU id can be copied into the package and install fields.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-world-creator-001 | world-creator | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-world-creator-002 | world-creator | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-world-creator-003 | world-creator | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-world-creator-004 | world-creator | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-world-creator-014 | world-creator | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-personas-008 | personas | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-personas-010 | personas | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-personas-014 | personas | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |
| FIX-personas-015 | personas | medium | FIXED_PENDING_VERIFY | 0ce36b3b4 |

## Mediums — a saved translation, a chat title, and a balance

Saving a translation says it was saved. Keep as DTU says the private DTU id, or why it was not saved. Draft in Thread says it stays off until that DTU reads back. A renamed chat keeps the title you saved when the session list reloads, including the spaces inside it. The composer control that opens ConKay is labeled ConKay. Staking shows the CC balance, or that it is unavailable. A dictionary lookup reads the definitions that came back, and says when none did.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-translation-001 | translation | medium | FIXED_PENDING_VERIFY | 029e5e945 |
| FIX-translation-002 | translation | medium | FIXED_PENDING_VERIFY | 029e5e945 |
| FIX-chat-003 | chat | medium | FIXED_PENDING_VERIFY | 029e5e945 |
| FIX-chat-005 | chat | medium | FIXED_PENDING_VERIFY | 029e5e945 |
| FIX-staking-004 | staking | medium | FIXED_PENDING_VERIFY | 029e5e945 |
| FIX-education-003 | education | medium | FIXED_PENDING_VERIFY | 029e5e945 |

## Mediums — a filtered library, an expense search, and a confirm

The paper library's Papers count is the list on screen. Expenses can be searched, limited by date, and sorted newest or oldest. On a phone with a coarse pointer, selects and checkboxes use the 44px minimum. Creating a path says it needs a title and at least one course. Deleting an activity or a route, and retiring gear, stays armed until confirm. An HRV reading can be removed.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-paper-001 | paper | medium | FIXED_PENDING_VERIFY | 9856a1384 |
| FIX-accounting-004 | accounting | medium | FIXED_PENDING_VERIFY | 9856a1384 |
| FIX-staking-012 | staking | medium | FIXED_PENDING_VERIFY | 9856a1384 |
| FIX-education-005 | education | medium | FIXED_PENDING_VERIFY | 9856a1384 |
| FIX-fitness-009 | fitness | medium | FIXED_PENDING_VERIFY | 9856a1384 |

## Mediums — the same year, a saved manuscript, and a club

Ratios count revenue in the same year-to-date window as the P&L. The manuscript header wraps, the new-item title takes focus, and the year field does not autocomplete. Saving or opening a paper gives the share control that manuscript, so the link is not the bare lens and marketplace publish is no longer waiting for a save. The owner can delete a segment, a club, a challenge, or a workout, and a club with no members left is removed. A PR publish shows the server's reason when it does not return a DTU id. The creatures list keeps space under the pen button.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-accounting-005 | accounting | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-paper-014 | paper | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-paper-010 | paper | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-paper-011 | paper | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-fitness-014 | fitness | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-fitness-015 | fitness | medium | FIXED_PENDING_VERIFY | 660c04b7e |
| FIX-creatures-010 | creatures | medium | FIXED_PENDING_VERIFY | 660c04b7e |


## Mediums — a glossary term, and formal Spanish

A glossary term the model left in English is written as the target. A target the model wrote without its accent gets the accent back. A term the model rendered as different wording stays a miss. Formal Spanish uses usted. Neutral is left as the model wrote it.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-translation-003 | translation | medium | FIXED_PENDING_VERIFY | dc43b1d5b |
| FIX-translation-004 | translation | medium | FIXED_PENDING_VERIFY | dc43b1d5b |


## Mediums — stakes, species, quests, outages, and bonds

Export downloads the caller's staking positions, receipts, and yield. It downloads the authored species codex. It downloads quests this account accepted, telecom outages on this account, and civic bonds and pledges on this account.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-staking-005 | staking | medium | FIXED_PENDING_VERIFY | bcc898ff4 |
| FIX-creatures-005 | creatures | medium | FIXED_PENDING_VERIFY | bcc898ff4 |
| FIX-quests-002 | quests | medium | FIXED_PENDING_VERIFY | bcc898ff4 |
| FIX-telecommunications-004 | telecommunications | medium | FIXED_PENDING_VERIFY | bcc898ff4 |
| FIX-civic-bonds-007 | civic-bonds | medium | FIXED_PENDING_VERIFY | bcc898ff4 |


## Mediums — an expense, a void, and a credit note

An expense row opens its number and journal id. Edit saves vendor, memo, date, amount, and account. Changing the amount or the account posts a reversing entry and a new one. Void keeps the expense on the list and posts the reversal. An open invoice can be voided after confirm. A paid invoice can take a credit note for its total after confirm.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-accounting-010 | accounting | medium | FIXED_PENDING_VERIFY | cf73a03d2 |
| FIX-accounting-014 | accounting | medium | FIXED_PENDING_VERIFY | cf73a03d2 |


## Mediums — a welding procedure

A WPS does not save until filler metal, amperage range, and thickness range are filled in. A leading minus is refused, and the form says so. A range written as 90-140 is accepted. A PQR needs the welder and the WPS it supports.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-welding-001 | welding | medium | FIXED_PENDING_VERIFY | cca126343 |


## Mediums — an HVAC name, and a sort

A job name stops at 120 characters. The field shows how many are used and says a longer name is cut off. The list sorts newest, oldest, or by name.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-hvac-009 | hvac | medium | FIXED_PENDING_VERIFY | a2ad101c3 |
| FIX-hvac-010 | hvac | medium | FIXED_PENDING_VERIFY | a2ad101c3 |


## Mediums — confirm before those deletes

An ethics result, a sentinel monitor, and a telecom site stay armed until Confirm or Cancel. A spectrum allocation uses the same confirm.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-ethics-007 | ethics | medium | FIXED_PENDING_VERIFY | ad1c4cbea |
| FIX-sentinel-003 | sentinel | medium | FIXED_PENDING_VERIFY | ad1c4cbea |
| FIX-telecommunications-002 | telecommunications | medium | FIXED_PENDING_VERIFY | ad1c4cbea |


## Mediums — a stale market snapshot

When CoinGecko is down, Markets says the live feed is unavailable and offers Retry. Prices from the last snapshot stay hidden until Show last snapshot. An error with no snapshot still shows nothing in its place.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-staking-008 | staking | medium | FIXED_PENDING_VERIFY | 0fa0929d8 |


## Mediums — the next workout

Next workout shows the answer the agent returned. When that answer is missing, the panel shows the reason.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-fitness-016 | fitness | medium | FIXED_PENDING_VERIFY | 07da7d7be |


## Mediums — tabs and tap targets

Quest tabs keep the full word, including Available, and the row scrolls sideways. Refresh, share, claim, export, and the lens tools menu are at least 44px on a phone. Codex search, resolve, lineage view, population rows, and breed are at least 44px.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-creatures-011 | creatures | medium | FIXED_PENDING_VERIFY | 4fe37407c |
| FIX-quests-007 | quests | medium | FIXED_PENDING_VERIFY | 4fe37407c |
| FIX-quests-008 | quests | medium | FIXED_PENDING_VERIFY | 4fe37407c |

## Mediums — a form says why it will not save

A ticket sale cannot end before it starts. A housing claim needs an x and a z. A listing price above 100,000,000 is refused, and a huge price reads as billions instead of a broken K. An auction needs an item, a start above 0, a duration from 60 seconds to 24 hours, a buyout at least the start, and a title of at most 120 characters. A quest reward under 1, or above the balance, keeps Post off. A repo name that is blank or full of punctuation says so, and letters, spaces, and café still work. An assignment dated as a day with no time is due at 11:59pm, and a broken due string is refused. Schedule a job says the title is required while that button is off.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-events-002 | events | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-housing-002 | housing | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-realestate-003 | realestate | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-auction-003 | auction | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-questmarket-002 | questmarket | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-repos-001 | repos | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-classroom-009 | classroom | medium | FIXED_PENDING_VERIFY | 6fe52060d |
| FIX-landscaping-003 | landscaping | medium | FIXED_PENDING_VERIFY | 6fe52060d |

## Mediums — the caller's own records are in the export

The file includes this person's estate, earned achievements, fish in inventory, and vehicles in every world. It includes vault submissions they filed. A logistics shipment keeps its origin, destination, consignee, and reference. A pet keeps its name. A schema registry entry they own keeps its name. Another person's rows stay out. System feed posts can still sit beside a fishing export. Chat notes the caller already owns can still sit beside a schema export.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-inheritance-006 | inheritance | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-achievements-002 | achievements | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-fishing-001 | fishing | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-garage-002 | garage | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-vault-003 | vault | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-logistics-007 | logistics | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-pets-002 | pets | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |
| FIX-schema-008 | schema | medium | FIXED_PENDING_VERIFY | 8137e8ca6 |

## Mediums — a calendar day stays the day you typed

A gift, a shift, a filed date, a deadline, and a welding job dated YYYY-MM-DD show that day. They no longer slip back one day in US timezones. A law case can be deleted after a confirm click.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-nonprofit-002 | nonprofit | medium | FIXED_PENDING_VERIFY | 488325c97 |
| FIX-legal-003 | legal | medium | FIXED_PENDING_VERIFY | 488325c97 |
| FIX-law-004 | law | medium | FIXED_PENDING_VERIFY | 488325c97 |
| FIX-welding-003 | welding | medium | FIXED_PENDING_VERIFY | 488325c97 |

## Mediums — the study desk tells the truth

Rating a due card shows the next card that is still due. The session says all caught up only when none remain. Adding a note that is already scheduled says when it comes back, and notes that are waiting can be removed from the list. A learning step that is not a number of minutes is refused and the old steps stay. Move deck under does not offer the deck or its own children.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-srs-001 | srs | medium | FIXED_PENDING_VERIFY | 9405332a2 |
| FIX-srs-004 | srs | medium | FIXED_PENDING_VERIFY | 9405332a2 |
| FIX-srs-002 | srs | medium | FIXED_PENDING_VERIFY | 9405332a2 |

## Mediums — a count matches the records behind it

Overview recurring donors include people with an active pledge. Harvest progress stays at 0% while the only lot is still planned, and the farm field count is the Fields list. While those lists are still loading the desk says Loading instead of 0. A dream composed at 02:22 UTC groups on the previous evening in US time, the same evening the card shows. An estranged courtship at 93% offers Propose. Below that line it says affinity has to reach the engage percent before you can propose again. A widowed courtship does not offer Propose. Wave energy for a 1 m significant height is about 1257 J/m².

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-nonprofit-003 | nonprofit | medium | FIXED_PENDING_VERIFY | 899e2b000 |
| FIX-agriculture-002 | agriculture | medium | FIXED_PENDING_VERIFY | 899e2b000 |
| FIX-dreams-009 | dreams | medium | FIXED_PENDING_VERIFY | 899e2b000 |
| FIX-courtship-002 | courtship | medium | FIXED_PENDING_VERIFY | 899e2b000 |
| FIX-courtship-006 | courtship | medium | FIXED_PENDING_VERIFY | 899e2b000 |
| FIX-ocean-001 | ocean | medium | FIXED_PENDING_VERIFY | 899e2b000 |

## Mediums — a bad value stays on the form

A scene location longer than 120 characters is refused and the scene keeps its old location. A tournament title longer than 120 characters stays on the create form, and the list does not turn into a load error. A gallery image has to be an http or https link. A webhook has to be https. An API key with spaces, or longer than 256 characters, is not saved. Forge validate names a port outside 1–65535 and an app name longer than 64 characters. Compatibility capabilities keep every term around a comma, so x, y against y, z overlaps on y. An aviation title longer than 200 characters shows the limit and the editor stays open. Alliance risk still does not save its rows: there is no dependency record to reload, so FIX-alliance-002 stays open.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-film-studios-001 | film-studios | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-tournaments-001 | tournaments | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-gallery-002 | gallery | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-integrations-002 | integrations | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-byo-keys-005 | byo-keys | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-forge-004 | forge | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-alliance-001 | alliance | medium | FIXED_PENDING_VERIFY | 1add00938 |
| FIX-aviation-003 | aviation | medium | FIXED_PENDING_VERIFY | 1add00938 |

## Mediums — delete asks first

The first click on these rows only arms the confirm. The record stays until Confirm. A forecast dataset row click does not delete the dataset. Consulting still has no void or credit note. The electrical job list can still lag one reload after a confirmed delete; that lag was not changed.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-temporal-002 | temporal | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-sandbox-003 | sandbox | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-astronomy-002 | astronomy | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-sports-001 | sports | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-consulting-010 | consulting | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-electrical-006 | electrical | medium | FIXED_PENDING_VERIFY | 87d6789a8 |
| FIX-finance-007 | finance | medium | FIXED_PENDING_VERIFY | 87d6789a8 |

## Mediums — the screen shows the value it measured

A 12 AWG ampacity line shows 25A, the ampacity of that gauge. ISS speed is the live km/h reading divided by 3600, and 51.6° is labeled as the catalog orbit because the live feed does not send inclination. Stress and error rate show the measured percent, so a high number says elevated stress or that errors were detected. A ledger row you paid, including a stake escrow, shows as a debit. A long unbroken timeline post wraps inside the card. The agenda title uses the same weight as the day row, so it stays readable beside the description. Switching expedition worlds clears the previous world's stages and the heading is the world you selected. Inbox rows and the conversation header use the display name the server resolved.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-electrical-001 | electrical | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-space-001 | space | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-tick-001 | tick | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-wallet-004 | wallet | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-timeline-003 | timeline | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-calendar-004 | calendar | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-expedition-journal-002 | expedition-journal | medium | FIXED_PENDING_VERIFY | b376d6dad |
| FIX-social-016 | social | medium | FIXED_PENDING_VERIFY | b376d6dad |

## Mediums — a bad number is refused

A forecast point that is blank, not a number, or dated with text that is not a date shows that error and no slope. A plan price or a tax amount that is not a finite number from 0 to 1,000,000,000 is refused, and a tax rate outside 0 to 1 is refused. An omitted plan price stays 0. Typing a job title clears the "Job title required" banner. A DIY hours, cost, budget, quantity, or price field that is filled with junk or a negative number shows the problem and Save stays off. A bridge flow refuses a negative record count. A negative alert threshold was already refused. Supply chain refuses a score outside 0 to 100, a missing inventory number, an alpha below 0.05, a season length below 2, a service-level Z outside 0 to 5, and a negative demand, lead time, stock, quantity, or unit cost. An alpha above 0.95 is still clamped to 0.95.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-analytics-003 | analytics | medium | FIXED_PENDING_VERIFY | e5b76baba |
| FIX-billing-002 | billing | medium | FIXED_PENDING_VERIFY | e5b76baba |
| FIX-plumbing-006 | plumbing | medium | FIXED_PENDING_VERIFY | e5b76baba |
| FIX-diy-005 | diy | medium | FIXED_PENDING_VERIFY | e5b76baba |
| FIX-bridge-004 | bridge | medium | FIXED_PENDING_VERIFY | e5b76baba |
| FIX-supplychain-003 | supplychain | medium | FIXED_PENDING_VERIFY | e5b76baba |

## Mediums — the list uses the filter the screen asked for

My Vault no longer lists automatic chat replies or the megas built from them. A message you chose to keep still appears. The global explorer applies the tag you typed, including a tag that matches nothing, so an unknown tag shows an empty page instead of the unfiltered list.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-chat-011 | chat | medium | FIXED_PENDING_VERIFY | adc77b53d |
| FIX-global-001 | global | medium | FIXED_PENDING_VERIFY | adc77b53d |

## Mediums — the date and the gratitude words

A Wikipedia timeline skips a bare number next to an alarm code, such as 1201. A sentence with a calendar date, including July 20, 1969, is kept when the list is capped, and a long lead sentence is still read. A gratitude entry stored as an object shows the words in its text, note, or body. A line that was already saved as the literal text "[object Object]" has no words left to recover.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-history-001 | history | medium | FIXED_PENDING_VERIFY | df722f571 |
| FIX-mental-health-003 | mental-health | medium | FIXED_PENDING_VERIFY | df722f571 |

## Mediums — the control does what its label says

Manual brain refresh stays off unless you are signed in as an owner, admin, or sovereign, including while the session is still loading. The page says why the buttons are off. A category chip on the event firehose shows only that category. Clicking the same chip again brings every category back, so Combat no longer leaves Other events such as graph:update on screen.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-lattice-006 | lattice | medium | FIXED_PENDING_VERIFY | 8a0a46311 |
| FIX-event-timeline-001 | event-timeline | medium | FIXED_PENDING_VERIFY | 8a0a46311 |

## Mediums — the number on screen matches the records

A series with a clear repeating period reports that period and a seasonal share. A flat series reports a share of zero. An outlier that stands away from its neighbors is flagged. The wellness trend average is the mean of every sample in the window, including two logs on the same day. Saving a log updates the overview counts and the daily recommendation. A differential-privacy call that would spend more than the remaining budget is refused, and that call adds nothing to the spent total. A call that uses exactly the remaining budget still goes through.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-temporal-001 | temporal | medium | FIXED_PENDING_VERIFY | 7410edd72 |
| FIX-wellness-003 | wellness | medium | FIXED_PENDING_VERIFY | 7410edd72 |
| FIX-anon-001 | anon | medium | FIXED_PENDING_VERIFY | 7410edd72 |

## Mediums — the control matches the record it changes

An open pledge ledger reloads after a pledge or an unpledge, so a bond that just received a pledge no longer says none were recorded. The canvas button says Save brush, and it saves the tool, size, and opacity. The artwork still saves on its own. When the wallet has no holdings, price alerts and the swap form list Bitcoin, Ether, Solana, and the other quoted tokens. A swap amount that is empty, zero, negative, or above 1e12 is refused before a quote. A heir id that is blank, longer than 80 characters, or full of characters a user id does not use is refused, and a saved id is shown in full.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-civic-bonds-003 | civic-bonds | medium | FIXED_PENDING_VERIFY | 93935a096 |
| FIX-art-002 | art | medium | FIXED_PENDING_VERIFY | 93935a096 |
| FIX-crypto-005 | crypto | medium | FIXED_PENDING_VERIFY | 93935a096 |
| FIX-crypto-006 | crypto | medium | FIXED_PENDING_VERIFY | 93935a096 |
| FIX-inheritance-002 | inheritance | medium | FIXED_PENDING_VERIFY | 93935a096 |

## Mediums — a cap, a confirm, and a version you can pick

The consulting timer stops counting at 12 hours and says to stop and log those hours, or discard the timer. Deleting an engagement that already has logged time asks first and names the hours. The server refuses that delete until the confirm is sent. An engagement with no time still deletes immediately. Analyze flags eval() and new Function() as high findings. Saving a fractal preset under a name that already exists updates that preset. Diff and Migration list every saved version of a schema. Sample data still uses the latest version.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-consulting-002 | consulting | medium | FIXED_PENDING_VERIFY | be2038094 |
| FIX-consulting-011 | consulting | medium | FIXED_PENDING_VERIFY | be2038094 |
| FIX-code-quality-002 | code-quality | medium | FIXED_PENDING_VERIFY | be2038094 |
| FIX-fractal-002 | fractal | medium | FIXED_PENDING_VERIFY | be2038094 |
| FIX-schema-007 | schema | medium | FIXED_PENDING_VERIFY | be2038094 |

## Mediums — a refused wage, and a contract that can hold a value

A counter-offer wage that is blank, not a number, negative, or above 1,000,000 stays on the form and says the wage has to be a number from 0 to 1,000,000. The server refuses the same numbers and does not change the standing offer. A new contract has fields for value, effective date, and expiry date. An empty title says a contract needs a title. A value that is not a number, or is negative, is refused before the call.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-careers-001 | careers | medium | FIXED_PENDING_VERIFY | 49ac1a477 |
| FIX-law-002 | law | medium | FIXED_PENDING_VERIFY | 49ac1a477 |

## Mediums — move through the photos, and a map list that can fail out loud

The photo viewer has Previous and Next, shows which photo this is, and the left and right arrow keys move through the photos on screen. Tab stays inside the open viewer instead of reaching the page behind it. Maps and Mind map show the load error when the list call fails, and the spinner stops. An empty list with no error still says no maps yet.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-photos-002 | photos | medium | FIXED_PENDING_VERIFY | 88e56a83c |
| FIX-photos-003 | photos | medium | FIXED_PENDING_VERIFY | 88e56a83c |
| FIX-graph-006 | graph | medium | FIXED_PENDING_VERIFY | 88e56a83c |

## Mediums — the last scan comes back, and Issues can track one

Reloading the code-quality page brings back the last analyze when that scan stored its source, and the editor fills with that source if it is still empty. Older scans that did not store source stay as findings only. The Issues tab has a form for a rule, a message, and a severity. Tracking one adds it to the list.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-code-quality-004 | code-quality | medium | FIXED_PENDING_VERIFY | 7fcc64fb8 |
| FIX-code-quality-007 | code-quality | medium | FIXED_PENDING_VERIFY | 7fcc64fb8 |

## Mediums — the number on screen is the one the action computed

Volume and growth share one board-foot curve. At site index 80 a 20-year Douglas-fir is 143 board feet per tree, and both screens show that formula. Growth multiplies by trees per acre (100 if you leave it blank). Discover lists the higher favorite count first, and recent uses the real created date. The card labels the star as favorites and the other number as pop. A price-book markup shows the new price as you type and saves when you leave the field. A lead score shows opens × 2, clicks × 6, views × 3, and submits × 20. A welding job with no estimate, contract, or amount does not become a $0 invoice. An amount you enter is a line, the invoice lists its lines, and an unpaid invoice can change its due date.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-forestry-006 | forestry | medium | FIXED_PENDING_VERIFY | 34da5468e |
| FIX-sub-worlds-005 | sub-worlds | medium | FIXED_PENDING_VERIFY | 34da5468e |
| FIX-plumbing-014 | plumbing | medium | FIXED_PENDING_VERIFY | 34da5468e |
| FIX-marketing-011 | marketing | medium | FIXED_PENDING_VERIFY | 34da5468e |
| FIX-welding-011 | welding | medium | FIXED_PENDING_VERIFY | 34da5468e |

## Mediums — edit the record that is already saved

A stand, robot, landscaping client, and sky target can be changed from the row that lists it. Event delete stays on the row and asks first. Open a case opens a blank case.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-forestry-001 | forestry | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |
| FIX-astronomy-001 | astronomy | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |
| FIX-robotics-002 | robotics | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |
| FIX-landscaping-010 | landscaping | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |
| FIX-analytics-004 | analytics | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |
| FIX-security-003 | security | medium | FIXED_PENDING_VERIFY | ed7d9ea10 |

## Mediums — ask before a destructive change, and do not save a preview

Watchlist remove asks before the search is deleted. A weld photo has to be an http or https link, and Remove asks first. A photo is still a link. Calculate load shows the numbers and leaves history alone until Save estimate. Deleting a saved model asks first and clears that model's reopen id, so Studio does not toast that a deleted model was not found. Restore asks before it replaces the current world. Squawks and remarks stay with the flight that was open. Archive, Leave, and Delete material ask before they run.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-black-market-013 | black-market | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-welding-012 | welding | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-hvac-014 | hvac | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-sim-006 | sim | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-worldmodel-002 | worldmodel | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-aviation-006 | aviation | medium | FIXED_PENDING_VERIFY | 12de88a84 |
| FIX-classroom-004 | classroom | medium | FIXED_PENDING_VERIFY | 12de88a84 |

## Mediums — edit a task from the list and a pipeline item from its card

Edit on a task opens the title, date, and priority form that was already on the task detail. Edit on a pipeline card changes the title, format, and date, and Save writes them.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-productivity-005 | productivity | medium | FIXED_PENDING_VERIFY | 0e9a7ce64 |
| FIX-creator-001 | creator | medium | FIXED_PENDING_VERIFY | 0e9a7ce64 |

## Mediums — publish the minutes you wrote, and say why a public save was refused

Public minutes send the motion, the decisions, and the action items as the note. A council refusal names the reason and the score the server returned. The society publish panel shows that same sentence.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-council-010 | council | medium | FIXED_PENDING_VERIFY | 6f278ce3c |
| FIX-society-003 | society | medium | FIXED_PENDING_VERIFY | 6f278ce3c |

## Mediums — counts that match the screen, and a compile that refuses bad source

Mesh Overview counts this node in the online total, and the Messages tab uses the same message total as Overview. Unread stays its own number. All messages is the opening view, and Send stays off until a conversation is picked. Queueing theory Analyze says it needs at least two arrivals or two completions. A cancelled sponsorship stays on My Sponsorships with Dispatch history, and Resume is only for a paused one. Total pledged is the sum of recorded pledge charges, including cancelled ones, and the page says the monthly figure is the next active pledge. Fork lab says divergence is how much of the file changed, and merge complexity is overlapping edits. Tools compile reports a syntax error for source that is not valid JavaScript and does not save that attempt as a success. This build still has no esbuild, so valid TypeScript uses the strip-types fallback and says so.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-mesh-004 | mesh | medium | FIXED_PENDING_VERIFY | 15dc2ffe2 |
| FIX-queue-013 | queue | medium | FIXED_PENDING_VERIFY | 15dc2ffe2 |
| FIX-sponsorship-001 | sponsorship | medium | FIXED_PENDING_VERIFY | 15dc2ffe2 |
| FIX-fork-005 | fork | medium | FIXED_PENDING_VERIFY | 15dc2ffe2 |
| FIX-tools-005 | tools | medium | FIXED_PENDING_VERIFY | 15dc2ffe2 |


## Highs — a desk save uses the status the form sends

A realestate deal, listing, or rental saves with the status the desk offers, including prospecting, active, and vacant. A security incident, asset, or access record saves too, including detected and active. Access is a record type the server accepts. A save that is still refused names the status in the error, instead of only saying validation failed.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-realestate-001 | realestate | high | FIXED_PENDING_VERIFY | c857bf35c |
| FIX-security-001 | security | high | FIXED_PENDING_VERIFY | c857bf35c |

## Highs — a scratch save keeps the script

Hover on a scratch file no longer answers "symbol or position required" when the cursor is already placed. Save writes the buffer immediately, and a reload restores the latest saved script when the live file is empty.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-code-001 | code | high | FIXED_PENDING_VERIFY | a3de11723 |

## Highs — send the DTU you picked

Transmit finds a DTU in your own list as well as the shared store. Someone else's private DTU is still refused.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-mesh-002 | mesh | high | FIXED_PENDING_VERIFY | 1de6f7c28 |

## Highs — Sync unlocks counts the DTUs you have

Sync unlocks counts DTUs this account owns. One unlocks First DTU. Twenty-five unlocks Creator. Sparks follow the catalog. A new DTU carries the owner so the check can see who created it.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-achievements-001 | achievements | high | FIXED_PENDING_VERIFY | cdb569e6e |

## Highs — a published listing is on Browse

Browse lists published storefront listings. Checkout buys that listing. The extra list no longer says the listing is waiting on an approval step.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-marketplace-001 | marketplace | high | FIXED_PENDING_VERIFY | 629edd61b |

## Highs — a thought unit you cannot open is a page

A direct link to a missing or private thought unit explains that, instead of the browser saying the site cannot be reached. A public thought unit still opens.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-cognition-009 | cognition | high | FIXED_PENDING_VERIFY | 93043a929 |

## Highs — the upload zone opens a file

The episode upload zone is a label for a real file input. A click opens the chooser. A drop attaches the file.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-podcast-006 | podcast | high | FIXED_PENDING_VERIFY | cdaab0129 |

## Highs — a recording title stays on the card

A new title stops at 120 characters. A long title wraps inside the row.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-voice-001 | voice | high | FIXED_PENDING_VERIFY | 8d0792e52 |

## Highs — offline matches the banner, and the queue drains

The connectivity card says Offline when the browser or the live link is down. Coming back online pushes the pending writes.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-offline-001 | offline | high | FIXED_PENDING_VERIFY | 4e4f69c44 |
| FIX-offline-002 | offline | high | FIXED_PENDING_VERIFY | 4e4f69c44 |

## Highs — the pen opens, and a creature can be published

Open the pen shows the crossbreeding pen and says when it is empty. Publish creature takes a species id, creates the creature, and refreshes the roster.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-creatures-001 | creatures | high | FIXED_PENDING_VERIFY | e002f0047 |
| FIX-creatures-002 | creatures | high | FIXED_PENDING_VERIFY | e002f0047 |

## Highs left open

These stayed OPEN. The note is the reason.

| Ticket | Why it is still open |
|---|---|
| FIX-music-001 | Export schedules from beat 0. The 16.75s silence was not reproduced from the renderer alone. |
| FIX-finance-002 | Cash 10 + investments 5 − liabilities 3 is 12 in the snapshot. The header Net worth is the account total. The audit inputs were unreadable. |
| FIX-finance-003 | An amount of 5 is stored as 5. Nothing in the save path produces −55. |
| FIX-retail-001 | Product create is on the Catalog tab inside the workbench, which starts closed. A Products tab on the main page was not mounted. |
| FIX-aviation-002 | Fleet aircraft and the logbook dropdown are different lists, and Log flight is quiet when a field is empty. The two stores were not joined. |
| FIX-services-002 | A booking-suite client and a desk client are two records. One save does not write both yet. |
| FIX-announcements-001 | GET /api/announcements is public, and a failed load shows an error. The 403 is the admin compose action. A signed-in GET 403 was not found. |


## Mediums — a typed zero stays zero, and a new world starts private

A heir-slot price of 0 is saved as 0, and the mentor can delist it. A new sub-world starts private. A new sync device starts with auto-sync off and without personal DTUs. An LFG note can be blank. A saved title opens its link. Join says when you already live in the kingdom.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-inheritance-003 | inheritance | medium | FIXED_PENDING_VERIFY | 1a51019f4 |
| FIX-sub-worlds-001 | sub-worlds | medium | FIXED_PENDING_VERIFY | 1a51019f4 |
| FIX-sync-001 | sync | medium | FIXED_PENDING_VERIFY | 1a51019f4 |
| FIX-lfg-003 | lfg | medium | FIXED_PENDING_VERIFY | 1a51019f4 |
| FIX-saved-001 | saved | medium | FIXED_PENDING_VERIFY | 1a51019f4 |
| FIX-kingdoms-002 | kingdoms | medium | FIXED_PENDING_VERIFY | 1a51019f4 |

The seven highs left open now carry a re-test note on the ticket: FIX-music-001, FIX-finance-002, FIX-finance-003, FIX-retail-001, FIX-aviation-002, FIX-services-002, FIX-announcements-001.


## Mediums — a quiet button says what it needs

Add supplier and Add project say when a name is missing. Burndown says how to give it a finished week. Quote shopping says a broker key is required. Cap rate and cash flow say when the record cannot be computed. Start, Cancel, and Rotate ask first. Board labels are lighter.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-environment-002 | environment | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-board-016 | board | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-board-013 | board | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-insurance-008 | insurance | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-realestate-004 | realestate | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-tournaments-002 | tournaments | medium | FIXED_PENDING_VERIFY | 6593a26c5 |
| FIX-anon-003 | anon | medium | FIXED_PENDING_VERIFY | 6593a26c5 |

## NEEDS_PRODUCT_SURFACE

These stay `OPEN`. Each one needs a product surface this pass did not build. `needs_product_surface` is set on the ticket.

| Ticket | What's missing | Suggested scope |
|---|---|---|
| FIX-film-studios-002 | The live page is a production and its scene sluglines. Script, shot, and budget panels exist and the page says they are not on this screen. | Mount those existing panels on the open production. Do not add a second editor. |
| FIX-005 | The recipe list is recipe artifacts. Mint writes a private DTU the list does not query. | Show that caller's private recipe DTUs in Recipes, or say why a minted DTU is not a recipe row. |
| FIX-chat-001 | A reply can update the history preview while the open transcript stays empty until reload. | Append the completed reply onto the open thread. |
| FIX-trades-002 | Workbench jobs and Project Desk jobs are different stores. | One job record that both surfaces read. |
| FIX-agriculture-001 | Records and Ops keep separate field lists, so yield is divided by the Ops acreage. | One field record. Yield uses that field's acres. |
| FIX-repos-004 | Share says published, and the social feed has no post to open or delete. | Create a real social post and return its id. |
| FIX-ml-001 | Playground and deploy invoke have no provider for the named models. | A provider that serves those models, or a refusal before invoke that names the missing provider. |
| FIX-ml-002 | Four AutoML templates say they are not wired. The tabular run reports complete without a model. | A template runs and returns a score, or it stays visibly unwired. |
| FIX-accounting-013 | Creating an invoice and marking it paid does not post a journal entry. | Double-entry rows for the invoice and the payment, reversible. |
| FIX-srs-003 | Publishing a deck is refused because the council rejects the DTU. | A deck publish that passes the same gate as other shared study material, then an independent copy. |
| FIX-crisis-ops-001 | Ask fails because list_lens_actions requires mcp:lens:read. | The lens ask grant includes that read scope. |
| FIX-goddess-001 | Ask stays on "Working on it…" and never answers. | The goddess context returns or shows the error. |
| FIX-law-001 | CourtListener returns an error and patent search requires PATENTSVIEW_API_KEY. | The keys and a result with a citation, or a setup state that names the missing key before search. |
| FIX-lfg-001 | Ask about LFG crashes the tab. | The chat page for that context stays up and shows the error. |
| FIX-quests-001 | A web user cannot create or accept a quest. The empty state points at a world NPC. | A web create and accept that uses the existing quest records. |
| FIX-forge-003 | Config is component state that starts as my-forge-app and is not saved on a project. | Load and save app name, port, and tables on the opened project. |
| FIX-app-maker-001 | Preview does not run the button, and the canvas does not restore the saved layout. | The preview executes the saved actions and paints the saved nodes. |
| FIX-import-002 | A JSON array is still one queue payload. validateImport now reads posted rows, and it does not mint one DTU per row. | One artifact per JSON element and per CSV row, with the job counting those rows. |
| FIX-art-008 | Lasso stores a polygon on the artwork. There is no list of selected marks and no move or delete of that content. | A selection can move or delete the marks it contains. |
| FIX-code-002 | Scratch tabs are in-memory editor buffers that start as untitled.js. There is no saved scratch-script list. | Name, rename, and remove a saved scratch script. |
| FIX-ar-016 | Sketchfab Save as DTU does not land on a library row the caller can open. There is no list item to delete. | Show that saved DTU in the caller's library, with delete. |
| FIX-forecast-002 | `world_forecasts` is keyed by world, with no user id. Exporting the table would include other worlds. | A per-user forecast store, then export only that caller's rows. |
| FIX-lattice-003 | There is no lattice domain store and no lattice panel bag. lattice-seed is a different domain. | Caller-owned corpus, brain, or schedule records, then an export of those. |
| FIX-alliance-002 | Risk rows live in the open page. The form now refuses a dependency outside 0–100, and there is no saved dependency record to show again after reload. | A caller-owned dependency list the risk tool reads back. |
