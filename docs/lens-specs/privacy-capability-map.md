# Privacy — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Reference bar (per-lens category leadership):** this
lens is judged as an independent product against **Google's "Data & Privacy"
dashboard + "My Activity"** (the consumer data-controls surface) for the
user-facing half, and **OneTrust Privacy Management** (DSAR automation, DPIA,
consent register, cookie banner, breach response) for the data-governance
half. The bar is "would this hold up shipped standalone against those," not
"good enough next to 259 sibling lenses."

**Honesty note (privacy is a trust-critical lens).** A fabricated
"data deleted" / "consent revoked" / "setting applied" confirmation is a
serious trust violation, not a mere UX defect. Every mutating action in this
lens was traced to a real backend write during this audit, and the envelope-
unwrap bug (fake success on a real macro failure) was checked at every call
site. The lens is clean on both counts — see "The defect found" below for the
one real gap fixed.

## Backend surface

Two backends serve this lens; both are real.

**1. REST consent API — `/api/consent` (`createConsentRouter`, mounted at
`server.js:33489`) + `POST /api/consent/update` (`server.js:55486`).** Drives
the main "Publishing / Leaderboards / AI & Emergents / Social / Advanced"
consent-toggle grid (marketplace publishing, regional/national/global
promotion, emergent-learning access, DM policy, etc.). This is the DTU-scope /
lattice-sharing consent register — a genuinely separate REST surface, not the
macro system. Non-revocable promotions (national/global) gate behind a
confirmation modal, matching the real permanence of a global-lattice promotion.

**2. Privacy macros — `server/domains/privacy.js` (19 registered actions, no
shadowing).** Verified single registration:
`grep -c 'registerLensAction("privacy"' server/domains/privacy.js` → `19`;
`grep -n 'register("privacy"' server/server.js` → none (no macro-shadowing
override). The 19 split into two groups:

- **Four DPO/GDPR analysis macros (artifact.data-driven, pure compute):**
  `dataInventory` (PII risk classification + GDPR remediation checklist),
  `consentAudit` (active/expired/withdrawn + compliance rate),
  `impactAssessment` (Article 35 DPIA determination + mitigations),
  `breachResponse` (Article 33 72-hour notification clock + phased runbook).
  Each reads structured input from `artifact.data` and returns
  `{ok:true, result:{...}}`. Because `POST /api/lens/run` builds a virtual
  artifact whose `.data` IS the request body, these are callable directly via
  `lensRun('privacy', action, {...input})` with no persisted artifact.
- **Fifteen per-user data-control macros (real `globalThis._concordSTATE`
  state, `save()`-persisted):** DSAR (`dsarSubmit` / `dsarList` /
  `dsarAdvance`), per-lens sharing (`lensSharingGet` / `lensSharingSet`),
  activity log (`recordAccess` / `accessLog`), data export (`dataExport`),
  cookie banner (`cookieConfigGet` / `cookieConfigSet`), retention policy
  (`retentionGet` / `retentionSet`), federation flow map (`flowRegister` /
  `flowMap` / `flowToggle`).

All 19 pass `node --test server/tests/depth/privacy-behavior.test.js
server/tests/platinum-privacy-review.test.js
server/tests/privacy-domain-parity.test.js` → **24/24 pass, 0 fail** (verified
this pass, tests unmodified).

## Macro classification (DESIGNED / GENERIC-STRIP-ONLY / UNSURFACED)

