# Insurance scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/insurance.js` (+ `concord-frontend/app/lenses/insurance/page.tsx`, `components/insurance/*`). Tip assumed same mega deploy as prior SCOPE reports. **No files/DB/services modified.** Code-only; not live-proven.

## Model

- Domain wrapped with `guardAnonWrites(register)` (`insurance.js:72–74`) — anonymous callers can read, not write.
- Actor key: `insAid(ctx)` / `pactUid(ctx)` = `ctx?.actor?.userId || ctx?.userId || "anon"` (`:613`, `:1275`).
- Storage (all **Map\<userId, Array\>** unless noted):
  - `STATE.insLens` — policies, claims, clients, agents, producerCompliance, reminders, assets; documents & payments & beneficiaries keyed by **policyId/claimId** after ownership check (`getInsState` `:324–336`).
  - `STATE.insAms` — carriers, renewalPipeline, fnol, statements, certificates, envelopes (`getAmsState` `:1680–1692`).
  - `STATE.inheritPacts` — pacts, payouts (`getPactState` `:1264–1273`) for Mutual-Aid / death-insurance macros.
- **No `_shared` bucket** anywhere in insurance.js (unlike council).
- `insurance` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server/server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- UI creates go through `POST /api/lens/run { domain:'insurance', action, … }` → `LENS_ACTIONS` with a **virtualArtifact** (`server.js` dual-registry branch ~51620+). That path does **not** call `_lensEmitDTU`. It only `_recordLensActivity` into the caller's own activity log.
- Generic `lens.create` / `dtu.create` WS leak (FIX-xl-ws-001 / `_lensEmitDTU` → `realtimeEmit("dtu:created", { title, tags })` without userId at `server.js:49871–49946`) therefore does **not** fire for insurance.* wallet/AMS creates. It **does** fire if Action Panel → Mint/Publish uses `dtu.create`.

## LIVE badge

Socket health only (`LiveIndicator` + `useRealtimeLens('insurance')` in `page.tsx:63,90`). Same pattern as Nonprofit/Logistics. Not a data-sharing signal. The badge text "Real. Real but static / open-access dataset." is **not** present on this lens page in code (that was Household); Insurance subtitle is local workbench copy (`page.tsx:87`).

## Verdict table

