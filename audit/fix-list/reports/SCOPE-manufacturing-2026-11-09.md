# Manufacturing scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/manufacturing.js` + `concord-frontend/app/lenses/manufacturing/page.tsx` + `components/manufacturing/*`. Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

## Model

- Domain wrapped with `saveAfterWrites(guardAnonWrites(...))` (`manufacturing.js:4`) — anonymous callers can read, not write.
- Actor key: `uid(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:201`).
- Storage: `globalThis._concordSTATE.manufacturingLens` Maps keyed by **userId** (or `` `${userId}::${product|machineId}` `` for SPC/IoT):
  - `machines`, `workOrders`, `spcSamples` (`:81–83`)
  - `workInstructions`, `iotReadings`, `scheduleJobs`, `lots`, `andonAlerts`, `ncrs`, `maintenancePlans`, `inventory` (`:191–198`)
- **No `_shared` bucket** anywhere in manufacturing.js (unlike council).
- `manufacturing` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/… only).
- UI creates go through `POST /api/lens/run { domain:'manufacturing', action, input }` → `LENS_ACTIONS` with a **virtualArtifact** (`server.js:51630–51656`). That path does **not** call `_lensEmitDTU`. It only `_recordLensActivity` into the caller's own activity log (`:14659–14669`, user-scoped).
- Generic `lens.create` WS leak (FIX-xl-ws-001 / `_lensEmitDTU` → `realtimeEmit("dtu:created", { title, tags })` without userId at `server.js:49871–49946`) therefore does **not** fire for MES board creates. It **does** fire if Tools → Mint/Publish uses `dtu.create`.

## Existing live records (10 WOs, 10 machines, `zukotest w2mv4evt2c WI`)

**Verdict: QA account's own bucket (earlier harness data), not a shared/anon/seed feed.**

Evidence: list handlers only return `state.*.get(uid(ctx))` (`work-orders` `:112–126`, `oee-status` `:95–109`, `work-instructions-list` `:451–457`). Cross-user ids are not found on update/delete (`work-order-update` comment `:375–376`; deletes `:962–965`). Naming (`zukotest`, harness WI id) matches prior shared **test account** pattern (same as logistics SCOPE), not `_shared` or social visibility.

Caveat (code-only): if a prior write ran while `userId` resolved to `"anon"`, those rows live under the `anon` Map and are **not** visible to a signed-in user — and vice versa. Live lists showing 10 machines/WOs while signed in implies they are under that signed-in userId.

## Verdict table

| Create / surface | UI → API | Storage | Verdict | Side effects / notes |
|------------------|----------|---------|---------|----------------------|
| Work Orders → Create work order | `WorkOrderBoard.tsx:80` → `work-order-create` | `workOrders` Map / userId (`:318–352`) | **SAFE_PRIVATE** | Local persist + `saveMfg`. Delete: `work-order-delete`. |
| OEE Board → machine register | `OEEDashboard.tsx:89` → `machine-register` | `machines` Map / userId (`:272–316`) | **SAFE_PRIVATE** | Local. Delete: `machine-delete` also clears that user's IoT readings for the machine (`:976`). |
| Quality/SPC → Log sample | `QualitySPC.tsx:93` → `spc-sample-log` | `spcSamples` `` userId::product `` (`:386–418`) | **SAFE_PRIVATE** | Local; capped at 500/product. **No sample-delete action** — cleanup = unique QA product name + leave or overwrite by volume. |
| Work Instructions → New Set | `ShopFloorSuite.tsx:95` → `work-instruction-create` | `workInstructions` / userId (`:422–448`) | **SAFE_PRIVATE** | Local. Delete: `work-instruction-delete`. |
| Machine/IoT readings | `ShopFloorSuite.tsx:251` → `iot-reading-ingest` | `iotReadings` `` userId::machineId `` (`:476–501`) | **SAFE_PRIVATE** | **No outbound MQTT/OPC-UA/HTTP.** Comments at `:69–74` describe a future shop-floor feed; handler only appends to Map. Does not invent a machine if unregistered. |
| Gantt → Add job | `ShopFloorSuite.tsx:360` → `schedule-job-add` | `scheduleJobs` / userId (`:541–560`) | **SAFE_PRIVATE** | Finite-capacity schedule is pure compute over caller's jobs (`schedule-gantt` `:563+`). Delete: `schedule-job-delete`. |
| Lot Traceability → register | `ShopFloorSuite.tsx:542` → `lot-register` | `lots` / userId (`:628–652`) | **SAFE_PRIVATE** | Local genealogy. Delete: `lot-delete`. |
| Andon → Raise alert | `ShopFloorSuite.tsx:674` → `andon-raise` | `andonAlerts` / userId (`:708–729`) | **SAFE_PRIVATE** | **No email/SMS/push/webhook.** Status only in Map (`andon-update` ack/resolve). Delete: `andon-delete`. |
| NCR/CAPA → Create NCR | `ShopFloorSuite.tsx:787` → `ncr-create` | `ncrs` / userId (`:775–800`) | **SAFE_PRIVATE** | Local workflow stages. Delete: `ncr-delete`. |
| Maintenance → Create plan | `ShopFloorSuite.tsx:903` → `maintenance-plan-create` | `maintenancePlans` / userId (`:838–860`) | **SAFE_PRIVATE** | Local. Delete: `maintenance-plan-delete`. |
| WIP Inventory → Upsert | `ShopFloorSuite.tsx:1025` → `inventory-upsert` | `inventory` / userId (`:899–918`) | **SAFE_PRIVATE** | Local allocate/status. Delete: `inventory-delete`. Pipeline `manufacturing`/`update_inventory` → logistics (`server.js:50553`) uses a **different action name** than `inventory-upsert` — dead for this UI unless something else calls `update_inventory`. |

