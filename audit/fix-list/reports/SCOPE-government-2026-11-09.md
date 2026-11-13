# Government scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/government.js` (+ `concord-frontend/app/lenses/government/page.tsx`, `components/government/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 1 after government pass 1 (`evidence/government/p1-desktop-20261109.md`). Creates held until this answer.

## Model — two coexisting data planes (+ FOIA side store)

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Case files** (generic lens artifacts) | `CaseOpsPanel.tsx` under Case files / Oversight→Caseload dashboard | `useLensData('government', type)` → `POST/PUT/DELETE /api/lens/government` | `STATE.lensArtifacts` domain=`government`; types `Permit`, `Project`, `Violation`, `EmergencyPlan`, `Record`, `CourtCase` (`lens-artifact-types.js:44`; `CaseOpsPanel.tsx:69`) |
| **Civic services desk** (domain macros) | 311 / Pin-drop / Permit desk / Inspections / Payments / Assets / Departments / Routing / Documents / Notices / Meetings / Advocacy / Elections | `POST /api/lens/run { domain:'government', action }` → `LENS_ACTIONS` + **virtualArtifact** | `STATE.governmentLens` Maps keyed by **userId** via `govActor` (`government.js:569–581`) — buckets `serviceRequests`, `permits`, `inspections`, `assets`, `departments`, `routingRules`, `fines`, `payments`, `meetings`, `advocacyActions`, `documents`, `notifications`, … |
| **FOIA drafts** (separate Map) | `FOIATracker.tsx` | `foia-list` / `foia-create` | `STATE.govLens.foiaRequests` Map keyed by userId (`government.js:233–237,433–455`) — **not** the same store as Case-file `Record` |

Also on the shell (side-effect / outbound surfaces):

- **Oversight** Caseload = CaseOps **dashboard** over case-file artifacts only (`page.tsx:168–169`) — **does not** read Permit Desk / FOIA / 311 stores (KPI mismatch root cause below).
- **Lookups** (`GovernmentActionPanel`) — reps / bills / broken permitTimeline & violationEscalation wrappers + **Mint / DM / Publish / agent** (Publish + DM + agent **BLOCKED**).
- **Open data** search + **Ingest as DTU** (private `dtu.create`).
- **My reps / Bills / Spending / Alerts** — public GETs (Congress.gov / USAspending / NWS / data.gov).
- **Payments** — Stripe PaymentIntent path when `STRIPE_SECRET_KEY` configured (**BLOCKED** for real card).

### Shared runtime facts

- Domain wrapped with `guardAnonWrites` (`government.js:142`) — anon can read, not write.
- Actor key: `govActor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:569`).
- `government` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- Generic Case-file creates go through `lens.create` (`server.js:50014–50085`): stamps `ownerId = ctx.actor.userId || "anon"`, defaults `meta.visibility` to `"private"`, then **`_lensEmitDTU`** → WS `dtu:created` / `lens:dtu_generated` with title/tags and **no userId** (**FIX-xl-ws-001**, `:49871–49946`, emit at `:50085`).
- Generic list/get filter by owner for non-social domains (`_lensArtifactVisible` `:49787–49792`). Caveat: artifacts with **no ownerId** or `ownerId === "anon"` are **visible to everyone**; `meta.visibility` `public`/`published` also opens them.
- Domain macros via `/api/lens/run` dual-registry path use a **virtualArtifact** and only `_recordLensActivity` — they do **not** call `_lensEmitDTU` (same as environment GHG / security SOC).
- Boot merges `EXTENDED_DOMAIN_RULES` then **`reconcileArtifactTypes`** so PascalCase case-file types are admitted (`domain-logic-extended.js:1260–1271`; test `government-case-file-status.test.js`). Form statuses `draft|proposed|public-comment|enacted|repealed|archived` match the rule — **no Security-style 422** for normal CaseOps creates. Old status `submitted` still 422s if forced.
- `useLensData` seed arrays exist in CaseOps but auto-seed is **dev-only** (`use-lens-data.ts:95–97`) — production live QA will not bulk-seed.
- LIVE badge = socket health only (`page.tsx:206,245` + `useRealtimeLens('government')`). Not a data-sharing signal.
- `queueGovNotification` (`:589–606`) writes an **in-app** row only — channel/contact are labels; **no email/SMS send**.

### Record Classification defaulting to "Public" — does it publish?

**No.** CaseOps Record form field `classification` (`public|confidential|exempt`, default `'public'`, `CaseOpsPanel.tsx:295,1390–1400`) is stored in **`data.classification`**. Save payload is `{ title, data: formData, meta: { status } }` only (`:718–723`) — **does not** set `meta.visibility`.

