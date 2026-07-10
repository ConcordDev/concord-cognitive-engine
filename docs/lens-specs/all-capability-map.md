# all — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("all"' server/domains/all.js` → 10

## Reference framing

No direct consumer rival — `all` is the internal lens hub / launcher.
Closest analog: a command-palette launcher (Raycast, macOS Launchpad). The
stale `docs/lens-specs/all.md` claims a "generic `/api/lens` artifact store
(view-event logging only)" backend — that's wrong; `server/domains/all.js`
(383 LOC) is a real, purpose-built aggregation domain: cross-domain search,
domain stats, an activity feed, and a full launcher substrate (per-user
recency/frequency usage ledger, pinned-lens shelf, fuzzy command-palette
index). Held to the "real, designed, no generic scaffold, no fake data"
bar directly, since the reference-app framing doesn't apply literally to
a hub page.

## `node scripts/lens-unsurfaced.mjs --lens all` (before fix)

```
all: 2/10 macros never referenced in the frontend
  domainStats-* (1): domainStats
  recentActivity-* (1): recentActivity
```

## Finding: `domainStats` + `recentActivity` — REAL GAP (fixed)

Both macros are real and already used elsewhere (`domainStats` aggregates
DTU counts per domain across the whole substrate; `recentActivity` returns
a cross-domain feed of the newest DTUs), but neither had ever been surfaced
on the launcher hub itself — the one page whose entire purpose is showing
"what's going on across the platform." The hub had search, a pinned shelf,
a recent-lenses strip, and a command palette (all real, all wired), but
nothing that answered "what's actually happening right now, substrate-wide"
— a natural, on-theme feature for a launcher that was sitting unbuilt.

**Fix:** added `components/all/SubstratePulsePanel.tsx` — a compact panel
with two real-data halves: (1) a top-domains-by-DTU-volume bar list (from
`domainStats`, each row linking to that domain's lens), and (2) a live
cross-domain activity feed (from `recentActivity`, each row linking to the
source DTU's lens). Mounted on `app/lenses/all/page.tsx` right below the
pinned-shelf / recent-lenses strip. Honest-empty-state by construction:
renders nothing at all (not a placeholder, not a zero-state card) when the
substrate has no DTUs yet or no recent activity — no fabricated "0" stat
tiles pretending to be meaningful data.

## Left alone (already real)

`crossDomainSearch` (surfaced from the `global` lens, not `all` — legitimate
cross-lens reuse of the same macro), the launcher substrate
(`record-open`/`usage-list`/`pin-toggle`/`pin-list`/`pin-reorder`/
`lens-badges`/`command-index`) driving `PinnedShelf.tsx`,
`RecentLensesStrip.tsx`, per-lens activity badges, and `CommandPalette.tsx`
— all pre-existing, all real, all verified calling their macros directly
(not through a generic action array). `all`'s own `CrossDomainSearch.tsx`
component (mounted at the bottom of the hub) calls the DTU search REST
endpoint directly rather than the `all.crossDomainSearch` macro — a
reasonable, equally-real alternate path, not a gap.

## Verification

- `npx eslint app/lenses/all/page.tsx components/all/SubstratePulsePanel.tsx` — clean, 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — all stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — all: `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens all` (after fix): `0/10` — both macros now surfaced.
