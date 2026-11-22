# ADR 014: `gifenc` as a direct frontend dependency

| Field      | Value                                                              |
|------------|--------------------------------------------------------------------|
| Status     | Accepted                                                           |
| Date       | 2026-11-22                                                         |
| Authors    | Muse builder B4 (PR #2398 fixer queue, CB-1242 / CB-1246)         |
| Scope      | concord-frontend runtime dependency                                |

## Context

The animation Light Table (`concord-frontend/components/animation/table/`)
exports a finished piece in the browser. Its GIF leg in `encode.ts` writes a
true animated GIF — one image per drawing, its delay the drawing's exposure —
using `GIFEncoder`, `quantize` and `applyPalette` from `gifenc` (1.0.3).

The browser platform has no GIF encoder. `canvas.toBlob` / `toDataURL`
produce still images only, and WebCodecs encodes video codecs, not GIF.
Palette quantization (256 colours) and LZW compression are the substance of
the format; they are exactly what `gifenc` implements.

## Decision

Declare **`gifenc`** in `dependencies` at `1.0.3` and import it directly in
`encode.ts` for the GIF export leg.

## Why not the alternatives

- **Hand-roll a GIF encoder:** palette quantization plus LZW is the
  error-prone core of the format. Reimplementing it to avoid a small,
  single-purpose package trades a reviewed encoder for a new bug surface in
  a user-facing export.
- **Encode on the server:** the Light Table renders client-only by design —
  the piece is drawn, previewed and exported locally, and media leaves the
  browser only when the user publishes or uploads it. A server encode adds a
  round trip and server CPU to every export and breaks that design.
- **Drop the GIF format:** GIF is the one export that plays everywhere
  (chat, email, older browsers) with no codec support question; the PNG
  frame zip is an editing intermediate, not a shareable piece.

## Consequences

`npm ci` installs `gifenc` on every box. It is imported statically by
`encode.ts` today, so it loads with the Light Table's export module;
splitting the export path behind a dynamic import is a recorded follow-up,
not part of this change.
