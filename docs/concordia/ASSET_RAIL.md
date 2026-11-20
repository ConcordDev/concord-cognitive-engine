# Concordia asset rail (P0-04)

Binary asset sets (Mixamo clips, model packs, HubKit) do not live in
git: the repo is public (Q2) and raw Mixamo files in a public git
history would be redistribution. They live on **one rail**: a
content-addressed store plus a manifest, with pull/push scripts.

## Pieces

- `apps/concordia-living-world/unity-client/ASSET_MANIFEST.json` —
  the manifest. One row per file: `path`, `sha256`, `bytes`,
  `family`, `source`, `license_class` (`tradeable` / `in_game_only` /
  `blocked_pending`, enforced server-side by CI-17), `lod_tier`.
  The full-catalog regeneration (P0-07) grows this file from the real
  source manifests; P0-04 ships the schema and the first set (the
  Mixamo clips, regenerated from `backup/aura-wt-20261103`).
- `scripts/assets/pull-assets.mjs` — materialise every manifest row
  from the store into the working tree, verifying sha256 per row.
  Idempotent; any row it cannot produce exactly fails the run by
  name. Unity CI (P0-18) runs it as step 1 with no arguments.
- `scripts/assets/push-assets.mjs` — write local files into the store
  under their sha256. Refuses a file whose bytes contradict the
  manifest; idempotent.
- `scripts/assets/asset-manifest.mjs` — shared manifest validation
  and store resolution.

## The store

Objects live at `<store>/objects/<sha256>`. The store root is
configuration, never code: `--store <dir>` or the
`CONCORDIA_ASSET_STORE` environment variable. With neither set, both
scripts fail with a named P0-04 message — a CI run without the rail's
assets would test a different project, so the pull must never skip
quietly.

The plan's durable home is a private R2 bucket (S3 API). R2 is parked
(Dutch's Q2 answer, 2026-11-13), so the interim home is a local store
directory on the build machine; an S3-backed store slots behind the
same object layout and CLI when the office un-parks a home. Nothing
about the manifest or the scripts changes when it does.

## Done-test (of record)

Pull into an empty dir reproduces sha256 for **100% of rows**; push
is idempotent. Pinned hermetically in `server/tests/asset-rail.test.js`
(corrupt object, manifest-contradicting file, missing file, missing
store configuration, and bad `license_class` all fail by name).

## Regeneration note

Asset sets reach the rail by regeneration, not by git: the Mixamo
clips were extracted from the Aura backup branch into a local working
set, hashed into the manifest, and pushed to the store. The clips
never enter git on any branch this rail produces; the backup branch's
own disposition is a founder/desk decision (see the P0-04 premise
record).
