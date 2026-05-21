# automotive — Feature Gap vs CARFAX Car Care / Drivvo

Category leader (2026): CARFAX Car Care / Drivvo (vehicle maintenance tracker). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/automotive.js` — 33 macros: vehicles CRUD, fuel log, service log, maintenance schedules + reminders, expenses, trips, documents, VIN decode (vPIC), recall lookup (NHTSA), diagnostic lookup, fuel-efficiency + repair-estimate calculators, vehicle stats, dashboard, recall feed.

## Has (verified in code)
- Garage: multiple vehicles with create/update/delete
- Fuel log + service log + maintenance schedules with reminders
- Expense tracking, trip log, document storage per vehicle
- VIN decode (NHTSA vPIC), recall lookup, OBD diagnostic-code lookup
- Fuel-efficiency calculator, repair-cost estimator
- Vehicle stats, dashboard summary, live NHTSA recall feed

## Missing — buildable feature backlog
- [ ] `[M]` OBD-II live telemetry import (Bluetooth dongle bridge)
- [ ] `[S]` Cost-per-mile / total-cost-of-ownership rollups
- [ ] `[M]` Predictive maintenance alerts from mileage + service history
- [ ] `[S]` Photo attachments for receipts + odometer readings
- [ ] `[M]` Multi-vehicle comparison dashboard
- [ ] `[S]` Service-shop locator + appointment notes
- [ ] `[S]` Warranty + insurance renewal tracking

## Parity
~68% of CARFAX Car Care's surface. Genuinely complete maintenance/fuel/expense/recall tracking with real NHTSA data; main gaps are OBD telemetry and predictive maintenance.
