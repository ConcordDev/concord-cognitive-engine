# Agriculture scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/agriculture.js` (+ `concord-frontend/app/lenses/agriculture/page.tsx`, `components/agriculture/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested by Lens Tester 4 after insurance TESTS_COMPLETE; agriculture claimed.

## Model — two coexisting data planes

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Records desk** (generic lens artifacts) | `RecordsPanel.tsx` under tabs Fields / Crops / Livestock / Equipment / Water / Harvest / Certs | `useLensData('agriculture', type)` → `POST/PUT/DELETE /api/lens/agriculture` | `STATE.lensArtifacts` domain=`agriculture`; types `Field`, `Crop`, `Animal`, `FarmEquipment`, `WaterSystem`, `Harvest`, `Certification` (`ag-types.ts:40–47,115–128`) |
| **Ops Center / FieldView / Farm Workbench** (domain macros) | `DeereWorkbenchPanel`, `PrecisionAgPanel`, `FarmWorkbench` overlay (Shift+W), Ops desk summaries | `POST /api/lens/run { domain:'agriculture', action }` → `LENS_ACTIONS` + **virtualArtifact** (`server.js:51631–51655`) | `STATE.agricultureLens` Maps keyed by **userId** via `agriActor` (`agriculture.js:727–744,947–950`) |

Also on the shell (not record creates, but side-effect surfaces):

- **Plans** (`AgricultureActionPanel`) — Mint private DTU / Publish public benchmark / Lever `chat_agent.do`
- **Live Feed** (`AgricultureFeedPanel`) — World Bank pull → **public** DTUs
- **Scout tab** — `PestIdentifier` (local `identify-pest`) + `GbifPanel` (`live_gbif` outbound read)
- Weather / realtime chrome — `useRealtimeLens('agriculture'|'eco')` + `WeatherHero` (socket / eco feed; not a create path)

### Shared runtime facts

- Domain wrapped with `guardAnonWrites` (`agriculture.js:4,13`) — anon can read, not write.
- Actor key: `agriActor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:744`).
- `agriculture` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- Generic Records creates go through `lens.create` (`server.js:50070–50085`): stamps `ownerId = ctx.actor.userId || "anon"`, defaults `meta.visibility` to `"private"`, then **`_lensEmitDTU`** → WS `dtu:created` / `lens:dtu_generated` with title/tags and **no userId** (**FIX-xl-ws-001**, `:49871–49946`, emit at `:50085`).
- Generic list/get filter by owner for non-social domains (`:49975–49988` pattern). Caveat: artifacts with **no ownerId** or `ownerId === "anon"` are **visible to everyone**.
- Domain macros via `/api/lens/run` dual-registry path use a **virtualArtifact** and only `_recordLensActivity` — they do **not** call `_lensEmitDTU` (`server.js:51631–51655`).
- **Two "Field" stores:** Records `Field` artifacts ≠ Ops Center `field-create` rows in `agricultureLens.fields`. Same split for Equipment (`FarmEquipment` artifact vs `equipment-add` fleet).
- Child macros refuse foreign parent ids via `agriParentRefusal` (`:952–966`) — no cross-farm confirmation.
- LIVE badge = socket health only (`page.tsx:46,108` + `useRealtimeLens('agriculture')`). Not a data-sharing signal.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/agriculture/page.tsx:56–74` via `useLensCommand`:

| Key | View |
|-----|------|
| `o` | Ops |
| `f` | Fields |
| `c` | Crops |
| `l` | Livestock |
| `e` | Equipment |
| `w` | Water |
| `h` | Harvest |
| `r` | Certifications |
| `m` | Map |
| `d` | Deere Ops Center |
| `p` | FieldView |
| `b` | Plans |
| `s` | Scout |
| `shift+w` | Farm Workbench overlay |

**RC1: YES — bare-letter tab shortcuts.** Typing in forms can steal focus and switch tabs (same class as Household/Food/Healthcare). Digits are not used here; almost every letter above is a navigation steal risk.

**RC2: YES on Records editor + cards.**

- `RecordsPanel.tsx:459–466` — list cards `role="button"` + Enter/Space → `onEdit`
- `RecordsPanel.tsx:677–683` — modal backdrop `role="button"` + Escape/Enter/Space → `onClose` (closes unsaved form)
- `FarmWorkbench.tsx:319` — field rows `role="button"` + Enter/Space → select

`useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — still leaks for the bare-letter map when the guard fails (RCA-form-hotkey-steal RC1).

## Verdict table — Records desk (generic lens artifacts)