Server `lens.create` therefore keeps `meta.visibility = "private"` (`server.js:50076`). Visibility to other users is gated by `_lensArtifactVisible` on **`meta.visibility`** (`published`/`public`) or anon/missing owner — **not** on `data.classification`.

`classification` is consumed by `retentionCheck` as a records-management label (`government.js:216–224`). It does **not** call publish, social, or DTU public create.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/government/page.tsx:214–227` via `useLensCommand`:

| Key | View |
|-----|------|
| `g o` | Caseload overview |
| `g b` | Bills |
| `p` | Permit case files |
| `u` | Public works |
| `c` | Code enforcement |
| `r` | Records |
| `o` | Court |
| `3` | 311 |
| `g r` | My representatives |

From `CaseOpsPanel.tsx:599–601`: `/` focuses search.

**RC1: YES — bare-letter tab shortcuts** `p/u/c/r/o` (+ digit `3`). Typing in CaseOps / civic forms can steal focus and switch tabs (same class as Environment/Household). Chorded `g o` / `g b` / `g r` are lower risk than bare letters but still registered.

**RC2: YES on CaseOps editor.**

- `CaseOpsPanel.tsx:2568` — card `role="button"` + Enter/Space → `.click()`
- `CaseOpsPanel.tsx:3375–3377` — modal backdrop + panel `role="button"` + Enter/Space → close / noop-click (closes unsaved form when backdrop fires)

**Escape:** no Escape key handler on the CaseOps editor modal (search for Escape/keydown Esc → empty beyond Escalation copy). Matches live FAIL "Escape doesn't close New CourtCase modal".

`useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — still leaks for the bare-letter map when the guard fails (RCA-form-hotkey-steal RC1).

## Verdict table — Case files (generic lens artifacts)

All six types share one path: `useLensData('government', currentType)` → create/update/remove. Delete UI: card **Delete** with two-click confirm (`CaseOpsPanel.tsx:728–729,2761–2773`) and editor Delete. Create fires **FIX-xl-ws-001**.

Validation after boot reconcile: statuses match `GOVERNMENT_ARTIFACT_STATUSES` (`CaseOpsPanel.tsx:202–209` = domain rule). Types from `FRONTEND_ARTIFACT_TYPES.government`.

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **Permit** (case file) | **SAFE_PRIVATE** (ownerId + default private; not social). `data.classification` N/A. | **Yes** `lens.delete` | **Yes** confirm Delete | Local Accela-shape case file — **separate** from Permit Desk `permits` Map. | **SAFE_PRIVATE_DELETABLE** |
| **Project** | same | **Yes** | **Yes** | Local public-works project metadata. | **SAFE_PRIVATE_DELETABLE** |
| **Violation** | same | **Yes** | **Yes** | Local code-enforcement case. | **SAFE_PRIVATE_DELETABLE** |
| **EmergencyPlan** | same | **Yes** | **Yes** | Local plan metadata. | **SAFE_PRIVATE_DELETABLE** |
| **Record** | **SAFE_PRIVATE** even when Classification=`public` (see above) | **Yes** | **Yes** | Local records request metadata — **not** FOIATracker and **not** agency submit. | **SAFE_PRIVATE_DELETABLE** |
| **CourtCase** | same | **Yes** | **Yes** | Local court admin row. | **SAFE_PRIVATE_DELETABLE** |

QA write title pattern: `QA LT1 government 2026-11-09 <thing>`. Delete after. Accept FIX-xl-ws-001 title/tags WS leak.

## Verdict table — Civic services desk (`STATE.governmentLens` / `govLens`)

