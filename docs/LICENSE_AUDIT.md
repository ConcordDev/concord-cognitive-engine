# License Pass — dependency + model + content licensing audit

> ⚠️ Engineering-informed flags for a real legal review — **not legal advice.** A lawyer should confirm
> the two "DECIDE" items before commercial scale.

## 0. Verdict

**Overwhelmingly clean.** 1,856 npm packages scanned (504 server + 1,352 frontend) — the tree is almost
entirely permissive (MIT / Apache-2.0 / BSD / ISC). Only a handful flagged, and **most are non-issues
for a hosted (SaaS) service.** Two items warrant a decision before commercial scale; one is a scan gap.

---

## 1. Flagged items (triaged)

| Item | License | Used where | Verdict | Action |
|---|---|---|---|---|
| **react-leaflet** + `@react-leaflet/core` | **Hippocratic-2.1** | atlas, aviation, realestate, desert, common/MapView (the map abstraction) | **⚠ DECIDE** | non-OSI "ethical source" license with open-ended usage restrictions — the one a commercial legal review will question. Either accept the terms (the restrictions are things you'd comply with anyway) or swap to **MapLibre GL** (BSD-3) / Mapbox. Used in 5+ places, so a swap is non-trivial. |
| **llava:13b-v1.6-vicuna** (vision brain) | Vicuna/LLaMA + GPT-4-data → **CC-BY-NC heritage** | `BRAIN_VISION_MODEL` | **⚠ SWAP** | the actual fix-before-commercial item. One-line Ollama swap to **Qwen2-VL** (Apache-2.0, unifies the stack on Qwen), **FireLLaVA**, or a Mistral-based LLaVA. |
| **ffmpeg-static** | **GPL-3.0-or-later** | `server/lib/personal-locker/pipeline.js` | **✅ FINE for SaaS** | GPL (not AGPL) + invoked as a **separate binary/subprocess** → no copyleft trigger for your code, and a hosted service doesn't *distribute* the binary to users. Only matters if you ever ship the server **on-prem** (then offer ffmpeg's source — it's public). Keep it as a separate process, never link it into your code. |
| **@img/sharp-libvips-*** | **LGPL-3.0-or-later** | sharp (Next.js image optimizer) | **✅ FINE** | LGPL via a **dynamically-loaded native lib** = commercial-OK (the standard sharp pattern). Don't modify libvips itself; keep the prebuilt binary. |
| **caniuse-lite** | CC-BY-4.0 | browserslist/babel (build-time) | **✅ FINE** | build tooling, not shipped as content; CC-BY just needs attribution if redistributed (you don't). |
| **flatbuffers** | "SEE LICENSE IN…" (= Apache-2.0) | transitive | **✅ FINE** | Google Apache-2.0; just a non-SPDX declaration. |
| **png-js, khroma, webgl-constants** | no `license` field | transitive | **🟡 CONFIRM** | all effectively MIT upstream — just undeclared in package.json. Low risk; confirm if a formal audit needs SPDX-complete. |

---

## 2. The scan gap

- **`concord-mobile` dependencies were NOT scanned** — `node_modules` isn't installed there, so the
  React Native / Expo tree is unaudited. **Action:** `cd concord-mobile && npm install`, then re-run the
  license scan. (Expo/RN trees are usually MIT/Apache, but it must be checked, not assumed.)

---

## 3. Non-dependency licensing (from the data-rights audit)

- **Content ingestion (RSS → DTUs):** good posture — `source-attribution.js` attributes sources +
  transforms into DTUs (not verbatim republish). Ongoing hygiene, not a blocker: keep to
  **excerpts + link-back, not full-text**, honor feed terms/robots, stay responsive to takedowns.
- **User data:** clean — personal DTUs are user-scoped + encrypted (locker-key gated), no cross-user
  leak (round-5 audit), with `training-consent.js` + GDPR-style export. Not stealing user data.
- **Cognitive brains:** **Qwen2.5 = Apache-2.0** (commercially clean) — minor nuance: the **3B repair
  model** is under the *Qwen* license (not Apache), still commercial-OK but with terms (>100M MAU needs
  a separate grant). The conscious brain (custom-built on Qwen2.5) inherits this.

---

## 4. Action checklist (pre-commercial-scale)

- [ ] **Decide react-leaflet/Hippocratic** — accept terms (document the decision) OR swap to MapLibre GL.
- [ ] **Swap the vision model** off `llava-vicuna` → Qwen2-VL / FireLLaVA (one-line `BRAIN_VISION_MODEL`).
- [ ] **Scan `concord-mobile`** (install deps + re-run the pass).
- [ ] Confirm the 3 no-license-field deps are MIT (or replace) if a formal SPDX audit is required.
- [ ] Document the ffmpeg-static "separate-process, not-distributed" posture (for any future on-prem).
- [ ] Keep content ingestion to excerpt+attribution; honor robots/feed terms.
- [ ] Add a **CI license gate** (e.g. `license-checker --failOn 'AGPL;GPL;SSPL;CC-BY-NC;UNLICENSED'`) so a
      future risky dep can't merge silently — same auto-gate principle as the Function-Assurance method.

## 5. Bottom line

You're **not stepping on toes** in any structural way — the dependency tree is clean, user data is
handled, content is attributed. The two real pre-commercial decisions are **the map library
(Hippocratic)** and **the vision model (Vicuna lineage)**, both cheap to resolve, plus **scanning the
mobile tree** you couldn't reach here. Add a CI license gate and the whole class stays closed — a new
AGPL/non-commercial dep can never sneak in again.

**Method note:** scan = walk `node_modules`, read each `package.json` license, flag
`AGPL|GPL|SSPL|CC-BY-NC|BUSL|Hippocratic|UNLICENSED|missing` vs the permissive allowlist
(MIT/Apache/BSD/ISC/0BSD/MPL). Reproducible; wire it into CI as the gate above.
