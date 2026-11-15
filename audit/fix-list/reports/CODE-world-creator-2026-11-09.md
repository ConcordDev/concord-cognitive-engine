# World-creator code findings (read-only) — 2026-11-09

Source tip assumed `dae9e10a6`. **No files/DB/services modified.** Code-only; not live-proven.

Companion to `SCOPE-world-creator-2026-11-09.md`. Triggered by Lens Tester 2 live note: typing `' 12'` into the draft name field moved the caret and produced `'12QA…'`.

---

## 1) Name-field caret jump / leading space eaten → `'12QA…'`

### Live symptom (LT2)

Typing a leading space then digits (`' 12'`) into the world name field while the value already started with a QA fixture prefix (e.g. `QA…`) ended as **`12QA…`**: the space disappeared and the digits were glued to the front of the prior name (caret effectively reset to the start of the trimmed value).

### Controlled input + blur persist + server trim + full refresh

Rules-tab name field (`concord-frontend/components/world-creator/DraftEditor.tsx:375–379`):

```375:379:concord-frontend/components/world-creator/DraftEditor.tsx
            <label className="text-sm font-medium text-stone-300">World name</label>
            <input value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              onBlur={e => run('draft-update', { id: draftId, name: e.target.value })}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100" />
```

- Value is **fully controlled** by `draft.name`.
- `onChange` writes through a **stale object spread** (`{ ...draft, name }`), not a functional `setDraft(d => …)` update (`:377`).
- `onBlur` always goes through `run('draft-update', …)` (`:378`).

`run` **always** re-fetches the whole draft after a successful macro (`DraftEditor.tsx:77–83`):

```77:83:concord-frontend/components/world-creator/DraftEditor.tsx
  const run = useCallback(async (name: string, params: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    const r = await lensRun('world-creator', name, params);
    setBusy(false);
    if (!r.data?.ok) { setErr(r.data?.error || `${name} failed`); return false; }
    await refresh();
    return true;
  }, [refresh]);
```

`refresh` replaces local state from the server (`:64–66`):

```64:66:concord-frontend/components/world-creator/DraftEditor.tsx
  const refresh = useCallback(async () => {
    const r = await lensRun<{ draft: Draft }>('world-creator', 'draft-get', { id: draftId });
    if (r.data?.ok && r.data.result?.draft) setDraft(r.data.result.draft);
```

Server name normalisation on `draft-update` (`server/domains/world-creator.js:41`, applied at `:290`):

```41:41:server/domains/world-creator.js
  const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
```

```290:290:server/domains/world-creator.js
      if (params.name != null) { const n = clean(params.name, 64); if (n.length >= 3) draft.name = n; }
```

`clean` **trims** leading/trailing whitespace before persist. The subsequent `refresh()` feeds that trimmed string back into the controlled input.

### Reproduction sequence (matches `'12QA…'`)

1. Draft name is already `QA…` (QA fixture prefix). Caret at index 0.
2. Type space → local controlled value briefly ` QA…`.
3. Blur (or any other `run()` that `refresh()`es while the field had been blurred / lost focus) → `draft-update` → `clean()` → stored name `QA…` (space dropped) → `refresh()` sets `draft.name` to `QA…`.
4. Controlled input re-renders shorter by one character; browser caret resets to the start of the new value.
5. Type `1` then `2` → `1QA…` then **`12QA…`**.

Same class of bug if a **concurrent** `run()`/`refresh()` from another control (biome click, prop-move failure refresh, playtest-check, etc.) lands while the user is mid-edit with a leading space: stale `onChange` spread (`:377`) can also clobber in-progress keystrokes against the post-trim server draft.

### Not the primary cause (ruled down)

- **Create gallery input** (`DraftGallery.tsx:97–98`) is controlled with `setNewName(e.target.value)` and only trims at submit (`:76`) — does not refresh mid-keystroke; weaker match for an already-prefixed `QA…` value.
- **Digit hotkeys `1`/`2`** (`app/lenses/world-creator/page.tsx:41–50`) call `setEditingDraft(null)` and would **unmount** the editor if the form guard failed — different symptom (leave editor), not `12QA…`. `useLensCommand` skips INPUT unless `global` (`hooks/useLensCommand.ts:147–154`). Still worth live-checking, but the trim+refresh path explains this exact string.

### Suggested fix direction (not implemented)

- Do not `trim()` on every blur persist before the user finishes editing, **or** trim only for validation while keeping display value stable until explicit Save.
- After `draft-update`, apply the returned draft patch **without** full `refresh()` while focus is in the name field, **or** skip `refresh()` for name-only updates and trust the local controlled value.
- Change `onChange` to functional updates: `setDraft(d => d ? { ...d, name: e.target.value } : d)`.
- Optionally preserve `selectionStart`/`selectionEnd` across controlled updates if normalisation remains.

**Ticket candidate:** FIX-world-creator-caret-001 (name controlled input + `clean().trim()` + `run→refresh` caret reset).

---

## Related scope pointers

- Caps / draft-update short-name silent ignore: `SCOPE-world-creator-2026-11-09.md` validation hints.
- RC1 digits `1`/`2` (no bare letters): same SCOPE hotkeys section.