All buckets are **`Map<userId, …>`** via `govActor` / `ensureGovBucket` (FOIA via `getGovState().foiaRequests`). **No `_shared` bucket.** Macros do **not** call `_lensEmitDTU`.

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **311 service request** (`service-requests-create`) | **SAFE_PRIVATE** | **No** | **No** | Local only (`LocalRecordNotice`). Status updates queue **in-app** notifs only. | **KEEP_BLOCKED** (no delete) |
| **Pin-drop report** | same path as 311 (`ServiceRequestReporter` → `service-requests-create`) | **No** | **No** | Local + optional browser geolocation for pin. Not city 311. | **KEEP_BLOCKED** (no delete) |
| **Permit Desk application** (`permits-apply`) | **SAFE_PRIVATE** | **No** | **No** (pay-fee/approve/issue/deny only) | Local Accela-shape application — not a real permit office. Offline pay-fee is ledger flag only. | **KEEP_BLOCKED** (no delete) |
| **Inspection schedule** (`inspections-schedule`) | **SAFE_PRIVATE** | **No** | **No** (complete only) | Requires existing desk permit. | **KEEP_BLOCKED** (no delete) |
| **Fine / citation** (`fines-create`) | **SAFE_PRIVATE** | **No** | **No** | Local ledger row. Checkout can open **Stripe** path — keep Pay **BLOCKED**. | **KEEP_BLOCKED** (no delete; payment side-effect) |
| **Asset** (`assets-add`) | **SAFE_PRIVATE** | **Yes** `assets-delete` | **Yes** hover Trash (`AssetsPanel.tsx:54–56,102`) | Local infrastructure asset. | **SAFE_PRIVATE_DELETABLE** |
| **Department** (`departments-add`) | **SAFE_PRIVATE** | **Yes** `departments-delete` | **Yes** hover Trash | Local dept roster (name/email/phone stored locally). | **SAFE_PRIVATE_DELETABLE** |
| **Routing rule** (`routing-rules-set`) | **SAFE_PRIVATE** | **Yes** `routing-rules-delete` | **Yes** hover Trash | Local category→dept map. | **SAFE_PRIVATE_DELETABLE** |
| **Document** (`documents-publish`) | **SAFE_PRIVATE** (name says publish; stores in own `documents` bucket only — `LocalRecordNotice` confirms workspace-only) | **Yes** `documents-delete` | **Yes** hover Trash | E-sign stores signerName/email + fingerprint locally — **no email send** (`documents-sign` `:1647–1674`). | **SAFE_PRIVATE_DELETABLE** (one QA doc; delete after; fake signer email) |
| **Notices subscribe** (`notifications-subscribe`) | private subs Map | **No** unsubscribe/delete | **No** | Stores contact string as label; **no email/SMS delivery** (`:1701–1731`; UI copy). | **KEEP_BLOCKED** (no delete) |
| **Notices manual update** (`notifications-emit`) | private notifications list | **No** hard delete (mark-read only) | **No** delete | In-app row only via `queueGovNotification`. | **KEEP_BLOCKED** (no delete) |
| **FOIA draft** (`foia-create`) | **SAFE_PRIVATE** (`govLens.foiaRequests`) | **No** | **No** | Status hardcoded `"draft"`; UI: "deliberately no Submit" (`FOIATracker.tsx:114–118`). **Never** posts to FOIA.gov / any agency. | **KEEP_BLOCKED** (no delete; residual drafts) |
| **Advocacy action** (`advocacy-record`) | **SAFE_PRIVATE** | **Yes** `advocacy-delete` | **Yes** hover Trash | Local log of stance/channel/message — **not** sent to any rep (`LocalRecordNotice`). | **SAFE_PRIVATE_DELETABLE** |
| **Voter registration** (`voter-registration-submit`) | **SAFE_PRIVATE** (one row per userId; overwrite) | **No** | **No** | Local only — UI + server store DOB/address/name; **not** sent to vote.gov / election office (`ElectionsPanel.tsx:103–105`; `:1457–1482`). | **KEEP_BLOCKED** (no delete; PII residual) |
| **Meeting** (`meetings-schedule`) | **SAFE_PRIVATE** | **Yes** `meetings-delete` | **Yes** hover Trash | `meetings-publish-minutes` only sets minutes on own row — **not** a public web gazette. | **SAFE_PRIVATE_DELETABLE** |

## Side-effect / outbound inventory