All seven types share one path: `useLensData('agriculture', artifactType)` → create/update/remove (`RecordsPanel.tsx:265–266,417`; Delete button `:639–647`).

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **Field** | **SAFE_PRIVATE** (ownerId + default private; not social) | **Yes** `lens.delete` owner/admin | **Yes** card Delete (`RecordsPanel.tsx:417,639–647`) | Local fields. Analyze → may follow `plan-crop` (compute). Create fires **FIX-xl-ws-001**. | **SAFE_PRIVATE_DELETABLE** (accept WS title leak; QA title) |
| **Crop** | same | **Yes** | **Yes** | Local. | **SAFE_PRIVATE_DELETABLE** |
| **Animal** (Livestock) | same | **Yes** | **Yes** | Local free-text livestock — not real animal registries. | **SAFE_PRIVATE_DELETABLE** |
| **FarmEquipment** | same | **Yes** | **Yes** | Separate from Ops Center `equipment` Map. | **SAFE_PRIVATE_DELETABLE** |
| **WaterSystem** | same | **Yes** | **Yes** | Local. `waterSchedule` may call Open-Meteo if `fetchForecast` (`:363–376`) — prefer leave forecast off during QA. | **SAFE_PRIVATE_DELETABLE** |
| **Harvest** | same | **Yes** | **Yes** | Local. | **SAFE_PRIVATE_DELETABLE** |
| **Certification** | same | **Yes** | **Yes** | Local cert metadata — not USDA/eCert submit. | **SAFE_PRIVATE_DELETABLE** |

QA write title pattern: `QA LT4 agriculture 2026-11-09 <thing>`. Delete after.

## Verdict table — Ops Center / FieldView / Workbench (`STATE.agricultureLens`)

All buckets are **`Map<userId, …>`** via `agriActor` / `ensureAgBucket`. **No `_shared` bucket.**

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **field** (`field-create`) | **SAFE_PRIVATE** | **Yes** `field-delete` (`:830–840`) | **Yes** Trash on FarmWorkbench Fields tab (`FarmWorkbench.tsx:166–170,338–341`) | Local. **No** `_lensEmitDTU`. | **SAFE_PRIVATE_DELETABLE** |
| **scout pin** (`scout-add`) | **SAFE_PRIVATE** | **Yes** `scout-delete` (`:930–941`) | **Yes** Trash on FarmWorkbench Scouting tab (`:505–508,592–594`) | Requires owned fieldId. Local note/coords. | **SAFE_PRIVATE_DELETABLE** |
| **equipment** (`equipment-add`) | **SAFE_PRIVATE** | **Yes** `equipment-delete` (`:1022–1031`) | **Yes** Trash hover (`EquipmentPanel.tsx:56–60,101`) | Ops Center fleet — separate from Records FarmEquipment. | **SAFE_PRIVATE_DELETABLE** |
| **zones** | **SAFE_PRIVATE** | **Yes** `zones-delete` (`:1066–1075`) | **Yes** Trash hover (`ZonesPanel.tsx:35–39,73`) | Parent field must be own `field-create` row. | **SAFE_PRIVATE_DELETABLE** |
| **prescriptions** | **SAFE_PRIVATE** | **Yes** `prescriptions-delete` (`:1128–1137`) | **Yes** Trash hover (`PrescriptionsPanel.tsx:51–55,90`) | Local Rx; approve is local flag. | **SAFE_PRIVATE_DELETABLE** |
| **cost entry** | **SAFE_PRIVATE** | **Yes** `cost-entry-delete` (`:1681–1690`) | **Yes** Trash (`ProfitAnalysisPanel.tsx:128+,266`) | Local bookkeeping $. | **SAFE_PRIVATE_DELETABLE** |
| **trial entry** | **SAFE_PRIVATE** | **Yes** `trial-entry-delete` (`:1973–1982`) | **Yes** Trash (`SeedTrialPanel.tsx:120–125,259–263`) | Local. | **SAFE_PRIVATE_DELETABLE** |
| **NDVI layer** (`satellite-ndvi-fetch`) | private store | **Yes** `satellite-ndvi-delete` (`:1563–1572`) | **Yes** Trash (`NdviLayersPanel.tsx:111–116,212–216`) | **EXTERNAL** Open-Meteo archive (`:1500–1504`). Persist + delete exist, but create **is** the outbound call. | **KEEP_BLOCKED** (outbound) |
| **planting pass** (`planting-log`) | **SAFE_PRIVATE** | **No** | **No** | Local log only. | **KEEP_BLOCKED** (no delete) |
| **harvest pass** (`harvest-log`) | **SAFE_PRIVATE** | **No** | **No** | Local log only. | **KEEP_BLOCKED** (no delete) |
| **nitrogen plan** | **SAFE_PRIVATE** | **No** | **No** (create + apply only) | `nitrogen-apply` mutates plan applications list. | **KEEP_BLOCKED** (no delete) |
| **imagery** (`imagery-attach`) | **SAFE_PRIVATE** | **No** | **No** | Stores URL/metadata string — client may load URL. Use fake/null. | **KEEP_BLOCKED** (no delete) |
| **tank mix** | **SAFE_PRIVATE** | **No** | **No** | Local recipe. | **KEEP_BLOCKED** (no delete) |
| **work order** | **SAFE_PRIVATE** | **No** hard delete | **No** (complete only `work-orders-complete`) | Local. | **KEEP_BLOCKED** (no delete) |
| **grain bin** | **SAFE_PRIVATE** | **No** | **No** (load/unload only) | Local inventory math. | **KEEP_BLOCKED** (no delete) |
| **telemetry sync** (`telemetry-import`) | **SAFE_PRIVATE** | **No** | **No** | Mutates own equipment telemetry + sync ledger (`:1580–1627`). Paste fake JSON only if ever allowed — prefer skip. | **KEEP_BLOCKED** (no delete) |
| **yield map** (`yield-map-build`) | **SAFE_PRIVATE** | **No** | **No** | Local grid from points / harvest passes. | **KEEP_BLOCKED** (no delete) |
| **soil grid** (`soil-grid-generate`) | **SAFE_PRIVATE** | **No** | **No** | Local sampling grid + lab import. | **KEEP_BLOCKED** (no delete) |

