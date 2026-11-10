# Audit fix progress

Branch: `fix/audit-sweep-20261110`. Status `FIXED_PENDING_VERIFY` means the fix is in this branch and still needs a live re-walk. Nothing here is `VERIFIED`.

Counts are merged from `fix_tickets.jsonl` (later lines override earlier fields for the same id). Design-call tickets are still open and were not changed: FIX-black-market-010, FIX-council-008, FIX-retail-002, FIX-foundry-007, FIX-world-creator-013.

## Running tally

| Severity | Fixed pending verify | Remaining open | Closed another way |
|---|---:|---:|---:|
| high | 21 | 196 | 3 |
| medium | 15 | 930 | 0 |
| low | 7 | 973 | 0 |
| unrated | 0 | 6 | 0 |
| **total** | **43** | **2105** | **3** |

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

Reviewed and left open (not this root cause): command-palette Ctrl+K in fields (global by design: FIX-creator-004, FIX-energy-004, FIX-genesis-002, FIX-poetry-003, FIX-understanding-001), Escape-led FIX-government-004, arrow-key tablists, FIX-council-002 (`QAQAQA` is not explained by the hotkey map), FIX-game-010 (shortcuts while focus is outside a field), FIX-ml-010 (no steal observed; tab URL), FIX-finance-002/003 (math; the word "keystroke" is a caveat only).

## RCA-missing-delete-confirm (vanishing confirm only)

The in-row confirm armed for 4 seconds and then reverted, so the click never landed. `StickyDeleteConfirm` stays armed until Confirm or Cancel. HVAC Jobs/Estimates/other desk rows use it. The same timer was removed from the code file tree, snippet delete, and git discard arm.

Tickets that have no delete control at all are still open. FIX-hvac-002 stays retracted.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-hvac-001 | hvac | high | FIXED_PENDING_VERIFY | bd4c4cf98 |
| FIX-hvac-013 | hvac | medium | FIXED_PENDING_VERIFY | bd4c4cf98 |
| FIX-hvac-015 | hvac | medium | FIXED_PENDING_VERIFY | bd4c4cf98 |