| Area | Verdict | Evidence | Side effects / delete |
|------|---------|----------|----------------------|
| Clients CRM | **SAFE_PRIVATE** | `client-add/list/delete` `:367–449`; `state.clients.get(userId)` | Delete detaches policies/claims (`client-delete`). UI: `InsuranceClientsPanel.tsx`. |
| Policies | **SAFE_PRIVATE** | `policy-add/list/update/delete/detail` `:451–695`; bucket `policies` / userId | Delete cascades docs/payments for that policyId + AMS certs (`:654–675`). UI: `InsurancePoliciesPanel.tsx`. |
| Claims | **SAFE_PRIVATE** | `claim-file/list/update/detail/delete` `:495–850` | Local status/notes. Delete: `claim-delete` + docs. UI: ClaimsPanel / ClaimTracker. |
| Policy/claim documents | **SAFE_PRIVATE** | `*-document-add/list` `:698–749` | Stores title/kind/**url string** only — **no** upload to S3/external storage. No document-delete (cleared with parent delete). |
| Premium payment log | **SAFE_PRIVATE** | `payment-log/list`, `premium-schedule` `:752–805` | **Local ledger only** — no Stripe/ACH/card. Amounts are bookkeeping fields. No payment-delete (cleared with policy-delete). |
| Agents / contacts | **SAFE_PRIVATE** | `agent-add/list` `:853–873` | Local. **No agent-delete.** |
| Producer compliance | **SAFE_PRIVATE** | `producer-compliance-{add,list,update,remove}` `:898–1083` | Local CE/license/E&O tracking. Remove exists. |
| Reminders | **SAFE_PRIVATE** | `reminder-create/list/complete` `:1085–1129` | Local. No hard delete (complete/reopen only). |
| Policy beneficiaries | **SAFE_PRIVATE** | `beneficiary-add/list` `:1131–1159` | Free-text names on own policy — **not** Concord userIds. No beneficiary-delete. |
| Covered assets | **SAFE_PRIVATE** | `asset-add/list` `:1161–1194` | Local. **No asset-delete.** |
| ID card / renewals-due / coverage-summary / dashboard | **SAFE_PRIVATE** (read/compute) | `:1196–1242`, `:2345–2367` | Over caller's policies only. |
| Analytical macros (coverageGap, commissionSummary, lossRatioReport, renewalAlert, premiumHistory, claimStatus, riskScore, coverage-analyze, book-of-business, producer-leaderboard) | **SAFE_PRIVATE** (stateless / own data) | `:102–284`, `:581–605`, `:2171–2241` | Pure compute; no persist / no outbound. |
| Quote Shopping (`quotes-compare`) | **BLOCKED stub** | `:566–579` | Always returns `ok:false` error asking for `INSURIFY_API_KEY` / `ZEBRA_API_KEY`. **Does not call** those APIs today (no `fetch`). Keep off — not a real create; if later wired would be outbound paid broker. |
| Carrier roster + local rate | **SAFE_PRIVATE** | `carrier-add/list/delete`, `carrier-rate` `:1699–1790` | Rate run is **local math** over user's appointed carriers × entered basePremium/riskFactor. **No** Insurify/Zebra/ISO call. |
| Renewal pipeline | **SAFE_PRIVATE** | `renewal-pipeline-build/list`, `renewal-advance` `:1795–1880` | Built from own policies. Reminder labels are strings only — **no email/SMS**. No per-item delete (rebuild overwrites). |
| FNOL intake | **SAFE_PRIVATE** | `fnol-intake/list/update` `:1883–1966` | Local routing labels; **no** carrier notify / email / SMS. **No fnol-delete.** |
| Commission statements | **SAFE_PRIVATE** | `statement-import/list/reconcile` `:1969–2060` | Paste/import lines locally. **No statement-delete.** |
| Certificates / ACORD export | **SAFE_PRIVATE** | `certificate-issue/list/export/revoke/delete` `:2063–2168` | Export returns **plain text** to caller. No external e-delivery. Delete + revoke exist. |
| E-sign envelopes + binder | **SAFE_PRIVATE** | `esign-create/list/sign`, `binder-issue` `:2244–2342` | Explicit: *"Signers are not emailed by Concord"* (`:2267–2272`). In-workspace sign only. **No envelope-delete.** |
| Mutual-aid pacts (write/list/revoke/renew/pay-premium/respond/payout/notifications) | **SAFE_PRIVATE store / CROSS-USER if real beneficiary** | `:1322–1646` | Written under insured's userId. `pact-list` / notifications scan **all** pacts for `beneficiaries[].userId === caller` (`:1382–1392`, `:1634–1644`). Naming a **real other Concord userId** surfaces a handshake to them. Sparks ledger only — **no CC/Stripe** (`:1257–1258`, `pact-pay-premium` `:1448–1471`). |
| Action Panel → Mint book DTU | **PRIVATE store + WS title leak** | `InsuranceActionPanel.tsx:156–161` → `dtu.create` visibility private | Triggers FIX-xl-ws-001 title/tags broadcast. Prefer skip. |
| Action Panel → Publish benchmark | **EXPOSED / public** | `:183–195` → `dtu.create` + publish, `visibility:'public'` | **Keep BLOCKED.** |
| Action Panel → Lever (`chat_agent.do`) | **BLOCKED** | `:202` | Agent / paid AI risk. |
| VisionAnalyzeButton | **BLOCKED** | `page.tsx:92–97` | Vision/AI cost path. |
| LensShell Publish/share / Reddit community | **BLOCKED / read-only** | shell chrome; `InsurancePolicyTalk` | Standing rules. |

## Keep BLOCKED

1. **Quote Shopping / `quotes-compare`** — fail-closed stub; do not treat as CRUD; if keys ever wired → outbound broker.
2. **Mutual-aid Pacts that name a real other Concord `userId` as beneficiary** — intentional cross-user handshake visibility. If testing pacts at all, use a **fake/nonexistent** beneficiary id and revoke afterwards; still prefer leave Pacts tab write-blocked for QA.
3. **Action Panel → Publish** (public anon benchmark DTU).
4. **Action Panel → Lever / chat_agent.do**.
5. **VisionAnalyzeButton** (and any Ask that shows a DTU cost).
6. **LensShell Publish/share**, invites, emails, SMS, real payments, agent deploy — standing rules.
7. Do **not** enter real SSN/DOB/policy numbers/client PII, real carrier credentials, or real people emails into esign signer fields (even though Concord does not send mail).

Mint (private book DTU) is technically private storage but still trips FIX-xl-ws-001 — treat as **optional / prefer skip**.

## Test-safe (CRUD OK under constraints)

Clients, policies (add/update/delete), claims (file/update/delete), payment-log (fake $), policy/claim document metadata, agents, producer-compliance, reminders, beneficiaries (fake names), assets, carriers + **local** carrier-rate, renewal pipeline build/advance, FNOL intake/update, statement import/reconcile, certificate issue/export/revoke/delete, esign create/sign + binder (fake signer names; no real emails needed).

Constraints:
- Titles / names / policy numbers / descriptions: `QA LT4 insurance 2026-11-09 <thing>`
- Fake people, fake policy numbers, fake carrier names, fake $ only — never real PII
- **Delete afterwards** where UI/API exists (client, policy, claim, carrier, certificate, producer-compliance-remove). Log residuals for: agents, assets, reminders, beneficiaries, documents, payments (if policy kept), FNOL, statements, envelopes, renewal pipeline rows
- Stay signed in (`guardAnonWrites`)
- Hotkeys are digit `1`–`5` only (see below) — bare-letter RCA steal is **unlikely** here; still watch for form glitches

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/insurance/page.tsx:68–77,100` via `useLensCommand`:

| Key | Tab |
|-----|-----|
| `1` | Overview |
| `2` | Quotes |
| `3` | GapAnalysis |
| `4` | AMS |
| `5` | Pacts |

No bare-letter tab shortcuts on this lens (unlike Household/Food/Healthcare/Logistics). `useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). RCA-form-hotkey-steal **probably does not block** Insurance typing; if digit keys somehow still steal focus, ticket separately. AMS/Wallet panels do not register additional `useLensCommand` letter maps (spot-check).

## Gaps / notes (not cross-user leaks)

- **Missing deletes:** agent, asset, beneficiary, document, payment, fnol, statement, envelope, renewal item — log QA leftovers.
- **quotes-compare** error text names env keys but handler never reads them or fetches — dead stub.
- **pact cross-user** is by design when beneficiaryUserId matches another account; not a `_shared` bucket bug.
- **payments Map keyed by policyId** (not userId) — access gated by `findPolicy(s, insAid(ctx), …)` first; other users cannot list without owning the policy.
- **documents Map** same pattern (policyId/claimId keys + ownership check).
- Cross-lens FIX-xl-ws-001 still applies to any `dtu.create` / generic `lens.create` from this page's Action Panel.
- Healthcare→Insurance pipeline (`server.js:50485–50486`) can draft claims from healthcare analyze — out of scope for LT4 Insurance CRUD; note if unexpected claim drafts appear.
- Live not proven: production STATE contents for the shared QA account; whether any older anon-bucket rows exist.

## Summary for tester

**CRUD on policies, claims, clients, carriers, FNOL, certificates, AMS local tools: SAFE_PRIVATE — proceed** with QA-labelled fixtures and delete/log cleanup.  
**Keep BLOCKED:** Quote Shopping, Publish, Lever/agent, Vision/paid Ask, Pacts naming real users, LensShell share/publish.  
Code-only verdict; not live-proven.
