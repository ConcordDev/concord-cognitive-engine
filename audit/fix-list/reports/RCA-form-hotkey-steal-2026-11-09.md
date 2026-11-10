# RCA: Create-form typing steals keystrokes to lens tab shortcuts

**Date:** 2026-11-09 (America/New_York)  
**Scope:** Read-only diagnosis in `/workspace/webdb-audit` @ `dae9e10a6` (same tip as live mega deploy). **No files modified.**  
**Symptoms (live QA, real keyboard):** Household / Trades / Food / Healthcare create flows jump tabs or close dialogs while typing; Council title once showed `QAQAQA`.

---

## Root causes

### RC1 (primary) — Bare-letter `useLensCommand` tab shortcuts

Lenses register single-letter navigation commands via `useLensCommand` → `react-hotkeys-hook`. Those letters map 1:1 onto the reported tab jumps.

| Lens | File:lines | Keys → action | Matches symptom |
|------|------------|---------------|-----------------|
| Household | `components/household/HouseholdHome.tsx:196–222` | `d` Dashboard, `m` Meals, `a` Calendar, `e` Emergency, `c` Chores, `h` Home, `b` Budget, `f` Family, `p` Pets, `/` focus search | Typing switches Calendar/Meals/Dashboard/Emergency and discards create context |
| Trades (shell) | `app/lenses/trades/page.tsx:162–174` | `d` → Dispatch | New Job closes; view → Dispatch |
| Trades (desk) | `components/trades/ProjectDeskPanel.tsx:240–252` | nested `d/j/e/m/…` + `esc` close | Same page; parent `d` unmounts desk |
| Food | `app/lenses/food/page.tsx:62–73` | `r/m/p/k/n/d/o` switch views | New Recipe unmounts when a tab letter is typed |
| Healthcare (page) | `app/lenses/healthcare/page.tsx:59–68` (+ COMMANDS :40–48) | `p/c/e/s/i/r/a` (+ `g d`/`g l`) | Tab jumps mid-allergy → interleaved text |
| Healthcare (desk) | `components/healthcare/ClinicalArtifactsPanel.tsx:332–344` | second binding `p/e/r/m/l/t/s` when Records desk mounted | Amplifies jumps on that view |
| Council | `components/council/CouncilChamber.tsx:679–690` | `n` new proposal; `1`–`5` status filters; `g p/v/d`; `/` | Does **not** map `q`/`a`; see gaps for `QAQAQA` |

Shared binder: `hooks/useLensCommand.ts` (esp. `:133–164` `useHotkeys` dispatch; form-tag discipline at `:43–49`, `:147–154`, `:159–161`).

**How a tab switch kills the dialog**

- Household: `setMode(...)` changes `currentType` / tab body while `showEditor` can stay true → form fields swap / feel discarded (`HouseholdHome.tsx:1844–1888`).
- Trades: parent `setActive('dispatch')` unmounts `ProjectDeskPanel` → New Job gone.
- Food: `setActive(...)` remounts view → recipe editor gone.
- Healthcare: page-level `go(id)` swaps `EpicSection` nav → focus/fields change mid-word → interleaved allergy text.

### RC2 (secondary, confirmed pattern) — Modal `role="button"` + Enter/Space → `.click()`

Create modals wrap backdrop/panel as:

```tsx
role="button" tabIndex={0}
onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
```

Keydowns **bubble from inputs**. Space/Enter therefore `preventDefault` and programmatically click the backdrop → **close unsaved**. Same anti-pattern already fixed for masonry in `ContractorSuite.tsx:1271–1289` (F3 comment). Still present on Household, ProjectDesk, FoodKitchenWorkbench, CouncilChamber (and ~163 files matching the pattern).

This explains Space closing dialogs; it does **not** by itself switch letter-mapped tabs.

### Guard that was supposed to stop RC1

`useLensCommand` already has Q82 form-tag discipline (in `dae9e10a6`, same as deploy):

- `enableOnFormTags: false` when no command is `global` (library should ignore INPUT/TEXTAREA/SELECT).
- When any command is `global`, aggregate form tags are enabled but non-global commands early-return via `isFormFieldEvent(event)`.

Unit pins: `tests/use-lens-command-form-fields.test.tsx`, `tests/ml-shortcut-guard.test.tsx`, `tests/paper-shortcut-guard.test.tsx`, `tests/hooks/useLensCommand.test.tsx` (Q82).

