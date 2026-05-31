# Vael's Expedition V — authorization boundaries + content integrity (blank map) — Sun May 31 22:18:22 UTC 2026

## Wave 19 — content integrity
**#S1 (soft) — ~99 NPCs reference faction ids with no structured faction record.**
NPCs across every sub-world set `faction: "<id>"` (verge_rangers, seven_spokes_inn, akeia,
ruined_court, thornwood_keep, frontier_militia…) where the id is named in lore/npcs-extra but never
DEFINED in any `factions.json`. `content-seeder.js#validateNpc` only type-checks the field (never
verifies existence), so they seed clean — but faction-strategy / reputation / role-matched dialogue
lookups for those NPCs resolve null. Either add the faction records or have the validator flag
dangling refs. (Some, e.g. `akeia`, are countries — the faction/country id-spaces overlap.)

## Authorization audit — VERIFIED SOUND (honest negatives)
publicReadPaths expose only catalogs/system-telemetry; sensitive routes 401; /api/dtus returns only
global-scope (0 private leaked); /api/messaging/messages 401s (allowlist prefix doesn't bypass route
auth); /api/events is system-only (no PII). One mild note: /api/auctions/active exposes pseudonymous
sellerUserId (normal for a marketplace).

## Wave 20 — lens system health (your directive: "ensure all the lenses work")
Official `scripts/verify-lens-backends.mjs`: **255 WIRED / 2 NO-BACKEND-CALL (narrative-walk, ux-suite) / 0 broken.**
My own 257-lens macro sweep flagged 96 "DEAD-via-macro" but that's a FALSE-POSITIVE overcount —
those lenses reach their backend via REST routes / child components / non-standard macro names that
the official verifier correctly resolves. Reported honestly, not as 96 bugs.

**#S2 (doc drift) — `narrative-walk` is now NO-BACKEND-CALL; CLAUDE.md lists only `ux-suite` as by-design.** Either it lost its backend wire or the doc is stale (2 by-design now, not 1).

**#S3 (the real one) — "WIRED" overstates "works": a cluster of lenses point at runtime-dead backends.**
The verifier confirms a macro/route EXISTS, but rounds 1+3 proved some of those targets are the
ghost-fleet macros that fall through to the LLM (#11: quest/agents/research/religion/city/…) or hit
ghost-table crashes (#V*). So lenses like /lenses/quests, /lenses/agents, /lenses/research render a
shell but their primary reads silently fail. The lens layer is structurally complete; its runtime
correctness is gated entirely by the rounds-1/3 backend bugs.
