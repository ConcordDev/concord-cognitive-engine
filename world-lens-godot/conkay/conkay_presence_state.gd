class_name ConKayPresenceState
extends RefCounted
## ConKayPresenceState — R5/E22 "ConKay spatial mode" pure state derivation.
##
## This is NOT a new agent. It is the SAME ConKay identity the web widget
## (concord-frontend/components/conkay/widget/ConKayWidget.tsx) already
## renders, given a spatial presence in the Godot Hub — so the two facts this
## module classifies are deliberately narrow: only facts that are genuinely
## TRUE ACROSS DEVICES for one user account, never anything that only makes
## sense inside one browser tab.
##
## ── What's real and cross-device (rendered here) ───────────────────────────
##   1. "busy" — a real macro/brain call ConKay itself initiated is currently
##      in flight. Server-observable: `/api/lens/run` already emits real
##      `macro:started`/`macro:completed` events to the caller's `user:<id>`
##      room whenever the request carries a ConKay correlation id
##      (x-conkay-run-id / body.__runId — see ConKayOverlay.tsx's `newRunId`),
##      and that room is ALREADY mirrored to a connected Godot client via
##      server.js's realtimeEmit `{ userId }` branch -> _godotGatewayEmitter.
##      No new server event was needed for this fact — see
##      docs/GODOT_PROTOCOL.md and server/lib/event-shapes.js's existing
##      macro:started/macro:completed entries.
##   2. "tier" — the capability tier (proven/flagged/reasoned/unverified,
##      the exact vocabulary concord-frontend/components/common/
##      CapabilityBadge.tsx renders) of ConKay's LAST completed verification.
##      This one genuinely had no realtime event before this unit — see
##      server/lib/conkay-verdict-bridge.js (new) + the new `conkay:verdict`
##      event this unit adds to server/lib/event-shapes.js, reusing the SAME
##      userId-scoped emit spine as (1).
##
## ── What's deliberately excluded (and why) ──────────────────────────────────
## ConKayWidgetState's other two values — "listening" (STT mic active) and
## "speaking" (TTS audio playing) — are real, but they are PHYSICALLY LOCAL
## to whichever browser tab/device is doing the capturing/playback right now
## (concord-frontend/components/conkay/conkayAttentionStore.ts). No server
## event carries them today, and inventing one would mean broadcasting "is
## THIS device's microphone active" into a completely separate native
## process as if it were a fact about the user's assistant in general — that
## would be presenting one device's local I/O state as if it were the
## account's shared truth, which is the opposite of "honest by
## construction." Likewise the overlay's `open` boolean (is the FULL
## ConKayOverlay surface open in a browser tab) is UI chrome local to that
## tab, not a fact about ConKay itself worth a shared spatial cue. So the
## Godot presence only ever shows `busy` + `tier` — real, per-account facts,
## nothing device-local dressed up as shared state.

## Discrete visual states this module classifies. `THINKING` always wins
## over whatever the last verdict tier was — mirrors
## conkayAttentionStore.ts's own documented priority rule (busy outranks
## voice state) for the identical reason: a call is in flight right now,
## which is more current information than a stale prior verdict.
const STATE_IDLE := "idle"
const STATE_THINKING := "thinking"
const STATE_PROVEN := "proven"
const STATE_FLAGGED := "flagged"
const STATE_REASONED := "reasoned"
const STATE_UNVERIFIED := "unverified"


## Applies one `macro:started`/`macro:completed` event to a Dictionary used
## as a SET of in-flight run ids (keys only; values are unused placeholders).
## Returns a NEW dictionary — never mutates `inflight` in place, so a caller
## holding a reference to the old value sees it unchanged (matches the
## immutable-update style `avatar_manager.gd`-family controllers use for
## their own bookkeeping dictionaries). An event with no runId is a no-op:
## never fabricates a run id to track.
static func apply_macro_event(inflight: Dictionary, evt: String, run_id: String) -> Dictionary:
	var out := inflight.duplicate()
	if run_id.is_empty():
		return out
	if evt == "macro:started":
		out[run_id] = true
	elif evt == "macro:completed":
		out.erase(run_id)
	return out


## True iff at least one real macro call this session has observed is still
## in flight (started, no matching completed yet).
static func is_busy(inflight: Dictionary) -> bool:
	return not inflight.is_empty()


## Collapses (busy, tier) into exactly one discrete visual state. `tier` must
## be one of the four CapabilityBadge tier strings ("proven"/"flagged"/
## "reasoned"/"unverified") or empty string ("no verdict has arrived yet in
## this session") — an empty/unrecognized tier degrades to STATE_UNVERIFIED,
## the same honest-absence default CapabilityBadge itself uses for a missing
## verdict. Never invents a "proven" default.
static func visual_state(busy: bool, tier: String) -> String:
	if busy:
		return ConKayPresenceState.STATE_THINKING
	match tier:
		"proven":
			return ConKayPresenceState.STATE_PROVEN
		"flagged":
			return ConKayPresenceState.STATE_FLAGGED
		"reasoned":
			return ConKayPresenceState.STATE_REASONED
		_:
			return ConKayPresenceState.STATE_UNVERIFIED


## Colors ported 1:1 from real Concord visual identity — never invented:
##   - THINKING: Tailwind amber-300 (#fcd34d), the exact color
##     ConKayWidget.tsx's `border-t-amber-300/80` thinking-ring uses.
##   - PROVEN / FLAGGED / REASONED: Tailwind emerald-400 (#34d399) /
##     rose-400 (#fb7185) / amber-400 (#fbbf24) — the exact three colors
##     CapabilityBadge.tsx's TIER_STYLE table uses for those tiers.
##   - IDLE / UNVERIFIED: Tailwind cyan-300 (#67e8f9), ConKayWidget.tsx's own
##     `text-cyan-300` core-glyph fill color — ConKay's resting identity
##     color, not a new "unverified gray" (CapabilityBadge uses zinc-500 for
##     its own text, but ConKay's idle/no-verdict-yet resting state is
##     already cyan everywhere else in this codebase; re-using zinc here
##     would read as two different "nothing to report" colors for the same
##     fact depending on which surface you're looking at).
static func color_for_state(state: String) -> Color:
	match state:
		ConKayPresenceState.STATE_THINKING:
			return Color(0.988, 0.827, 0.302)  # amber-300
		ConKayPresenceState.STATE_PROVEN:
			return Color(0.204, 0.827, 0.600)  # emerald-400
		ConKayPresenceState.STATE_FLAGGED:
			return Color(0.984, 0.443, 0.522)  # rose-400
		ConKayPresenceState.STATE_REASONED:
			return Color(0.984, 0.749, 0.141)  # amber-400
		_:
			return Color(0.404, 0.910, 0.976)  # cyan-300 (idle / unverified)
