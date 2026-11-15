# SEC-export-system-dtu-leak — 2026-11-09

**Status:** confirmed (read-only triage)  
**Severity:** **High** (cross-user private activity text exposed as public “system” lens artifacts; any signed-in user, and for most domains also anonymous `lens.list` callers, can pull it via Export / list)  
**Live site:** https://concord-os.org  
**Scope:** read-only code + `sqlite3 -readonly` on `server/data/concord.db`  
**Do not fix in this ticket’s triage run** — recommendations only.

---

## Summary (5–8 lines)

Meditation Export → JSON returning 172 rows (3 QA-owned + 169 `ownerId=system`) is real. The Export menu calls `GET /api/lens/:domain/export[/download]`, which runs `collectLensExport` → `lens.list`. That list intentionally returns every **public/published** artifact in the domain, and `syncDTUToLensArtifacts` + integrity repair have been minting **`dtu_lens_<domain>_<dtuId>` mirrors with `ownerId: "system"` and `meta.visibility: "public"`**, including mirrors of private `Lens:<domain> <action> …` exhaust DTUs. Keyword auto-tagging (e.g. meditation keyword `"focus"`) places other lenses’ private activity into unrelated domains. DB join of `Lens:*` mirrors → `dtu_store` → `users` found **351** public mirror rows whose source DTU is **private** and owned by **`is_test_account=0`** (at least **1** distinct non-test owner in that slice; broader `dtu_lens_%` join shows **7** distinct non-test owners). Root cause: `server/server.js:90791` (`syncDTUToLensArtifacts`) + `49980–49987` (`lens.list` public pass-through), fed by `_lensEmitDTU` at `49871`. Fix: stop mirroring private/lens_exhaust DTUs as public system artifacts; preserve real `ownerId`/`visibility`; tighten auto-tag; scrub existing mirrors; scope Export to caller-owned data.

---

## 1. Export code path (why system public rows come back)

### Frontend

| Step | File:line | What it does |
|------|-----------|--------------|
| Shared header Export menu | `concord-frontend/components/common/ExportMenu.tsx` (~152–173) | `exportAs()` calls `apiHelpers.lens.exportList(domain)` then navigates to `/api/lens/${domain}/export/download?format=json\|csv&limit=1000` |
| Empty-state copy | same file, lines 11–14 | “Nothing to export…” when the list is empty |
| Alternate ↓.dtu control | `concord-frontend/components/lens/DTUExportButton.tsx:45` | `GET /api/lens/${domain}/export` |

### Server HTTP

| Route | File:line |
|-------|-----------|
| `GET /api/lens/:domain/export` | `server/routes/universal-export.js:100–106` |
| `GET /api/lens/:domain/export/download` | `server/routes/universal-export.js:115–152` |

Both call `collectLensExport({ runMacro, domain, ctx, limit })`. **Neither route attaches `requireAuth()`**; auth is whatever the session cookie happens to carry. `GET /api/lens/:domain` (`server/server.js:51767`) likewise lists without auth except for the `agents` domain.

### collectLensExport merge

`server/lib/lens-export.js:67–141`:

1. **`lens.list`** artifacts (ownership/visibility reused from that macro) — **this is the leak leg**
2. Optional domain `registerLensExportProvider` rows (caller-scoped when registered)
3. **`dtu.list` with `{ domain, mine: true }`** — caller’s own DTUs only

Meditation has **no** `registerLensExportProvider` (unlike calendar/feed/mail/…). Sessions/journals live in per-user STATE (`server/domains/meditation.js` `sessionLog` / `journal` fields) and never enter the export merge — which matches the tester finding that **the user’s own journal was missing** while 169 system rows appeared.

### Why `lens.list` returns the system rows

`server/server.js:49963–49996` (`register("lens", "list", …)`), non-social domains:

```text
if (!a.ownerId || a.ownerId === "anon") return true;   // ownerless always visible
if (a.ownerId === currentUserId) return true;            // own
if (vis === "published" || vis === "public") return true; // ← system mirrors hit this
return false;
```

Live meditation inventory:

| owner_id | count |
|----------|------:|
| `system` | 169 |
| QA user (`496291b0-…`) | 3 |
| **total** | **172** |

Careers: 208 system / 1 user. Fishing: 186 system / 0 user. Matches the tester’s Careers (208) and Fishing (186) reports.

Sample meditation system row (structure only):

- `id`: `dtu_lens_meditation_dtu_…`
- `ownerId`: `system`
- `meta.visibility`: `public`
- `meta.createdFrom`: `dtu-auto-sync` (or integrity-repair)
- `title`: e.g. `Lens:goals delete goal`
- `data.summary`: activity text naming another account’s goal title

