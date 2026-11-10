# Audit fix progress

Branch: `fix/audit-sweep-20261110`. Status `FIXED_PENDING_VERIFY` means the fix is in this branch and still needs a live re-walk. Nothing here is `VERIFIED`.

Counts are merged from `fix_tickets.jsonl` (later lines override earlier fields for the same id). Design-call tickets are still open and were not changed: FIX-black-market-010, FIX-council-008, FIX-retail-002, FIX-foundry-007, FIX-world-creator-013.

## Running tally

| Severity | Fixed pending verify | Remaining open | Closed another way |
|---|---:|---:|---:|
| high | 83 | 134 | 3 |
| medium | 287 | 658 | 0 |
| low | 250 | 730 | 0 |
| unrated | 0 | 6 | 0 |
| **total** | **620** | **1528** | **3** |

"Closed another way" is NOT_REPRODUCED / RETRACTED / SUPERSEDED / REVERIFIED_OK (FIX-automotive-001, FIX-hvac-002, and one other high follow-up). Two of the 40 pending tickets (FIX-chat-006, FIX-chat-007) were already pending before this sweep.

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

Lenses with no `*Lens` state bag are still open (their records live somewhere else): FIX-move-builder-014, FIX-lfg-007, FIX-inheritance-006, FIX-achievements-002, FIX-creatures-005, FIX-garage-002, FIX-quests-002, FIX-forecast-002, FIX-sentinel-008, FIX-creative-writing-003, FIX-vault-003, FIX-construction-006, and the other no-bag skips in this pass. FIX-finance-004 (unscoped dump), FIX-export-001 (decrypt), FIX-music-001, and FIX-paper-002 are different bugs and stay open.

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

One capture listener closes the top dialog by activating its Close control, and keeps Tab inside an aria-modal dialog. Share and Export are dialogs, so Escape reaches them. Dialogs with no Close control still need that button.

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

Still open in this group: classroom, creative-writing, disputes, education, legal, mental-health, move-builder, paper, and questmarket deletes. FIX-foundry-007 and FIX-world-creator-013 stay design calls.

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