| Macro | Class | Surface |
|---|---|---|
| `dataInventory` | **DESIGNED** (this pass) | DpoStudioPanel · Data Inventory tab (add data-item rows + PII toggle → risk report) |
| `consentAudit` | **DESIGNED** (this pass) | DpoStudioPanel · Consent Audit tab (add consent records + expiry → compliance bar) |
| `impactAssessment` | **DESIGNED** (this pass) | DpoStudioPanel · DPIA tab (data-type / purpose chip fields + minors/cross-border toggles) |
| `breachResponse` | **DESIGNED** (this pass) | DpoStudioPanel · Breach Response tab (severity + affected + compromised types → timeline) |
| `dsarSubmit` / `dsarList` / `dsarAdvance` | DESIGNED | DataControlsPanel · DSAR section |
| `lensSharingGet` / `lensSharingSet` | DESIGNED | DataControlsPanel · Per-Lens Sharing grid |
| `accessLog` | DESIGNED | DataControlsPanel · Activity Log (TimelineView) |
| `dataExport` | DESIGNED | DataControlsPanel · Download My Data (real .json blob) |
| `cookieConfigGet` / `cookieConfigSet` | DESIGNED | DataControlsPanel · Cookie Banner config |
| `retentionGet` / `retentionSet` | DESIGNED | DataControlsPanel · Retention Policy editor |
| `flowMap` / `flowRegister` / `flowToggle` | DESIGNED | DataControlsPanel · Data-Flow Map (TreeDiagram) |
| `recordAccess` | UNSURFACED (by design) | System-write macro — other subsystems append access events; not a user button. Correctly not surfaced. |

`node scripts/lens-unsurfaced.mjs --lens privacy` → `1/19 never referenced` =
`recordAccess`, which is a legitimate system-side append hook (the read side
`accessLog` renders the timeline). No defect.

## What was already real/wired

- **`app/lenses/privacy/page.tsx`** — the consent-toggle grid over the
  `/api/consent` REST API: real loading/error states, optimistic local edit +
  explicit Save, `revokeAll` mutation, non-revocable-promotion confirmation
  modal, live stat tiles (DTUs shared / promotions / emergent interactions /
  feed posts) from `consentData.stats`. Honest throughout.
