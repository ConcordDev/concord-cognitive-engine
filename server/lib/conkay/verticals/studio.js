// server/lib/conkay/verticals/studio.js
// Advanced Studio slice — scene/shot packet from intent → mesh/GLB hook.
// Hardens strongest existing ConKay studio surface: design-glb archetypes + shot timeline packet.

const ARCHETYPES = Object.freeze(['sword', 'spear', 'staff', 'mace', 'shield']);

/**
 * Compile a studio shot packet from free-text intent.
 * LIVE path hooks: archetype → /api/conkay/design-glb → load_glb (existing).
 * This module emits the structured shot/timeline packet + mesh placeholder for cert.
 */
export function compileStudioShot(input = {}) {
  const t0 = Date.now();
  const text = String(input.text || input.prompt || 'steel sword hero prop').trim();
  const lower = text.toLowerCase();
  let archetype = ARCHETYPES.find((a) => lower.includes(a)) || 'sword';
  if (input.archetype && ARCHETYPES.includes(String(input.archetype))) {
    archetype = String(input.archetype);
  }

  const durationSec = Math.max(1, Math.min(30, Number(input.durationSec) || 4));
  const fps = Math.max(12, Math.min(60, Number(input.fps) || 24));
  const frames = Math.round(durationSec * fps);

  // Procedural placeholder mesh (blade-ish box) — GLB comes from design-glb when API live
  const positions = [
    -0.05, 0, 0,  0.05, 0, 0,  0.04, 0.9, 0,  -0.04, 0.9, 0,
    -0.05, 0, 0.02, 0.05, 0, 0.02, 0.04, 0.9, 0.02, -0.04, 0.9, 0.02,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
  ];

  const shot = {
    id: `shot-${archetype}-${Date.now().toString(36)}`,
    title: `${archetype} studio beat`,
    intent: text,
    archetype,
    timeline: [
      { t: 0, action: 'spawn_from_spec', target: 'hero_prop' },
      { t: 0.2, action: 'load_glb', target: 'hero_prop', via: '/api/conkay/design-glb' },
      { t: durationSec * 0.4, action: 'camera_orbit', yaw: 35 },
      { t: durationSec * 0.75, action: 'set_color', color: '#c0a060' },
      { t: durationSec, action: 'hold' },
    ],
    fps,
    durationSec,
    frames,
  };

  const ms = Date.now() - t0;
  return {
    ok: true,
    shot,
    mesh: {
      positions,
      indices,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      id: `studio-${archetype}`,
      color: '#c0a060',
    },
    glbHook: {
      route: 'POST /api/conkay/design-glb',
      overlay: 'ck-evo-glb-world',
      note: 'Strongest LIVE studio surface — archetype keyword → evo-asset → Unity load_glb',
    },
    honesty: {
      note: 'Studio shot packet + mesh placeholder; GLB generation uses existing design-glb path when authenticated',
      fullNle: false,
    },
    ms,
  };
}

/** Optional: hit live design-glb if token provided. */
export async function compileStudioShotLive(input = {}, { baseUrl = 'http://127.0.0.1:5050', token } = {}) {
  const packet = compileStudioShot(input);
  if (!token) {
    return { ...packet, liveGlb: null, live: false };
  }
  const t0 = Date.now();
  try {
    const r = await fetch(`${baseUrl}/api/conkay/design-glb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 ConKayStudioCert',
        Origin: 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({ text: input.text || `steel ${packet.shot.archetype}`, archetype: packet.shot.archetype }),
    });
    const j = await r.json();
    return {
      ...packet,
      live: !!j?.ok,
      liveGlb: j?.ok
        ? { glbUrl: j.glbUrl, assetId: j.assetId, archetype: j.archetype, apiMs: Date.now() - t0 }
        : { error: j?.error || j?.reason || `status_${r.status}`, apiMs: Date.now() - t0 },
      ms: packet.ms + (Date.now() - t0),
    };
  } catch (e) {
    return { ...packet, live: false, liveGlb: { error: e?.message || String(e) }, ms: packet.ms + (Date.now() - t0) };
  }
}

export default { compileStudioShot, compileStudioShotLive, ARCHETYPES };