| Action | Outbound / platform effect? | QA rule |
|--------|----------------------------|---------|
| Case-file create/update/delete | FIX-xl-ws-001 title/tags WS broadcast (no body) | Prefer QA titles; optional skip if leak unacceptable |
| Civic desk macros (SR/permit/asset/…) | No `_lensEmitDTU`; activity log only; in-app notifs only | OK where deletable |
| `queueGovNotification` / subscribe / emit | **No email/SMS** — in-app rows + contact labels | Still no delete on sub/notif → blocked writes |
| `documents-sign` | Local fingerprint only — **no mailer** | OK on deletable doc |
| `open-data-search` | **EXTERNAL** data.gov CKAN GET (`query`) | **SAFE_READONLY_PUBLIC_GET** |
| `open-data-ingest` + UI Ingest | EXTERNAL fetch + **private** `dtu.create` (still FIX-xl-ws-001 class on DTU path) | Prefer **KEEP_BLOCKED** for write; search alone OK |
| `representatives-find` | **EXTERNAL** `api.congress.gov` — sends resolved **state** (+ API key); ZIP/address resolved locally | **SAFE_READONLY_PUBLIC_GET** |
| `bills-list` | **EXTERNAL** congress.gov bill list; optional topic filter client-side | **SAFE_READONLY_PUBLIC_GET** |
| `budget-breakdown` (Spending) | **EXTERNAL** `api.usaspending.gov` POST-like fetch with fy/period | **SAFE_READONLY_PUBLIC_GET** (may 400 on period — known live FAIL) |
| `alerts-current` | **EXTERNAL** `api.weather.gov/alerts/active?point=lat,lng` — no DTU mint | **SAFE_READONLY_PUBLIC_GET** |
| `elections-upcoming` / `polling-place-lookup` | **EXTERNAL** Google Civic (needs `GOOGLE_CIVIC_API_KEY`) | Prefer skip / BLOCKED if key present and unused needed; read-only |
| `GovernmentActionPanel` Mint | Private `dtu.create` — FIX-xl-ws-001 | Prefer skip |
| `GovernmentActionPanel` Publish | `dtu.create` **public** + `/api/dtus/:id/publish` | **BLOCKED** |
| `GovernmentActionPanel` DM | `/api/social/dm` to another Concord user | **BLOCKED** |
| `GovernmentActionPanel` agent Letter | `chat_agent.do` | **BLOCKED** (paid/agent) |
| Stripe `payments-create-intent` / `payments-confirm` | Real charge when configured | **BLOCKED** |
| LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask | Standing rules | **BLOCKED** |

**No `government.feed` public-DTU feed** analogous to `environment.feed` / `security.feed` was found in this domain.

### Outbound lookups — classification (tester list)

| Lookup | Class | What's sent | Creates public DTU/feed? |
|--------|-------|-------------|---------------------------|
| Open data search | **SAFE_READONLY_PUBLIC_GET** | `query` → data.gov CKAN | **No** (list only). Ingest button → private DTU — keep ingest write blocked. |
| My reps ZIP | **SAFE_READONLY_PUBLIC_GET** | Address/ZIP resolved to 2-letter state locally; congress.gov gets `state` + API key | **No** |
| Bills load (Congress.gov) | **SAFE_READONLY_PUBLIC_GET** | congress number + limit (+ optional topic filter after fetch) | **No** |
| Spending (USAspending) | **SAFE_READONLY_PUBLIC_GET** | scope/year → fy + period | **No** (live may error on period) |
| Alerts (NWS) | **SAFE_READONLY_PUBLIC_GET** | `lat,lng` (browser geo or SF fallback `37.7749,-122.4194`) | **No** |

## KPI / calculator bugs (code-confirmed)

### Open Permits 0 vs Permit Desk 10 — **BUG (cross-plane)**

- Oversight→Caseload `Open Permits` counts **Case-file** `Permit` artifacts with status ∈ `{draft,proposed,public-comment}` (`CaseOpsPanel.tsx:2796–2798,2860–2863`).
- Permit Desk lists `governmentLens.permits` via `permits-list` (`PermitsPanel.tsx:36–37`) — a **different store**.
- Cause: two systems; dashboard never calls `dashboard-summary` / `permits-list`. File:line: `page.tsx:168–169` + `CaseOpsPanel.tsx:2796–2798` vs `government.js:799–817`.

### Pending Requests 0 vs 5 FOIA + 1 SR — **BUG (cross-plane + label)**

- `Pending Requests` counts Case-file **`Record`** artifacts with draft/proposed/public-comment (`CaseOpsPanel.tsx:2816–2818,2889–2892`).
- FOIA drafts live in `govLens.foiaRequests`; 311 SRs in `governmentLens.serviceRequests`.
- Cause: KPI label implies FOIA/311 backlog but only counts Record case files. File:line: `CaseOpsPanel.tsx:2816–2818,2889–2892` vs `government.js:433–455` / `:665–691`.

### Emergency Readiness 100% with 0 plans — **BUG (empty→100)**

```tsx
const emergencyReadiness =
  allEmergency.length > 0
    ? Math.round((allEmergency.filter(...).length / allEmergency.length) * 100)
    : 100; // ← empty set reports READY
```

File:line: `CaseOpsPanel.tsx:2819–2826,2901–2919`.

### Calculators `~undefined weeks` / `Tier: undefined` — **BUG (shape mismatch)**

