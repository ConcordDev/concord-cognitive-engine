# inheritance — Feature Gap vs Trust & Will / estate-planning apps

Category leader (2026): Trust & Will (digital estate planning). No direct consumer rival for the in-game "death-derivatives" mechanic — closest analog is an estate/inheritance planner. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/?` via `inheritance` macros (`list_open`, `claim_slot`) routed through `/api/lens/run`; CC-escrow on NPC death.

## Has (verified in code)
- Open heir-slot listings feed for dying NPCs (mentor-listed), with price in CC
- Claim/lock heir slot — escrow payment held until NPC actually dies; revocable before then
- On resolution buyer inherits the NPC's recipes / desires / grudges
- EstateChatter ambient-activity panel, RecentMine / AutoAction / CrossLensRecents integration

## Missing — buildable feature backlog
- [ ] `[M]` Beneficiary designation builder — name heirs, split percentages, contingencies
- [ ] `[M]` Will / directive document authoring with versioning
- [ ] `[S]` Asset inventory — enumerate what an estate contains before listing slots
- [ ] `[M]` Executor assignment + multi-party consent workflow
- [ ] `[S]` Revoke / amend UI for an already-locked slot (mentioned in copy, no button shown)
- [ ] `[M]` Probate / resolution timeline view showing pending death-triggered transfers
- [ ] `[S]` Heir notification + acceptance flow on resolution

## Parity
~35% of an estate-planning tool's surface. It is a narrow, well-built game-economy primitive (escrowed heir-slot futures), not a general inheritance planner — missing wills, beneficiary splits, executors, and asset inventory.
