# UI Polish Audit (May 2026)

What polished means here: each lens-as-app delivers on its genre's UX
bar, AND the cross-app surfaces (settings, auth, navigation, toasts)
are consistent. Two different questions. This audit answers both.

## Cross-app shell — production-tier ✅

`components/shell/AppShell.tsx` already mounts the full chrome:
Sidebar + Topbar + MobileNav + CommandPalette (Cmd+K) + Toasts +
SystemStatus + OnboardingWizard + ConnectionStatus + OfflineFallback +
InstallPrompt + SyncIndicator + CookieConsent + ThemeToggle +
skip-to-content link + PWA service worker + offline queue auto-flush
+ IndexedDB session init + fullPageMode escape hatch for the world
lens. This is real, not stub.

## Design system — exists with selective adoption ✅

`lib/design-system.ts` has 30+ tokens (`ds.panel`, `ds.btnPrimary`,
`ds.tabBar`, `ds.input`, etc.). Adoption is intentionally split:

- **Heavy adopters** (data-table-shaped lenses): accounting (583
  refs), healthcare (240), council (184). These are dashboard-style
  surfaces that benefit from shared panel/grid tokens.
- **Zero adopters** (full-app-shaped lenses): chat, music,
  marketplace, code, calendar, dtus, alliance. These are real apps
  with their own visual idioms (Discord-style for chat, DAW-style
  for music, e-commerce for marketplace, IDE for code). Forcing
  shared tokens would make them look like generic dashboards.

Light adopters (chat, music with 6 refs each) use ds for shared
primitives like buttons but keep their own panel layouts. Correct
architecture.

## Genre depth — real apps, not prototypes ✅

| Lens | LOC | Domain vocabulary signals |
|---|---|---|
| Chat | 3289 | 112 tool refs (regen/copy/edit/reaction/attach/stream), 37 streaming refs, virtualized list (Virtuoso) |
| World | 5215 | 3D scene + Rapier physics + FABRIK IK + combat + dialogue + quests + emote wheel |
| Music | 2171 | 277 vocab hits (play/pause/track/playlist/fork/remix/stem/wave/piano/chord/tempo/bpm) |
| Marketplace | 2573 | 275 vocab hits (cart/checkout/listing/seller/buyer/filter/sort/price/cite/royalty) |
| Accounting | 2866 | 322 vocab hits (ledger/invoice/debit/credit/balance/tax/reconcile/gaap) |
| Council | 3442 | governance + voting + RFC + dissent surfaces |
| Healthcare | 3933 | clinical workflow + records + scheduling |

Each has substantial domain depth. None are placeholder-with-lorem.

## Real polish gaps

### 1. prefers-reduced-motion not respected (FIXED in this audit)

Zero `useReducedMotion` or `prefers-reduced-motion` references across
the entire codebase. framer-motion animations ran for users with
OS-level reduce-motion pref.

**Fix shipped:** `<MotionConfig reducedMotion="user">` wrapped at the
Providers level. Single change cascades to every framer-motion call
site (~100s) across all 175 lenses + utility pages.

### 2. Mobile responsive coverage uneven

Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) per major lens:

- chat: 15
- music: 9
- marketplace: 6
- code: 3
- accounting: 1
- world: 0 (intentional — 3D scene)

Marketplace at 6 / code at 3 / accounting at 1 means these mostly
assume desktop layouts. World at 0 is fine (game UI).

**Recommendation:** Per-lens responsive audit, ordered by traffic. Not
a single fix; each app's mobile strategy is its own decision (e.g.,
accounting probably wants a "mobile means read-only" mode rather than
a fully responsive grid).

### 3. Custom focus rings missing in major lenses

`focus:ring`/`focus-visible` references per major lens:

- chat: 1
- music/marketplace/world/code/accounting: 0 each

Browser defaults work for keyboard nav, but custom focus rings would
match the lattice/neon aesthetic. AppShell's skip-to-content already
does this — extend the pattern.

**Recommendation:** Add `ds.focusRing` to interactive elements in
top-traffic lenses. Not blocking.

### 4. aria-label coverage thin in major lenses

`aria-label` / `aria-labelledby` per major lens:

- chat / music / marketplace / world: 0 each

Icon-only buttons (which there are MANY of in these apps) will be
screen-reader-broken. Each `<button>` with just a lucide icon needs
an aria-label.

**Recommendation:** Per-lens icon-button audit. The AccessibilityPanel
component sets the right tone (settings has strong a11y); the lens
authoring patterns haven't followed it.

### 5. Loading states inconsistent in dashboard-shaped lenses

Loader2 usage per lens:

- chat: 4
- code: 9, calendar: 5, dtus: 6 (good)
- music: 2, marketplace: 2 (sparse)
- accounting: 0, council: 0, healthcare: 0 (none)

The big dashboard lenses (accounting/council/healthcare) likely
render empty grids during data fetches instead of a loading state.

**Recommendation:** Add Loader2 + skeleton states to the three with 0
hits. ds.panel makes the styling trivial; the patterns just haven't
been added.

## What's already good (don't fix)

- EmptyState component adopted in 131 of 205 lens pages (~64%)
- AppShell is production-tier
- ds tokens are consistently used where they make sense
- The 21 absorbed UX components have been migrated to lattice tokens
- The 7 utility pages now share UtilityPageShell
- Genre-specific visual languages are intentional and should stay
  different (chat looks like a chat app, world looks like a game)

## Order of follow-on fixes (by leverage)

1. ✅ MotionConfig reducedMotion (this audit)
2. aria-label sweep on the top-5-traffic lenses (~half day per lens)
3. Loading state pass on accounting/council/healthcare (~half day)
4. Per-lens mobile responsive audits (1+ day per major lens, not
   fungible — each app's mobile UX is its own design problem)

All of these are incremental commits, not a sprint. The platform UI is
in genuinely good shape; what remains is per-app polish work that
each lens author / next session can pick up individually.
