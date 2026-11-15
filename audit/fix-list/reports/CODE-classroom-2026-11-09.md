# CODE-classroom — assignment/material vanish after reload (FIX-classroom-001/002) — 2026-11-09

**Tickets:** FIX-classroom-001 (high — Classwork/Materials empty after reload; assignment remains in To-do), FIX-classroom-002 (high — orphaned assignment not deletable from UI). **Live (LT3 evidence `evidence/classroom/phase3-lifecycle-20261109.md`):** Cohort #13 scoped create of assignment + material → show immediately → after reload + re-scope to #13, Classwork and Materials empty; assignment still listed under To-do > Upcoming; unscoped Workspace also hides both; To-do row has no Delete; leftover survives Archive. **Code-only** against `/workspace/webdb-audit` tip assumed `dae9e10a6`. **No files/DB/services modified. Fix not implemented.**

## Symptoms → code surfaces

| Live observation | Code |
|------------------|------|
| Assignment shows in Classwork right after create | `AssignmentsTab.create` → `assignment-create` then `assignment-list` refresh (`ClassroomWorkspace.tsx:236–248`) |
| Material shows in Materials right after add | `MaterialsTab.add` → `material-add` then `material-list` (`:495–506`) |
| After reload, Classwork empty (scoped **and** unscoped) | `assignment-list` filter + list UI (`classroom.js:239–256`, `ClassroomWorkspace.tsx:228–231`) |
| After reload, Materials empty | `material-list` filter + `byTopic` UI (`classroom.js:512–529`, `ClassroomWorkspace.tsx:487–490`) |
| Assignment still in To-do > Upcoming | `todo` buckets unsubmitted future-due items (`classroom.js:553–603`, `TodoTab` `:576–589`) |
| No way to delete leftover from To-do | Todo items are display-only — no `assignment-delete` control (`ClassroomWorkspace.tsx:593–611`); delete only on Classwork row (`:339–342`) |
| Stream had no assignment entry at create time | Likely tab not refreshed: create runs from AssignmentsTab; StreamTab only loads on its own mount (`:150–159`). Separate UX gap, not required for vanish |

## Data model (relevant)

Workspace records live in **per-user Maps** on `STATE.classroomLens`:

```176:187:server/domains/classroom.js
  function getClassState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.classroomLens) STATE.classroomLens = {};
    const s = STATE.classroomLens;
    for (const k of [
      "assignments", "submissions", "grades", "stream",
      "materials", "quizzes", "quizAttempts",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
```

- `assignment-create` stores `cohortId: Number(params.cohortId)` and `pushTo(state.assignments, userId, assignment)` then `saveClassState()` (`:213–232`).
- `material-add` same pattern on `state.materials` (`:489–505`).
- `assignment-list` / `material-list` / `todo` all read `state.assignments` or `state.materials` for `uid(ctx)` and optionally filter by cohort.

## Cause analysis

### 1) Strict cohortId equality on list filters (scoped vanish)

```245:247:server/domains/classroom.js
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        list = list.filter((a) => a.cohortId === c);
```

Same pattern on `material-list` (`:518–520`), `stream-list` (`:471–473`), `gradebook` (`:390–392`), `todo` (`:560–562`), `quiz-list` (`:679–681`).

**Defect:** filter uses **strict** `===` after `Number(params.cohortId)`. If a stored `cohortId` is ever a string (bad client payload, older fixture, or any serialize path that stringifies), scoped lists return **[]** while the row still exists in the Map.

Create always does `Number(params.cohortId)` (`:213`, `:489`), and JSON Map persistence preserves numbers — so a clean create→same-process list should match. This remains a real footgun for scoped views and for any future type drift; fix should coerce both sides (`Number(a.cohortId) === Number(c)`).

**Alone, this does not explain unscoped Classwork being empty** (unscoped passes `{}` / omits `cohortId`, so no filter runs).

### 2) getClassState empty-Map wipe (persistence / remount loss)

```185:185:server/domains/classroom.js
      if (!(s[k] instanceof Map)) s[k] = new Map();
```

**Defect:** if `assignments` / `materials` hydrate as plain objects (snapshot without `__type:"Map"` envelopes, or any in-place JSON round-trip), this line **replaces the field with a brand-new empty Map**, destroying all rows. Same anti-pattern class as the documented DTU-store `instanceof Map` wipe in `server.js:14038–14058`.

`hydrateLensState` *does* restore Map envelopes correctly when present (`lens-state-persistence.js:749–750,842–847`). Wipe bites when the restored value is **not** a Map instance.

This can explain **Materials gone** if `materials` was wiped or never flushed while `assignments` remained a healthy Map (To-do still sees the assignment). It can also wipe **both** after a bad boot — then To-do would also be empty (does not match leftover To-do by itself).

