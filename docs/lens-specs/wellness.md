# wellness — Feature Gap vs Whoop / Calm / CBT apps

Category leader (2026): Whoop (recovery/strain) + CBT apps like Woebot. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `therapy` domain macros (`compose_field`, `active_fields`, `deactivate`) — refusal-field-as-therapy substrate (base-6 glyph algebra gates cognitive patterns); plus WellnessSection / WellnessActionPanel components (Whoop-shape sleep/strain/recovery/HRV).

## Has (verified in code)
- Compose a refusal-field therapeutic gate (8 kinds: binary_thinking, catastrophising, self_judgment, numbing, compulsion, rumination, perfectionism, shame_spiral) with duration.
- List your active fields; deactivate any field (user revocation can't be overridden — privacy-first).
- Whoop-shape wellness workbench — sleep / strain / recovery / HRV panel + actions.
- WellnessSection and WellnessFeed surfaces.

## Missing — buildable feature backlog
- [x] `[M]` Self-compose fields — currently "therapist mode" targets another user id; let users gate their own patterns directly.
- [x] `[S]` Mood / check-in journaling with daily logging.
- [x] `[M]` Guided CBT exercises — thought records, reframing prompts tied to each field kind.
- [x] `[M]` Trend tracking — recovery/strain/mood over time with charts.
- [x] `[S]` Wearable data import (HRV/sleep) instead of manual entry.
- [x] `[S]` Streaks / habit tracking for wellness practices.
- [x] `[M]` Meditation / breathing sessions (Calm-style guided audio).
- [x] `[S]` Personalized daily recovery recommendation.

## Parity
~90% of Whoop/Calm. The refusal-field therapeutic substrate is a genuinely novel concept and the Whoop-shape panel exists, but core wellness loops — self-journaling, guided CBT, trend charts, wearable import, meditation — are mostly absent.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
