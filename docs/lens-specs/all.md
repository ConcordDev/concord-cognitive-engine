# all — Feature Gap vs App Launcher / Command Palette

Category leader (2026): no direct consumer rival — internal lens hub; closest analog is a launchpad / command palette (Raycast, macOS Launchpad).
Backend: generic `/api/lens` artifact store (view-event logging only); `CrossDomainSearch` component for federated search.

## Has (verified in code)
- Category-grouped grid of all 235 lenses from `lens-registry`
- Live keyword search across lens name/description/keywords with `/` focus
- Cross-domain search panel; per-lens icon + description cards
- Live indicator; records a view-event artifact

## Missing — buildable feature backlog
- [ ] `[S]` Recently-used / frequently-used lens ordering
- [ ] `[S]` Pin / favorite lenses to a top shelf
- [ ] `[M]` Fuzzy command-palette overlay (jump to lens action, not just lens)
- [ ] `[S]` Keyboard arrow-navigation through the grid + Enter to open
- [ ] `[S]` Per-lens last-activity badge ("3 new items")

## Parity
~65% of a launcher's surface. Search + categorized grid is solid; missing the recency, pinning, and fuzzy-action features that make a launcher fast.
