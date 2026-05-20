# pets — Feature Completeness Spec

Rival app(s): Pawprint, 11pets, Rover (2026)
Sources:
- https://thedogapi.com/ — The Dog API breed reference (free, no key for breeds list)

## Features

### Pet-care substrate
- [x] Pets, vaccines, medications, vet visits, weight history
- [x] Care activities, symptoms, reminders, documents, expenses
- [x] Caregivers, bookings, pet-care dashboard
- (43 macros)

### Live data & feed
- [x] Live dog-breed feed — The Dog API breed profiles ingested as DTUs (macro: pets.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| GPS pet trackers | hardware tracker integration | manual location + activity notes |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (The Dog API → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` pets feed green; `tests/pets-domain-parity.test.js` + `tests/pets-breed-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="pets"` mounted in the lens page.
