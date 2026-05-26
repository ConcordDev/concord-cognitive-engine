# Authored Asset Drop-Zone

Drop hand-authored or downloaded CC0 3D models, textures, HDRIs, and materials
here. The server's `bootstrapAuthoredLocal` loader walks this tree on boot
and registers everything it finds into `evo_assets` with `source='authored'`.

## Directory layout

```
content/world/_shared/
├── models/        — .glb, .gltf, .obj, .fbx
│   ├── polyhaven/    (populated by `scripts/fetch-cc0-assets.mjs`)
│   ├── os3a/         (populated by fetcher; CC0-filtered)
│   ├── quaternius/   (populated by fetcher; user extracts ZIPs)
│   └── authored/     (your hand-authored work goes here)
├── textures/      — .png, .jpg, .webp, .ktx2
│   ├── ambientcg/    (populated by fetcher)
│   └── authored/     (your hand-painted textures)
├── hdris/         — .hdr, .exr (skyboxes + image-based lighting)
│   └── polyhaven/    (populated by fetcher)
├── materials/     — .json or .mtl (Substance / Quixel export bundles)
└── sprites/       — .png (2D billboards, particles)
```

## How to populate

**One-time CC0 bulk fetch** (run from repo root, requires internet):
```bash
node scripts/fetch-cc0-assets.mjs        # default: Poly Haven + AmbientCG + OS3A
node scripts/fetch-cc0-assets.mjs --all  # also pulls Quaternius CC0 packs
```

**Hand-authored work** — drop your own files into the appropriate sub-dir.
Naming convention: `kind_name_descriptor.ext` (e.g. `tree_oak_mature.glb`,
`stone_cobble_albedo.png`). Filenames become part of the `source_id` so they
must be stable.

**On next server boot**, the bootstrap pipeline auto-registers everything in
this tree as `source='authored'`. Idempotent — re-running won't duplicate.

## License responsibilities

The project owner is responsible for the license of files placed here.

- Files fetched via `scripts/fetch-cc0-assets.mjs` are **all CC0 / public
  domain** at fetch time — the fetcher verifies the license per asset.
- Hand-authored work: put a `LICENSE.txt` in the relevant sub-dir if you
  want to track attribution requirements.
- Never drop assets with restrictive licenses (CC-BY-NC, "personal use
  only", etc.) into this tree. They'll be served to every Concord user
  who lands in Concordia — the world treats them as freely-citable seeds.

## How these assets enter the gameplay loop

1. Bootstrap registers each file → `evo_assets` row
2. Procedural generators (L-system trees, procedural buildings, terrain
   blending) pull from the registry as seed geometry/textures
3. The evo cycle generates variants (`source='evolved'`, lineage→seed)
4. NPCs + players interact with variants → quality signal accumulates
5. Top variants get promoted to canonical pool
6. Royalty cascade pays the original seed author every time a derivative
   is cited or transacted, 50 generations deep

So: dropping one authored oak-tree model into `models/authored/` can seed
1,000s of derivative trees across the substrate, and the original author
collects perpetual royalties.

## Don't commit large binaries to git

The directories under this folder are gitignored except for this README.
Asset files live on the server's disk, not in version control. Distribute
big asset packs separately (S3, BitTorrent, direct from CC0 source).