- UI `GovernmentActionPanel` calls `permitTimeline` with `{ permitType }` and reads `result.estimatedWeeks` / `phases` (`GovernmentActionPanel.tsx:86–90,218–222`).
- Server `permitTimeline` ignores params for type, reads `artifact.data.type`, returns `{ permitType, processingDays, benchmark, onTime }` — **no `estimatedWeeks`** (`government.js:156–167`). With a virtualArtifact and no data, type falls to `'general'` and UI still prints `undefined`.
- UI calls `violationEscalation` with `{ severity }` and reads `result.tier` (`GovernmentActionPanel.tsx:93–97,225–228`).
- Server returns `{ escalated, daysPast, currentStatus }` — **no `tier`**; severity param unused (`government.js:170–181`).

File:line: UI `GovernmentActionPanel.tsx:86–97,218–228`; server `government.js:156–181`.

## Validator status/type mismatches (422 risk)

- Case-file form statuses **aligned** with domain rule after F2 (`government-case-file-status.test.js`). Normal CaseOps create should **not** 422.
- Forcing status `submitted` (old default) still 422s — form no longer offers it.
- Raw rule types before reconcile are lowercase legacy (`policy|regulation|permit|…`); PascalCase case-file types rely on boot `reconcileArtifactTypes` — same pattern as Environment. Live mega deploy assumed reconciled.
- Civic desk macros do not go through `validateArtifact` type/status enum.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| Case files: Permit, Project, Violation, EmergencyPlan, Record, CourtCase | Case files → sub-tab → New / confirm Delete. QA titles. Classification may stay Public — still private visibility. Accept FIX-xl-ws-001. |
| Asset, Department, Routing rule | Civic desk panels → add → hover Trash. |
| Document | Publish document (workspace-local) → hover Trash. Fake signer if testing e-sign. |
| Advocacy action | Record one → hover Trash. Fake bill id. |
| Meeting | Schedule → hover Trash. Prefer skip minutes-"publish" if wording confuses audit log. |

## Keep BLOCKED / do not write

1. **311 / pin-drop / Permit Desk apply / inspections / fines** — private but **no hard delete**.
2. **FOIA draft** — never submits externally, but **no delete** → residual drafts pile up (tester already has 5).
3. **Voter registration** — local only, **no delete**, stores DOB/address/name PII.
4. **Notices subscribe / manual emit** — no delete on subs or notification rows.
5. **Stripe Pay / payments-confirm / refunds that imply real money**.
6. **GovernmentActionPanel Publish / DM / agent Letter**; prefer skip Mint.
7. **Open-data Ingest as DTU** write (search alone OK).
8. **LensShell Publish/share**, invites, real emails/SMS, real constituent/PII of third parties, real case numbers of live agencies.
9. Do **not** enter real voter PII, real FOIA agency request text intended as a real filing, or real payment cards.

## Gaps / notes

- Live not proven: whether production `governmentLens` / `govLens` / `lensArtifacts` for the shared QA account already hold the 10 desk permits / 5 FOIA drafts / 1 SR observed; hover-delete reachability on mobile; whether `CONGRESS_GOV_API_KEY` / `DATA_GOV_API_KEY` / `GOOGLE_CIVIC_API_KEY` / Stripe are configured on the live host.
- `dashboard-summary` (`government.js:1772–1808`) correctly aggregates civic-desk counts but is **not** what Oversight Caseload renders — Caseload uses CaseOps artifact math instead. Wiring mismatch, not a broken macro.
- Document action is named `documents-publish` / button "Publish document" while remaining user-scoped — copy risk similar to Insurance E-Sign "emails the signer".
- Meetings panel header says "Public meeting calendar" but storage is per-user private.
- CaseOps Escape missing is a confirmed a11y/keyboard gap (RC2 + no Esc).
- Pin-drop "Use my location" may prompt the browser for geolocation — prefer map click with fake coords for QA.

## Tester instructions (concise)

- **SAFE one-write-then-delete:** Case-file types; Asset; Department; Routing rule; Document; Advocacy; Meeting. Title `QA LT1 government 2026-11-09 …`.
- **KEEP_BLOCKED writes:** 311, pin-drop, Permit Desk apply, inspection, fine, FOIA, voter registration, notices subscribe/emit, payments Pay, Publish/DM/agent, open-data ingest.
- **SAFE reads:** Open data search, My reps ZIP, Bills, Spending, NWS alerts (expect possible USAspending period error).
- Log RC1 (`p/u/c/r/o`/`3`) once then mark blocked; log RC2 Enter/Space + missing Escape on CaseOps modal; log KPI + calculator bugs with citations above.
- Classification=Public on Record: **do not** treat as publish — still SAFE_PRIVATE for QA write.

