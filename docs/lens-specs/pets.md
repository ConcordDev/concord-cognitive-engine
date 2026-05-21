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
- [ ] `[M]` Vaccine due-date reminders with calendar export — auto-alert on expiring shots
- [ ] `[S]` Shareable health record export — PDF/portable record for vet or boarding
- [ ] `[M]` Multi-caregiver shared access — household members see and edit one pet's record
- [ ] `[S]` Photo gallery / timeline per pet — visual history beyond document storage
- [ ] `[M]` Vet appointment booking integration — schedule directly, not just log visits
- [ ] `[S]` Breed-specific care guidance — surface health risks and care tips from breed data
- [ ] `[S]` Lost-pet / microchip profile — public-shareable ID card

## Parity
~65% of 11pets' feature surface. The health-record substrate is unusually complete (vaccines, meds, vet visits, weight, symptoms, expenses, bookings). Gaps are reminders-with-export, shareable records, and multi-caregiver sync.