## Side-effect / outbound inventory

| Action | Outbound / platform effect? | QA rule |
|--------|----------------------------|---------|
| Records create/update/delete | FIX-xl-ws-001 title/tags WS broadcast (no body) | Prefer QA titles; optional skip if leak unacceptable |
| Ops Center / FieldView macros (except rows below) | No `_lensEmitDTU`; activity log only | OK where deletable |
| `weather-for-field` | **EXTERNAL** Open-Meteo via `getForecast` (`:845–879`) | Prefer skip / BLOCKED for outbound |
| `spray-window-advisor` | **EXTERNAL** Open-Meteo (`:1757–1766`) | Prefer skip / BLOCKED for outbound |
| `satellite-ndvi-fetch` | **EXTERNAL** Open-Meteo archive + persist layer (`:1482–1550`) | **BLOCKED** |
| `waterSchedule` with `fetchForecast` | **EXTERNAL** `openMeteoDailyForecast` (`:363–376`) | Leave forecast flag off |
| `agriculture.feed` / Feed Pull | **EXTERNAL** World Bank + `dtu.create` **`visibility:"public"`** (`:2164–2207`); UI `AgricultureFeedPanel.tsx:55–60` | **BLOCKED** |
| `live_gbif` (Scout GbifPanel) | **EXTERNAL** GBIF occurrence search | Read OK; no QA write |
| Action Panel → Mint farm plan | Private `dtu.create` — still FIX-xl-ws-001 (`AgricultureActionPanel.tsx:134`) | Prefer skip |
| Action Panel → Publish yield benchmark | `dtu.create` + **`visibility:'public'`** (`:163`) | **BLOCKED** |
| Action Panel → Lever | `chat_agent.do` (`:177`) | **BLOCKED** |
| `AgricultureKeepMenu` Save field report | Private DTU + optional **thread draft** (`agricultureReport.ts` + KeepMenu; `thread` is social) | Prefer skip; thread draft **BLOCKED** |
| LensShell Publish/share, emails, SMS, payments, agent deploy | Standing rules | **BLOCKED** |

Analytical macros (`rotationPlan`, `yieldAnalysis`, `plan-crop`, `analyze-soil`, `identify-pest`, `predict-yield`, `analyze`, `profit-analysis`, `trial-compare`, `dashboard-summary`, …) are **pure compute** over owned / supplied data when forecast fetch is off — OK to run read-only.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| Records: Field, Crop, Animal, FarmEquipment, WaterSystem, Harvest, Certification | Records tab → New / card Delete. QA titles. Delete after. Accept FIX-xl-ws-001. |
| Ops: **field** (Farm Workbench overlay Shift+W → Fields) | `field-create` + Trash. Prefer this path if avoiding WS leak. |
| Ops: **scout pin** (Farm Workbench → Scouting) | Needs a domain field first. |
| Ops: **equipment**, **zones**, **prescriptions** (Ops Center tabs) | Hover Trash (`opacity-0 group-hover` — easy to miss). Zones/Rx need parent domain field. |
| FieldView: **cost entry**, **trial entry** | Trash present. |

## Keep BLOCKED / do not write

1. **planting / harvest passes, nitrogen plans, imagery, tank mixes, work orders, grain bins, telemetry imports, yield maps, soil grids** — private but **no delete** (server and/or UI).
2. **satellite-ndvi-fetch**, **weather-for-field**, **spray-window-advisor**, **waterSchedule+fetchForecast** — outbound Open-Meteo.
3. **Live Feed Pull** (`agriculture.feed`) — public DTUs + World Bank.
4. **Action Panel Publish** / **Lever** / paid Ask / Vision.
5. **KeepMenu thread draft** (social domain) and prefer skip private DTU mint (WS leak).
6. **LensShell Publish/share**, invites, real emails/SMS, real farm GPS of private property if privacy-sensitive, real pesticide mixes tied to commercial applications.
7. Do **not** enter real producer PII, real USDA cert numbers, or real equipment serials.

