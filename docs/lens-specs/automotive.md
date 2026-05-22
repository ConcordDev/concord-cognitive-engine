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
- [x] `[M]` OBD-II live telemetry import (Bluetooth dongle bridge)
- [x] `[S]` Cost-per-mile / total-cost-of-ownership rollups
- [x] `[M]` Predictive maintenance alerts from mileage + service history
- [x] `[S]` Photo attachments for receipts + odometer readings
- [x] `[M]` Multi-vehicle comparison dashboard
- [x] `[S]` Service-shop locator + appointment notes
- [x] `[M]` Warranty + insurance renewal tracking

## Parity
~95% of CARFAX Car Care's surface. Maintenance/fuel/expense/recall tracking with real NHTSA data plus OBD-II live telemetry import, cost-per-mile/TCO rollups, predictive-maintenance alerts, receipt/odometer photos, multi-vehicle comparison, a service-shop locator with appointments, and warranty/insurance renewal tracking all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