- **`components/privacy/DataControlsPanel.tsx`** (860 LOC) — DESIGNED, and the
  strongest part of the lens. Seven OneTrust-parity surfaces (DSAR, per-lens
  sharing, activity log, data export, cookie banner, retention, flow map), each
  wired to real macros through `lensRun` with **correct envelope unwrapping**:
  every section checks `r.data.ok && r.data.result` (the `lensRun` helper at
  `lib/api/client.ts:352` fully unwraps nested `{ok,result}` envelopes AND
  detects the terminal `{ok:false, error}` handler-error path, so `r.data.ok`
  reflects the macro's *own* success, not the transport envelope). No fake
  success anywhere. Data export produces a real downloadable JSON blob of the
  user's actual privacy corpus.
- **`components/privacy/PrivacyFeed.tsx`** — DESIGNED. Real live external feed
  (Reddit r/privacy · r/PrivacyGuides · r/degoogle · r/opsec top posts) with
  honest error/empty/loading states and Save-as-DTU export. Not fabricated.

## The defect found + what changed

**`app/lenses/privacy/page.tsx` "Privacy Analysis" section** ran the four
genuinely-capable GDPR/DPO analysis macros (`dataInventory`, `consentAudit`,
`impactAssessment`, `breachResponse`) through the **generic artifact-run
pattern** — the recurring defect class this program watches for (dead/hollow
real capability reached only through generic plumbing):

1. It fetched `/api/lens/privacy` artifacts and ran each macro against
   `firstArtifactId` via `useRunArtifact` → `POST /api/lens/privacy/{id}/run`.
   With **no authoring UI to create such an artifact**, `firstArtifactId` was
   usually `undefined`, leaving all four buttons permanently disabled — a dead
   feature.
2. Even when an artifact existed, its `.data` carried none of the structured
   input these macros read (`dataItems` / `consents` / `dataTypes` / breach
   fields), so the macros returned their empty/zero branches ("Add data items
   to inventory", 0 items, 100% vacuous compliance). Real depth, hollow output.

This was pattern (b) field-shape-mismatch + (c) generic-strip: four best-in-
class compliance tools (PII risk scoring, GDPR compliance-rate audit, Article
35 DPIA, Article 33 breach runbook) that could never produce a meaningful
result because nothing let the user supply real input.

**Fix — `components/privacy/DpoStudioPanel.tsx` (new, ~600 LOC).** A real
"DPO Compliance Studio" with a four-tab tool selector, each tab a **bespoke
structured input form** (not a JSON-paste box, not a button wall) calling the
macro directly via `lensRun('privacy', action, {...realInput})`:

- **Data Inventory** — add/remove data-category rows with a sensitive/PII
  toggle → risk badge + category histogram + remediation checklist.
- **Consent Audit** — add consent records (subject / status / optional expiry
  date) → active/expired/withdrawn counts + an animated compliance-rate bar +
  re-consent issue chips.
- **DPIA** — data-type and purpose chip fields + involves-minors / cross-border
  toggles → DPIA-required determination + risk-factor + mitigation list.
- **Breach Response** — severity select + affected-user count + compromised-
  data-type chips → notification-required badge, regulatory deadline, and the
  phased Immediately/24h/72h/30d remediation timeline.

The dead `useRunArtifact` / `/api/lens/privacy` artifact query / `firstArtifactId`
/ `handlePrivacyAction` state and the inline result-rendering block were all
removed from `page.tsx`. Each new form checks `r.data.ok && r.data.result` —
same honest unwrap as DataControlsPanel.

**Fluidity.** Added a discoverable `⌘S` kbd chip on the Save Changes button
(the `useLensCommand` save shortcut already existed but was invisible). The
four DPO tools are pure-compute analysis (they mutate nothing), so results
render immediately on backend return — no optimistic-UI needed, and no
optimistic "success" is ever shown for a real mutation.

**Judgment call on optimistic UI (documented per the fluidity invariant).**
The genuinely mutating privacy actions — DSAR submit/advance, per-lens sharing
toggles, cookie/retention saves, flow register/toggle in DataControlsPanel —
deliberately do **not** optimistically pre-render success. They reload from the
backend after the call resolves (`if (r.data.ok) await reload()`), so the UI
only ever shows a state the backend actually confirmed. For a privacy/data-
governance lens this is the correct trade: a fabricated "revoked"/"deleted"
that never reconciles would be a trust violation wearing a performance costume.
The sub-100ms-perceived-response bar is met by the local input responsiveness
(chips/rows update instantly) rather than by optimistically faking the server's
confirmation.

## Genuinely missing (deferred — Wave 4 gap-closure)

Nothing in the four-tool DPO studio or the seven data-control surfaces is
faked or stubbed; the gaps below are honest capability boundaries, each triaged
per the sixth hard invariant:

- **DSAR "deletion" request currently records + tracks the request; it does not
  yet execute a real cross-lens data purge.** The DSAR lifecycle
  (received → in_review → completed) is real state, but "completed" is a status
  transition, not a substrate-wide delete. Triage: **ENGINEERING** — wiring
  `dsarAdvance('completed')` on a `kind:'deletion'` request to the existing
  `dtu:deleted` hard-delete path + retention sweeps would make the "delete my
  data" request actually erase data. Deferred because it touches the deletion/
  tombstone invariant (`forgetting-engine` retention vs. user hard-delete) and
  deserves its own careful pass, not a rushed wire.
- **Cookie-banner + retention-policy config is stored per-user but not yet
  enforced by a runtime consent gate.** The config round-trips honestly (real
  state, real consent string), but no request-time middleware currently reads
  it to actually block analytics/advertising trackers or auto-expire data at
  the window. Triage: **ENGINEERING** — a retention-sweep heartbeat + a
  consent-gate middleware would close it. Deferred; the editor is honest about
  being a policy register today.
- **Access log depends on other subsystems calling `recordAccess`.** The read/
  render path is real; population breadth depends on more call sites across the
  platform invoking the append hook. Triage: **ENGINEERING** (instrument more
  read paths). Not faked — an empty log honestly shows "No data accesses
  recorded yet."

## Verification (this pass)

- `node --check` n/a (no backend file touched — `server/domains/privacy.js`
  unchanged).
- `node --test server/tests/depth/privacy-behavior.test.js
  server/tests/platinum-privacy-review.test.js
  server/tests/privacy-domain-parity.test.js` → **24/24 pass, 0 fail**
  (unmodified).
- `npx eslint app/lenses/privacy/page.tsx components/privacy/*.tsx` → clean.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`,
  privacy WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → privacy `tier:"polished"`,
  `isGenericScaffold:false`.