**Simulated `react-hotkeys-hook@5.3.3` gate:** with `enableOnFormTags: false`, native `INPUT` targets do **not** fire; `DIV role=button` **does** fire. So if focus/target is the modal panel (not the input), letter shortcuts still run. That is a likely live failure mode when the field was never focused, or focus was stolen. If testers truly typed into a focused `<input>` and still saw tab jumps, either the live bundle behaves differently than this source pin, or another listener is involved — see Gaps.

LIVE-view remount was checked as an alternate hypothesis; it does **not** explain letter→specific-tab mapping. RC1 does.

---

## Blast radius

- `useLensCommand(` call sites: **~335** files  
- Files with both `useLensCommand` and bare `keys: '[a-z0-9]'`: **~261**  
- Distinct `lensId`s in those files: **~225** (of ~267 lenses)  
- Modal Enter/Space anti-pattern: **~163** files  

Any lens that registered bare letter/digit nav shortcuts is exposed; reported five are the tip of the iceberg (Graph/ML/Paper already documented the same class of bug).

---

## Proposed patch (NOT applied)

### 1. Harden `useLensCommand` (minimal shared fix)

```diff
--- a/concord-frontend/hooks/useLensCommand.ts
+++ b/concord-frontend/hooks/useLensCommand.ts
@@ -39,14 +39,36 @@
 /**
  * Did this keystroke originate in a form field? Mirrors the tag set
  * react-hotkeys-hook's enableOnFormTags covers, plus contentEditable.
+ * Also checks activeElement + composedPath + role=textbox and nearest
+ * editable ancestor so modal role=button wrappers cannot steal letters.
  */
-function isFormFieldEvent(event: KeyboardEvent): boolean {
-  const t = event.target as (HTMLElement & { isContentEditable?: boolean }) | null;
-  if (!t || typeof t !== 'object') return false;
-  if (t.isContentEditable) return true;
-  const tag = t.tagName;
-  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
+function isEditableElement(el: EventTarget | null): boolean {
+  if (!el || typeof el !== 'object') return false;
+  const node = el as HTMLElement & { isContentEditable?: boolean; role?: string };
+  if (node.isContentEditable) return true;
+  const tag = (node.tagName || '').toUpperCase();
+  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
+  const role = (node.getAttribute?.('role') || node.role || '').toLowerCase();
+  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
+  if (typeof node.closest === 'function') {
+    const editable = node.closest(
+      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
+    );
+    if (editable) return true;
+  }
+  return false;
+}
+
+function isFormFieldEvent(event: KeyboardEvent): boolean {
+  if (event.isComposing) return true;
+  if (isEditableElement(event.target)) return true;
+  if (typeof document !== 'undefined' && isEditableElement(document.activeElement)) return true;
+  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
+  return path.some((n) => isEditableElement(n));
 }
@@ -133,15 +155,22 @@
   useHotkeys(
     allKeys || 'f24',
     (event, handler) => {
       const cmds = commandsRef.current;
       if (!cmds.length) return;
+      // Belt-and-suspenders: never dispatch nav/actions from editables
+      // unless the matched command opted into global.
+      // (Library enableOnFormTags:false should already skip; this covers
+      // role=button targets, activeElement skew, and composing.)
       const fired = (handler as { hotkey?: string; keys?: string[] }).hotkey
         ?? (handler as { keys?: string[] }).keys?.join('+');
       const matched = cmds.find((c) =>
         c.keys === fired || c.keys.replace(/\s+/g, '') === fired
       );
       if (!matched || !(matched.enabled ?? true)) return;
       if (!(matched.global ?? false) && isFormFieldEvent(event)) return;
+      if (event.metaKey || event.ctrlKey || event.altKey) {
+        /* allow modified chords through as registered */
+      }
       event.preventDefault();
       liveActions.current.get(matched.namespacedId)?.();
     },
     {
       enableOnFormTags: namespacedCommands.some((c) => c.global)
         ? ['INPUT', 'TEXTAREA', 'SELECT']
         : false,
+      // Always run our predicate even when the library thinks the target
+      // is non-form (e.g. focus on modal panel role=button while caret is
+      // notionally in a field, or during composition).
+      ignoreEventWhen: (e) => {
+        // Only suppress for non-global-only bindings; globals still need delivery.
+        if (commandsRef.current.some((c) => c.global)) return false;
+        return isFormFieldEvent(e as KeyboardEvent);
+      },
       preventDefault: false,
     },
     [allKeys]
   );
```

