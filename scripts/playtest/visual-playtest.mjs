// scripts/playtest/visual-playtest.mjs
//
// Instrument 2 — the VISUAL render-parity tier (the data×vision cross-check, the
// payoff of the whole harness). The headless agent knows the DATA truth (NPC at P
// has a sword, activity=forge); this drives a real browser camera to P,
// screenshots, and asks LLaVA (the wired vision brain) the PIXEL truth ("is there
// an NPC here? holding a sword? doing a forge motion?"). Parity = data matches
// vision. Pure diff + driver/vision-injectable runner so the analyzer unit-tests
// headlessly; the live adapter supplies a Playwright driver + a BRAIN_VISION_URL
// vision fn. Nightly / pre-release cadence.

/**
 * Compare one entity's DATA truth to the VISION verdict. PURE.
 * @param data { present:true, equipped?:string[], activity?:string, kind?:string }
 * @param vision { present:bool, sees?:string[], motion?:string }  (LLaVA-parsed)
 * @returns { parity, layers: { presence, appearance, animation } , mismatches[] }
 */
export function parityForEntity(data = {}, vision = {}) {
  const mismatches = [];

  // Layer 1 — presence.
  const presence = !!data.present === !!vision.present;
  if (!presence) mismatches.push({ layer: "presence", expected: data.present, saw: vision.present });

  // Layer 2 — appearance (equipped gear the data says is on the body).
  const sees = (vision.sees || []).map((s) => String(s).toLowerCase());
  let appearance = true;
  for (const g of data.equipped || []) {
    if (!sees.some((s) => s.includes(String(g).toLowerCase()))) {
      appearance = false;
      mismatches.push({ layer: "appearance", expected: g, saw: vision.sees || [] });
    }
  }

  // Layer 3 — animation (doing its state).
  let animation = true;
  if (data.activity) {
    const m = String(vision.motion || "").toLowerCase();
    if (!m.includes(String(data.activity).toLowerCase())) {
      animation = false;
      mismatches.push({ layer: "animation", expected: data.activity, saw: vision.motion });
    }
  }

  return { parity: mismatches.length === 0, layers: { presence, appearance, animation }, mismatches };
}

/**
 * Aggregate a parity report across many entities → the % drawn / % equipped /
 * % animating the health report prints. PURE.
 */
export function aggregateParity(results = []) {
  const n = results.length || 1;
  let drawn = 0, equipped = 0, animating = 0;
  for (const r of results) {
    if (r.layers.presence) drawn++;
    if (r.layers.appearance) equipped++;
    if (r.layers.animation) animating++;
  }
  return {
    total: results.length,
    pctDrawn: Math.round((drawn / n) * 100),
    pctEquipped: Math.round((equipped / n) * 100),
    pctAnimating: Math.round((animating / n) * 100),
    parity: results.every((r) => r.parity),
  };
}

/**
 * Live runner. For each entity the data knows, move the camera, screenshot, ask
 * vision, diff. `driver.snapshot()` → data entities; `screenshot(driver, pos)` →
 * image; `askVision(image, prompt)` → { present, sees, motion }.
 */
export async function runVisualParity({ driver, screenshot, askVision, limit = 12 } = {}) {
  if (!driver || typeof screenshot !== "function" || typeof askVision !== "function") {
    return { ok: false, reason: "need_driver_screenshot_vision" };
  }
  const entities = ((await driver.snapshot())?.npcs || []).slice(0, limit);
  const results = [];
  for (const e of entities) {
    const data = { present: true, equipped: e.equipped || [], activity: e.currentActivity || e.activity, kind: e.kind };
    let vision = { present: false };
    try {
      const img = await screenshot(driver, { x: e.x, y: e.y ?? 0, z: e.z });
      vision = await askVision(img, "Is there a creature/person here? What are they holding or wearing, and what motion are they doing?");
    } catch { /* vision unavailable → counts as a presence miss */ }
    results.push(parityForEntity(data, vision));
  }
  return { ok: true, ...aggregateParity(results), results };
}
