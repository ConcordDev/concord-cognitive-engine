# settings — Feature Gap vs OS/App Settings panels (macOS System Settings / Steam Settings)

Category leader (2026): macOS System Settings / Steam Settings. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: thin `settings` domain (2 macros: `list`, `applied`); actual values stored client-side in localStorage. No server persistence.

## Has (verified in code)
- Quality preset selector (potato/balanced/high/ultra) + mouse sensitivity slider
- Preset snapshot capture/list as artifacts (rollback to known-good config)
- `⌘S` keyboard command to capture snapshot
- SettingsHealth diagnostic panel
- Server macro surface for cross-domain discovery (`settings.list` enumerates known prefs)

## Missing — buildable feature backlog
- [ ] `[M]` Server-persisted preferences — sync settings across devices via `/api/settings` write, not just localStorage
- [ ] `[S]` Audio/volume + subtitle + reduced-motion controls — domain advertises them but page omits the UI
- [ ] `[M]` Accessibility section — text size, contrast, color-blind modes, screen-reader hints
- [ ] `[S]` Language / locale picker wired to I18nProvider
- [ ] `[M]` Keybinding remap UI — surface useLensCommand bindings, allow rebind (per keybindings skill)
- [ ] `[S]` Search-within-settings — single search box across all preference keys
- [ ] `[M]` Account/security panel — password change, sessions, 2FA, connected accounts
- [ ] `[S]` Snapshot apply/restore — currently snapshots are listed but cannot be re-applied

## Parity
~35% of a modern OS settings panel. Functional core (graphics presets, snapshots) exists but settings are localStorage-only, scattered across other lenses, and most categories (audio, accessibility, account, language) have no UI here.
