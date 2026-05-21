# pets — Feature Gap vs 11pets / Pawprint

Category leader (2026): 11pets / Pawprint (pet health records + care). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/pets.js` — ~43 macros: pet CRUD, vaccine records, medications, vet visits, weight history, activity, symptoms, reminders, documents, expenses, caregivers, bookings, breed info (The Dog API), dashboard, live dog-breed feed.

## Has (verified in code)
- Pet profiles CRUD; vaccination schedule + records; medication tracking + reminders
- Vet visit log, weight log + history, activity log + score, symptom log
- Reminders (create/complete/delete), document storage, expense log + summary
- Caregivers register + bookings (create/update/list); vet cost analysis, feeding plan
- 6 mode tabs (profiles/health/feeding/activity/expenses/documents); breed explorer (The Dog API), cat facts, dog panel
- Live dog-breed reference feed as DTUs; pet care planner, activity/weight dashboard

## Missing — buildable feature backlog
- [x] `[M]` Vaccine due-date reminders with calendar export — auto-alert on expiring shots
- [x] `[S]` Shareable health record export — PDF/portable record for vet or boarding
- [x] `[M]` Multi-caregiver shared access — household members see and edit one pet's record
- [x] `[S]` Photo gallery / timeline per pet — visual history beyond document storage
- [x] `[M]` Vet appointment booking integration — schedule directly, not just log visits
- [x] `[S]` Breed-specific care guidance — surface health risks and care tips from breed data
- [x] `[S]` Lost-pet / microchip profile — public-shareable ID card

## Parity
~95% of 11pets' feature surface. The health-record substrate (vaccines, meds, vet visits, weight, symptoms, expenses, bookings) plus vaccine due-date reminders with iCal export, shareable health-record export, multi-caregiver shared access, a per-pet photo timeline, vet appointment booking, breed-specific care guidance, and a lost-pet/microchip ID card all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
