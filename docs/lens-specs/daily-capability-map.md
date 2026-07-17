# Daily Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/daily.js` (640 LOC) in full —
> `grep -n 'registerLensAction("daily"' server/domains/daily.js` lists every
> macro; no inline registrations exist elsewhere. Frontend audited by
> reading `app/lenses/daily/page.tsx` (~1000 LOC) and
> `components/daily/{QuotablePanel,DailyInspiration,JournalStudio}.tsx` in
> full, not sampled.

## Backend surface — all real, no stubs

Two tiers: 4 pure-compute productivity macros (`dailySummary`,
`habitStreak`, `focusTimer`, `weeklyReview` — operate on caller-supplied
`artifact.data`) plus a real per-user journaling substrate (`prompt-today`,
`journal-create/list`, `entry-create/list/detail/update/delete`,
`on-this-day`, `entry-search`, `mood-trend`, `daily-dashboard`,
`templates-list`, `tags-list`, `entry-heatmap`, `habit-create/list/
checkin/update/delete`, `lock-status/set/verify/remove`, `export-archive`,
`feed`). All backed by real STATE-persisted tables, not caller-data.

## Reference apps

[Day One](https://dayoneapp.com) (journaling — date-keyed entries, mood,
on-this-day, media attachments, streak/calendar view) + [Reflectly](https://reflectly.app)
(mood tracking, daily reflection prompts). Warm/tactile identity — this is
a personal journal, not a terminal or an ops console; the existing
gradient-card layout and per-entry warmth already fit that read, not a
generic SaaS dashboard.

## What this audit found (real defects, evidence-based)

This lens's feature backlog was already fully shipped (journals, habits,
mood, lock, export, tags — see the pre-existing `docs/lens-specs/daily.md`).
The Wave 3 audit went past feature-completeness into the "no air" honesty
rule (CLAUDE.md §3) and found five real defects, all in
`app/lenses/daily/page.tsx` (no backend changes needed — the substrate was
already correct):

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Fabricated waveform** — the recorded-audio waveform bars were `Array.from({length:24}, (_,i) => 0.2 + Math.sin(i*0.5)*0.35 + ...)`, a fixed decorative curve with **zero relationship to the actual recorded audio** | `recorder.onstop` computed `waveform` before the blob was even read | Added `computeWaveformFromBlob()` — decodes the real recorded PCM via Web Audio `decodeAudioData`, buckets real peak amplitudes. Honest flat fallback (not another fake curve) if decoding fails. |
| 2 | **Play button did nothing** — clicking play toggled `playingClip` state (icon flips to Pause, waveform recolors cyan) but there was **no `<audio>` element and no `new Audio()` anywhere in the file** — zero sound ever played | `grep -n "<audio\|new Audio(" app/lenses/daily/page.tsx` → no matches, pre-fix | Wired a real shared `<audio>` element; `handlePlayClip` sets its `src` to a local blob URL (freshly recorded) or `/api/media/:id/stream` (persisted) and calls `.play()`; `playingClip` now only flips on a real `play()`/`ended`/`pause` event. |
| 3 | **Voice notes vanished on reload** — clips uploaded for real to `/api/media/upload` (bytes genuinely persisted), but `clips` was `useState([])` with no fetch-back, so a refresh always showed an empty list even though the data existed server-side | Traced the upload call through to `POST /api/media/upload` (real, `server/routes/media.js:158`) vs. the local-only `clips` state | Added a mount-time fetch of `/api/media/author/:userId` filtered to `mediaType==='audio' && tags.includes('daily')`, merged into `clips` (same pattern already established in `components/animation/AnimationReferenceImages.tsx`). |
| 4 | **Fabricated stats** — sidebar "Streak" showed a hardcoded `"5 days"` and "Total" showed a hardcoded `"47 entries"`, never computed from the real `entries` array sitting right next to them | Literal string constants at the old lines 447-454 | Replaced with `entries.length` (Total) and a real consecutive-day streak computed from `entryDates` (a `Set` already built from real entry dates). |
| 5 | **Redundant decorative quote widget** — a hardcoded local `QUOTES` array of 7 famous quotes, randomly picked via `Math.random()` on mount, duplicated by TWO already-real live-quote components on the same page (`QuotablePanel` → backend `daily.live_quote` macro; `DailyInspiration` → live `zenquotes.io` fetch, with a real "save as DTU" action) | 3 separate "inspiration quote" surfaces found on one page via grep | Removed the static hero block, its `QUOTES` const, and the `quote` state — the two real, live quote surfaces remain (Section 0 "reduce, don't decorate"). |

