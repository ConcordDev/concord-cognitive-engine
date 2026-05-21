# law-enforcement — Feature Gap vs Axon Records / Mark43 (RMS/CAD)

Category leader (2026): Axon Records / Mark43 (police records & dispatch management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/lawenforcement.js` registerLensAction macros (caseAnalysis, patrolOptimize, incidentReport, crimeStats) + generic `/api/lens` artifact store via useLensData.

## Has (verified in code)
- Records management across Cases, Incidents, Officers, Evidence, Patrols, Warrants — typed artifacts with rich schemas
- Dashboard: active cases, on-duty officers, active incidents, high-priority count
- Case strength analysis (evidence/witness/suspect scoring → prosecutable verdict + next steps)
- Patrol optimization, incident report generation, crime statistics
- Search per record type, police activity feed, action panel

## Missing — buildable feature backlog
- [x] `[L]` CAD (computer-aided dispatch) — live call queue, unit status board, dispatch routing
- [x] `[M]` Evidence chain-of-custody log with transfers, signatures, and barcode/locker tracking
- [x] `[M]` Officer scheduling / roster with shifts, beats, and overtime
- [x] `[M]` Crime mapping — geospatial incident heatmap with hotspot detection
- [x] `[S]` Warrant lifecycle — issuance, service attempts, return, expiry tracking
- [x] `[M]` Report writing with statute auto-population and supervisor approval workflow
- [x] `[S]` Field interview / arrest booking forms with mugshot/print capture

## Parity
~90% of an RMS/CAD suite. All seven backlog items now ship full-stack: the `RmsCadConsole`
(`components/law-enforcement/RmsCadConsole.tsx`) wires the complete `lawenforcement.js` macro
surface — live CAD dispatch with nearest-unit routing, evidence chain-of-custody with barcode
+ integrity audit, officer roster with daily/weekly overtime detection, geospatial crime
mapping with grid-bucket hotspot detection, the warrant lifecycle, statute-auto-populating
report writing with supervisor approval, and field-interview/arrest booking. Remaining gap is
licensed integrations (NCIC/CLETS, real GIS tile providers) — a structural, non-buildable gap.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
