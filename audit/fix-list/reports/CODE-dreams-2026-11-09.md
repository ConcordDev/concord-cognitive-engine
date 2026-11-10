# Dreams code findings (read-only) — 2026-11-09

Source tip assumed `dae9e10a6`. **No files/DB/services modified.** Code-only; not live-proven.

Companion to `SCOPE-dreams-2026-11-09.md`. Triggered by Lens Tester 1 live FAIL notes: multi-tag entry saved only `qa1`; timeline groups days in UTC not local.

---

## 1) Multi-tag typing (`qa1, qa2`) saved only `qa1`

### Tag editor path (parsing is not the truncator)

Client save (`concord-frontend/components/dreams/DreamReader.tsx:111–116`):

```111:116:concord-frontend/components/dreams/DreamReader.tsx
  const saveTags = async () => {
    setBusy(true);
    const tags = tagDraft.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('dreams', 'tag', { dreamId, tags });
    if (r.data.ok) { await load(); onChanged?.(); }
    setBusy(false);
```

- Input is a plain controlled `<input>` with `onChange` → `setTagDraft` only — **no** `onKeyDown`, **no** auto-save on comma/space (`:242–247`).
- Placeholder documents comma-separated tags (`:246`).
- Split on `,` would turn `"qa1, qa2"` into `["qa1","qa2"]` if that full string is in `tagDraft` at click time.

Server replace (`server/domains/dreams.js:376–396`):

- Accepts `input.tags` array; lowercases/trims; drops empty / `>32` chars; dedupes; **`.slice(0, 12)`** (`:388–391`).
- `"qa1"` / `"qa2"` both pass. Silent 12×32 caps do **not** explain dropping the second short tag.
- Returns `{ ok: true, dreamId, tags }`; detail re-reads tags from the per-user Map (`:306`).

**Conclusion:** neither the tag-input parser nor the server tag macro inherently keeps only the first tag when the full comma-separated draft is submitted.

### Hotkeys (RC1) — digits yes; comma/space no

Dreams `useLensCommand` (`app/lenses/dreams/page.tsx:58–60,88–97`):

| Key | Action |
|-----|--------|
| `1` | Recent tab |
| `2` | Search & Timeline tab |
| `n` | Read latest dream |

- **Bare comma:** not a Dreams command.
- **Bare space:** not a Dreams command.
- **Bare digits `1` / `2`:** **yes — RC1 class** (same as SCOPE-dreams).
- Form guard: `useLensCommand.ts:43–49,147–154` returns without `preventDefault` when focus is INPUT/TEXTAREA/SELECT/`contentEditable` and command is not `global`. Dreams commands do **not** set `global`. LT1 reported single-tag letter typing did not steal — consistent with the guard holding for that session.

If the guard **misses** while typing `qa2`, key `2` would `preventDefault` and `setTab('library')` (`page.tsx:94`). DreamReader stays mounted (`openDreamId` overlay is outside the tab conditional, `:193–199`), so the draft should survive a tab switch — but the swallowed `2` would leave draft like `qa1, qa` (still two tags on save), not `qa1` alone.

### Most likely code-led explanation (still needs live repro)

1. **Not the comma-split parser** — it preserves multiple tags when `tagDraft` holds them.
2. **Not a comma/space hotkey** — none registered.
3. **RC1 digit hotkeys are present** and are the only keyboard interaction that can interfere with typing `qa1, qa2…` key-by-key; a guard miss on `1`/`2` can interrupt entry (and on `1` could `preventDefault` the digit into the field). Alone, code does **not** show an automatic save-of-first-tag.
4. Practical live hypothesis for "only `qa1` saved": Save was clicked (or an interrupted flow left the field) while `tagDraft` was still `"qa1"` / `"qa1,"` — e.g. after a hotkey distraction — rather than a server-side drop of `qa2`. **Repro:** focus tag input → type `qa1, qa2` slowly → DevTools confirm input value → Save → check network payload `tags` array.

Also noted (related UX, not the truncator): Save tags has **no success toast** (`saveTags` only reloads).

---

## 2) Timeline groups days by UTC, not local time

Confirmed in server timeline macro (`server/domains/dreams.js:475–521`):

```501:501:server/domains/dreams.js
        const day = new Date(Number(row.composed_at) * 1000).toISOString().slice(0, 10);
```

- `Date#toISOString()` is always **UTC**; `.slice(0, 10)` yields a UTC `YYYY-MM-DD` bucket.
- Same UTC day key in `busiest-night` (`:568`) — comment at `:525` even says "calendar days, UTC".
- UI (`DreamLibrary.tsx:86–100,251–254`) consumes server `days[].day` as-is for `TimelineView` — no local tz reinterpretation.

Evening local dreams near midnight can land on the **next/previous UTC date**. Matches LT1 FAIL.

**Fix direction (builders — do not apply here):** bucket with local tz (explicit offset or `Intl` / temporal) or return epoch + let the client group by `timeZone`; document UTC if product intends UTC nights.

---

## Summary

| Finding | Cause in code | Cite |
|---------|---------------|------|
| Multi-tag → only `qa1` | **Not** tag `split(',')` / server 12×32 filter. Comma/space are not hotkeys. Digit `1`/`2` are RC1 hotkeys with input guard; truncator not fully explained by code alone — repro network `tags` payload. | `DreamReader.tsx:111–116,242–247`; `dreams.js:388–391`; `page.tsx:88–97`; `useLensCommand.ts:154` |
| Timeline day groups | **UTC** via `toISOString().slice(0,10)` | `dreams.js:501` (and `:568` busiest-night) |

Code-only; not live-proven.
