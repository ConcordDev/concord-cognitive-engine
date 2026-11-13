# Security scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/security.js` (+ `concord-frontend/app/lenses/security/page.tsx`, `components/security/*`). Tip assumed same mega deploy as prior SCOPE reports. **No files/DB/services modified.** Code-only; not live-proven.

Requested by Lens Tester 3 for Cases records (Incident, Asset, Patrol, Surveillance, AccessControl, ThreatIntel) and SOC records (events, detection rules, incidents, badge, camera).

## Model — two separate data planes

The Security lens has **two coexisting layers** that share a UI shell but **not** a store (`docs/lens-specs/security-capability-map.md`):

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Cases** (analyst-report CRUD) | `SecurityOpsPanel.tsx` under Cases / view `ops` | Generic `POST/PUT/DELETE /api/lens/security` via `useLensData('security', type)` | `STATE.lensArtifacts` keyed by artifact id; domain=`security`; types below |
| **SOC** (SIEM / IR / physical) | `SOCConsole.tsx` under SOC / view `soc` | `POST /api/lens/run { domain:'security', action }` → `LENS_ACTIONS` with virtualArtifact | `STATE.securityLens` Maps: `events`, `rules`, `incidents`, `cameras`, `badgeEvents`, plus Vulns tab `assets`/`vulns` |

Also on the shell (not in the tester's Cases/SOC list but relevant for BLOCKED):

- **Advisories** — GitHub advisory pull + `AdvisoryActionMenu` (mint / publish / agent)
- **Scanner** — client-side threat/vuln worksheets → analysis macros only
- **Vulns** — `VulnManager.tsx` → `asset-*` / `vuln-*` / `security.feed` on same `securityLens` Maps

### Shared runtime facts

- Domain wrapped with `guardAnonWrites` (`security.js:1,20`) — anon can read, not write.
- Actor key: `secActor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:308`).
- `security` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- Generic Cases creates go through `lens.create` (`server.js:50014–50086`): stamps `ownerId = ctx.actor.userId || "anon"`, defaults `meta.visibility` to `"private"`, then **`_lensEmitDTU`** → WS `dtu:created` with title/tags and **no userId** (**FIX-xl-ws-001**, `:49871–49946`, emit at `:50085`).
- Generic list/get filter by owner for non-social domains (`:49975–49988`, `:50004–50010`). Caveat: artifacts with **no ownerId** or `ownerId === "anon"` are **visible to everyone**.
- Generic update/delete require owner or admin (`:50090–50176`).
- SOC / Vulns macros via `/api/lens/run` dual-registry lens_action path use a **virtualArtifact** and only `_recordLensActivity` — they do **not** call `_lensEmitDTU` (same as insurance/logistics).
- LIVE badge = socket health only (`page.tsx:52–53,92` + `useRealtimeLens('security')`). Not a data-sharing signal.

## Why "Open a case" does nothing

`page.tsx:105`:

```tsx
cta={{ label: 'Open a case', icon: Plus, onClick: () => setActive('ops') }}
```

The CTA **only switches the top-level view to Cases (`ops`)**. It does **not** call `openNew()`, does **not** open the create modal, and does **not** leave the Cases Dashboard sub-tab.

Effects:

1. If the user is already on Cases → **literal no-op** (state stays `'ops'`).
2. If switching from SOC → lands on Cases with `mode` default `'Dashboard'` (`SecurityOpsPanel.tsx:236`). Dashboard shows stats only; **New {type}** button appears only when `mode !== 'Dashboard'` (`:916–919`). So the page changes but **no create form opens** — feels like "does nothing" relative to the Plus-labelled CTA.
3. Real create entry points: Cases sub-tabs Incidents/Assets/… → **New {Type}** (`:917–918`), or card Edit; SOC has its own **Open Incident** / ingest / rule / camera / badge forms.

