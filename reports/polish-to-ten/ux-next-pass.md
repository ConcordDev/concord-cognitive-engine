# UX Next-Pass Work — Trade Initiation, Party Creation, Nav, EvoAsset Building Signal

The previous commit (`ux-wire-fixes.md`) closed all 8 audit gaps end-to-end. This commit closes the 4 follow-up items the report flagged as "next-pass UX":

1. Trade *initiation* sender side
2. Party *creation* + *invite* sender side
3. Nav surface for `/lenses/world-creator/anomalies`
4. EvoAsset interaction signal from passively-rendered buildings

All four are pure UX surface additions — no backend changes, no architectural shifts. Each one was already wired on the receiver side; this commit gives the user a way to actually trigger the sender side.

## Pre-build sweep findings

Per the user's "find before build" rule, ran a sweep first. Highlights:

- `IsometricEngine.tsx` already supports per-avatar `onPlayerClick` — but the world page uses ConcordiaScene + AvatarSystem3D, not IsometricEngine. Per-avatar 3D click would require deeper plumbing.
- No existing in-world context-menu / radial-menu pattern in the codebase.
- `useUIStore` doesn't have a centralized modal stack — components own their own visibility state.
- `BuildingDTU` has no `assetUrl` field; **buildings are procedurally generated, not loaded from GLBs.** So `resolveAssetUrl` migration into the building loader is moot — the right EvoAsset signal for buildings is `recordAssetInteraction`, not `resolveAssetUrl`.
- Lens registry at `lib/lens-registry.ts` requires every lens route to have an entry. Sidebar reads from it.

So:
- **Trade + party initiation**: build a small floating Social Action Panel rather than thread per-avatar 3D click handlers
- **EvoAsset building signal**: `recordAssetInteraction` in BuildingRenderer3D (passive render), not `resolveAssetUrl` (no GLB loader exists to wire into)

## Changes

### `components/world-lens/SocialActionPanel.tsx` (new)

Floating bottom-right button (Users icon) → opens a 288px-wide panel above with two sections:

- **My party**: shows current party state (loading / active / none). If none, exposes a "Create" button that calls `POST /api/parties`. When `hasParty === true`, the existing PartyHUD (bottom-left) shows the membership detail.
- **Nearby players**: lists `nearbyPlayers` (filtered to exclude self). Each row has two buttons:
  - **Trade** — calls `POST /api/player-trade/initiate { recipientId }`. Toast feedback. The recipient's SocialOverlay already pops a TradeWindow on `trade:request` (the receiver side that was wired in the previous commit).
  - **Invite** — calls `POST /api/parties/me` to fetch the party id, then `POST /api/parties/:id/invite { invitedId }`. Disabled when no party exists; tooltip explains.

Per-action `busy` state shows `…` on the relevant button while the request is in flight. All errors surface as toasts via `useUIStore.getState().addToast`.

### `components/world-lens/SocialOverlay.tsx`

Mounts `SocialActionPanel` at the end of its overlay tree. Accepts a new `nearbyPlayers` prop (optional, defaults to `[]`) and threads it through.

### `app/lenses/world/page.tsx`

`<SocialOverlay>` now receives `nearbyPlayers={otherPlayers.map((p) => ({ id: p.id, name: p.name }))}`. Same `otherPlayers` array the AvatarSystem3D and other components already use — no new state, no new fetch.

### `lib/lens-registry.ts`

New entry for the anomaly viewer:

```ts
{
  id: 'world-creator/anomalies',
  name: 'Anomaly Review',
  icon: AlertTriangle,
  description: 'Inventory anomaly transparency log + per-world creator review',
  category: 'governance',
  showInSidebar: false,
  showInCommandPalette: true,
  path: '/lenses/world-creator/anomalies',
  order: 13.5,
  keywords: ['anomaly', 'audit', 'transparency', 'world creator', 'inventory'],
}
```

`showInSidebar: false` because it's an opt-in tool, not a primary workspace. `showInCommandPalette: true` so any user can find it via Cmd-K with the listed keywords. Order 13.5 places it between the existing governance entries (council = 13, anon = 14).