### 3) Unscoped Classwork empty while To-do still lists the assignment

`assignment-list` and `todo` both start from `state.assignments.get(userId)` with identical cohort filter logic when scoped, and **no filter** when unscoped (`classroom.js:244–247` vs `:559–562`).

With a healthy array under that key, unscoped `assignment-list` **must** return the same rows `todo` walks. Code review finds **no server branch** that can omit those rows from `assignment-list` while still returning them from `todo`.

Frontend difference that *can* present as “Classwork empty”:

```81:83:concord-frontend/components/classroom/ClassroomWorkspace.tsx
async function run<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('classroom', name, params);
  return r.data?.ok ? (r.data.result as T) : null;
}
```

```228:231:concord-frontend/components/classroom/ClassroomWorkspace.tsx
    const r = await run<{ assignments: Assignment[] }>('assignment-list',
      cohortId != null ? { cohortId } : {});
    setAssignments(r?.assignments ?? []);
```

If `assignment-list` returns `{ ok:false, … }` (handler catch, `invalid_input`, transport failure), `run()` yields `null` → UI shows **“No assignments yet.”**  
`TodoTab` uses the same `run()`; a successful `todo` payload sets `upcoming` directly (`:583–588`). So a live split implies **different HTTP outcomes** for the two macros (or multi-instance `STATE` drift), not a second assignments store.

`assignment-list` enrich touches `submissions` / `grades` with `.filter` (`:249–253`). A corrupted non-array Map value would throw inside the handler `try/catch` → `{ ok:false }` → empty Classwork. `todo` also calls `.find` on those lists (`:571`) and would fail the same way if corrupted — so this only fits if those maps are fine empty arrays and something else fails only on the list path (infra / intermittent 4xx — LT3 console noted background `/api/lens/run` 400/500s).

**Recommended live check (not done here):** capture Network for `assignment-list` vs `todo` on the failing reload (status, body `ok` / `result.assignments` / `result.upcoming`).

### 4) Why the leftover cannot be deleted (FIX-classroom-002)

- `assignment-delete` exists and works by id (`classroom.js:262–276`) but the **only UI trash control is on Classwork rows** (`ClassroomWorkspace.tsx:339–342`).
- When Classwork does not render the row, the tester cannot invoke delete.
- To-do rows have **no actions** (`:602–609`).
- Archiving the SQLite cohort (`archive_cohort`) does **not** cascade into `classroomLens` Maps — assignment remains with `cohortId: 13`.

## Proposed fix direction (not implemented)

1. **Coerce cohort filters:** `list.filter((a) => Number(a.cohortId) === Number(c))` everywhere in `classroom.js` (assignment/material/stream/gradebook/todo/quiz).
2. **Revive Maps instead of wiping:** in `getClassState`, if a field is a plain object of `userId → array`, convert with `new Map(Object.entries(...))` (and array values unchanged); only allocate empty Map when missing/invalid — same capability-style guard as `server.js:14059–14062`.
3. **Delete affordance:** add Delete on To-do items (and/or an “orphans” Classwork section when unscoped) calling `assignment-delete` / `material-delete`.
4. **Archive cascade (product choice):** optionally clear or re-home workspace rows when a cohort is archived — today they orphan by design.
5. **Verify** with LT3 leftover title `QA LT3 classroom 2026-11-09 assignment` via direct `assignment-list` `{}` then `assignment-delete` once Classwork can see it again (or a one-off admin cleanup — out of scope for testers).

## Leftover fixture note

| Field | Value |
|-------|-------|
| Title | `QA LT3 classroom 2026-11-09 assignment` |
| Where visible | To-do > Upcoming (due 11/16/2026) |
| Cohort | #13 archived — no longer in Teaching list |
| Material | Not visible after reload (likely Map loss or filter); title was a Note material from phase3 |
| Cleanup via UI | **Blocked** until Classwork lists it or To-do gains delete |

## Summary

| Hypothesis | Fits scoped empty? | Fits unscoped Classwork empty + To-do full? | Fits materials gone? |
|------------|--------------------|---------------------------------------------|----------------------|
| Strict `cohortId ===` filter | **Yes** | **No** | Yes if typed wrong |
| `getClassState` Map wipe | Yes (total loss) | Only if assignments survive and materials wiped | **Yes** |
| `assignment-list` ok:false → UI null | Yes | **Plausible** (needs network proof) | If material-list also fails |
| Local-only React state | No (reload clears client) | No | No |

**Primary code defects to fix:** (1) strict cohortId filter, (2) Map wipe on non-Map revive, (3) missing delete path from To-do / orphan visibility. **Unscoped split** needs a captured `assignment-list` response on repro to confirm whether the server still has the row in the list payload.

Code-only; not live-proven; no fix applied.
