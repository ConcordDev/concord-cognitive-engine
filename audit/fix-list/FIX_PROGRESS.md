# Audit fix progress

Branch: `fix/audit-sweep-20261110`. Status `FIXED_PENDING_VERIFY` means the fix is in this branch and still needs a live re-walk. Nothing here is `VERIFIED`.

Counts are merged from `fix_tickets.jsonl` (later lines override earlier fields for the same id). Design-call tickets are still open and were not changed: FIX-black-market-010, FIX-council-008, FIX-retail-002, FIX-foundry-007, FIX-world-creator-013.

## Running tally

| Severity | Fixed pending verify | Remaining open | Closed another way |
|---|---:|---:|---:|
| high | 20 | 197 | 3 |
| medium | 13 | 932 | 0 |
| low | 7 | 973 | 0 |
| unrated | 0 | 6 | 0 |
| **total** | **40** | **2108** | **3** |

"Closed another way" is NOT_REPRODUCED / RETRACTED / SUPERSEDED / REVERIFIED_OK (FIX-automotive-001, FIX-hvac-002, and one other high follow-up). Two of the 40 pending tickets (FIX-chat-006, FIX-chat-007) were already pending before this sweep.

## RCA-form-hotkey-steal

Shared fix: `shouldIgnoreLensHotkey` in `concord-frontend/lib/a11y/editable-target.ts`, used by `useLensCommand` and `useShortcut`. Clickable wrappers that turned Space/Enter into `.click()` now call `activateOnEnterOrSpace`, which ignores keys that start in a nested field.

| Ticket | Lens | Severity | Status | Commit |
|---|---|---|---|---|
| FIX-003 | food | high | FIXED_PENDING_VERIFY | this commit |
| FIX-004 | trades | high | FIXED_PENDING_VERIFY | this commit |
| FIX-agents-008 | agents | high | FIXED_PENDING_VERIFY | this commit |
| FIX-aviation-012 | aviation | high | FIXED_PENDING_VERIFY | this commit |
| FIX-council-009 | council | high | FIXED_PENDING_VERIFY | this commit |
| FIX-environment-001 | environment | high | FIXED_PENDING_VERIFY | this commit |
| FIX-ethics-005 | ethics | high | FIXED_PENDING_VERIFY | this commit |
| FIX-food-001 | food | high | FIXED_PENDING_VERIFY | this commit |
| FIX-government-006 | government | high | FIXED_PENDING_VERIFY | this commit |
| FIX-healthcare-004 | healthcare | high | FIXED_PENDING_VERIFY | this commit |
| FIX-household-002 | household | high | FIXED_PENDING_VERIFY | this commit |
| FIX-markets-006 | markets | high | FIXED_PENDING_VERIFY | this commit |
| FIX-photos-001 | photos | high | FIXED_PENDING_VERIFY | this commit |
| FIX-science-001 | science | high | FIXED_PENDING_VERIFY | this commit |
| FIX-security-002 | security | high | FIXED_PENDING_VERIFY | this commit |
| FIX-services-001 | services | high | FIXED_PENDING_VERIFY | this commit |
| FIX-sim-001 | sim | high | FIXED_PENDING_VERIFY | this commit |
| FIX-trades-001 | trades | high | FIXED_PENDING_VERIFY | this commit |
| FIX-voice-003 | voice | high | FIXED_PENDING_VERIFY | this commit |
| FIX-wallet-001 | wallet | high | FIXED_PENDING_VERIFY | this commit |
| FIX-auction-005 | auction | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-byo-keys-002 | byo-keys | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-dreams-003 | dreams | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-electrical-004 | electrical | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-fitness-019 | fitness | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-hr-006 | hr | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-materials-003 | materials | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-move-builder-011 | move-builder | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-pets-004 | pets | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-questmarket-005 | questmarket | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-veterinary-004 | veterinary | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-wallet-007 | wallet | medium | FIXED_PENDING_VERIFY | this commit |
| FIX-cognitive-replay-006 | cognitive-replay | low | FIXED_PENDING_VERIFY | this commit |
| FIX-forecast-009 | forecast | low | FIXED_PENDING_VERIFY | this commit |
| FIX-housing-010 | housing | low | FIXED_PENDING_VERIFY | this commit |
| FIX-manufacturing-012 | manufacturing | low | FIXED_PENDING_VERIFY | this commit |
| FIX-marketplace-007 | marketplace | low | FIXED_PENDING_VERIFY | this commit |
| FIX-voice-016 | voice | low | FIXED_PENDING_VERIFY | this commit |

Reviewed and left open (not this root cause): command-palette Ctrl+K in fields (global by design: FIX-creator-004, FIX-energy-004, FIX-genesis-002, FIX-poetry-003, FIX-understanding-001), Escape-led FIX-government-004, arrow-key tablists, FIX-council-002 (`QAQAQA` is not explained by the hotkey map), FIX-game-010 (shortcuts while focus is outside a field), FIX-ml-010 (no steal observed; tab URL), FIX-finance-002/003 (math; the word "keystroke" is a caveat only).