---

## 2. Are these activity logs mirrored as public system DTUs/artifacts?

### Creation of `Lens:<lens> <action> …` records

`server/server.js:49871–49960` — `_lensEmitDTU`:

- Called from lens create/update/delete/run/export paths.
- Title: ``Lens:${domain} ${action} ${artifactType}`` (e.g. `Lens:goals delete goal`).
- Stores artifact title/text into `human.summary` / `creti` / `summary` (up to 4k of artifact body).
- Intended stamps: **`ownerId` = artifact owner / actor**, **`visibility: "private"`**, `machine.kind: "lens_exhaust"`.

So the **canonical exhaust DTU is private and user-owned**. The leak is not that `dtu.list` ignores `mine:true`; it is the **downstream public mirror**.

### How they become public system lens artifacts

1. **`applyAutoTagging` / `autoClassifyDTU`** — `server/server.js:90720`, `90774`  
   Keyword score against `LENS_DOMAIN_KEYWORDS` (`90550+`). Meditation includes **`"focus"`** (`90643`). A goals exhaust whose summary contains “focus” (tester title: `… goals 2026-11-08 focus`) gets tagged `meditation` (and up to 4 other domains).

2. **`syncDTUToLensArtifacts`** — `server/server.js:90791–90833`  
   For every domain tag in `LENS_DOMAIN_KEYWORDS`, if `dtu_lens_${domain}_${dtu.id}` is missing, inserts a lens artifact with:
   - `ownerId: dtu.createdBy || dtu.entityId || "system"`  
     (**bug:** exhaust DTUs set `ownerId`, not `createdBy` → falls through to **`"system"`**)
   - `meta.visibility: "public"`, `meta.status: "published"`, `meta.createdFrom: "dtu-auto-sync"`
   - `data.summary` copied from the DTU’s human/creti summary (**includes private action text**)

3. Hooked on DTU upsert — `server/server.js:19726–19735` (and similar ~26727/26782).

4. **Integrity repair** duplicates the same shape — `server/lib/integrity-check.js` ~232 (audit) / ~505 (`fixUnsyncedLens`, `createdFrom: "integrity-repair"`).

Intentionally public feed ingestion is a separate path (`server/server.js:63568+`, `ownerId: "system"`, `visibility: "public"`) and is expected for external RSS/API content; it is **not** the Lens-activity leak, but it does explain large system-owned public catalogs on some lenses (e.g. fishing).

### DB counts (read-only)

| Metric | Count |
|--------|------:|
| `lens_artifact_store` rows with `owner_id='system'` | 128,828 |
| … with `meta.visibility='public'` | 128,828 (all of them) |
| … with `meta.createdFrom` in (`dtu-auto-sync`,`integrity-repair`) | 114,130 |
| ids matching `dtu_lens_%` | 115,670 (all public) |
| system-owned titles `Lens:%` | 2,564 |
| Distinct source DTUs for those `Lens:%` mirrors | 761 |
| `Lens:%` mirrors joinable to `dtu_store` | 1,040 |
| … source `visibility='private'` | **1,040** (all matched sources private) |
| … `users.is_test_account=1` | 689 |
| … **`users.is_test_account=0`** | **351** |
| Distinct non-test owners (`Lens:%` private sources) | **≥1** (query returned 1) |
| All `dtu_lens_%` mirrors joinable to non-test owners | 936 rows / **7** distinct non-test owners |
| … of which source still `private` | 864 |

**Masked example** (no verbatim user content):

```text
mirror_domain: meditation (also studio/news/cooking/… for other tags)
title:        Lens:goals delete goal
owner:        system / public artifact
source DTU:   private, owner is_test_account=0|1
summary:      "delete goal \"…[REDACTED user text]…\" in goals lens"
```

**Conclusion:** Yes — private per-user lens activity is being **mirrored** into public system-owned lens artifacts (not merely “catalog” content). Real non-test accounts are included in the matched set.

---

## 3. Reachable through other public endpoints?

| Surface | Exposed? | Notes |
|---------|----------|-------|
| `GET /api/lens/:domain` → `lens.list` | **Yes** | Same filter as export; no auth except `agents`. Any caller (incl. anon for most domains) sees public system mirrors. |
| `GET /api/lens/:domain/:id` / `.../export` | **Yes** | If the artifact id is known/`dtu_lens_…` predictable from DTU id + domain. `_lensArtifactVisible` allows public. |
| Export menu / `GET /api/lens/:domain/export[/download]` | **Yes** | Primary report path; up to 1000/5000 rows. |
| `dtu.list` / `dtu.search` / by-id DTU read | **Original exhaust: No** (intended) | Exhaust DTUs are `visibility: private` + real `ownerId`; `userVisibleDTUs` / `ctxMayReadDtu` keep them owner-only. The **mirror artifact** is the bypass. |
| Social Feed lens / `/api/feeds` | **Separate** | Hosts intentional public feed items (`ownerId: system`). Does not need the auto-sync bug to publish RSS; should not be confused with Lens-activity mirrors. |
| Account export / `exportableDtus` | Different path | Uses `lib/export-filter.js` + `_isHiddenSystemDtu`; does **not** fix lens artifact export. |

