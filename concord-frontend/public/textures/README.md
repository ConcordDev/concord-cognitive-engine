# Authored PBR textures

This directory holds CC0 (public-domain) PBR texture sets. They are
pulled from AmbientCG by `scripts/fetch-cc0-textures.mjs` and
preferred over the procedural canvas fallback when present.

## Source

All textures: https://ambientcg.com — CC0 Public Domain.

No attribution required, but we cite the source for honesty.

## Layout

```
public/textures/
  stone/   color.jpg  normal.jpg  roughness.jpg  ao.jpg
  wood/    …
  brick/   …
  cloth/   …
  metal/   …
  leather/ …
  thatch/  …
  dirt/    …
```

## Refresh

```bash
node scripts/fetch-cc0-textures.mjs
```

Re-running only fetches files that aren't already on disk. To force a
re-pull, delete the folder first.
