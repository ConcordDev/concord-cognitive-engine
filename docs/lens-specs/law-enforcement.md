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
- [ ] `[L]` CAD (computer-aided dispatch) — live call queue, unit status board, dispatch routing
- [ ] `[M]` Evidence chain-of-custody log with transfers, signatures, and barcode/locker tracking
- [ ] `[M]` Officer scheduling / roster with shifts, beats, and overtime
- [ ] `[M]` Crime mapping — geospatial incident heatmap with hotspot detection
- [ ] `[S]` Warrant lifecycle — issuance, service attempts, return, expiry tracking
- [ ] `[M]` Report writing with statute auto-population and supervisor approval workflow
- [ ] `[S]` Field interview / arrest booking forms with mugshot/print capture

## Parity
~40% of an RMS/CAD suite. Solid records CRUD and case-strength analytics, but missing live dispatch, geospatial crime mapping, and the chain-of-custody rigor that define a production police system.
