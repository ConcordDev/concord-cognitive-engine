# Audit fix progress

Branch: `fix/audit-sweep-20261110`. Status `FIXED_PENDING_VERIFY` means the fix is in this branch and still needs a live re-walk. Nothing here is `VERIFIED`.

Counts are merged from `fix_tickets.jsonl` (later lines override earlier fields for the same id). Design-call tickets are still open and were not changed: FIX-black-market-010, FIX-council-008, FIX-retail-002, FIX-foundry-007, FIX-world-creator-013.

## Running tally

| Severity | Fixed pending verify | Remaining open | Closed another way |
|---|---:|---:|---:|
| high | 38 | 179 | 3 |
| medium | 87 | 858 | 0 |
| low | 52 | 928 | 0 |
| unrated | 0 | 6 | 0 |
| **total** | **177** | **1971** | **3** |

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
| FIX-all-001 | all | high | FIXED_PENDING_VERIFY | this commit |
| FIX-landscaping-006 | landscaping | high | FIXED_PENDING_VERIFY | this commit |
| FIX-pharmacy-006 | pharmacy | high | FIXED_PENDING_VERIFY | this commit |
| FIX-plumbing-002 | plumbing | high | FIXED_PENDING_VERIFY | this commit |
| FIX-productivity-002 | productivity | high | FIXED_PENDING_VERIFY | this commit |
| FIX-animation-001 | animation | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-animation-004 | animation | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-astronomy-003 | astronomy | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-automotive-013 | automotive | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-billing-003 | billing | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-black-market-009 | black-market | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-bridge-005 | bridge | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-carpentry-003 | carpentry | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-command-center-003 | command-center | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-consulting-001 | consulting | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-debate-003 | debate | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-debug-008 | debug | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-desert-001 | desert | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-diy-006 | diy | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-dx-platform-006 | dx-platform | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-energy-003 | energy | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-ethics-002 | ethics | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-expert-mode-004 | expert-mode | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-forestry-003 | forestry | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-forge-008 | forge | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-fork-006 | fork | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-geology-003 | geology | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-hr-002 | hr | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-hvac-011 | hvac | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-lab-002 | lab | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-legacy-005 | legacy | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-linguistics-001 | linguistics | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-lock-008 | lock | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-marketing-007 | marketing | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-markets-010 | markets | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-masonry-007 | masonry | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-mental-health-002 | mental-health | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-mentorship-002 | mentorship | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-meta-003 | meta | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-mining-001 | mining | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-nonprofit-005 | nonprofit | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-pets-001 | pets | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-platform-006 | platform | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-podcast-003 | podcast | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-productivity-003 | productivity | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-questmarket-004 | questmarket | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-queue-009 | queue | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-social-002 | social | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-supplychain-002 | supplychain | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-tools-001 | tools | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-travel-001 | travel | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-understanding-003 | understanding | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-voice-005 | voice | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-wallet-005 | wallet | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-welding-004 | welding | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-worldmodel-007 | worldmodel | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-admin-002 | admin | low | FIXED_PENDING_VERIFY | this commit |
| FIX-alliance-005 | alliance | low | FIXED_PENDING_VERIFY | this commit |
| FIX-analytics-008 | analytics | low | FIXED_PENDING_VERIFY | this commit |
| FIX-artistry-006 | artistry | low | FIXED_PENDING_VERIFY | this commit |
| FIX-atlas-005 | atlas | low | FIXED_PENDING_VERIFY | this commit |
| FIX-calendar-015 | calendar | low | FIXED_PENDING_VERIFY | this commit |
| FIX-cognition-004 | cognition | low | FIXED_PENDING_VERIFY | this commit |
| FIX-council-011 | council | low | FIXED_PENDING_VERIFY | this commit |
| FIX-crypto-010 | crypto | low | FIXED_PENDING_VERIFY | this commit |
| FIX-custom-003 | custom | low | FIXED_PENDING_VERIFY | this commit |
| FIX-goddess-004 | goddess | low | FIXED_PENDING_VERIFY | this commit |
| FIX-history-006 | history | low | FIXED_PENDING_VERIFY | this commit |
| FIX-observe-005 | observe | low | FIXED_PENDING_VERIFY | this commit |
| FIX-ocean-007 | ocean | low | FIXED_PENDING_VERIFY | this commit |
| FIX-offline-006 | offline | low | FIXED_PENDING_VERIFY | this commit |
| FIX-parenting-009 | parenting | low | FIXED_PENDING_VERIFY | this commit |
| FIX-projects-003 | projects | low | FIXED_PENDING_VERIFY | this commit |
| FIX-repos-005 | repos | low | FIXED_PENDING_VERIFY | this commit |
| FIX-resonance-006 | resonance | low | FIXED_PENDING_VERIFY | this commit |
| FIX-sandbox-011 | sandbox | low | FIXED_PENDING_VERIFY | this commit |
| FIX-self-008 | self | low | FIXED_PENDING_VERIFY | this commit |
| FIX-sub-worlds-008 | sub-worlds | low | FIXED_PENDING_VERIFY | this commit |
| FIX-sync-006 | sync | low | FIXED_PENDING_VERIFY | this commit |
| FIX-system-008 | system | low | FIXED_PENDING_VERIFY | this commit |
| FIX-tick-004 | tick | low | FIXED_PENDING_VERIFY | this commit |
| FIX-timeline-007 | timeline | low | FIXED_PENDING_VERIFY | this commit |
| FIX-veterinary-002 | veterinary | low | FIXED_PENDING_VERIFY | this commit |
| FIX-world-002 | world | low | FIXED_PENDING_VERIFY | this commit |
