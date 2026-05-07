# NEXT SESSION SPEC — Premium Lens Engines + Full Lens Audit

> **STATUS — HISTORICAL (as of 2026-05-06).** This spec is from a much earlier
> session. The branch `claude/audit-lenses-fix-warnings-HdWQ4` is no longer
> active (current branch is `claude/production-audit-macros-1alt5`). Most of
> the work described below has been completed: ~30+ lenses now have full
> production-grade implementations (CLAUDE.md), Monaco editor + react-markdown
> + Excalidraw + the music player are wired, the DAW engine is connected to
> its UI, etc. Test count of "1958 tests" is also stale — current is ~10,721
> passing. Keep this file as a record of the lens-engine remediation
> roadmap; do NOT use it as a current task list.

**Branch:** `claude/audit-lenses-fix-warnings-HdWQ4` (HISTORICAL)
**Status:** SUPERSEDED — most items completed

---

## Priority 1: Make 7 Core Lenses Best-in-Class

### The Problem
Most creative/media lenses have polished UI scaffolding but **missing engines**. Studio has a full DAW interface (piano roll, mixer, drum machine) but zero sound. Music has a player that doesn't play. Code uses a textarea. These 7 lenses are the revenue engines — they must work.

### Phase 1: Chat + Code (Highest Impact, Lowest Risk)

#### 1A. Chat — Markdown + Code Rendering
- **Problem:** `app/lenses/chat/page.tsx` line 1257 renders messages as raw `<p>` text
- **Fix:** Install `react-markdown`, `remark-gfm`, `rehype-highlight`
- Create `components/chat/MessageRenderer.tsx` with syntax-highlighted code blocks, GFM tables, styled blockquotes, copy button
- Replace raw `<p>` at line 1257 with `<MessageRenderer>`

#### 1B. Code — Monaco Editor
- **Problem:** `app/lenses/code/page.tsx` lines 877, 1241 use plain `<textarea>`
- **Fix:** Install `@monaco-editor/react`, create `components/code/MonacoWrapper.tsx`
- Lazy-load Monaco (2MB) with `next/dynamic ssr:false`
- Custom "Concord Dark" theme matching lattice palette
- Add `@xterm/xterm` terminal panel for run output

### Phase 2: Studio + Music (Core Creative Value)

#### 2A. Studio — Wire Existing Engine to UI
- **Key discovery:** `lib/daw/engine.ts` (987 lines) already has working Web Audio API:
  - `TransportEngine` — lookahead scheduler, metronome, loop, beat tracking
  - `SynthEngine` — polyphonic subtractive synth with oscillators, filters, ADSR
  - `DrumMachineEngine` — synthesized kick/snare/hihat/clap
  - `EffectsChainEngine` — EQ, compressor, reverb, delay, distortion, chorus
  - `MixerEngine` — per-channel gain/pan + master bus
  - 8 synth presets
- **Fix:** Verify/complete wiring between engine and UI components
  - PianoRoll click → `SynthEngine.noteOn/noteOff`
  - DrumMachine pad → `DrumMachineEngine.triggerPad`
  - Mixer faders → `MixerEngine` channel gains
  - Add Web MIDI input (~80 lines)
  - Add WAV export via `OfflineAudioContext` bounce

#### 2B. Music — Real Playback
- **Key discovery:** `lib/music/player.ts` (251 lines) is complete HTML5 Audio player with Web Audio analyser and Media Session API
- **Fix:** Wire UploadFlow to artifact API, wire track clicks to player, mount NowPlayingBar globally

### Phase 3: Social + Artistry (Network Effects)

#### 3A. Social — Infinite Scroll + DMs
- Feed page (1,523 lines) + social components (5,663 lines) already exist
- **Fix:** Add `useInfiniteQuery` + `react-virtuoso` (both already installed), build DM interface

#### 3B. Artistry — Canvas Drawing
- **Fix:** Install `@excalidraw/excalidraw` (single React component, dark mode built in)
- Mount in Artistry "Studio" tab, export to DTU via artifact API

### Phase 4: Film (Deepest Lift)

#### 4A. Film — Video Upload + Player + Timeline
- Wire video upload via artifact API, use existing UniversalPlayer
- Build clip timeline, add server-side FFmpeg concat

### New Dependencies
| Package | Lens | Size | License |
|---------|------|------|---------|
| `react-markdown` | Chat | ~50KB | MIT |
| `remark-gfm` | Chat | ~10KB | MIT |
| `rehype-highlight` | Chat | ~20KB | MIT |
| `@monaco-editor/react` | Code | ~2MB (lazy) | MIT |
| `@xterm/xterm` | Code | ~400KB | MIT |
| `@excalidraw/excalidraw` | Artistry | ~1.5MB (lazy) | MIT |
| `fluent-ffmpeg` (server) | Film | ~50KB | MIT |

---

## Priority 2: Full Lens Engine Audit (After the 7)

After fixing the 7 core lenses, audit ALL 175 lenses for the same "UI shell with no engine" pattern. Check every lens involving:

- **Media creation** (animation, photography, podcast, voice, ar, fractal, game, sim)
- **Real-time interaction** (collab, whiteboard, board, forum, debate)
- **External integrations** (import, export, ingest, integrations)
- **Data visualization** (graph, analytics, resonance, timeline)

### Specific lenses to check:
- `animation` — animates or just manages project data?
- `podcast` — records/plays audio or just metadata?
- `voice` — speech recognition or just voice notes?
- `ar` — renders 3D (Three.js in deps) or just project data?
- `game` — runs games or just design data?
- `sim` — simulates or just manages parameters?
- `whiteboard` — draws or just manages board data?
- `collab` — real-time editing or just tracks changes?
- `graph` — renders force graphs or just data?

---

## What Was Completed This Session

### Code Quality
- All 175 lenses field-audited, all mismatches fixed
- 1958 tests passing, 0 TS errors, 0 eslint no-explicit-any
- 42 new backend action handlers built across 14 domains
- 9 manifest macro mismatches + 2 domain naming mismatches fixed

### Chat System (5 root causes fixed)
- WebSocket crash bug, missing DTU context, DTU-title dump fallback, tools disabled, LLM_READY false positive
- Web search, token streaming, personality persistence, accelerated DTU promotion all wired

### Real-time Pipeline
- All 11 socket events wired (heartbeat, beacon, resonance, city streaming, etc.)
- Web DTU pipeline connected, city streaming integrated, ThoughtStream fixed

### Security & Ops
- DTU/lens delete ownership validation, state mutation locking, auth rate limiting
- Redis fail-closed, server false-ok fixes, health endpoint improvements
- Ingest engine real URL fetching

### Visual Design
- WCAG AA text contrast, gradient buttons, card shadows, softer labels, faster transitions
