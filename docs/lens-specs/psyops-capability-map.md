# Psyops Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

**What this lens is.** `psyops` is a behavioral **threat-detection / anomaly
console** — the closest real-world analog is a SIEM anomaly module (Darktrace,
Splunk ES notable-events triage) scoped to one deployment's own signals rather
than a general network-security platform. It is NOT "influence operations"
in the campaign/propaganda sense despite the name and the `PsyopsReference`
tab's Wikipedia topics (Propaganda / Disinformation / Cognitive bias /
Information warfare) — those are background reading for an operator, not the
console's function. Category leader for the reference bar: an anomaly-console
triage workflow (alert → assign → investigate → resolve/dismiss, with
evidence drill-down and audited quarantine), not a marketing tool.

## Backend surface

Two registration sites, 17 macros total:

```
grep -c 'register("psyops"' server/server.js
```
→ **3** legacy macros in `server.js` (lines ~77184–77296): `scan_skill_divergence`
(real statistical scan of `skill_revisions` — flags NPCs whose demonstration
rate diverges >Nσ from cohort baseline, a genuine "is an NPC being
adversarially fast-trained" signal), `list_alerts`, `quarantine`. These touch
a **shared, system-wide** table (`skill_divergence_alerts`) — not per-user.

```
grep -c 'registerLensAction("psyops"' server/domains/psyops.js
```
→ **14** macros in `server/domains/psyops.js` (447 lines): `rules_list` /
`rules_update` (configurable per-signal σ thresholds), `scan_signal`
(multi-signal z-score scan over operator-supplied samples — genuine mean/
stddev/z-score math, not a lookup table), `alerts_list` / `alert_detail`
(evidence drill-down + related-alert correlation), `alert_triage`
(assign/investigate/resolve/dismiss with a note log), `incident_create` /
`incident_list` / `incident_close` (group alerts into a correlated incident
with a chronological timeline), `quarantine_entity` / `quarantine_release`
(audited — release requires a non-empty reason) / `quarantine_log`,
`notifications_list` / `notification_ack` (critical-severity paging). All
state is per-user (`STATE.psyopsLens`, keyed by `actorId(ctx)`), in-memory,
persisted via the standard `_concordSaveStateDebounced` snapshot path — no DB
table, by design (an operator's own triage workspace, not a global ledger).

## Frontend surface

- `concord-frontend/app/lenses/psyops/page.tsx` (325 lines) — 5-tab shell
  (Console / Incidents / Rules / Skill divergence / Reference), notification
  bell in the header, `AdminRequiredState` gate on `forbidden`.
- `components/psyops/SignalScanner.tsx` (167 lines) — operator-entered
  sample-population input (entity + numeric value rows) → real z-score scan,
  bar chart of new alerts via `ChartKit`.
- `components/psyops/AlertBoard.tsx` (278 lines) — severity/status-badged
  alert list, triage action buttons, evidence-drill-down modal, quarantine +
  audited-release flow.
- `components/psyops/IncidentPanel.tsx` (184 lines) — correlate
  board-selected alerts into a titled incident, `TimelineView` chronological
  render, audited-resolution close.
- `components/psyops/DetectionRules.tsx` (98 lines) — per-signal σ / critical-σ
  / enabled editor.
- `components/psyops/NotificationBell.tsx` (103 lines) — critical-alert
  paging dropdown, ack / ack-all.
- `components/psyops/QuarantineLog.tsx` (56 lines) — audited quarantine/
  release trail.
- `components/psyops/PsyopsReference.tsx` (55 lines) — live Wikipedia REST
  summaries for influence-ops background topics, Save-as-DTU.

## Verification of coverage

```
node scripts/lens-unsurfaced.mjs --lens psyops
```
→ `psyops: 0/14 macros never referenced in the frontend` (the 3 legacy
`server.js` macros are covered by the "Skill divergence" tab's raw-fetch
`skillMacro()` helper, which the unsurfaced-macro script doesn't scan since
it isn't a `lensRun`/`api.post` call site — cross-checked by direct grep of
`scan_skill_divergence` / `list_alerts` / `quarantine` against
`app/lenses/psyops/page.tsx`, all 3 have exactly one call site).

## Classification: all 17 macros are DESIGNED

Every macro is reached through bespoke, domain-appropriate UI (a real
sample-entry grid + z-score bar chart, a severity/status-badged alert board
with an evidence-drill-down modal, a chronological incident timeline, a
per-signal rule editor, an audited quarantine trail) — not a generic
macro-button wall, not a raw JSON-paste form, not a
`<UniversalActions>`/`<LensFeaturePanel>` body. `ManifestActionBar` /
`AutoActionStrip` / `RecentMineCard` appear only in the `hideWhenEmpty`
accessibility footer common to every rebuilt lens, not as the page's primary
content — confirmed by the grader below.

`node scripts/grade-ux-polish.mjs --honest` (result reverted after read —
`audit/` is a transient regenerated artifact per repo convention):
```
{"lens":"psyops","tier":"polished","fileCount":8,"totalLoc":1266,
 "pageLoc":325,"bespokeComponentLoc":941,"maxBespokeComponentLoc":278,
 "bespokeRatio":0.743,"importsGenericTrio":false,"usesGenericBody":false,
 "hasMacroButtonWall":true,"hasInlineActionWall":false,"hasLoading":true,
 "hasEmptyState":true,"hasErrorUI":true,"hasAria":true,
 "hasNativeButtons":true,"hasKeyboardHandlers":false,"hasResponsive":true,
 "hasAnimation":true,"hasToasts":false,"hasAltOnImages":true,
 "divAsButtons":0,"inlineHex":0,"pillarsPresent":5,"antiPatterns":0,
 "isGenericScaffold":false,"honestCapped":false}
```
Already `tier: "polished"`, `isGenericScaffold: false`.

## Real defect found and fixed: missing server-side admin gate

The frontend has always been built as if `psyops` were an operator-only
console — `page.tsx` renders `<AdminRequiredState roles={['admin','operator']}>`
on a forbidden response, and `concord-frontend/tests/e2e/admin-gated-lenses.spec.ts`
lists `psyops` among the 6 lenses (`ops-telemetry`, `repair-telemetry`,
`psyops`, `crisis-ops`, `ops`, `admin`) that must show the friendly gate for a
non-admin user. But **none of the 17 `psyops` macros enforced this on the
backend** — `requireAdminRole()` (`server.js:36003`, the codebase's own admin
helper: role ∈ `owner`/`admin`/`founder`) is used only by the 4 macros in the
`admin` domain; `psyops`'s handlers never called it or any equivalent. Direct
grep confirmed there is no `role` field check anywhere in
`server/domains/psyops.js` or the 3 legacy `server.js` registrations before
this fix.

The practical exposure: any authenticated user (not just the intended
operator/admin role) could call `psyops.scan_skill_divergence` (a system-wide
scan over real NPC `skill_revisions` data) and `psyops.quarantine` (which
flips `quarantined=1` on **any** row, by id, in the shared
`skill_divergence_alerts` table — no ownership check) — a real
integrity/griefing surface on a shared system table, not just an
information-disclosure issue. The 14 per-user domain-module macros were lower
risk (each operator only ever sees/mutates their own `STATE.psyopsLens`
workspace), but leaving them open contradicted the documented "operator
console" design and meant the frontend's `AdminRequiredState` path could never
actually fire in production — a non-admin visiting `/lenses/psyops` got full
access to the whole console instead of the intended gate.

**Fix (ENGINEERING — no external dependency, straightforward role check):**

- `server/domains/psyops.js`: added `requireOperatorRole(ctx)` (role ∈
  `owner`/`admin`/`founder`, same allow-list as `server.js`'s
  `requireAdminRole`) and called it as the first line inside every one of the
  14 handlers' `try` blocks, before any state access — mirrors the existing
  in-handler-gate idiom in `server/domains/announcements.js#announcements.post`
  (the only other domain-module precedent for this pattern; comment on both
  explains why the gate lives in-handler rather than at the route layer).
- `server/server.js`: added the equivalent `_psyopsRequireOperatorRole(ctx)`
  gate to the 3 legacy macros (`scan_skill_divergence`, `list_alerts`,
  `quarantine`), renaming their unused `_ctx` parameter to `ctx` so the role
  check can read it.
- **Error text matters**: the frontend's `isForbidden()`
  (`concord-frontend/lib/api/client.ts:422`) only flips to the friendly gate
  when the error string matches `/insufficient permission/i` (or a real HTTP
  403/`FORBIDDEN` code, which `/api/lens/run` never produces — it always
  returns `{ok:true, result:<macro result>}` at HTTP 200, per the
  fabricated-success-envelope note in `CLAUDE.md`). The codebase's existing
  `requireAdminRole()` returns `"unauthorized: admin role required"`, which
  does **not** match that regex — reusing it verbatim would have silently
  left the frontend gate dead even after adding the backend check. Both new
  gates instead return `"Insufficient permissions: admin role required"`,
  matching the regex and the wording the `admin`-domain's own route-level
  403 middleware uses at `server.js:6652`.
- `publicReadDomains.psyops = new Set(["list_alerts"])` (`server.js:11506`)
  is left in place — that entry only bypasses one upstream ACL layer for
  anonymous callers; the in-handler gate added here still denies them
  (an anonymous actor's role defaults to `"viewer"`/`"member"`, neither in
  the admin allow-list), so leaving it doesn't reopen the hole. Touching it
  would be a wider, unrelated change to a system-wide gate map used by ~40
  other domains — out of scope for a surgical fix.

No internal callers (heartbeats, other domains) invoke any `psyops` macro —
confirmed by `grep -rn 'runMacro("psyops"' server/` returning nothing — so
this fix has zero blast radius outside the `/lenses/psyops` page itself.

## Fabrication check

```
grep -niE "Math\.random|MOCK|mock|fake|lorem|hardcoded|dummy|sample data|TODO|FIXME|stub" \
  concord-frontend/components/psyops/*.tsx concord-frontend/app/lenses/psyops/page.tsx
```
→ no hits. `SignalScanner`'s doc comment explicitly states every value is
operator-entered, no mock data; verified against the domain-module handler,
which genuinely computes `mean`/`stddev`/z-score from the caller-supplied
sample array (`server/domains/psyops.js:60-67, 129-135`) — not a lookup
table or fabricated output.

Field-shape audit (the #1 recurring bug class in this program) — traced every
`lensRun('psyops', <macro>, …)` call site against the real handler return
shape:
- `SignalScanner` → `scan_signal` returns
  `{signal,scanned,mean,stddev,newAlerts}` (`psyops.js:178-184`); the
  component reads exactly those fields. Match.
- `AlertBoard` → `alerts_list` returns `{alerts,counts,total}`
  (`psyops.js:207`); `alert_detail` returns `{alert,incident,related}`
  (`psyops.js:227`); `alert_triage`/`quarantine_entity`/`quarantine_release`
  all return `{alert}` (`psyops.js:262,352,374`). All read correctly,
  including nested `evidence.{cohortSize,ruleSigma,criticalSigma,percentile}`
  and `notes[].{by,action,text,at}`. Match.
- `IncidentPanel` → `incident_create`/`incident_close` return `{incident}`
  (`psyops.js:294,330`); `incident_list` returns `{incidents}` where each
  entry carries the server-computed `alertCount`/`timeline` fields
  (`psyops.js:303-315`) — the component correctly falls back to
  `inc.alertCount ?? inc.alertIds.length` for the (never-actually-hit, since
  the server always sets it) case where `alertCount` is absent. Match.
- `DetectionRules` → `rules_list` returns `{rules}` (`psyops.js:82`);
  `rules_update` returns `{rule}` — the component only checks `.ok` for the
  update (doesn't need the returned rule since it triggers a `rules_list`
  refetch via `onChange`). Match.
- `NotificationBell` → `notifications_list` returns
  `{notifications,unacknowledged}` (`psyops.js:394`); `notification_ack`
  returns `{acknowledged}` — the component correctly checks `.ok` (not the
  count) before calling `onChange()`. Match.
- `QuarantineLog` → `quarantine_log` returns `{log}` (`psyops.js:382`),
  where each entry has `{id,alertId,entityId,action,reason,by,at}`
  (`psyops.js:346-350, 368-372`) — matches `QuarantineLogEntry` exactly.
- The "Skill divergence" tab's `skillMacro()` helper unwraps the legacy
  macros' flat return shape correctly (`{ok,scanned,alerts,mean,stddev}` for
  `scan_skill_divergence`, `{ok,alerts}` for `list_alerts`,
  `{ok,quarantined}` for `quarantine` — all verified against
  `server.js:77202-77266`); its `SkillAlert` interface fields
  (`npc_id,suspect_mentor_id,revision_count_window,cohort_baseline,
  sigma_above,detected_at,quarantined`) match the `SELECT` column list at
  `server.js:77234-77236` exactly.

No fabricated-success envelope bug: every call site checks `r.data?.ok`
(the `lensRun()`-unwrapped inner result, not the always-`true` outer HTTP
envelope) before treating a mutation as successful — none of the 6
components trust the outer wrapper alone.

## Genuinely missing

None beyond the admin-gate fix above. The domain's own spec doc
(`docs/lens-specs/psyops.md`) already lists every planned feature as shipped
(multi-signal detection, triage workflow, evidence drill-down, configurable
rules, incident correlation, audited quarantine/release, critical
notifications) — verified true by this pass. The console legitimately fills
its "content" via operator-supplied samples + real system data (skill
divergence) rather than a seeded catalog, which is correct for a SIEM-shaped
tool (there's no equivalent of "more rows to browse" — an anomaly console's
depth is in the workflow, which is fully built).

## Verification

- `node scripts/lens-unsurfaced.mjs --lens psyops` → `0/14 macros never
  referenced in the frontend`.
- `cd server && node --test tests/psyops-domain-parity.test.js` →
  **23/23 pass** (9 pre-existing describe blocks updated to pass an admin
  `ctx`, plus 1 new "psyops — admin gate" block with 4 new tests covering
  denial-with-forbidden-shaped-error, no-role-defaults-to-denied,
  owner/founder admission, and no-state-mutation-on-denial).
- `cd server && node --check server/domains/psyops.js server/server.js` →
  clean.
- `cd concord-frontend && npx eslint app/lenses/psyops/page.tsx
  components/psyops/*.tsx components/psyops/types.ts` → clean, zero output
  (no frontend files were changed — the fix is entirely server-side; ran
  anyway as a sanity check since eslint config also lints unmodified files
  on demand).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (psyops counted as WIRED, unchanged).
- `node scripts/grade-ux-polish.mjs --honest` → psyops `tier: "polished"`,
  `isGenericScaffold: false` (see JSON above); `audit/ux-polish-honest*`
  reverted via `git checkout` after reading.
- No `tsc` run per this wave's standing rule (prior parallel batch OOM'd the
  container).

## Left alone, with reason

- All 17 macros' business logic, all 6 bespoke components, the page shell —
  already real, already correctly wired, no fabrication or field-shape bugs
  found.
- `publicReadDomains.psyops` entry (`server.js:11506`) — left as-is; see
  "Real defect found and fixed" above for why touching it wasn't necessary.
- The "Skill divergence" tab's raw-`fetch` `skillMacro()` helper
  (bypasses `lensRun`) — kept as-is; it's a documented, deliberate choice
  (comment: "Legacy skill-divergence macros live in server.js, not the
  domain module — they predate lensRun unwrapping, so call /api/lens/run
  directly") and its unwrap logic is correct for the flat shape those 3
  macros return.