**Important:** `ignoreEventWhen` returning true when *any* global exists would block globals too if we naively always return `isFormFieldEvent`. The sketch above only installs the ignore when the instance has **no** globals (the common tab-letter case). When globals exist, keep relying on the per-command `isFormFieldEvent` early-return (already present) **after** upgrading `isFormFieldEvent` as above.

### 2. Fix modal chrome (Space/Enter close)

Mirror `ContractorSuite` Modal: remove `role="button"`, `tabIndex={0}`, and the Enter/Space `onKeyDown` from backdrop/panel; keep `onClick` on backdrop only. Priority files: HouseholdHome, ProjectDeskPanel, FoodKitchenWorkbench, CouncilChamber create modals.

### 3. Optional product hardening

- While any create/edit modal is open, set tab nav commands `enabled: false`.
- Longer term: prefer `1`–`9` or `g <letter>` for tabs instead of bare letters (Anki/Epic-style bare letters are hostile to forms).

### Suggested tests

1. Extend `tests/ml-shortcut-guard.test.tsx` / add `tests/household-shortcut-guard.test.tsx`: open New editor harness with Household’s exact key set; `fireEvent.keyDown` on title `input` for `a/m/d/e` → **no** `setMode`; same keys on `document.body` → mode changes.
2. Focus a modal **panel** `role=button` with an input inside; with upgraded guard, letters must not switch tabs when `document.activeElement` is the input (and ideally not when only the panel is focused if an editable is the intended target — product choice).
3. Space in title must **not** close modal after RC2 fix.
4. Healthcare: type `penicillin` into allergy allergen input with page COMMANDS bound → no nav change; string intact.
5. Regression: existing Q82 / paper / graph form-field tests still pass.

---

## Confidence and gaps

| Claim | Confidence |
|-------|------------|
| RC1 letter→tab mapping explains Household/Trades/Food/Healthcare keyboard symptoms | **High** (exact key tables) |
| RC2 Space/Enter modal close | **High** (code + prior F3 fix elsewhere) |
| Form guard in source *should* block INPUT when `enableOnFormTags:false` | **High** (library simulation + unit pins) |
| Why live still breaks with focused inputs | **Medium** — best hypotheses: (a) focus actually on modal `role=button` panel; (b) focus stolen mid-word then bare keys fire; (c) Playwright “fill” path was actually sequential keypresses; (d) live chunk skew (unverified; login wall blocked bundle inspect) |
| `QAQAQA` from Council hotkeys | **Low** — Council has no `q`/`a` shortcut; not explained by RC1. Possibilities: digit filters `1`–`5` remount side effects, double-entry after reopen, or separate controlled-input/automation issue. Needs live re-check. |
| Playwright `fill` without keydowns also switching tabs | **Gap** — native `fill` does not emit per-char `keydown`; if truly observed, need a second input/onChange listener (not found for Household). Likely harness used `type`/`pressSequentially`, or focus/click hit a tab. |

**Not done:** no fix applied; no live authenticated DOM repro in this pass; node_modules absent so unit pins not re-executed here.

---

## Verdict for testers

Treat create/edit CRUD as **BLOCKED** on any lens with bare-letter `useLensCommand` nav until RC1+RC2 land. Prefer documenting tickets against `useLensCommand` + per-lens key tables rather than lens-local one-offs.
- 2026-11-09 6:27 AM: RCA-form-hotkey-steal note: Sim (LT2) and Services both close New modal on browser_fill_form too (not only keystrokes) — trigger wider than bare-letter keydown; builders must check input/change-driven close paths. Environment (LT3): all 9 Field Ops New modals affected.
- 2026-11-09 6:40 AM: LT2 move-builder live: bare 'c'/'l' typed in Name did NOT steal (page.tsx:19-38 guarded for inputs). RC1 not universal — some useLensCommand call sites guard inputs; builders should diff guarded vs unguarded paths.
- 2026-11-09 6:50 AM: Photos (LT2) — RC1 Space key opens viewer/Import while typing title; 600-char fill fired ~12 file choosers; fill truncates to 'QA'.
