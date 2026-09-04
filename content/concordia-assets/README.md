# Concordia shared asset kits

One pack at a time, committed, used by **all three presenters**
(Unity, Godot, Three.js / Vite). Do not git the 118MB Kenney kitchen or Mixamo.

| Kit | Where | What |
|---|---|---|
| **Unburned Court (this piece)** | `hub/` | Walls, trees, tents, furniture, KayKit forge + tower |
| Next | `ruins/` etc. | Same pattern: ingest → MANIFEST → `npm run sync:hub-kit` |

```
npm run sync:hub-kit
```

Mac kitchen with gitignored `kenney-free/` is the ingest source. After the
files are in `hub/`, any clone can re-copy them onto the presenters.