Ticket candidate: CTA should `setActive('ops')` **and** either deep-link to Incidents + `openNew()`, or rename to "Go to Cases".

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/security/page.tsx:33–39,57–66` via `useLensCommand`:

| Key | View |
|-----|------|
| `1` | SOC |
| `2` | Cases (ops) |
| `3` | Advisories |
| `4` | Scanner |
| `5` | Vulns |

From `SecurityOpsPanel.tsx:229–234`:

| Key | Action |
|-----|--------|
| `/` | Focus search |

**No bare-letter tab shortcuts** on this lens (unlike Household/Food/Healthcare/Logistics). Digits only + `/`. RCA-form-hotkey-steal **RC1 is unlikely** to block Security typing.

**RC2 still present** on the Cases editor: modal backdrop/panel use `role="button"` + Enter/Space → `.click()` (`SecurityOpsPanel.tsx:1295–1297`), same pattern as the RCA. Space/Enter while focus is on the panel (not a true input) can close the unsaved form. Card rows also use that pattern (`:602`).

`useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`).

## Verdict table — Cases (generic lens artifacts)

All six types share one path: `useLensData('security', currentType)` → `POST /api/lens/security` create, `PUT …/:id` update, `DELETE …/:id` remove (`use-lens-data.ts:117–135`; panel `:249–304`, Edit/Delete UI `:732–733`, editor Delete `:1318–1319`).

| Record type | Scope | Delete server | Delete UI | Side effects | Evidence |
|-------------|-------|---------------|-----------|--------------|----------|
| **Incident** | **SAFE_PRIVATE** (ownerId + default private; not social) | **Yes** `lens.delete` owner/admin | **Yes** Edit + Delete on cards (non-Dashboard) | Local fields only. Domain Actions (`incidentEscalate`, etc.) are **pure compute** — `incidentEscalate` returns a `notifications[]` plan (`phone_and_email` / `email_and_slack` / `email` labels) but **does not send** mail/SMS/Slack (`security.js:65–121`). Create fires **FIX-xl-ws-001**. | Types `:46`; create path `use-lens-data` + `server.js:50070–50085`; delete UI `SecurityOpsPanel.tsx:732–733` |
| **Asset** | **SAFE_PRIVATE** | **Yes** | **Yes** | Same. Note: Cases **Asset** artifacts are **separate** from SOC/Vulns `securityLens.assets` Map. | same |
| **Patrol** | **SAFE_PRIVATE** | **Yes** | **Yes** | Local checkpoints / coverage analysis only (`patrolCoverage` `:37–44`). | same |
| **Surveillance** | **SAFE_PRIVATE** | **Yes** | **Yes** | Metadata record only in Cases (camera stream tiles live in SOC `camera-*`). | same |
| **AccessControl** | **SAFE_PRIVATE** | **Yes** | **Yes** | Free-text badge/visitor fields in artifact data — **not** live badge hardware. | same |
| **ThreatIntel** | **SAFE_PRIVATE** | **Yes** | **Yes** | Local IOC/mitigation text. Enrichment outbound is SOC `threat-enrich`, not this artifact create. | same |

**Why the tester may see "no edit/delete controls":**

- Default shell view is **SOC** (`page.tsx:55`), not Cases.
- On Cases, default sub-tab is **Dashboard**, which has **no per-item Edit/Delete** and hides **New** until another sub-tab is selected (`:916–919`).
- Edit/Delete appear on list cards for Incidents/Assets/Patrols/Surveillance/Access/Threats only (`:732–733`).

So: **server + UI delete both exist for all six Cases types**, but only after navigating Cases → a non-Dashboard sub-tab → an existing card (or open editor).

## Verdict table — SOC / Vulns (`STATE.securityLens`)

All Maps are **`Map<userId, Array>`** (`security.js:298–299,488–502`). List/mutate always via `secActor(ctx)`. **No `_shared` bucket.** Detection rules evaluate **only the caller's own event stream** and write incidents into **the same user's** `incidents` Map (`rule-evaluate` `:641–686`) — **no platform auth/blocking, no cross-user effects.**

| Record type | Scope | Delete server | Delete UI | Side effects | Evidence |
|-------------|-------|---------------|-----------|--------------|----------|
| **events** (SIEM ingest) | **SAFE_PRIVATE** | **No** `event-delete` | **No** | Local log lines only; capped at 5000 (`:527–529`). Correlate mutates `correlationId` on own events (`:550–585`). | `event-ingest/list/correlate` `:509–585`; UI `SOCConsole.tsx` ingest |
| **detection rules** | **SAFE_PRIVATE** | **Yes** `rule-delete` | **Yes** Trash on rule row | `rule-evaluate` auto-opens **own** SOC incidents only — substring match on own events; **does not** touch real auth, accounts, firewalls, or other users (`:639–686`). Playbook text mentions quarantine/block but those are **checklist strings**, not executed actions (`:728–733`). | `rule-add/list/delete/toggle/evaluate` `:588–686`; UI delete `SOCConsole.tsx:201–202,462–464` |
| **incidents** (SOC IR) | **SAFE_PRIVATE** | **No** hard delete | **No** delete control; can **close** via `incident-advance` phase=`closed` | Local timeline/playbook. `incidentEscalate` on Cases artifacts is separate (compute-only). | `incident-open/list/attach/advance` `:689–784`; UI open `SOCConsole.tsx:221,476–486` — no Trash |
| **badge** events | **SAFE_PRIVATE** | **No** | **No** | Local synthetic access log + anomaly math (`badge-audit` `:839–870`). **No** badge reader / door hardware / ACS API. | `badge-event-add/audit` `:818–870`; UI `:258–264` |
| **camera** | **SAFE_PRIVATE** | **Yes** `camera-delete` | **Yes** Trash on tile | Stores name/zone/`streamUrl` string only (`:873–922`). Server does **not** call ONVIF/RTSP. Browser may load user-supplied `streamUrl` (use fake/null for QA — never a real camera URL). | UI delete `SOCConsole.tsx:288–289,734` |
| **Vulns assets** (Vulns tab) | **SAFE_PRIVATE** | **Yes** `asset-delete` | **Yes** (hover Trash; `opacity-0 group-hover`) | Separate from Cases Asset artifacts. | `asset-add/list/delete` `:322–358`; `VulnManager.tsx:66,114` |
| **Vulns vulns** | **SAFE_PRIVATE** | **Yes** `vuln-delete` | **Yes** (hover Trash) | Local CVE register. `cve-asset-match` only links own assets (`:787–815`). | `vuln-add/list/update/delete` `:361–415`; UI `:149` |

## Side-effect / outbound inventory

| Action | Outbound / platform effect? | QA rule |
|--------|----------------------------|---------|
| Cases create/update/delete | FIX-xl-ws-001 title/tags WS broadcast (no body) | Prefer QA titles; optional skip if leak unacceptable |
| SOC event/rule/incident/badge/camera/vuln macros | No `_lensEmitDTU`; activity log only | OK |
| `incidentEscalate` / `threatAssessment` / `vulnerabilityScan` / `accessAudit` / `patrolCoverage` / `threatMatrix` / `evidenceChain` / `security-dashboard` | Pure compute over owned data; notifyRoles are **labels in JSON** | OK to run |
| `rule-evaluate` | Creates own SOC incidents only; **no** account block / platform security config change | OK (fake patterns) |
| `security.feed` / `LensFeedButton` | **EXTERNAL** `fetch("https://cve.circl.lu/api/last")` + `dtu.create` with **`visibility:"public"`** (`:442–475`) | **BLOCKED** |
| `threat-enrich` | **EXTERNAL** FIRST.org EPSS `https://api.first.org/data/v1/epss?cve=…` (`:928–952`); IOC half is local | Prefer skip / BLOCKED for outbound |
| Advisories view | Pulls GitHub advisories via domain macro (cached); read OK | Read OK |
| `AdvisoryActionMenu` Publish post-mortem | `dtu.create` **public** (`AdvisoryActionMenu.tsx:187`) | **BLOCKED** |
| `AdvisoryActionMenu` Exposure agent | `chat_agent.do` (paid / agent) | **BLOCKED** |
| Mint incident / patch plan DTUs | Private `dtu.create` — still FIX-xl-ws-001 | Prefer skip |
| Camera `streamUrl` | Client may fetch URL | Use null / fake; never real camera |
| LensShell Publish/share, emails, SMS, payments, agent deploy | Standing rules | **BLOCKED** |