### WS broadcast per create

| Path | Triggers FIX-xl-ws-001 (`_lensEmitDTU` → global `dtu:created` title/tags)? |
|------|-----------------------------------------------------------------------------|
| All MES creates above via `/api/lens/run` manufacturing.* | **No** (virtualArtifact branch skips emit) |
| Tools → Mint (`dtu.create` private) | **Yes** (title/tags broadcast; DTU itself visibility private) |
| Tools → Publish OEE (`dtu.create` + `/api/dtus/:id/publish`) | **Yes** + **public publish** |
| Tools → DM (`/api/social/dm`) | N/A (messages other users) |
| Tools → Lever (`chat_agent.do`) | Paid/agent path — separate from MES Maps |

## Keep BLOCKED

1. **Ask about Manufacturing** (LensShell toolbar) — LT1: costs 100 DTUs; standing rule: stop if cost appears. Keep BLOCKED.
2. **ManufacturingActionPanel → Publish** (anon/public OEE DTU) — public.
3. **ManufacturingActionPanel → DM** — contacts another user.
4. **ManufacturingActionPanel → Lever / chat_agent.do** — agent run / paid AI risk.
5. **LensShell Publish/share**, invites, emails, SMS, payments, agent deploy — standing rules (none in MES Maps, but shell chrome stays off).
6. Do **not** enter real shop-floor telemetry, real supplier lots, or real personal data into Andon/NCR titles.

Mint (private shift DTU) is technically private storage but still trips FIX-xl-ws-001 title/tags broadcast — treat as **optional / prefer skip** during write audit unless needed.

## Test-safe (CRUD OK under constraints)

All Shop Floor / OEE / WO / SPC / Andon / NCR / Maintenance / Inventory creates, updates, and deletes listed above.

Constraints:
- Titles / product / machine / lot / SKU / reason strings: `QA LT1 manufacturing 2026-11-09 <thing>`
- Fake quantities, dates, specs only
- **Delete afterwards** (every collection except SPC samples has a `*-delete`; for SPC use a unique product key and note residual samples in the ticket)
- Expect **RCA-form-hotkey-steal** (keys below) to interrupt typing — mark those checks BLOCKED by RCA, continue others
- Stay signed in (writes refuse anon via `guardAnonWrites`)

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/manufacturing/page.tsx:51–55, 110–116` via `useLensCommand`:

| Key | Tab |
|-----|-----|
| `o` | OEE Board |
| `w` | Work Orders |
| `q` | Quality / SPC |
| `s` | Shop Floor |
| `t` | Tools |

ShopFloorSuite subviews (Work Instructions / IoT / Gantt / Lot / Andon / NCR / Maintenance / Inventory) are click tabs only — **no** nested bare-letter `useLensCommand` found. Parent `o/w/q/s/t` still fire while those forms are open (same RC1 as Household/Food).

## Dashboard "9 open NCRs" vs empty NCR/CAPA tab

Both surfaces call the **same** `manufacturing.ncr-list` (`page.tsx:136,150` → `openCount`; `ShopFloorSuite.tsx:779–780` → `result.ncrs`).

Server (`:827–834`): `openCount = ncrs.filter(stage !== "closed").length` over **caller's** list. Empty list ⇒ `openCount: 0`. So a live mismatch is **not** cross-user leakage.

Likely same-user UI/consistency bugs (ticket, not BLOCKED for scope):
1. NCRTab `load()` silently ignores `!d.ok` and leaves `ncrs=[]` (`:778–781`) — a 400/`/api/lens/run` failure shows empty while KPI strip may still hold a prior successful react-query cache (`staleTime: 15000`).
2. Or KPI strip not yet invalidated after deletes (mutations fire `MFG_MUTATED_EVENT`; a failed load would not).

Recommend: re-hit `ncr-list` once, log `{ count, openCount, ncrs.length }`, and ticket the silent-fail empty state if still mismatched.

## Gaps

- Code-only; not live-proven against production STATE Maps.
- SPC samples have **no delete** verb.
- Pipeline `update_inventory` → logistics is orphaned relative to `inventory-upsert` UI.
- Blank WO submit: HTML `required` on product/quantity (`WorkOrderBoard.tsx:179–183`); server also validates. If LT1 saw no message, ticket UI/400-envelope surfacing (functional), not scope.
- IoT comments claim OPC-UA/MQTT/MTConnect; **implementation is in-memory only** — do not treat as live device integration.
- Cross-lens FIX-xl-ws-001 still applies platform-wide for generic `lens.create` / `dtu.create`; MES macros themselves are clean of that emit path.
- Existing 10 WOs / 10 machines / zukotest WI: treat as prior QA fixtures in the shared test account; prefer delete or leave labelled, do not assume they are other users' data.

