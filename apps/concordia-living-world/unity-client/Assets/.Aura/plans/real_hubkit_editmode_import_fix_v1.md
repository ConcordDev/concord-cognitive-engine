# Real HubKit EditMode Import Fix

1. Inspect HubKit.cs, ModuleKit.cs, SettlementRealKitTests, manifest, packages, and current console failures.
2. Correct the EditMode cache lifecycle so EnsureLoaded can index the real manifest without calling DontDestroyOnLoad outside Play Mode; preserve real GLTFast imports and diagnostics.
3. Compile-check and run the focused SettlementRealKitTests.
4. If focused tests expose further import/path/cleanup issues, correct only the production lifecycle/path code, then rerun and report observed results.