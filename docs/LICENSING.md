# Licensing — dependency, model, and content license posture

A license pass over the dependency tree, the LLM models, and ingested content, with the
two pre-commercial decisions and their resolutions. **Verdict: clean for commercial use**
after the two swaps below.

> ⚠️ Engineering-informed, **not legal advice.** A lawyer should confirm before commercial
> scale. This is the code-grounded starting point.

## 1. Dependency tree

A scan of ~1,856 npm packages (504 server + 1,352 frontend) came back overwhelmingly
permissive (MIT / Apache-2.0 / BSD / ISC / 0BSD / MPL). Flagged items and disposition:

| Dependency | License | Where | Disposition |
|---|---|---|---|
| `react-leaflet` + `@react-leaflet/core` | **Hippocratic-2.1** (non-OSI) | atlas/aviation/realestate/desert/`common/MapView` | **SWAPPED → MapLibre GL (BSD-3)** (Track G3). Removes the open-ended "ethical source" usage restriction entirely. |
| `llava:13b-v1.6-vicuna` (vision model) | Vicuna→LLaMA + GPT-4-data (**CC-BY-NC heritage**) | `BRAIN_VISION_MODEL` | **SWAPPED → `qwen2.5vl:7b`** (Qwen2.5-VL, Apache-2.0) (Track G1). |
| `ffmpeg-static` | **GPL-3.0-or-later** | `server/lib/personal-locker/pipeline.js` | **FINE for SaaS.** Invoked as a separate subprocess (not linked into our code) and a hosted service does not *distribute* the binary → no copyleft trigger. **Posture: keep it a separate process; never link libav/ffmpeg into the codebase.** Only matters if ever shipped on-prem — then offer ffmpeg's source (it's public). |
| `sharp` / `@img/sharp-libvips-*` | **LGPL-3.0-or-later** | Next.js image optimizer | **FINE.** Dynamically-loaded native lib (standard sharp pattern) = commercial-OK. Don't modify libvips; keep the prebuilt binary. |
| `caniuse-lite` | CC-BY-4.0 | browserslist/babel (build-time) | **FINE.** Build tooling, not shipped as content. |
| `flatbuffers` | "SEE LICENSE IN…" (= Apache-2.0) | transitive | **FINE.** Google Apache-2.0, non-SPDX declaration only. |
| `png-js`, `khroma`, `webgl-constants` | no `license` field | transitive | **Low-risk** — all effectively MIT upstream; confirm if a formal SPDX-complete audit is required. |

**Scan gap:** `concord-mobile` (React Native / Expo) was not scanned in the first pass
(no `node_modules`). Action: `cd concord-mobile && npm install` then re-run the license
gate; record the result here. (Expo/RN trees are usually MIT/Apache — verify, don't assume.)

## 2. LLM models

| Brain | Model | License | Commercial |
|---|---|---|---|
| Conscious | `concord-conscious:latest` (custom Modelfile on Qwen2.5) | inherits Qwen | ✅ (see 3B nuance) |
| Subconscious | `qwen2.5:7b-instruct-q4_K_M` | Apache-2.0 | ✅ |
| Utility | `qwen2.5:3b` | **Qwen license** (not Apache) | ✅ but **>100M MAU needs a separate grant** |
| Repair | `qwen2.5:1.5b` | Qwen license | ✅ (same MAU nuance) |
| Vision | `qwen2.5vl:7b` (Qwen2.5-VL) | Apache-2.0 | ✅ — **swapped off `llava-vicuna`** |

The custom conscious brain is a Modelfile SYSTEM/few-shot layer on Qwen2.5 (no fine-tuned
weights), so it inherits the Qwen base license. The **3B/1.5B Qwen-license nuance** (a
separate grant past 100M MAU) is the only model term to revisit at large scale — not a
blocker now.

## 3. Content licensing

See `DATA_PROVENANCE.md`. Summary: ingested RSS is excerpt + attribution + Fair-Use
(marketplace-blocked), external APIs attributed + non-commercial-blocked, user data
scoped + consented. Manage RSS as standard aggregator hygiene (excerpt+link-back, honor
robots/feed-terms, responsive to takedowns).

## 4. CI license gate (Track G4)

`scripts/audit/gates/license-scan.mjs` walks `node_modules` (server + frontend + mobile),
reads each `package.json` license, and **fails** on `AGPL | GPL | SSPL | BUSL | CC-BY-NC |
Hippocratic | UNLICENSED | missing` against the permissive allowlist (MIT / Apache-2.0 /
BSD-* / ISC / 0BSD / MPL-2.0 / CC0 / Unlicense / Python-2.0). Wired into
`.github/workflows/audits.yml` as a floor gate so a future risky dependency cannot merge
silently.

**Accepted exceptions** (allowlisted with a reason, mirroring the schema-drift FP_EXCLUDE):

| Package | Flagged license | Reason accepted |
|---|---|---|
| `ffmpeg-static` | GPL-3.0 | separate subprocess, not linked, not distributed (SaaS) — §1 |
| `@img/sharp-libvips-*`, `sharp` | LGPL-3.0 | dynamically-loaded native lib, unmodified — §1 |
| `caniuse-lite` | CC-BY-4.0 | build-time tooling, not shipped as content — §1 |
| `gsap` | Standard "no charge" license (non-SPDX) | Free for commercial use under Webflow ([gsap.com/standard-license](https://gsap.com/standard-license)); dynamically-linked frontend animation lib, unmodified, not redistributed as source. |

`react-leaflet`/`llava-vicuna` are **not** on the allowlist — they were removed, so the
gate stays strict against them returning.

## Reproduce
`node scripts/audit/gates/license-scan.mjs` (add `--ci` to fail on violation).
Re-run after `cd concord-mobile && npm install` to close the mobile scan gap.
