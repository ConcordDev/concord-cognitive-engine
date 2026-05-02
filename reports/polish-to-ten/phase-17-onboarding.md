# Phase 17 — Onboarding Refinement

## Goal

Make the OnboardingWizard "completed" state survive logout/login on a different device. Today it lives in `localStorage` only; users on a fresh browser get the wizard fired again even if they already finished it.

## Pre-implementation discovery

`OnboardingWizard.tsx` exists and is wired (per Block A sweep). The flow itself is fine — what's missing is server-side persistence of completion. Step-by-step progress is already tracked server-side via `/api/onboarding/complete` + `completeOnboardingStep(userId, stepId)`, but the **wizard-completed-overall** flag was localStorage-only.

## Changes

### `server/migrations/072_users_first_visit.js` (new)

`ALTER TABLE users ADD COLUMN first_visit_completed_at INTEGER`. Idempotent.

### `server/server.js`

Two new endpoints:

- `GET /api/onboarding/wizard-status` (auth required) — returns `{ ok, completed, completedAt }` based on the new column.
- `POST /api/onboarding/wizard-complete` (auth required) — sets `first_visit_completed_at = unixepoch()` if not already set. Idempotent (the SQL `WHERE first_visit_completed_at IS NULL` clause).

These are intentionally separate from the existing per-step `/api/onboarding/complete` endpoint so the wizard-overall state doesn't collide with the granular step-progress state.

### `concord-frontend/components/onboarding/OnboardingWizard.tsx`

The `useOnboarding` hook now:

1. Reads `localStorage` first for snappy hydration; opens the wizard if no flag
2. Hits `/api/onboarding/wizard-status` and, if the server says completed but localStorage doesn't have the flag, syncs localStorage and skips the wizard
3. On `complete()` — writes localStorage AND fires `POST /api/onboarding/wizard-complete` (best-effort; no error UX, the next request will heal)

## Verification

- `node --check server.js migrations/072_users_first_visit.js` — clean
- `npx tsc --noEmit` — clean
- `npx eslint components/onboarding/OnboardingWizard.tsx` — clean
- Manual verification (Phase 20): complete the wizard on browser A → log in to browser B with the same account → wizard does not re-fire.

## Files touched

| File | Action |
|---|---|
| `server/migrations/072_users_first_visit.js` | created |
| `server/server.js` | added wizard-status + wizard-complete endpoints |
| `concord-frontend/components/onboarding/OnboardingWizard.tsx` | extended `useOnboarding` to consult server |

## Notes for downstream phases

- Phase 18 (loop closure feedback): the first-time-quest-complete fanfare can be made extra-loud / extra-special by reading `first_visit_completed_at` and treating sub-1-day-old completion as "still new."
- Phase 19 (retention hooks): same column tells the daily-quest variety system whether the player is in their first session ever (special variety vs. veteran variety).
