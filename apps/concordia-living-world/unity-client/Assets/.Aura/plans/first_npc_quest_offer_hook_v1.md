# First authored NPC quest-offer hook

1. Verify the existing local dialogue authority, authored `WorldBook` quest lookup, `QuestLog.Offer`, and the live NPC interaction path.
2. Bind a first-talk-only hook in `ConcordiaDialogueService` to `WorldBook.OfferedBy` and `QuestLog.Offer`, without hardcoded quest IDs or duplicate state.
3. Route the existing NPC interaction path through that hook while preserving authored quest-hook fallback dialogue behavior.
4. Refresh/compile-check and inspect the resulting diff for correctness.
