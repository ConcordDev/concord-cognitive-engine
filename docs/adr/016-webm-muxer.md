# ADR 016: `webm-muxer` as a direct frontend dependency

| Field      | Value                                                              |
|------------|--------------------------------------------------------------------|
| Status     | Accepted                                                           |
| Date       | 2026-11-22                                                         |
| Authors    | Muse builder B4 (PR #2398 fixer queue, CB-1242 / CB-1246)         |
| Scope      | concord-frontend runtime dependency                                |

## Context

The animation Light Table's WebM export (`encode.ts`) encodes VP9/VP8
video and Opus audio frame by frame with WebCodecs, so each film frame
gets its exact timestamp. WebCodecs emits raw encoded chunks — it does not
produce a file. Something must package those chunks into a WebM (EBML)
container before the user has a `.webm`. `encode.ts` does this with
`Muxer` and `ArrayBufferTarget` from `webm-muxer` (5.1.4).

No browser API muxes WebCodecs output: there is no native
`EncodedVideoChunk` → WebM path in any browser. WebM is also the fallback
the desk offers where MP4/H.264 is unavailable (older Safari aside, it
plays everywhere WebCodecs does), so the export set needs both containers.

## Decision

Declare **`webm-muxer`** in `dependencies` at `5.1.4` and use it as the
WebM container writer for the WebCodecs encode path in `encode.ts`.

## Why not the alternatives

- **Hand-roll a WebM muxer:** EBML writing with correct cue/cluster
  structure is a spec-heavy surface to own for a container the platform
  does not provide; the package is the smaller, reviewed implementation.
- **MediaRecorder:** it records in real time, cannot guarantee per-frame
  timestamps (the export's stated contract), and offers no control over
  the VP9/VP8 + Opus configuration the encoder picked. Its output is not
  the file the desk promises.
- **Encode on the server:** the Light Table renders client-only by design;
  a server encode adds an upload of every frame plus server CPU per export
  and breaks that design (see ADR 014).

## Consequences

`npm ci` installs `webm-muxer` on every box. It is imported statically by
`encode.ts` today, so it loads with the Light Table's export module;
splitting the export path behind a dynamic import is a recorded follow-up,
not part of this change.