## Gaps / notes

- Records Equipment vs Ops Center Equipment are **different stores** — deleting one does not remove the other.
- Records Field vs Workbench `field-create` same split; PrecisionAg `field-list` only sees domain fields.
- Scout **tab** (`ScoutPanel`) does not host scout-pin CRUD — pins live under Farm Workbench overlay.
- Missing deletes listed above leave residuals up to in-memory/STATE caps (e.g. NDVI bucket capped 200 — but NDVI create is outbound-blocked anyway).
- Live not proven: production `agricultureLens` contents for the shared QA account; whether older anon-bucket rows exist.

## Summary for tester

**OK for one QA write + delete** (title `QA LT4 agriculture 2026-11-09 …`): all seven Records types; domain field / scout / equipment / zones / prescriptions / cost entry / trial entry.

**KEEP_BLOCKED:** non-deletable Ops/FieldView logs (passes, N plans, imagery, mixes, WOs, bins, telemetry, yield maps, soil grids); all Open-Meteo / World Bank / public DTU / agent / publish paths.

**RC1 bare-letter hotkeys are active** on this lens — expect form typing to switch tabs. **RC2** on Records modal backdrop.

---

## Insurance E-Sign verification

**Question:** Live E-Sign form copy appears to imply emailing the signer; earlier code read said e-sign stays in-workspace. Which is true?

### UI path

- AMS tab → **E-Sign & Binder** (`AmsWorkbench.tsx:168,233`) → `ESignBinder` (`:1158+`).
- Create calls `lensRun('insurance', 'esign-create', { title, docType, policyId, signers })` (`:1190–1194`).
- Sign calls `lensRun('insurance', 'esign-sign', { id, signerName })` (`:1205–1208`) — **in-page "Sign now"** button (`:1304–1306`), not an email link.
- Binder: `binder-issue` after all signed (`:1214–1221`).

### Misleading UI copy (does **not** prove outbound mail)

- Intro: *"Send a document for signature…"* (`AmsWorkbench.tsx:1229–1231`).
- Signer row has an **Email** input (`:1252`).
- Primary button uses a **Send** icon + "Create envelope" (`:1266–1267`).
- Status chip treats `sent` like awaiting (`:1290`) even though create never sets `status:"sent"`.

There is **no** literal string "emails the signer" / "will email" in the E-Sign UI. The implication comes from Send + Email field + "Send a document…" wording.

### Handler — definitive: **no email / no outbound message**

`esign-create` (`server/domains/insurance.js:2244–2277`):

- Stores `signers[].email` as **optional metadata only** (`:2251–2257`).
- Explicit comment: *"Signers are not emailed by Concord; they sign in this workspace."* (`:2267`).
- `delivered: false` always on create (`:2269`).
- `status: "awaiting_signatures"` (`:2268`) — not `sent`.
- Audit event: *"Envelope created; awaiting signatures (signers are not emailed)"* (`:2272`).
- Persist via `pushCapped(s.envelopes, userId, envelope)` + `saveInsState()` only (`:2274–2275`).
- Returns `{ ok:true, result:{ envelope } }` — no mail call.

`esign-sign` (`:2288–2314`): flips `signer.signed` in the caller's own envelopes Map; no outbound.

`binder-issue` (`:2318+`): local binder object on the envelope; no outbound.

### Searches performed (not found in insurance esign path)

| Pattern | Result in `insurance.js` esign handlers / `ESignBinder` |
|---------|--------------------------------------------------------|
| `nodemailer`, `sendEmail`, `sendgrid`, `resend`, `smtp`, `createTransport` | **Not found** |
| `fetch(` / external host call inside `esign-create` / `esign-sign` / `binder-issue` | **Not found** |
| `notify` / webhook emit tied to esign | **Not found** (email fields elsewhere are CRM client/agent contact storage only — `:380`, `:861`) |

### Verdict

**DOES_NOT_SEND_EMAIL.** Submitting E-Sign creates a **private, per-user AMS envelope** and expects in-workspace "Sign now". The live form **looks** like it emails (Send icon + Email field + "Send a document…" copy) but the server **explicitly does not** email. FIX-insurance-007 can be closed as **UI copy misleading / false implication**, not as an outbound mail bug — still advise **fake emails only** and prefer empty email field for QA.

**Could not determine from code alone:** whether any production middleware / observability wrapper outside `insurance.js` logs signer emails to an external sink (no such call site in the esign handlers). Live SMTP/env presence was not probed (read-only, no service touch).
