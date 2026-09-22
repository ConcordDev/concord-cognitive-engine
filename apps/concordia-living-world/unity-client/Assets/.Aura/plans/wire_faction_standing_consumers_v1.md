# Faction standing consumer integration

1. Inspect the existing FactionStandingBook, persistence DTOs, dialogue/quest/economy/world-simulation APIs, and current call sites.
2. Add a small integration authority that reads FactionStandingBook without introducing another standing store, normalizes stable world/faction IDs, applies neutral defaults, and records typed causal events.
3. Wire the existing dialogue and authored quest offer paths to standing-based response/offer gates, wire market quote/refusal behavior to standing plus witness heat, and route simulation crime/witness events into standing adjustments while keeping witness heat separate.
4. Add focused EditMode tests for standing persistence/neutral defaults and at least one consumer decision supported by the project APIs.
5. Compile-check and report changed files, integrations, and test status, preserving any pre-existing compile blockers.
