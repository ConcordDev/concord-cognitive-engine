# Reopen queue (2026-10-05 2:04 PM ET, read-only audit vs Ramaj's no-partials / no-demo bar)

Truly complete: Retail, Agriculture, Astronomy, Atlas. Accounting is complete once its badge fix (manifest REAL_FREE, uncommitted) is browser re-proven and committed.

Reopened, worst first:
1. World: simulated camera feed (MobileCompanion.tsx:452-463), simulated DSL compiler (ConcordDSLEditor.tsx:200+), SEED_SNAP_TEMPLATES shipped (SnapBuildCatalog.tsx:389); proof is a page screenshot only
2. Healthcare: manifest dataTier DEMO (manifest.ts:1465) + "DEMO data" empty-state caption over real patients
3. Legal: dataTier DEMO (manifest.ts:1685), no browser proof
4. Aviation: dataTier DEMO + "Simulated DUATS-style filing" (EFBFiling.tsx:193)
5. Crypto: DTUExportButton data={{}} (CryptoWalletWorkspace.tsx:700)
6. Timeline: DTUExportButton data={{}} (timeline/page.tsx:188), no browser proof
7. Artistry (ollama worktree): data={{}} (artistry/page.tsx:124) + SIM_GRADE_A badge, no proof
8. Engineering, HVAC, Trades, Creator, Weather/forecast: SIM_GRADE_A "Simulated / Not real data" badge on real persisted user work; no or weak browser proof
9. Food: no recipe delete (in progress by zuko 3)
10. Fitness, Board, Studio, Analytics, Whiteboard: Keep -> DTU -> Thread was harness-only, not clicked in the browser
11. Chat, Thread, Wallet, Mail, Calendar, Marketplace, Finance, Projects, Code, Graph, Hypothesis, SRS, Travel, Physics, Pets: no browser proof at all (Thread, Marketplace, Hypothesis, Physics also export {} when there's no realtime data)
12. Music, Forums (ollama worktree): never browser-proven; Forums has empty-fallback exports

Also fix everywhere: `DTUExportButton data={realtimeData || {}}` must not export an empty object, so hide or disable it when there is nothing real to export.