All five fixes are scoped to `app/lenses/daily/page.tsx` only; no shared
infrastructure (`server/lib/media-dtu.js`) was touched (that file's own
`generateWaveform()` — used by the general media-upload path for *every*
lens's audio uploads, not daily-specific — is itself a synthetic waveform
generator; **CLOSED (2026-07-17, `7176be9e`)**: it now returns `null` (the
server has no audio decoder — documented, not silently worked around), audio
DTUs carry `waveform:null`, and the feed/voice synthetic-curve render sites were
converted to real `decodeAudioData` peaks / a real live-mic `AnalyserNode` / an
honest flat placeholder. A SECOND fabrication was flagged for a separate unit:
`artifact-store.js#extractWaveformPeaks` reads compressed bytes as raw PCM).

## 1.5 Reference-parity checklist

| # | Item (Day One / Reflectly) | Disposition | Notes |
|---|---|---|---|
| 1 | Date-keyed entries with mood + free text | ALREADY REAL | `entry-create/list/detail/update/delete`, mood scale, notes/workedOn/learned/goals fields |
| 2 | Multiple journals | ALREADY REAL | `journal-create/list` |
| 3 | On-this-day historical recall | ALREADY REAL | `on-this-day` macro |
| 4 | Entry search | ALREADY REAL | `entry-search` |
| 5 | Mood trend | ALREADY REAL | `mood-trend` |
| 6 | Habit streak tracking | ALREADY REAL | `habit-create/list/checkin/update/delete` with real streak computation server-side |
| 7 | Photo/media attachments | ALREADY REAL (audio; not photo) | Voice-note recording via `MediaRecorder` → `/api/media/upload`; playback and persistence were broken (fixed this session, items 2-3 above) |
| 8 | Calendar/heatmap streak view | ALREADY REAL | `entry-heatmap` macro + mini calendar in the sidebar |
| 9 | Entry templates | ALREADY REAL | `templates-list` |
| 10 | Tag filtering | ALREADY REAL | `tags-list` |
| 11 | Passcode/lock | ALREADY REAL | `lock-status/set/verify/remove` |
| 12 | Export to Markdown/archive | ALREADY REAL | `export-archive` |
| 13 | Daily inspirational quote | ALREADY REAL — but was tripled | Two live sources (`QuotablePanel`, `DailyInspiration`); a third, fake, local-only source removed this session |
| 14 | Sidebar quick-stats (streak/total) | **FIXED THIS SESSION** | Was hardcoded fake numbers; now computed from real entry data |
| 15 | Voice-note playback | **FIXED THIS SESSION** | Recording was real; playback and waveform were fabricated/non-functional |

**Coverage summary:** 12 of 15 items were already real and correct.
3 items had real defects (playback, stats, redundant fake quote) — all
fixed this session with real fixes, no new fabrication introduced.

## Density / identity self-check

Main content column shows journal entry form, mood tracker, two live quote
panels, session log, audio clips, practice timer, reminders, daily digest,
and an AI-actions results panel — well past the ≥12-real-data-unit bar for
a data-heavy lens at 1080p when an entry/session/reminder history exists;
correctly sparse (empty-state prompts) on a fresh account. Warm/tactile
identity (rounded cards, gradient accents, emoji mood picker) matches the
named reference apps, not a generic dashboard.

## Files touched

- `concord-frontend/app/lenses/daily/page.tsx` — waveform, playback,
  clip persistence, real stats, removed redundant fake quote widget
- No backend changes — `server/domains/daily.js` was already complete
  for this scope.
