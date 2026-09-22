# Real HubKit EditMode Import Fix

1. Inspected HubKit.cs, ModuleKit.cs, SettlementRealKitTests, the real manifest, package versions, and console failures.
2. Fixed HubKit's EditMode cache lifecycle and supplied glTFast's `UninterruptedDeferAgent` in EditMode so neither the cache nor glTFast's stable-framerate helper calls `DontDestroyOnLoad` outside Play Mode.
3. Manifest indexing now visibly succeeds (`793` entries) and HubKit import diagnostics identify the remaining glTFast lifecycle blocker.
4. Focused tests could not be rerun to completion because Unity now reports an unrelated malformed, untracked `ConcordiaPersistenceService.cs` containing merge/replacement markers; compile-check is blocked by that file. HubKit itself passes standard script validation and `git diff --check`.

## Observed focused-test results

- Baseline: 4/4 `SettlementRealKitTests` failed because `DontDestroyOnLoad` in `HubKit.EnsureCache` aborted manifest loading.
- After the first fix: manifest indexed, but glTFast's default `glTF-StableFramerate` helper still called `DontDestroyOnLoad` in EditMode.
- After the second fix: test initialization was blocked by the unrelated compile error before focused tests started.
