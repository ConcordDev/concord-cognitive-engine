# mental-health — Feature Completeness Spec

Rival app(s): Headspace, Calm, Daylio, Finch (2026)

## Features

### Wellness substrate
- [x] Mood tracker + trend/variance analysis, journal prompts + entries
- [x] Coping strategies, wellness scoring, gratitude, habit/ritual tracking
- [x] Breathing exercises, crisis-resource directory, reflection logs
- (29 macros — full per-(domain,macro) inventory via `npm run cartograph:static`)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time external feed | a free public mental-health data source | **Feed-exempt.** Mental health is a private, personal-care domain — there is no appropriate real-time public data feed to ingest, and a quotes/affirmations API would be low-signal noise. The lens is substrate-focused (the user's own mood, journal, habits). External clinical guidance belongs in authored content, not a live feed. |
| Licensed teletherapy | a clinician network + HIPAA infrastructure | crisis-resource directory points to real hotlines; the lens never claims to provide medical advice |

## Verification log
- 2026-05-20: Backend — already a deep lens (29 macros). No changes needed for completeness; reviewed and confirmed feed-exempt (see Boundary register).
- 2026-05-20: Tests — `tests/mentalhealth-domain-parity.test.js` + `tests/mentalhealth-urbanplanning-domain-parity.test.js` green (70 cases).