**Platform security config:** nothing in `security.js` writes Concord auth, sessions, firewall, rate limits, or middleware. Detection rules are a **toy SIEM over the user's own ingested lines**, not platform detectors.

## Private AND deletable (qualify for a single QA write)

Per tester rule: write only where record is **private AND deletable** (server + UI).

| Qualify | Notes |
|---------|-------|
| Cases: Incident, Asset, Patrol, Surveillance, AccessControl, ThreatIntel | All six. Use Cases → sub-tab → New / Edit / Delete. QA titles. Delete after. Accept FIX-xl-ws-001 on create. |
| SOC: **detection rules** | rule-add + Trash delete. Fake pattern strings only. |
| SOC: **cameras** | camera-add + Trash. **streamUrl empty/null.** |
| Vulns: **assets** and **vulns** | Hover Trash (easy to miss — `opacity-0 group-hover`). |

## Keep BLOCKED / do not write

1. **SOC events** — private but **no delete** (server or UI). Ingest leaves residuals up to 5000.
2. **SOC incidents** — private; close-only; **no hard delete**. Prefer leave write-blocked, or open one labelled QA and close it, then log residual.
3. **Badge events** — private; **no delete**. Do not add.
4. **Live CVE feed** (`LensFeedButton` / `security.feed`) — public DTUs + external CIRCL.
5. **threat-enrich** (EPSS outbound) — keep off.
6. **Advisory Publish post-mortem** / **Exposure agent** / paid Ask / Vision / Lever.
7. **LensShell Publish/share**, invites, real emails/SMS, real camera URLs, real badge IDs / people names.
8. Do **not** enter real IOC/IPs tied to production, real employee names, or real facility zones.

