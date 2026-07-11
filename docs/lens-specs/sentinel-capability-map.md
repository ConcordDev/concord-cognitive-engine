# Sentinel Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro counts:
> `grep -c "registerLensAction('sentinel'" server/domains/sentinel.js` → 26
> `grep -cE '^register\("shield"' server/server.js` → 11
> `grep -cE '^register\("intel"' server/server.js` → 14
> `grep -cE '^register\("semantic"' server/server.js` → 8

## What this lens actually is

Sentinel is a security threat console — the closest real-world analog is
**CrowdStrike Falcon** (threat feed + triage case queue + continuous
monitoring + automated fortification), with a secondary NVD CVE ticker
(VulnDB-style) and a Foundation-Intelligence sidebar (weather/geology/
seismic/etc. signal feeds). It sits over four macro domains: `sentinel`
(the operator workflow layer — triage, monitors, alerts, timeline, scan
config, saved queries), `shield` (the scan/detection engine —
`server/lib/concord-shield.js`, ~1770 LOC), `intel` (a 3-tier Foundation
Intelligence system — public/research/classifier), and `semantic` (DTU
corpus search).

## Audit finding: real, deep macros with zero UI caller

`server/lib/concord-shield.js` has three named "Fortify" analysis engines
— **Prophet** (`runProphet`, technique-escalation prediction from a threat
family's variant history, generates a preemptive YARA-rule concept),
**Surgeon** (`runSurgeon`, subtype-specific reverse-engineering + a real
three-phase neutralization playbook — immediate/short-term/long-term,
distinct content for ransomware vs. trojan/rootkit vs. generic), and
**Guardian** (`runGuardian`, generates an iptables-style firewall rule +
Suricata/Snort rule-concept text and persists a `FIREWALL_RULE` DTU) —
plus a full-lattice **Sweep** (`performSweep`, scans every non-threat DTU
artifact up to 500, auto-runs Guardian+Surgeon on anything it finds) and a
user **Report** path (`processUserReport`, submits a new threat to the
collective lattice, or confirms an already-known one). All seven are
registered as real macros (`shield.prophet` / `shield.surgeon` /
`shield.guardian` / `shield.sweep` / `shield.report` / `shield.firewall` /
`shield.predictions`) but **had zero frontend caller** — `grep -rn
"lensRun('shield'" concord-frontend/components/sentinel/*.tsx` before this
pass only found `status` / `threats` / `metrics` / `scan`. This is the
"unsurfaced real macro" defect class this wave has been finding elsewhere
(mentorship match scoring, supplychain CRUD-vs-engine, etc.) — the depth
was real, nobody built the feature.

### Fix — wired into `SentinelShield.tsx`

- **Investigate** (per threat row) — runs `shield.surgeon` +
  `shield.guardian` in parallel for that threat, expands an inline panel
  showing the neutralization procedure (immediate/short-term/long-term)
  and any generated firewall rule text. Cached per threat id (no re-fetch
  on re-expand).
- **Fortifications** panel — a `family` input (datalist-suggested from the
  subtypes present in the live threat board) + **Run Prophet** button
  (`shield.prophet`), plus read-only feeds of `shield.predictions` and
  `shield.firewall` (refreshed after every Guardian/Prophet run). Prophet
  needs ≥2 samples of a family to produce a real prediction — an
  `insufficient_data` response renders an honest inline message instead of
  silently doing nothing.
- **Report a threat** — a real form (subtype / severity slider / vector /
  hash / description) that calls `shield.report`; response distinguishes
  "already known" vs. "new threat added to the collective lattice" using
  the macro's real `status` field, not a fabricated success toast.
- **Run full sweep** — calls `shield.sweep`, shows the real summary
  (`scanCount` / `threatsFound.length` / `cleanCount` / `durationMs`).

### A real shape bug caught during wiring (fixed before it shipped)

`shield.guardian` (per-threat call) returns `rules` as an array of raw
**rule-text strings** (`runGuardian`'s local `rules.push(fwRule)`, where
`fwRule` is the iptables-text string). `shield.firewall` (the global feed)
returns `rules` as an array of **`FIREWALL_RULE` DTU objects** with a
`.rule` field (`getFirewallRules()` reads `_shieldState.firewallRules`,
which stores the DTU, not the string). Same word ("rules"), two different
shapes from two different macros. The first draft of this component typed
both as `{ rule?: string }[]` uniformly, which would have rendered the
per-threat Guardian rule as `undefined ?? JSON.stringify(r)` (a
quote-escaped, newline-mangled blob) instead of the clean rule text.
Fixed with a `GuardianRule = string | { rule?: string; ... }` union type
and a `ruleText()`/`ruleKey()` normalizer used at both render sites.
Pinned by `tests/components/SentinelShield.test.tsx`'s "Investigate runs
shield.surgeon + shield.guardian" case, which asserts the raw rule string
renders verbatim (`iptables -A INPUT -j DROP # trojan`), and the
"Fortifications feed" case, which asserts the DTU-object shape's `.rule`
field renders correctly from a *different* macro in the same panel.

## Genuinely missing (deferred) — `intel.research.*` + `intel.classifier.status` + `intel.metrics`

`server/server.js` also registers a **separate, bigger-scoped** "Foundation
Intelligence 3-Tier Architecture": `intel.research.apply` /
`.research.status` / `.research.data` / `.research.synthesis` /
`.research.archive` (a governance-controlled research-access application
workflow: submit → await approval → pull tiered data) plus
`intel.classifier.status` and `intel.metrics`. Confirmed unsurfaced
anywhere in the frontend (`grep -rln "research.apply\|classifier.status"
concord-frontend/ --include=*.tsx --include=*.ts` matches nothing that
actually calls these macros — the two files that matched the grep,
`AtlasResearchView.tsx` and `app/research/page.tsx`, are an unrelated
"research" feature).

**Triage: ENGINEERING**, deferred. This is not a data-sourcing gap (no
external feed needed — `submitResearchApplication` /
`getResearchApplicationStatus` / `getResearchIntelligence` /
`getResearchSynthesis` / `getResearchArchive` are all local, deterministic
compute over the existing Foundation Intelligence corpus) and not a
curation gap (no reference material to author). It's a real multi-step
governance UI (apply → track application status → gated data access)
that deserves its own designed workflow rather than being bolted onto
Sentinel's threat-console layout as an afterthought — building it well
means a dedicated "Research Access" panel with real state transitions
(pending → approved/denied → tiered access), which is out of scope for
this pass's surgical wiring fix. Left undocumented-as-done and flagged
here per the sixth hard invariant, not silently dropped.

## Security / authz review (this wave's special focus)

Checked whether Sentinel exposes system-wide state without a role check
(the pattern found elsewhere this wave in psyops/admin). It does not, by
design:

- `sentinel.*` macros (triage/monitors/alerts/timeline/scan-config/saved
  queries) are **all per-user**, keyed by `ctx.actor.userId` on
  `globalThis._concordSTATE` Maps — confirmed by reading every handler in
  `server/domains/sentinel.js`. No cross-user read path exists.
- `shield.*` macros surface a **shared threat feed** (`_shieldState`,
  in-process, not per-user) — but this is the collective-immunity design
  documented in the file's own header comment (a "everyone benefits from
  everyone's scans" model, the VirusTotal/community-AV shape), not a
  privilege leak: no user's private data is exposed, only the community
  threat-intel corpus (hash/subtype/severity/vector — never file content
  or the reporter's identity beyond an opaque `source: "user:<id>"` tag
  that isn't surfaced to other users).
- Neither `shield` nor `sentinel` nor `intel` nor `semantic` appear in
  `publicReadDomains` (`grep -n "shield" server/server.js | grep -i
  public` — no hits) — every macro requires a normal authenticated
  session via the standard three-gate system. There is no admin-only
  surface here that's missing a role check; it's a per-account security
  console, correctly gated at "logged in," same as e.g. the `music` or
  `crafting` lenses.

No authz gap found. Documenting the negative result since this wave's
brief specifically asked for it.

## Everything else — already real, verified clean

- **Shield board** (`SentinelShield.tsx`) — real `shield.status` /
  `.threats` / `.metrics` / `.scan`, promote-to-triage bridges into
  `sentinel.triage.open`.
- **Triage** (`SentinelTriage.tsx`) — real case state machine (open →
  investigating → contained → resolved/dismissed), assignee, notes, intel
  correlation. Loading/error/empty states pinned by
  `tests/sentinel-lens-states.test.tsx`.
- **Monitors** (`SentinelMonitors.tsx`) — real scheduled-scan configs +
  alert inbox, pulls the live `shield.threats` feed into
  `sentinel.monitor.run`. Pinned by
  `tests/components/SentinelMonitors.test.tsx` (14 cases).
- **Metrics** (`SentinelMetrics.tsx`) — real time-bucketed chart +
  severity mix + append-only timeline from `sentinel.metrics.series` /
  `.timeline.list`.
- **Rules** (`SentinelScanConfig.tsx`) — real scan-scope toggles,
  auto-triage threshold, custom rule book (add/remove/evaluate against
  pasted content).
- **Semantic** (`SentinelSemantic.tsx`) — real `semantic.similar` /
  `.classify_intent` / `.extract_entities` with a saved-query book and a
  genuine CSV/JSON export (`sentinel.query.export`, browser
  `Blob`/`URL.createObjectURL` download, not a fake "downloaded!" toast).
- **Intel** (`SentinelIntel.tsx`) — the 7 public-tier Foundation
  Intelligence feeds (weather/geology/energy/ocean/seismic/agriculture/
  environment), with a "log to timeline" bridge.
- **CVE ticker** (`SentinelCves.tsx`) — a genuinely live NVD (National
  Vulnerability Database) feed, not a mock — `fetch()`s
  `services.nvd.nist.gov` directly, no fabricated CVE data.

All field shapes were cross-checked against the actual `register(...)`
handler return values in `server/server.js` / `server/domains/sentinel.js`
(not assumed from the frontend's own type declarations) — the
`_unwrapLensEnvelope` behavior means `shield.*`/`intel.*`/`semantic.*`
(raw `register()`, no `{ok,result}` wrapper) land at `r.data.result`
verbatim, while `sentinel.*` (registered through the domain's internal
`registerLensAction` shim, which *does* return `{ok, result}`) unwraps one
level deeper the same way. Both paths were verified to match what each
component reads.

## Verification

- `npx eslint components/sentinel/SentinelShield.tsx
  tests/components/SentinelShield.test.tsx` — clean, 0 errors/warnings.
- `npx vitest run tests/components/SentinelShield.test.tsx` — 7/7 passing
  (new — Investigate wiring, idempotent re-expand, full sweep, threat
  report, Prophet insufficient-data honesty, Fortifications feed with the
  two distinct rule shapes).
- `npx vitest run tests/sentinel-lens-states.test.tsx
  tests/components/SentinelMonitors.test.tsx` — 19/19 passing (pre-existing,
  unaffected — `SentinelTriage.tsx` / `SentinelMonitors.tsx` were not
  touched).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260, unchanged (sentinel was already WIRED; this pass added a
  feature, not a wire).
- `node scripts/grade-ux-polish.mjs --honest` → `audit/ux-polish-honest.json`
  sentinel entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.938`. `audit/` reverted after grading
  (`git checkout -- audit/`), per the transient-artifact rule.
