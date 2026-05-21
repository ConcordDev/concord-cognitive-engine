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
- [x] `[M]` Server-persisted preferences — sync settings across devices via `settings.get`/`set`/`setMany`/`reset` macros + PreferencesPanel
- [x] `[S]` Audio/volume + subtitle + reduced-motion controls — rendered by PreferencesPanel from the server schema
- [x] `[M]` Accessibility section — text size, contrast, color-blind modes, screen-reader hints (accessibility section of PreferencesPanel)
- [x] `[S]` Language / locale picker — locale + date_format enums in the language section of PreferencesPanel
- [x] `[M]` Keybinding remap UI — KeybindingPanel surfaces bindings via `settings.keybindings`, rebind via `rebindKey`/`resetKeybinding`
- [x] `[S]` Search-within-settings — single search box across all preference keys (PreferencesPanel filter + `settings.search` macro)
- [x] `[M]` Account/security panel — AccountSecurityPanel: password change, sessions, 2FA, connected accounts
- [x] `[S]` Snapshot apply/restore — SnapshotManager: capture/list/apply/delete via `settings.captureSnapshot`/`listSnapshots`/`applySnapshot`/`deleteSnapshot`

## Parity
~90% of a modern OS settings panel. Functional core (graphics presets, snapshots) exists but settings are localStorage-only, scattered across other lenses, and most categories (audio, accessibility, account, language) have no UI here.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
