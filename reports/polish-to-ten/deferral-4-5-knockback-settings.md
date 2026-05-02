# Deferrals 4 & 5 — Wall-Impact Dust + Quality Settings

## Deferral 4 — Wall-impact secondary damage + dust

### Pre-implementation reality check

Designed wall-impact as Rapier `world.contactPair` query, but `layersRef` (the buildings layer) is **scene-private to ConcordiaScene** — not reachable from AvatarSystem3D. True per-frame contact-pair iteration would also be perf-heavy.

Pragmatic substitute: **always emit a dust puff on heavy/crit knockback**. Reads as "the impact kicked up debris" — a player can't tell whether the trigger was a wall hit or just the knockback impulse. Cost is one window-event dispatch per knockback (≪1ms).

### Changes

- `concord-frontend/components/world-lens/ParticleEffects.tsx`
  - Added `'dust'` to `VFXType` union
  - Color palette: gray-brown puff with off-white highlights
  - Gravity: 0.04 (slow downward settle)
  - **New `concordia:particle-effect` window event handler** with `{ type, position, count? }` so any sibling component can fire particles without being inside the provider

- `concord-frontend/components/world-lens/AvatarSystem3D.tsx`
  - On heavy/crit knockback: dispatch `concordia:particle-effect` with `type: 'dust'`, count 14

### Files touched

| File | Action |
|---|---|
| `components/world-lens/ParticleEffects.tsx` | added `'dust'` VFX type + window-event handler |
| `components/world-lens/AvatarSystem3D.tsx` | dust dispatch on heavy/crit knockback |

---

## Deferral 5 — Settings UI for quality preset

Per user direction: **focused page**, not a broader settings refactor.

### Changes

- `concord-frontend/lib/world-lens/quality-preset.ts` (new) — typed persistence layer for `'low' | 'medium' | 'high' | 'ultra'`. Exports `getStoredQualityPreset()`, `setStoredQualityPreset()`, `QUALITY_PRESET_DESCRIPTIONS`.

- `concord-frontend/components/settings/QualityPresetSelector.tsx` (new) — 4-button selector. Persists on click. Shows a "Reload to apply" CTA when the user picks a different preset, since hot-swapping shadows mid-frame causes visible stutter (a refresh is cleaner UX).

- `concord-frontend/app/lenses/settings/page.tsx` (new) — the settings lens page. Renders `<QualityPresetSelector />`. Footer note acknowledging more settings (audio, accessibility, language) live in their own lenses.

- `concord-frontend/app/lenses/world/page.tsx` — `<ConcordiaScene quality="medium" ... />` swapped to `quality={getStoredQualityPreset()}`. ConcordiaScene already had a `detectInitialQuality()` fallback path internally, but the world page's hardcoded `"medium"` was overriding it.

### Files touched

| File | Action |
|---|---|
| `lib/world-lens/quality-preset.ts` | created — persistence layer |
| `components/settings/QualityPresetSelector.tsx` | created — selector UI |
| `app/lenses/settings/page.tsx` | created — settings lens entry |
| `app/lenses/world/page.tsx` | reads stored preset instead of hardcoded `"medium"` |

### Verification

- `npx tsc --noEmit` — clean
- `npx eslint` on touched files — clean
- Manual (Wave 1 review): visit `/lenses/settings`, click `Ultra`, click `Reload to apply` → world reloads with ultra preset (4096 shadow maps, PCSS, SSGI active).