### `components/world-lens/BuildingRenderer3D.tsx`

EvoAsset passive-presence interaction added in the existing `useEffect` that builds all building meshes. Each rendered building gets `recordAssetInteraction('authored', b.id, 'render', 0.1)`. Weight 0.1 deliberately low — passive presence shouldn't dominate over active engagement (click 1.0, dialogue 1.5, combat hit 1.0, crit 2.0). Together they create a layered signal where actively-engaged buildings rise faster than just-visible ones, and ignored-by-everyone buildings get effectively zero score.

Note documented in the commit: building meshes are procedural, not GLB-loaded, so `resolveAssetUrl` → mesh-swap migration is out of scope. EvoAsset's value for buildings comes via the procedural refinement passes (subdivision, wear, etc.) feeding the registry, gated by the Atlas pipeline. The interaction signal is the input that's now wired.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/SocialActionPanel.tsx` | created — floating panel, trade + party initiation |
| `concord-frontend/components/world-lens/SocialOverlay.tsx` | mounts SocialActionPanel + threads nearbyPlayers prop |
| `concord-frontend/app/lenses/world/page.tsx` | passes `otherPlayers` as `nearbyPlayers` to SocialOverlay |
| `concord-frontend/lib/lens-registry.ts` | new `world-creator/anomalies` entry |
| `concord-frontend/components/world-lens/BuildingRenderer3D.tsx` | EvoAsset interaction signal on render |

## Verification

- `npx tsc --noEmit` — clean (only pre-existing `openNPCDialogue` errors remain, untouched)
- `npx eslint` — clean on touched files (1 pre-existing warning in BuildingRenderer3D about a useCallback dep array, unrelated to this change)

## End-to-end flows now usable by the player

**Trade end-to-end**: open Social Action Panel (Users icon, bottom-right) → see nearby players → click Trade → recipient's TradeWindow pops (via `trade:request` socket → SocialOverlay listener) → both drag inventory items into offers (TradeInventorySidebar drag-drop) → both flip Ready → atomic execute via `_executeTrade` (re-verifies ownership inside `db.transaction`) → both see `trade:complete` → fanfare-short SFX (Phase 18 milestone trigger) → items move atomically.

**Party end-to-end**: Social Action Panel → My party "Create" → party row created with caller as leader → panel updates → click Invite next to any nearby player → `party:invite` event → invitee sees toast (SocialOverlay listener) → if they accept (current path is via direct API call until a dedicated invite-accept toast button is added) → join → both see `party:member_joined` → PartyHUD updates bottom-left.

**Anomaly viewer end-to-end**: Cmd-K → search "anomaly" → command palette routes to `/lenses/world-creator/anomalies` → page loads `/api/anomalies/public` (visible to all) and accepts a world ID for the world-creator section → server gates by `worlds.created_by`.

**EvoAsset signal end-to-end**: every building rendered fires a 0.1-weight `render` interaction → registry accumulates → heartbeat scheduler every 100th tick picks top-3 by score → runs next refinement pass → submits as pseudo-DTU through the Atlas 5-stage gate → on VERIFIED, the version is promoted and `quality_level` bumps. Frequently-rendered buildings (player hubs, popular districts) rise faster than ignored ones.

## Open follow-ups (small, non-blocking)

- **Party invite toast accept button**: today the invitee toast is informational; accepting still requires hitting `POST /api/parties/invites/:inviteId/accept` directly. A future pass could add an inline Accept button in the toast.
- **Per-avatar 3D click**: the SocialActionPanel uses a player list because per-avatar 3D click handlers in AvatarSystem3D would require extending its prop surface. Could be done in a future pass for a more "click-the-avatar" feel.
- **Building mesh swap from EvoAsset variants**: if a future pass migrates buildings from procedural to GLB-loaded, the `resolveAssetUrl` consumption path can be added at that mesh-load callsite. Today's procedural buildings benefit from the EvoAsset signal via the procedural refinement passes (subdivision/wear) that feed the registry, not via mesh-swap.

These are all small UI affordances or larger architectural decisions, not gaps in what the substrate can do today.