## Test-safe plan (if proceeding)

1. Stay signed in (`guardAnonWrites`).
2. Cases: for **one** type first (e.g. Incident) — Cases view → Incidents → New Incident → title `QA LT3 security 2026-11-09 incident` → Create → verify list → Delete → confirm gone after reload.
3. Optionally repeat one Asset / one ThreatIntel the same way.
4. SOC: one detection rule `QA LT3 security rule` with harmless pattern → Delete via Trash.
5. SOC: one camera name-only, no streamUrl → Delete.
6. Skip events, badge, SOC incident creates (no delete), feed, enrich, publish, agent.
7. Watch RC2: prefer clicking Save/Cancel; avoid Space on modal chrome.
8. Digits `1`–`5` switch shell views — unlikely to steal from focused inputs; still watch.

## Gaps / notes

- Cases Edit/Delete **exist in code** but are easy to miss (wrong view / Dashboard). Not a missing-server-delete bug.
- Vulns Trash buttons are hover-only (`opacity-0 group-hover`) — a11y/discoverability ticket.
- Two different "Asset" and "Incident" concepts (Cases artifacts vs SOC/Vulns Maps) — do not expect counts to match across tabs.
- Anon-owned or ownerless Cases artifacts remain world-readable (`server.js:49980–49981`) — if any seed/harness wrote as anon into `security`, they would show for everyone; `SecurityOpsPanel` seeds `[]` so it does not auto-bulk-create.
- Cross-lens FIX-xl-ws-001 still applies to every Cases create and to any Action-menu `dtu.create`.
- Live not proven: production STATE for the shared QA account; whether older anon security artifacts exist; whether hover-delete is reachable on the tester's viewport/touch device.

## Summary for tester

**Cases (all six types): SAFE_PRIVATE + deletable in UI after opening Cases → non-Dashboard sub-tab — one QA write each is OK; delete afterwards.**  
**SOC rules + cameras (+ Vulns assets/vulns): SAFE_PRIVATE + deletable — OK.**  
**Keep BLOCKED:** SOC events, badge events, SOC incident hard-create (no delete), CVE feed, EPSS enrich, Publish, agent, real stream URLs.  
**"Open a case"** only switches to Cases Dashboard — it never opens a create form (code bug / misleading CTA).  
**Hotkeys:** `1`–`5` views, `/` search — no bare-letter steal on this lens; RC2 Enter/Space-on-modal still applies.  
Code-only verdict; not live-proven.
