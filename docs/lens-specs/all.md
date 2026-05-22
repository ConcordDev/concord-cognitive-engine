# all — Feature Gap vs App Launcher / Command Palette

Category leader (2026): no direct consumer rival — internal lens hub; closest analog is a launchpad / command palette (Raycast, macOS Launchpad).
Backend: generic `/api/lens` artifact store (view-event logging only); `CrossDomainSearch` component for federated search.

## Has (verified in code)
- Category-grouped grid of all 235 lenses from `lens-registry`
- Live keyword search across lens name/description/keywords with `/` focus
- Cross-domain search panel; per-lens icon + description cards
- Live indicator; records a view-event artifact

## Missing — buildable feature backlog
- [x] `[S]` Recently-used / frequently-used lens ordering
- [x] `[S]` Pin / favorite lenses to a top shelf
- [x] `[M]` Fuzzy command-palette overlay (jump to lens action, not just lens)
- [x] `[S]` Keyboard arrow-navigation through the grid + Enter to open
- [x] `[S]` Per-lens last-activity badge ("3 new items")

## Parity
~95% of a launcher's surface. Search + categorized grid plus recently/frequently-used ordering, pinned-lens shelf, a fuzzy command palette, keyboard grid navigation, and per-lens activity badges all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
