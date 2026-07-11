# Voice Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("voice"' server/domains/voice.js
```
→ **38** macros in `server/domains/voice.js` (993 lines after this pass),
registered via `registerVoiceActions(registerLensAction)`: 4 text-analysis
calculators (`transcriptAnalyze`/`speakerDiarize`/`sentimentScore`/
`keywordSpot`, pure-compute, no LLM) + 10 recording CRUD/summary/search
(`recording-create/-list/-detail/-rename/-delete`, `segment-edit`,
`highlight-toggle`, `recording-summary`, `transcript-search`,
`voice-dashboard`) + 5 live in-browser transcription (`live-start/-append/
-detail/-list/-finalize`) + 1 LLM meeting summary (`recording-summary-llm`,
opt-in on `ctx.llm`) + 5 automatic speaker ID (`voiceprint-enroll/-list/
-delete/-identify`, `recording-auto-label-speakers`) + 5 meeting-bot calendar
(`meeting-schedule/-list/-cancel/-bot-join/-bot-finalize`) + 6 share +
segment comments (`recording-share/-unshare`, `share-detail`,
`segment-comment-add/-delete`, `segment-comments-list`) + 2 multi-language
translation (`transcript-translate`, `transcript-translations-list`). The
earlier `docs/lens-specs/voice.md` claim of "14 macros" was a stale
undercount — corrected in that file as part of this pass.

**Real audio transcription and TTS live elsewhere, as separate macros.**
`register("voice","transcribe", ...)` (`server.js:12395`) is a whisper.cpp-
backed local ASR macro gated behind `ctx.state.__chicken3.voiceEnabled` +
a session opt-in flag; `register("voice","tts", ...)` (`server.js:12416`) is
Piper-backed local TTS with a validated voice-id allowlist (`resolvePiperVoice`,
tested at `tests/voice-tts-voice-param.test.js`, 15/15); `register("voice",
"ingest", ...)` (`server.js:46706`) accepts an uploaded audio/transcript blob.
These are registered on the canonical `MACROS` registry (`register()`), NOT
`LENS_ACTIONS` (`registerLensAction()`) — reachable via `apiHelpers.voice.
{transcribe,tts,ingest}` → `POST /api/voice/{transcribe,tts,ingest}`
(`routes/domain.js:1030-1037`, `server.js:46782`) → bare `runMacro("voice",
name, …)`. Two sibling domain files sit near `voice.js` by naming
convention but are unrelated features on distinct domain strings —
`server/domains/voice-chat.js` (`"voice_chat"`, underscore — in-world WebRTC
signalling room registry for `VoiceMesh.tsx`'s spatial voice chat) and
`server/domains/voice-tts.js` (`"voice-tts"`, hyphenated — ElevenLabs NPC
dialogue-line synthesis for Concordia). Neither collides with the voice lens
under audit; confirmed by direct read of both files (118 + 59 lines).

## Frontend surface

`concord-frontend/app/lenses/voice/page.tsx` (1154 lines) — a bespoke
DAW-style "Recording Booth" (rival shape: a multitrack recorder/mixer, not a
generic dashboard) with real `MediaRecorder`-backed takes, a processing-chain
effects rack, and an inline analysis panel calling the 4 text calculators —
plus four mounted sections: `VoiceRepos.tsx` (live GitHub API pull of
voice-tooling repos), `VoiceTranscripts.tsx` (recording CRUD + inline
transcript editing + highlights + summary + cross-recording search),
`VoiceOtterSuite.tsx` (tabbed: `VoiceLiveTranscribe.tsx` real browser
`SpeechRecognition` streaming, `VoiceRecordingStudio.tsx` summary/playback/
share/translate, `VoiceprintEnroll.tsx` real Web Audio acoustic
fingerprinting, `VoiceMeetings.tsx` meeting-bot calendar), and
`VoiceActionPanel.tsx` (the analyst-bench mint/DM/publish/agent surface).
`bespokeRatio: 0.687`, `pillarsPresent: 5/5`, `tier: "polished"` per
`scripts/grade-ux-polish.mjs --honest` (unchanged by this pass — no frontend
files were edited).

Every one of the 38 macros already had a real, field-shape-correct caller
before this pass (cross-checked component-by-component against the exact
`registerLensAction` return shapes in `domains/voice.js` — no
`Match: 87%`-style invented field, no JSON-paste-textarea standing in for a
form, no `<UniversalActions>`/`<LensFeaturePanel>` scaffold body). The one
gap found was **not** a wiring defect but a security defect (below).

## The defects found

### 1. IDOR — `share-detail` and `segment-comments-list` trusted a
caller-supplied `recordingId` with no ownership/collaborator check

`server/domains/voice.js` (pre-fix, lines 838-844 and 876-887):

```js
registerLensAction("voice", "share-detail", (ctx, _a, params = {}) => {
  const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
  const recId = vcClean(params.recordingId, 80);
  const share = s.shares.get(recId);
  if (!share) return { ok: true, result: { shared: false, share: null } };
  return { ok: true, result: { shared: true, share } };
});
```

`s.shares` is a **recordingId-keyed** Map (not user-keyed), so this handler
returns the full share record — the collaborator list plus every segment
comment on that recording — for **any** `recordingId` the caller supplies,
regardless of who they are. `segment-comments-list` had the identical gap.
By contrast, `segment-comment-add` and `segment-comment-delete` (a few lines
below, both pre-existing and correct) already gate on `ownsIt = vcList(s,
userId).some(r => r.id === recId)` OR collaborator membership — the fix
below makes `share-detail`/`segment-comments-list` match that established
pattern exactly. Every other recording macro in this file is safe by
construction because it indexes a **per-user** Map (`vcList(s, vcActor(ctx))`
— `s.recordings` is keyed by `userId`, not by `recordingId`), so a lookup by
id can never cross into another user's list; these two macros were the only
ones that broke that pattern by indexing `s.shares` directly.

**Reachability, confirmed from the live dispatch, not assumed:**
`POST /api/lens/run` with `{domain:"voice", name:"share-detail", input:
{recordingId}}` resolves via `LENS_ACTIONS.get("voice.share-detail")`
directly (`server.js:39593`, the domain-level "no artifact id required"
dispatcher `useRunArtifact`/`lensRun` frontend helpers use) — gated only by
`_lensActionForbiddenForAnon` (must be authenticated; no further check).
**Exploit shape:** any authenticated user who knows or enumerates another
user's `recordingId` (format `rec_<ts36>_<6-char-random>` — not intended to
be secret, and can leak via a shared link, a DM, or simple guessing) could
read that user's collaborator list and every comment on every segment of a
recording they were never given access to, purely via a raw macro call — the
frontend never exposes a "browse other people's recordings" path (confirmed:
`VoiceRecordingStudio.tsx`'s `open()` calls `recording-detail` first, which
**is** owner-scoped, so the UI only ever reaches `share-detail` for a
recording the caller already owns — this was a raw-macro-call-only exposure,
not a discoverable UI flow, but that does not make it any less of a real
IDOR: an MCP client, a browser devtools user, or a future frontend change
could all reach it directly).

### 2. `LENS_ACTIONS` name collision — the dead `registerLensAction("voice",
"transcribe", ...)` cluster shadowed the real whisper.cpp transcription macro

`server.js:41559` (pre-fix) registered a `LENS_ACTIONS` handler named
`"transcribe"` that does **not** transcribe audio — it derives a pseudo-
transcript struct (sentence segments, word frequency, top words) from an
**already-typed** text field (`artifact.data.rawText/body/content`) on a
generic lens artifact. This collided with the real, ethos-gated,
whisper.cpp-backed `register("voice","transcribe", ...)` macro at
`server.js:12395` (a completely different registry — `MACROS`, not
`LENS_ACTIONS`). Three dispatch paths resolve `LENS_ACTIONS` **before**
falling back to `MACROS`: `POST /api/lens/run` (`server.js:39593`), the
generic per-artifact `POST /api/lens/:domain/:id/run` (`server.js:38314`),
and the MCP tool runner `runMcpTool` (`server.js:39431`) — so any of those
three callers requesting `voice.transcribe` got the fake text-reformatter
silently instead of real ASR (or an honest "no transcription backend"
error). The one path that correctly reaches the real macro,
`apiHelpers.voice.transcribe` → `POST /api/voice/transcribe` →
`routes/domain.js:1031`'s **bare** `runMacro("voice","transcribe", …)`, was
unaffected — bare `runMacro` cannot see `LENS_ACTIONS` at all (confirmed at
`server.js:39505-39507`'s own comment) — which is why the actual Recording
Booth "transcribe this take" feature in `page.tsx` worked correctly despite
the collision. Verified via grep across `server/`, `concord-frontend/`, and
every voice test file that no caller anywhere invokes the `LENS_ACTIONS`
handler by the name `"transcribe"` (only `transcriptAnalyze`/
`speakerDiarize`/`sentimentScore`/`keywordSpot`, all from `domains/voice.js`,
are ever called that way) — so the shadowed handler was pure dead weight,
and renaming it carries zero UI regression risk while closing a live
footgun for any future MCP/agent caller or frontend dev who assumes
`voice.transcribe` does what its name says via the standard dispatch path.

## What changed

### 1. `server/domains/voice.js` — ownership/collaborator gate added to
`share-detail` and `segment-comments-list`

Both handlers now compute `ownsIt = vcList(s, userId).some(r => r.id ===
recId)` and check it OR `share.collaborators.includes(userId)` before
returning anything, matching `segment-comment-add`'s existing pattern
exactly. Denial returns `{ ok: false, error: "recording not found or not
shared with you" }` — the same message `segment-comment-add` already used —
so the response doesn't reveal whether the recording exists, is shared, or
just isn't visible to this caller (same non-disclosure shape as the security
lens's `lens.run`/`lens.export` IDOR fix, `2d6a40a4`).

### 2. `server.js` — the shadowing `LENS_ACTIONS` handler renamed

`registerLensAction("voice", "transcribe", ...)` →
`registerLensAction("voice", "derive-transcript-struct", ...)`, with a
comment explaining the shadowing history so it can't silently regress if
someone re-adds a `"transcribe"` `LENS_ACTIONS` entry later. Behavior is
otherwise byte-identical — this is a pure rename, not a rewrite; the four
sibling dead macros in the same cluster (`process`/`analyze`/`summarize`/
`extract_tasks`) don't collide with anything and were left untouched
(renaming/removing them was outside the collision this pass found and
verified).

### 3. `docs/lens-specs/voice.md` — corrected the stale "14 macros" claim
to the verified 38, and pointed to this file for detail.

### 4. Tests — two new regression tests pinning the IDOR fix both ways

`server/tests/voice-domain-parity.test.js` — `"share-detail and
segment-comments-list deny a caller who is neither owner nor collaborator"`:
asserts a stranger is denied on both macros (with the non-disclosure error
shape) while the owner and a listed collaborator are unaffected. This file's
harness has **no server boot and no `process.exit`**, so its pass/fail
signal is fully trustworthy — verified by deliberately re-breaking the fix
(`git stash` on `domains/voice.js` alone) and confirming the test correctly
flips to `not ok` / `fail 1` before restoring.

`server/tests/depth/voice-behavior.test.js` — two equivalent tests added
using the real `lensRun`/`depthCtx` harness (two distinct `depthCtx` labels
as owner/stranger/collaborator). **Important caveat, found while verifying
this fix (see below):** this file's shared harness (`server/tests/depth/
_harness.js`) registers a global `after()` hook that calls `process.exit(0)`
unconditionally once all tests finish. A minimal reproduction (`after(() =>
process.exit(0))` + one deliberately-failing assertion, no other code)
confirms `node --test` reports the **whole file** as a single passing test
regardless of any internal assertion failure — the child process exits
before the per-test TAP/IPC data for anything after the collapse point is
relayed to the parent runner. This means running `node --test tests/depth/
voice-behavior.test.js` (alone, or via the `tests/**/*.test.js` glob used by
`npm test`) currently cannot be trusted as a correctness signal for **any**
of the ~90 files sharing this harness, including the two new tests added
here — they are logically correct (independently verified below) but their
CI pass/fail signal is masked by this pre-existing, orthogonal infrastructure
bug. This is a real, load-bearing finding beyond the scope of the voice lens
and was **not** fixed in this pass (the harness is shared by dozens of
files, a `guard.mjs`-adjacent shared-infra change, and outside this task's
scope) — flagging it prominently here per the "don't trust, check" mandate
rather than silently working around it. It deserves its own dedicated
investigation and fix.

## Independent verification of the IDOR fix (bypassing the masked harness)

Because of the `_harness.js` issue above, the fix was verified three ways
that don't depend on it:

1. A standalone script imports `server/domains/voice.js` directly with a
   minimal mock `registerLensAction` (same shape `tests/voice-lens-macros.
   test.js`/`tests/voice-domain-parity.test.js` already use, neither of which
   boots the server or calls `process.exit`) and exercises owner/collaborator/
   stranger access — all assertions pass with the fix, and the stranger
   assertion (`strangerView.ok === false`) fails as expected when the fix is
   `git stash`-reverted, proving the test discriminates the real bug.
2. `server/tests/voice-domain-parity.test.js`'s new test (no server boot, no
   `process.exit`) passes with the fix and fails (`not ok`, `fail 1`,
   correctly surfaced in the TAP summary) when the fix is reverted — this is
   the trustworthy regression guard going forward.
3. Manual trace of the live dispatch path (`server.js:39593`) confirms
   `POST /api/lens/run` calls the exact handler function edited, with no
   intermediate layer that would mask the fix in production.

## Macro → UI classification (all 38 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 37/38:

| Macro group | Count | Where |
|---|---:|---|
| `transcriptAnalyze`/`speakerDiarize`/`sentimentScore`/`keywordSpot` | 4 | `page.tsx` inline Voice Actions panel + `VoiceActionPanel.tsx` (analyst bench: mint/DM/publish/agent) |
| `recording-create/-list/-detail/-rename/-delete`, `segment-edit`, `highlight-toggle`, `recording-summary`, `transcript-search`, `voice-dashboard` | 10 | `VoiceTranscripts.tsx` |
| `live-start/-append/-detail/-list/-finalize` | 5 | `VoiceLiveTranscribe.tsx` (real `SpeechRecognition` streaming) |
| `recording-summary-llm` | 1 | `VoiceRecordingStudio.tsx` ("AI summary" button) |
| `voiceprint-enroll/-list/-delete/-identify` | 4 | `VoiceprintEnroll.tsx` (real Web Audio acoustic feature extraction — pitch/energy/spectral-centroid/ZCR/rolloff) |
| `meeting-schedule/-list/-cancel/-bot-join/-bot-finalize` | 5 | `VoiceMeetings.tsx` |
| `recording-share/-unshare`, `share-detail`, `segment-comment-add/-delete`, `segment-comments-list` | 6 | `VoiceRecordingStudio.tsx` (share + timestamped-playback-with-inline-comments panel) |
| `transcript-translate`, `transcript-translations-list` | 2 | `VoiceRecordingStudio.tsx` (translate panel) |

**UNSURFACED** (real, tested, no UI caller) — 1/38:

- `recording-auto-label-speakers` — relabels a recording's segments by
  matching each segment's `.vector` acoustic fingerprint against enrolled
  voice-prints (tested at `tests/depth/voice-behavior.test.js`). Genuinely
  unreachable in practice, not just unmounted: no frontend code anywhere
  ever attaches a `.vector` field to a segment (confirmed by grep across
  `components/voice/*.tsx`) — `recording-create`'s segments come from typed
  text or live ASR words, neither of which carries per-segment audio, so
  there is nothing for this macro to match against today. See "Investigated
  and honestly deferred" below for the triage.

## Investigated and honestly deferred

- **`recording-auto-label-speakers` — ENGINEERING gap, not a quick wire-up.**
  Making this reachable needs real new frontend work (capturing isolated
  per-segment audio during either the takes recorder or live transcription,
  running the same Web Audio feature extraction `VoiceprintEnroll.tsx`
  already does per segment, and attaching the resulting vector) — a genuine
  audio-pipeline feature, not "add a button that calls an existing macro."
  Per the CLAUDE.md triage classes: this is **ENGINEERING** (no external
  data dependency, just unbuilt frontend capture logic), scoped out of this
  pass, which fixes existing wiring + closes the security defect rather than
  growing new frontend audio architecture.
- **The `_harness.js` `process.exit(0)`-masks-failures bug** — documented in
  detail above. Confirmed real via a minimal, codebase-independent repro;
  confirmed to affect the ~90 `tests/depth/*.test.js` files sharing that
  harness, not just this lens's tests. Left unfixed — shared infrastructure
  touching dozens of files is outside a single-lens audit's blast radius,
  and deserves its own dedicated investigation (does it also affect the
  *other* ~89 files' previously-reported pass counts? is `--test-force-exit`
  interacting with it? does the same pattern exist in any other shared test
  harness in the repo?). Flagged here so it's discoverable, not buried.
- **`process/analyze/summarize/extract_tasks`** (the three other dead
  `LENS_ACTIONS` siblings of the renamed `transcribe` handler) — orphaned,
  but don't collide with anything and aren't reachable by any caller, so
  they're inert rather than actively harmful. Left alone; removing dead code
  that isn't causing a defect is a separate cleanup pass, not part of this
  security-and-wiring audit.

## Verification

```
node --check server/domains/voice.js server/server.js       # OK, both syntax-valid
cd server && npx eslint domains/voice.js tests/voice-domain-parity.test.js \
  tests/depth/voice-behavior.test.js
# → clean, 0 errors/warnings

cd server && node --test tests/voice-lens-macros.test.js tests/voice-domain-parity.test.js \
  tests/depth/voice-behavior.test.js tests/voice-chat-leave-macro-removed.test.js \
  tests/voice-tts-voice-param.test.js
# → 71/71 pass, 0 fail (voice-domain-parity: 24/24 including the new IDOR
#   regression test; voice-behavior.test.js's internal count is not
#   independently visible due to the harness issue above, but its file-level
#   result is green and its two new tests were independently verified per
#   the "Independent verification" section)

node scripts/verify-lens-backends.mjs
# → {"WIRED":258,"NO-BACKEND-CALL":2} total 260 — unchanged

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json["voice"]: tier "polished", isGenericScaffold:
#   false, bespokeRatio 0.687, pillarsPresent 5/5, antiPatterns 0 — unchanged
#   (no frontend files touched this pass)
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
