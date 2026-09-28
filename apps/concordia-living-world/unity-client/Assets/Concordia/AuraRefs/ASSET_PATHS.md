# Where the heavy assets live (do NOT symlink into AuraRefs)

Unity imports everything under Assets/. Symlinking PolyHaven/Generated here caused a full duplicate reimport + GUID storms and killed the MCP bridge.

- CX plates/mats/prefabs: `Assets/Concordia/Generated/`
- Plate index: `Assets/Concordia/AuraRefs/CX_PLATE_INDEX.json`
- Poly Haven: `Assets/Concordia/PolyHaven/` (maps are `_2k.jpg`)
- FreePacks: `Assets/Concordia/FreePacks/`
- Living-world bible (outside Assets): `apps/concordia-living-world/bible/` — also linked at `AuraRefs/bible/` as .md only