So: **any signed-in user** (and typically **anonymous** list callers) who opens an affected lens can read other users’ activity summaries via list/export. They cannot pull the private exhaust DTU itself through the DTU ACL — but they do not need to; the summary is already copied onto the public artifact.

---

## 4. Severity, who can see what, recommended fix (do not implement here)

### Severity: **High**

- **Confidentiality:** Private user actions (goal titles, craft recipe names, code script titles, etc.) cross tenant boundaries.
- **Blast radius:** ~115k `dtu_lens_%` public mirrors; 2.5k explicit `Lens:*` activity titles; confirmed non-test private sources.
- **Ease of access:** Built-in Export button + unauthenticated `lens.list` for most domains.
- **Integrity of Export product:** Export returns the wrong corpus (site-wide auto-sync junk) and omits real per-user STATE (journals/sessions).

### Who can see what

| Actor | Sees |
|-------|------|
| Any signed-in member on lens X | All `meta.visibility=public` artifacts in X, including system mirrors of **other users’** private lens activity summaries |
| Anonymous caller of `GET /api/lens/:domain` (non-agents) | Same public set |
| Owner of private exhaust DTU | Still sees their private DTU via normal DTU ACL; Export of unrelated lenses may still dump their mirrored summaries to others |
| Other users via `dtu.get` on exhaust id | Should 404/hide (private) — **not** the leak path |

### Recommended fix (triage only — **do not apply in this run**)

1. **Stop the mint** (`syncDTUToLensArtifacts` / integrity `fixUnsyncedLens`):
   - Skip `machine.kind === "lens_exhaust"` (and other private activity kinds).
   - Skip any DTU with `visibility`/`privacy` private (or non-public).
   - Set artifact `ownerId` from `dtu.ownerId || dtu.createdBy || …` — **never** default private user content to `"system"`.
   - Artifact `meta.visibility` must **inherit** source visibility (default private), never force `public`.
2. **Tighten autoClassify** so exhaust/private rows are not tagged into unrelated lenses; remove ultra-broad keywords (`focus`, `calm`, …) from cross-domain scoring or require stronger scores / explicit `domain` stamps.
3. **Export / list product fix**:
   - For Export, prefer caller-owned artifacts + registered providers + `dtu.list mine:true`; exclude `createdFrom ∈ {dtu-auto-sync, integrity-repair}` unless the viewer owns the source DTU.
   - Register a meditation (and similar) export provider for sessions/journals so Export returns the user’s real data.
4. **Backfill (ops, after code fix):** identify `dtu_lens_%` rows whose source DTU is private or `Lens:%` / `lens_exhaust`; delete or flip to private / correct owner; re-run only for intentionally public feed/catalog DTUs.
5. **Auth hardening (defense in depth):** require auth on `/api/lens/:domain/export` and `/export/download`; reconsider anonymous `lens.list` of non-social domains.
6. **Regression tests:** private goals action must not appear in meditation export/list for another user; meditation export must include the caller’s journal/session rows when present.

---

## Evidence map (file:line)

| Piece | Location |
|-------|----------|
| Export menu → download URL | `concord-frontend/components/common/ExportMenu.tsx:152–173` |
| HTTP export routes | `server/routes/universal-export.js:100–152` |
| Merge logic | `server/lib/lens-export.js:67–141` |
| `lens.list` public pass-through | `server/server.js:49963–49996` |
| Private exhaust mint | `server/server.js:49871–49960` (`_lensEmitDTU`) |
| Keyword classify | `server/server.js:90720–90788` |
| Public system mirror mint | `server/server.js:90791–90833` |
| Upsert hook | `server/server.js:19726–19735` |
| Integrity re-mint | `server/lib/integrity-check.js` (~232, ~505) |
| Meditation STATE (not exported) | `server/domains/meditation.js` (`sessionLog` / journal) |

---

## What this triage did **not** do

- No writes, DELETEs, UPDATEs, restarts, deploys, or code changes.
- No content excerpts of real user text beyond masked shapes.
- No live HTTP calls that would further exfiltrate data; DB/code inspection only.
