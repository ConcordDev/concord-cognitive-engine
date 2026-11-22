# ADR 015: `mp4-muxer` as a direct frontend dependency

| Field      | Value                                                              |
|------------|--------------------------------------------------------------------|
| Status     | Accepted                                                           |
| Date       | 2026-11-22                                                         |
| Authors    | Muse builder B4 (PR #2398 fixer queue, CB-1242 / CB-1246)         |
| Scope      | concord-frontend runtime dependency                                |

## Context

The animation Light Table's MP4 export (`encode.ts`) encodes H.264 video
and AAC/Opus audio frame by frame with WebCodecs, so each film frame gets
its exact timestamp. WebCodecs emits raw encoded chunks — it does not
produce a file. Something must package those chunks into an MP4 container
(the `moov`/`mdat` box structure and sample tables) before the user has an
`.mp4`. `encode.ts` does this with `Muxer` and `ArrayBufferTarget` from
`mp4-muxer` (5.2.2), with `fastStart: 'in-memory'` so the result plays
while streaming.

No browser API muxes WebCodecs output: there is no native
`EncodedVideoChunk` → MP4 path in any browser.

## Decision

Declare **`mp4-muxer`** in `dependencies` at `5.2.2` and use it as the MP4
container writer for the WebCodecs encode path in `encode.ts`.

## Why not the alternatives

- **Hand-roll an MP4 muxer:** the box/sample-table format is a large,
  spec-heavy surface (stbl tables, edit lists, fast-start relocation).
  Writing and maintaining one is a bigger commitment than this dependency
  by an order of magnitude, in the least forgiving file format of the set.
- **MediaRecorder:** it records in real time — a three-minute piece takes
  three minutes to export — cannot guarantee per-frame timestamps (the
  export's stated contract), and its MP4/container and codec support vary
  by browser, so the file it produces is not the file the desk promises.
- **Encode on the server:** the Light Table renders client-only by design;
  a server encode adds an upload of every frame plus server CPU per export
  and breaks that design (see ADR 014).

## Consequences

`npm ci` installs `mp4-muxer` on every box. It is imported statically by
`encode.ts` today, so it loads with the Light Table's export module;
splitting the export path behind a dynamic import is a recorded follow-up,
not part of this change.
