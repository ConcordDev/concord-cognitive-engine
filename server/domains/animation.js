// server/domains/animation.js
// Domain actions for animation: keyframe interpolation, timing analysis,
// frame rate optimization, storyboard sequencing, easing calculation.

export default function registerAnimationActions(registerLensAction) {
  registerLensAction("animation", "interpolateKeyframes", (ctx, artifact, _params) => {
    const keyframes = artifact.data?.keyframes || [];
    if (keyframes.length < 2) return { ok: true, result: { message: "Add at least 2 keyframes with time and value." } };
    const sorted = [...keyframes].sort((a, b) => (parseFloat(a.time) || 0) - (parseFloat(b.time) || 0));
    const fps = parseInt(artifact.data?.fps) || 24;
    const totalDuration = parseFloat(sorted[sorted.length - 1].time) - parseFloat(sorted[0].time);
    const totalFrames = Math.ceil(totalDuration * fps);
    const interpolated = [];
    for (let f = 0; f <= totalFrames; f++) {
      const t = parseFloat(sorted[0].time) + (f / fps);
      let i = 0;
      while (i < sorted.length - 1 && parseFloat(sorted[i + 1].time) < t) i++;
      const k0 = sorted[i], k1 = sorted[Math.min(i + 1, sorted.length - 1)];
      const t0 = parseFloat(k0.time), t1 = parseFloat(k1.time);
      const progress = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const v0 = parseFloat(k0.value) || 0, v1 = parseFloat(k1.value) || 0;
      interpolated.push({ frame: f, time: Math.round(t * 1000) / 1000, value: Math.round((v0 + (v1 - v0) * progress) * 1000) / 1000 });
    }
    return { ok: true, result: { keyframeCount: keyframes.length, fps, totalFrames, durationSeconds: totalDuration, sampleFrames: interpolated.filter((_, i) => i % Math.max(1, Math.floor(totalFrames / 10)) === 0) } };
  });

  registerLensAction("animation", "timingAnalysis", (ctx, artifact, _params) => {
    const sequences = artifact.data?.sequences || [];
    if (sequences.length === 0) return { ok: true, result: { message: "Add animation sequences to analyze timing." } };
    const analyzed = sequences.map(s => {
      const duration = parseFloat(s.duration) || 1;
      const delay = parseFloat(s.delay) || 0;
      const fps = parseInt(s.fps) || 24;
      return { name: s.name || "Unnamed", duration, delay, fps, frames: Math.ceil(duration * fps), endTime: delay + duration, easing: s.easing || "linear" };
    });
    const totalDuration = Math.max(...analyzed.map(a => a.endTime));
    const overlaps = [];
    for (let i = 0; i < analyzed.length; i++) {
      for (let j = i + 1; j < analyzed.length; j++) {
        const a = analyzed[i], b = analyzed[j];
        if (a.delay < b.endTime && b.delay < a.endTime) overlaps.push({ a: a.name, b: b.name });
      }
    }
    return { ok: true, result: { sequences: analyzed, totalDuration, totalFrames: analyzed.reduce((s, a) => s + a.frames, 0), overlappingPairs: overlaps.length, overlaps: overlaps.slice(0, 5) } };
  });

  registerLensAction("animation", "optimizeFPS", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const currentFPS = parseInt(data.fps) || 30;
    const complexity = parseInt(data.complexity) || 50; // 0-100
    const targetDevice = (data.targetDevice || "desktop").toLowerCase();
    const budgets = { mobile: { maxFPS: 30, maxComplexity: 60 }, tablet: { maxFPS: 30, maxComplexity: 75 }, desktop: { maxFPS: 60, maxComplexity: 100 }, highend: { maxFPS: 120, maxComplexity: 100 } };
    const budget = budgets[targetDevice] || budgets.desktop;
    const recommendedFPS = complexity > budget.maxComplexity ? Math.min(currentFPS, budget.maxFPS / 2) : Math.min(currentFPS, budget.maxFPS);
    const frameTime = Math.round((1000 / recommendedFPS) * 100) / 100;
    return { ok: true, result: { currentFPS, recommendedFPS, frameTimeMs: frameTime, targetDevice, complexity, withinBudget: complexity <= budget.maxComplexity, tips: complexity > budget.maxComplexity ? ["Reduce particle count", "Simplify easing curves", "Use sprite sheets instead of vector animations"] : ["Performance is within budget"] } };
  });

  registerLensAction("animation", "storyboardSequence", (ctx, artifact, _params) => {
    const scenes = artifact.data?.scenes || [];
    if (scenes.length === 0) return { ok: true, result: { message: "Add scenes to generate a storyboard sequence." } };
    let runningTime = 0;
    const sequence = scenes.map((s, i) => {
      const duration = parseFloat(s.duration) || 2;
      const transition = parseFloat(s.transitionDuration) || 0.5;
      const startTime = runningTime;
      runningTime += duration + transition;
      return { scene: i + 1, name: s.name || `Scene ${i + 1}`, startTime: Math.round(startTime * 100) / 100, duration, transitionDuration: transition, endTime: Math.round((startTime + duration) * 100) / 100, description: s.description || "" };
    });
    return { ok: true, result: { scenes: sequence, totalDuration: Math.round(runningTime * 100) / 100, sceneCount: scenes.length, avgSceneDuration: Math.round((runningTime / scenes.length) * 100) / 100 } };
  });

  // ─── FlipaClip + Pencil2D 2026 parity — frame-by-frame animator ─────
  // Projects of drawn frames (vector strokes), per-frame exposure for
  // timing, onion-skin-ready playback expansion, and easing curves.

  function getAnimState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.animationLens) STATE.animationLens = {};
    const s = STATE.animationLens;
    if (!(s.projects instanceof Map)) s.projects = new Map();
    return s;
  }
  function saveAnimState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const anId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const anNow = () => new Date().toISOString();
  const anAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const anListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const anNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const anClamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, anNum(v, d)));
  const anClean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const anHex = (v) => {
    const m = String(v || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(m) ? m : null;
  };

  const AN_TOOLS = ["pencil", "ink", "marker", "airbrush", "eraser"];
  const AN_MAX_POINTS = 4000;
  const AN_MAX_STROKES = 4000;
  const AN_MAX_FRAMES = 600;

  function findAnim(s, userId, animId) {
    return (s.projects.get(userId) || []).find((a) => a.id === animId) || null;
  }
  const AN_MAX_LAYERS = 10;
  function blankLayer(name) {
    return { id: anId("lyr"), name: name || "Layer 1", visible: true, opacity: 1, strokes: [] };
  }
  function blankFrame() {
    return { id: anId("frm"), exposure: 1, layers: [blankLayer("Layer 1")], strokes: [] };
  }
  // Resolve a frame's active drawing layer; tolerates legacy single-layer frames.
  function frameLayer(frame, layerId) {
    if (!Array.isArray(frame.layers) || !frame.layers.length) {
      // migrate a legacy frame: wrap its flat strokes in a default layer
      frame.layers = [{ id: anId("lyr"), name: "Layer 1", visible: true, opacity: 1, strokes: frame.strokes || [] }];
    }
    if (layerId) return frame.layers.find((l) => l.id === layerId) || null;
    return frame.layers[frame.layers.length - 1];
  }
  // Flatten a frame's visible layers into one stroke list (playback/onion/legacy).
  function frameStrokes(frame) {
    if (Array.isArray(frame.layers) && frame.layers.length) {
      return frame.layers.filter((l) => l.visible).flatMap((l) => l.strokes);
    }
    return frame.strokes || [];
  }
  function anSanitizeStroke(raw, anim) {
    if (!raw || typeof raw !== "object") return null;
    const tool = AN_TOOLS.includes(String(raw.tool)) ? String(raw.tool) : "ink";
    const color = anHex(raw.color) || "#222222";
    const size = anClamp(raw.size, 0.5, 300, 6);
    const opacity = anClamp(raw.opacity, 0.01, 1, 1);
    const pts = Array.isArray(raw.points) ? raw.points : [];
    const points = [];
    for (const p of pts.slice(0, AN_MAX_POINTS)) {
      if (Array.isArray(p) && p.length >= 2) {
        points.push([
          Math.round(anClamp(p[0], -2, anim.width + 2, 0)),
          Math.round(anClamp(p[1], -2, anim.height + 2, 0)),
        ]);
      }
    }
    if (!points.length) return null;
    return { id: anId("stk"), tool, color, size, opacity, points };
  }

  // Real easing functions for tweening.
  const AN_EASINGS = {
    linear: (t) => t,
    "ease-in": (t) => t * t,
    "ease-out": (t) => 1 - (1 - t) * (1 - t),
    "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    "ease-in-cubic": (t) => t * t * t,
    "ease-out-cubic": (t) => 1 - Math.pow(1 - t, 3),
    "bounce-out": (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
      if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
      t -= 2.625 / d1; return n1 * t * t + 0.984375;
    },
  };

  // ── Projects ────────────────────────────────────────────────────────
  registerLensAction("animation", "anim-create", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = {
      id: anId("anm"),
      title: anClean(params.title, 120) || "Untitled animation",
      width: Math.round(anClamp(params.width, 64, 3000, 960)),
      height: Math.round(anClamp(params.height, 64, 3000, 540)),
      fps: Math.round(anClamp(params.fps, 1, 60, 12)),
      background: anHex(params.background) || "#ffffff",
      frames: [blankFrame()],
      thumbnail: null,
      createdAt: anNow(), updatedAt: anNow(),
    };
    anListB(s.projects, anAid(ctx)).push(anim);
    saveAnimState();
    return { ok: true, result: { animation: anim } };
  });

  registerLensAction("animation", "anim-list", (ctx, _a, _params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const animations = (s.projects.get(anAid(ctx)) || [])
      .map((a) => ({
        id: a.id, title: a.title, width: a.width, height: a.height, fps: a.fps,
        background: a.background, thumbnail: a.thumbnail,
        frameCount: a.frames.length,
        durationFrames: a.frames.reduce((n, f) => n + f.exposure, 0),
        updatedAt: a.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { animations, count: animations.length } };
  });

  registerLensAction("animation", "anim-get", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    return { ok: true, result: { animation: anim } };
  });

  registerLensAction("animation", "anim-rename", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    const title = anClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    anim.title = title;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { id: anim.id, title } };
  });

  registerLensAction("animation", "anim-update-settings", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    if (params.fps != null) anim.fps = Math.round(anClamp(params.fps, 1, 60, anim.fps));
    if (params.background != null) anim.background = anHex(params.background) || anim.background;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { id: anim.id, fps: anim.fps, background: anim.background } };
  });

  registerLensAction("animation", "anim-save-thumbnail", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    const thumb = String(params.thumbnail || "");
    if (!thumb.startsWith("data:image/") || thumb.length > 400000) {
      return { ok: false, error: "thumbnail must be a data URL under 400KB" };
    }
    anim.thumbnail = thumb;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { saved: true } };
  });

  registerLensAction("animation", "anim-delete", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.projects.get(anAid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "animation not found" };
    arr.splice(i, 1);
    saveAnimState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Frames ──────────────────────────────────────────────────────────
  registerLensAction("animation", "frame-add", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    if (anim.frames.length >= AN_MAX_FRAMES) return { ok: false, error: `frame limit (${AN_MAX_FRAMES}) reached` };
    const frame = blankFrame();
    const afterIdx = anim.frames.findIndex((f) => f.id === params.afterFrameId);
    if (afterIdx >= 0) anim.frames.splice(afterIdx + 1, 0, frame);
    else anim.frames.push(frame);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { frame, index: anim.frames.indexOf(frame) } };
  });

  registerLensAction("animation", "frame-duplicate", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    if (anim.frames.length >= AN_MAX_FRAMES) return { ok: false, error: `frame limit (${AN_MAX_FRAMES}) reached` };
    const idx = anim.frames.findIndex((f) => f.id === params.frameId);
    if (idx < 0) return { ok: false, error: "frame not found" };
    const src = anim.frames[idx];
    frameLayer(src);   // migrate legacy frame to layered shape if needed
    const copy = {
      id: anId("frm"), exposure: src.exposure, strokes: [],
      layers: src.layers.map((l) => ({
        id: anId("lyr"), name: l.name, visible: l.visible, opacity: l.opacity,
        strokes: l.strokes.map((st) => ({ ...st, id: anId("stk"), points: st.points.map((p) => [...p]) })),
      })),
    };
    anim.frames.splice(idx + 1, 0, copy);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { frame: copy, index: idx + 1 } };
  });

  registerLensAction("animation", "frame-delete", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    if (anim.frames.length <= 1) return { ok: false, error: "an animation needs at least one frame" };
    const idx = anim.frames.findIndex((f) => f.id === params.frameId);
    if (idx < 0) return { ok: false, error: "frame not found" };
    anim.frames.splice(idx, 1);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { deleted: params.frameId } };
  });

  registerLensAction("animation", "frame-reorder", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const i = anim.frames.findIndex((f) => f.id === params.frameId);
    if (i < 0) return { ok: false, error: "frame not found" };
    const j = i + (params.direction === "right" ? 1 : -1);
    if (j < 0 || j >= anim.frames.length) {
      return { ok: true, result: { order: anim.frames.map((f) => f.id) } };
    }
    [anim.frames[i], anim.frames[j]] = [anim.frames[j], anim.frames[i]];
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { order: anim.frames.map((f) => f.id) } };
  });

  registerLensAction("animation", "frame-set-exposure", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    frame.exposure = Math.round(anClamp(params.exposure, 1, 60, 1));
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { frameId: frame.id, exposure: frame.exposure } };
  });

  // ── Per-frame layers ────────────────────────────────────────────────
  registerLensAction("animation", "frame-layer-add", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    frameLayer(frame);
    if (frame.layers.length >= AN_MAX_LAYERS) return { ok: false, error: `layer limit (${AN_MAX_LAYERS}) reached` };
    const layer = blankLayer(anClean(params.name, 60) || `Layer ${frame.layers.length + 1}`);
    frame.layers.push(layer);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { layer: { ...layer, strokes: undefined, strokeCount: 0 } } };
  });

  registerLensAction("animation", "frame-layer-update", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (params.name != null) layer.name = anClean(params.name, 60) || layer.name;
    if (params.visible != null) layer.visible = !!params.visible;
    if (params.opacity != null) layer.opacity = anClamp(params.opacity, 0, 1, layer.opacity);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { layerId: layer.id, visible: layer.visible, opacity: layer.opacity } };
  });

  registerLensAction("animation", "frame-layer-delete", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    frameLayer(frame);
    if (frame.layers.length <= 1) return { ok: false, error: "a frame needs at least one layer" };
    const i = frame.layers.findIndex((l) => l.id === params.layerId);
    if (i < 0) return { ok: false, error: "layer not found" };
    frame.layers.splice(i, 1);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { deleted: params.layerId } };
  });

  // ── Strokes (commit to the active layer of a frame) ─────────────────
  registerLensAction("animation", "anim-stroke-commit", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.strokes.length >= AN_MAX_STROKES) return { ok: false, error: "layer stroke limit reached" };
    const stroke = anSanitizeStroke(params.stroke, anim);
    if (!stroke) return { ok: false, error: "invalid stroke" };
    layer.strokes.push(stroke);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { strokeId: stroke.id, layerId: layer.id, strokeCount: layer.strokes.length } };
  });

  registerLensAction("animation", "anim-stroke-batch", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const incoming = Array.isArray(params.strokes) ? params.strokes : [];
    let added = 0;
    for (const raw of incoming) {
      if (layer.strokes.length >= AN_MAX_STROKES) break;
      const stroke = anSanitizeStroke(raw, anim);
      if (stroke) { layer.strokes.push(stroke); added += 1; }
    }
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { added, strokeCount: layer.strokes.length } };
  });

  registerLensAction("animation", "anim-stroke-undo", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const removed = layer.strokes.pop() || null;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { removed: removed?.id || null, strokeCount: layer.strokes.length } };
  });

  registerLensAction("animation", "frame-clear", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (params.allLayers) { for (const l of frame.layers) l.strokes = []; }
    else layer.strokes = [];
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { cleared: frame.id } };
  });

  // ── Audio tracks ────────────────────────────────────────────────────
  registerLensAction("animation", "audio-track-add", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    if (!Array.isArray(anim.audio)) anim.audio = [];
    if (anim.audio.length >= 6) return { ok: false, error: "audio track limit (6) reached" };
    const name = anClean(params.name, 80);
    if (!name) return { ok: false, error: "track name required" };
    const url = anClean(params.url, 600);
    const track = {
      id: anId("aud"), name,
      url: /^https?:\/\//.test(url) ? url : null,
      startSec: Math.max(0, anNum(params.startSec)),
    };
    anim.audio.push(track);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { track } };
  });

  registerLensAction("animation", "audio-track-list", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    return { ok: true, result: { tracks: anim.audio || [], count: (anim.audio || []).length } };
  });

  registerLensAction("animation", "audio-track-remove", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    anim.audio = (anim.audio || []).filter((t) => t.id !== params.id);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Playback & easing ───────────────────────────────────────────────
  registerLensAction("animation", "playback-frames", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    const sequence = [];
    anim.frames.forEach((f, idx) => {
      for (let i = 0; i < f.exposure; i++) sequence.push({ frameId: f.id, frameIndex: idx });
    });
    return {
      ok: true,
      result: {
        fps: anim.fps,
        sequence,
        totalFrames: sequence.length,
        durationSec: Math.round((sequence.length / anim.fps) * 100) / 100,
      },
    };
  });

  registerLensAction("animation", "easing-curve", (_ctx, _a, params = {}) => {
    const type = AN_EASINGS[String(params.type)] ? String(params.type) : "ease-in-out";
    const steps = Math.round(anClamp(params.steps, 2, 120, 24));
    const fn = AN_EASINGS[type];
    const samples = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      samples.push({ t: Math.round(t * 1000) / 1000, value: Math.round(fn(t) * 1000) / 1000 });
    }
    return { ok: true, result: { type, steps, easings: Object.keys(AN_EASINGS), samples } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("animation", "anim-dashboard", (ctx, _a, _params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = s.projects.get(anAid(ctx)) || [];
    const totalFrames = projects.reduce((n, a) => n + a.frames.length, 0);
    const latest = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      ok: true,
      result: {
        animations: projects.length,
        totalFrames,
        latestAnimation: latest ? { id: latest.id, title: latest.title } : null,
      },
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // FlipaClip / Pencil2D 2026 feature-parity backlog
  // ════════════════════════════════════════════════════════════════════

  // ── Canvas-size / frame-rate presets + onscreen grid & guides ───────
  const AN_CANVAS_PRESETS = [
    { id: "yt-1080", label: "YouTube 1080p", width: 1920, height: 1080, fps: 24 },
    { id: "yt-720", label: "YouTube 720p", width: 1280, height: 720, fps: 24 },
    { id: "ig-square", label: "Instagram Square", width: 1080, height: 1080, fps: 30 },
    { id: "ig-story", label: "Story / Reel 9:16", width: 1080, height: 1920, fps: 30 },
    { id: "tiktok", label: "TikTok 9:16", width: 1080, height: 1920, fps: 30 },
    { id: "pixel-128", label: "Pixel Art 128", width: 128, height: 128, fps: 12 },
    { id: "anim-16-9", label: "Animation 16:9", width: 960, height: 540, fps: 12 },
    { id: "film-2k", label: "Film 2K", width: 2048, height: 1152, fps: 24 },
  ];
  const AN_FPS_PRESETS = [8, 12, 15, 24, 25, 30, 48, 60];

  registerLensAction("animation", "canvas-presets", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { presets: AN_CANVAS_PRESETS, fpsPresets: AN_FPS_PRESETS } };
  });

  registerLensAction("animation", "set-canvas-guides", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    anim.guides = {
      grid: !!params.grid,
      gridSize: Math.round(anClamp(params.gridSize, 4, 400, 32)),
      thirds: !!params.thirds,
      safeArea: !!params.safeArea,
      symmetry: ["none", "vertical", "horizontal", "both"].includes(String(params.symmetry))
        ? String(params.symmetry) : "none",
    };
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { guides: anim.guides } };
  });

  // ── Pressure-sensitive brush dynamics + custom brush library ────────
  function blankBrushLib(s, userId) {
    const lib = anListB(s.brushes ||= new Map(), userId);
    return lib;
  }
  registerLensAction("animation", "brush-save", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = anClean(params.name, 60);
    if (!name) return { ok: false, error: "brush name required" };
    const lib = blankBrushLib(s, anAid(ctx));
    if (lib.length >= 40) return { ok: false, error: "brush library limit (40) reached" };
    const brush = {
      id: anId("brush"),
      name,
      tool: AN_TOOLS.includes(String(params.tool)) ? String(params.tool) : "ink",
      size: anClamp(params.size, 0.5, 300, 6),
      opacity: anClamp(params.opacity, 0.01, 1, 1),
      // Pressure dynamics — how stylus pressure maps onto size/opacity.
      pressureSize: anClamp(params.pressureSize, 0, 1, 0.6),
      pressureOpacity: anClamp(params.pressureOpacity, 0, 1, 0.3),
      smoothing: anClamp(params.smoothing, 0, 1, 0.4),
      spacing: anClamp(params.spacing, 0.05, 2, 0.2),
      taper: anClamp(params.taper, 0, 1, 0.3),
      color: anHex(params.color) || "#222222",
      createdAt: anNow(),
    };
    lib.push(brush);
    saveAnimState();
    return { ok: true, result: { brush } };
  });

  registerLensAction("animation", "brush-list", (ctx, _a, _params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lib = blankBrushLib(s, anAid(ctx));
    return { ok: true, result: { brushes: lib, count: lib.length } };
  });

  registerLensAction("animation", "brush-delete", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lib = blankBrushLib(s, anAid(ctx));
    const i = lib.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "brush not found" };
    lib.splice(i, 1);
    saveAnimState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Pressure-aware stroke commit (samples carry per-point pressure) ──
  // A pressure-sampled stroke is [x, y, pressure] triples; this expands
  // them into per-segment width modulation against a brush's dynamics.
  registerLensAction("animation", "stroke-commit-pressure", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const layer = frameLayer(frame, params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.strokes.length >= AN_MAX_STROKES) return { ok: false, error: "layer stroke limit reached" };
    const raw = params.stroke || {};
    const tool = AN_TOOLS.includes(String(raw.tool)) ? String(raw.tool) : "ink";
    const color = anHex(raw.color) || "#222222";
    const baseSize = anClamp(raw.size, 0.5, 300, 6);
    const baseOpacity = anClamp(raw.opacity, 0.01, 1, 1);
    const pressureSize = anClamp(raw.pressureSize, 0, 1, 0.6);
    const samples = Array.isArray(raw.points) ? raw.points : [];
    const points = [];
    const widths = [];
    for (const p of samples.slice(0, AN_MAX_POINTS)) {
      if (Array.isArray(p) && p.length >= 2) {
        const x = Math.round(anClamp(p[0], -2, anim.width + 2, 0));
        const y = Math.round(anClamp(p[1], -2, anim.height + 2, 0));
        const pr = p.length >= 3 ? anClamp(p[2], 0, 1, 0.5) : 0.5;
        points.push([x, y]);
        // pressure modulates width: at pr=0 width shrinks toward (1-pressureSize)*base.
        const w = baseSize * (1 - pressureSize + pressureSize * pr);
        widths.push(Math.round(w * 100) / 100);
      }
    }
    if (!points.length) return { ok: false, error: "invalid stroke" };
    const stroke = {
      id: anId("stk"), tool, color, size: baseSize, opacity: baseOpacity,
      points, widths, pressureSize,
    };
    layer.strokes.push(stroke);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { strokeId: stroke.id, layerId: layer.id, strokeCount: layer.strokes.length, widthSamples: widths.length } };
  });

  // ── Path / shape tweening between keyframes ─────────────────────────
  // Given a shape (a closed/open point path) on two keyframe times, emit
  // interpolated point paths per in-between frame, eased.
  registerLensAction("animation", "tween-shapes", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const from = Array.isArray(params.fromPath) ? params.fromPath : [];
    const to = Array.isArray(params.toPath) ? params.toPath : [];
    if (from.length < 2 || to.length < 2) {
      return { ok: false, error: "fromPath and toPath each need at least 2 points" };
    }
    if (from.length !== to.length) {
      return { ok: false, error: "fromPath and toPath must have the same point count" };
    }
    const easing = AN_EASINGS[String(params.easing)] ? String(params.easing) : "ease-in-out";
    const fn = AN_EASINGS[easing];
    const steps = Math.round(anClamp(params.steps, 1, 240, 12));
    const clampPt = (p) => [
      anClamp(Array.isArray(p) ? p[0] : 0, -2, anim.width + 2, 0),
      anClamp(Array.isArray(p) ? p[1] : 0, -2, anim.height + 2, 0),
    ];
    const fromC = from.map(clampPt);
    const toC = to.map(clampPt);
    const tween = [];
    for (let step = 0; step <= steps; step++) {
      const lin = step / steps;
      const e = fn(lin);
      const path = fromC.map((p, i) => [
        Math.round((p[0] + (toC[i][0] - p[0]) * e) * 100) / 100,
        Math.round((p[1] + (toC[i][1] - p[1]) * e) * 100) / 100,
      ]);
      tween.push({ step, t: Math.round(lin * 1000) / 1000, eased: Math.round(e * 1000) / 1000, path });
    }
    return {
      ok: true,
      result: { easing, steps, pointCount: from.length, frames: tween, easings: Object.keys(AN_EASINGS) },
    };
  });

  // Commit a tween directly into the project as new frames (one per step).
  registerLensAction("animation", "tween-to-frames", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const from = Array.isArray(params.fromPath) ? params.fromPath : [];
    const to = Array.isArray(params.toPath) ? params.toPath : [];
    if (from.length < 2 || to.length < 2 || from.length !== to.length) {
      return { ok: false, error: "fromPath and toPath need matching length ≥ 2" };
    }
    const easing = AN_EASINGS[String(params.easing)] ? String(params.easing) : "ease-in-out";
    const fn = AN_EASINGS[easing];
    const steps = Math.round(anClamp(params.steps, 1, 120, 8));
    if (anim.frames.length + steps + 1 > AN_MAX_FRAMES) {
      return { ok: false, error: `tween would exceed frame limit (${AN_MAX_FRAMES})` };
    }
    const color = anHex(params.color) || "#222222";
    const size = anClamp(params.size, 0.5, 300, 6);
    const startIdx = anim.frames.findIndex((f) => f.id === params.afterFrameId);
    const insertAt = startIdx >= 0 ? startIdx + 1 : anim.frames.length;
    const created = [];
    for (let step = 0; step <= steps; step++) {
      const e = fn(step / steps);
      const path = from.map((p, i) => [
        Math.round(p[0] + (to[i][0] - p[0]) * e),
        Math.round(p[1] + (to[i][1] - p[1]) * e),
      ]);
      const frame = blankFrame();
      frame.layers[0].strokes.push({ id: anId("stk"), tool: "ink", color, size, opacity: 1, points: path });
      anim.frames.splice(insertAt + step, 0, frame);
      created.push(frame.id);
    }
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { createdFrames: created, count: created.length, easing } };
  });

  // ── Rigging / bone armature for cut-out animation ───────────────────
  // A rig is a tree of bones; each frame can hold a pose (bone angles).
  function getRig(anim) {
    if (!anim.rig || typeof anim.rig !== "object") anim.rig = { bones: [], poses: {} };
    if (!Array.isArray(anim.rig.bones)) anim.rig.bones = [];
    if (!anim.rig.poses || typeof anim.rig.poses !== "object") anim.rig.poses = {};
    return anim.rig;
  }
  const AN_MAX_BONES = 60;

  registerLensAction("animation", "rig-bone-add", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const rig = getRig(anim);
    if (rig.bones.length >= AN_MAX_BONES) return { ok: false, error: `bone limit (${AN_MAX_BONES}) reached` };
    const parentId = params.parentId ? String(params.parentId) : null;
    if (parentId && !rig.bones.some((b) => b.id === parentId)) {
      return { ok: false, error: "parent bone not found" };
    }
    const bone = {
      id: anId("bone"),
      name: anClean(params.name, 50) || `Bone ${rig.bones.length + 1}`,
      parentId,
      x: Math.round(anClamp(params.x, -2, anim.width + 2, anim.width / 2)),
      y: Math.round(anClamp(params.y, -2, anim.height + 2, anim.height / 2)),
      length: Math.round(anClamp(params.length, 4, 2000, 60)),
      angle: anClamp(params.angle, -360, 360, 0),
      layerId: params.layerId ? String(params.layerId) : null,
    };
    rig.bones.push(bone);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { bone, boneCount: rig.bones.length } };
  });

  registerLensAction("animation", "rig-bone-update", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const rig = getRig(anim);
    const bone = rig.bones.find((b) => b.id === params.boneId);
    if (!bone) return { ok: false, error: "bone not found" };
    if (params.name != null) bone.name = anClean(params.name, 50) || bone.name;
    if (params.x != null) bone.x = Math.round(anClamp(params.x, -2, anim.width + 2, bone.x));
    if (params.y != null) bone.y = Math.round(anClamp(params.y, -2, anim.height + 2, bone.y));
    if (params.length != null) bone.length = Math.round(anClamp(params.length, 4, 2000, bone.length));
    if (params.angle != null) bone.angle = anClamp(params.angle, -360, 360, bone.angle);
    if (params.layerId !== undefined) bone.layerId = params.layerId ? String(params.layerId) : null;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { bone } };
  });

  registerLensAction("animation", "rig-bone-delete", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const rig = getRig(anim);
    const target = params.boneId ? String(params.boneId) : null;
    if (!target || !rig.bones.some((b) => b.id === target)) return { ok: false, error: "bone not found" };
    // Remove the bone and any descendants.
    const removed = new Set([target]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of rig.bones) {
        if (b.parentId && removed.has(b.parentId) && !removed.has(b.id)) { removed.add(b.id); grew = true; }
      }
    }
    rig.bones = rig.bones.filter((b) => !removed.has(b.id));
    for (const fid of Object.keys(rig.poses)) {
      for (const bid of removed) delete rig.poses[fid]?.[bid];
    }
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { deleted: [...removed], boneCount: rig.bones.length } };
  });

  registerLensAction("animation", "rig-pose-set", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const rig = getRig(anim);
    const bone = rig.bones.find((b) => b.id === params.boneId);
    if (!bone) return { ok: false, error: "bone not found" };
    if (!rig.poses[frame.id]) rig.poses[frame.id] = {};
    rig.poses[frame.id][bone.id] = {
      angle: anClamp(params.angle, -360, 360, bone.angle),
      x: params.x != null ? Math.round(anClamp(params.x, -2, anim.width + 2, bone.x)) : undefined,
      y: params.y != null ? Math.round(anClamp(params.y, -2, anim.height + 2, bone.y)) : undefined,
    };
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { frameId: frame.id, boneId: bone.id, pose: rig.poses[frame.id][bone.id] } };
  });

  registerLensAction("animation", "rig-get", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const rig = getRig(anim);
    return { ok: true, result: { bones: rig.bones, poses: rig.poses, boneCount: rig.bones.length } };
  });

  // Forward-kinematics: resolve absolute bone tip positions for a frame.
  registerLensAction("animation", "rig-resolve-pose", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const rig = getRig(anim);
    const pose = rig.poses[frame.id] || {};
    const byId = new Map(rig.bones.map((b) => [b.id, b]));
    const resolved = new Map();
    const resolve = (bone) => {
      if (resolved.has(bone.id)) return resolved.get(bone.id);
      const p = pose[bone.id] || {};
      const angle = (p.angle != null ? p.angle : bone.angle) * Math.PI / 180;
      let originX, originY;
      if (bone.parentId && byId.has(bone.parentId)) {
        const parent = resolve(byId.get(bone.parentId));
        originX = p.x != null ? p.x : parent.tipX;
        originY = p.y != null ? p.y : parent.tipY;
      } else {
        originX = p.x != null ? p.x : bone.x;
        originY = p.y != null ? p.y : bone.y;
      }
      const tipX = Math.round((originX + Math.cos(angle) * bone.length) * 100) / 100;
      const tipY = Math.round((originY + Math.sin(angle) * bone.length) * 100) / 100;
      const r = { id: bone.id, name: bone.name, originX: Math.round(originX * 100) / 100, originY: Math.round(originY * 100) / 100, tipX, tipY };
      resolved.set(bone.id, r);
      return r;
    };
    const segments = rig.bones.map(resolve);
    return { ok: true, result: { frameId: frame.id, segments, boneCount: segments.length } };
  });

  // ── Audio waveform display + sync scrubbing ─────────────────────────
  // Client decodes audio (Web Audio API) and posts peak samples; the
  // backend stores them so they can be drawn against the frame timeline.
  registerLensAction("animation", "audio-waveform-set", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const track = (anim.audio || []).find((t) => t.id === params.trackId);
    if (!track) return { ok: false, error: "audio track not found" };
    const peaks = Array.isArray(params.peaks) ? params.peaks : [];
    if (!peaks.length) return { ok: false, error: "peaks array required" };
    track.durationSec = Math.max(0, anNum(params.durationSec));
    track.waveform = peaks.slice(0, 2000).map((p) => Math.round(anClamp(p, 0, 1, 0) * 1000) / 1000);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { trackId: track.id, peakCount: track.waveform.length, durationSec: track.durationSec } };
  });

  // Compute which animation frames each audio track spans — for scrub sync.
  registerLensAction("animation", "audio-sync-map", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    const fps = anim.fps;
    const totalFrames = anim.frames.reduce((n, f) => n + f.exposure, 0);
    const tracks = (anim.audio || []).map((t) => {
      const startFrame = Math.round((t.startSec || 0) * fps);
      const dur = anNum(t.durationSec);
      const endFrame = dur > 0 ? startFrame + Math.round(dur * fps) : null;
      return {
        id: t.id, name: t.name, startSec: t.startSec || 0, durationSec: dur,
        startFrame, endFrame, waveformPoints: (t.waveform || []).length,
        waveform: t.waveform || [],
      };
    });
    return { ok: true, result: { fps, totalFrames, durationSec: Math.round((totalFrames / fps) * 100) / 100, tracks } };
  });

  // ── Video export (MP4 / GIF / WebM) ─────────────────────────────────
  // The browser does the actual encoding (WebCodecs / gif.js). The
  // backend builds a deterministic per-frame render manifest the client
  // walks, and tracks export jobs so completed exports are discoverable.
  registerLensAction("animation", "export-manifest", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    const format = ["mp4", "gif", "webm", "png-sequence"].includes(String(params.format))
      ? String(params.format) : "mp4";
    const scale = anClamp(params.scale, 0.1, 2, 1);
    const outW = Math.round(anim.width * scale);
    const outH = Math.round(anim.height * scale);
    // Walk the exposure-expanded sequence — one render entry per output frame.
    const sequence = [];
    anim.frames.forEach((f, idx) => {
      for (let i = 0; i < f.exposure; i++) {
        sequence.push({ outFrame: sequence.length, sourceFrameId: f.id, sourceIndex: idx });
      }
    });
    return {
      ok: true,
      result: {
        format, fps: anim.fps, width: outW, height: outH, scale,
        background: anim.background,
        frameCount: sequence.length,
        durationSec: Math.round((sequence.length / anim.fps) * 100) / 100,
        sequence,
        audio: (anim.audio || []).map((t) => ({ id: t.id, url: t.url, startSec: t.startSec || 0 })),
      },
    };
  });

  function getExports(s, userId) {
    return anListB(s.exports ||= new Map(), userId);
  }
  registerLensAction("animation", "export-record", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const format = ["mp4", "gif", "webm", "png-sequence"].includes(String(params.format))
      ? String(params.format) : "mp4";
    const list = getExports(s, anAid(ctx));
    if (list.length >= 50) list.shift();
    const job = {
      id: anId("exp"),
      animId: anim.id,
      animTitle: anim.title,
      format,
      width: Math.round(anClamp(params.width, 16, 6000, anim.width)),
      height: Math.round(anClamp(params.height, 16, 6000, anim.height)),
      fps: anim.fps,
      frameCount: Math.max(0, Math.round(anNum(params.frameCount))),
      fileSizeBytes: Math.max(0, Math.round(anNum(params.fileSizeBytes))),
      durationSec: Math.max(0, anNum(params.durationSec)),
      status: "complete",
      createdAt: anNow(),
    };
    list.push(job);
    saveAnimState();
    return { ok: true, result: { export: job } };
  });

  registerLensAction("animation", "export-list", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let list = getExports(s, anAid(ctx));
    if (params.animId) list = list.filter((e) => e.animId === params.animId);
    return { ok: true, result: { exports: [...list].reverse(), count: list.length } };
  });

  // ── Project templates ───────────────────────────────────────────────
  // Templates are structural starting points — they seed canvas size,
  // fps, frame count and per-frame layer scaffolding, never sample art.
  const AN_TEMPLATES = [
    {
      id: "blank-12", label: "Blank · 12 fps", description: "A clean 16:9 canvas at 12 fps with one frame.",
      width: 960, height: 540, fps: 12, frames: 1, layers: ["Layer 1"],
    },
    {
      id: "walk-cycle", label: "Walk Cycle (8-frame)", description: "Eight-frame loop scaffold with separate body and limb layers.",
      width: 960, height: 540, fps: 12, frames: 8, layers: ["Background", "Body", "Limbs"],
    },
    {
      id: "lip-sync", label: "Lip-Sync Scene", description: "Dialogue-ready scene with character, mouth and background layers.",
      width: 1280, height: 720, fps: 24, frames: 4, layers: ["Background", "Character", "Mouth"],
    },
    {
      id: "title-card", label: "Title Card", description: "Square title sequence with text and effects layers.",
      width: 1080, height: 1080, fps: 30, frames: 6, layers: ["Background", "Text", "Effects"],
    },
    {
      id: "pixel-sprite", label: "Pixel Sprite Sheet", description: "Tiny pixel-art canvas with a 6-frame action loop.",
      width: 128, height: 128, fps: 12, frames: 6, layers: ["Sprite"],
    },
    {
      id: "storyboard", label: "Storyboard Sequence", description: "Twelve framed panels for blocking out a sequence.",
      width: 1280, height: 720, fps: 24, frames: 12, layers: ["Panel", "Notes"],
    },
  ];

  registerLensAction("animation", "template-list", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { templates: AN_TEMPLATES, count: AN_TEMPLATES.length } };
  });

  registerLensAction("animation", "anim-from-template", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tpl = AN_TEMPLATES.find((t) => t.id === String(params.templateId));
    if (!tpl) return { ok: false, error: "template not found" };
    const frameCount = Math.min(AN_MAX_FRAMES, Math.max(1, tpl.frames));
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const layers = tpl.layers.map((name) => blankLayer(name));
      frames.push({ id: anId("frm"), exposure: 1, layers, strokes: [] });
    }
    const anim = {
      id: anId("anm"),
      title: anClean(params.title, 120) || tpl.label,
      width: tpl.width, height: tpl.height, fps: tpl.fps,
      background: anHex(params.background) || "#ffffff",
      frames,
      thumbnail: null,
      templateId: tpl.id,
      createdAt: anNow(), updatedAt: anNow(),
    };
    anListB(s.projects, anAid(ctx)).push(anim);
    saveAnimState();
    return { ok: true, result: { animation: anim, templateId: tpl.id } };
  });

  // ── Shareable export link ───────────────────────────────────────────
  function getShares(s) {
    return s.shares ||= new Map();
  }
  registerLensAction("animation", "share-create", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const shares = getShares(s);
    // One live share per animation — reuse if it already exists.
    let existing = null;
    for (const sh of shares.values()) {
      if (sh.animId === anim.id && sh.ownerId === anAid(ctx)) { existing = sh; break; }
    }
    const token = existing ? existing.token : anId("shr");
    const share = {
      token,
      animId: anim.id,
      ownerId: anAid(ctx),
      title: anim.title,
      allowDownload: params.allowDownload !== false,
      views: existing ? existing.views : 0,
      createdAt: existing ? existing.createdAt : anNow(),
      url: `/share/animation/${token}`,
    };
    shares.set(token, share);
    anim.shareToken = token;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { share } };
  });

  registerLensAction("animation", "share-get", (_ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shares = getShares(s);
    const share = shares.get(String(params.token));
    if (!share) return { ok: false, error: "share link not found" };
    share.views = (share.views || 0) + 1;
    const owner = s.projects.get(share.ownerId) || [];
    const anim = owner.find((a) => a.id === share.animId);
    if (!anim) return { ok: false, error: "shared animation no longer exists" };
    saveAnimState();
    return {
      ok: true,
      result: {
        share: { token: share.token, title: share.title, views: share.views, allowDownload: share.allowDownload },
        animation: {
          id: anim.id, title: anim.title, width: anim.width, height: anim.height,
          fps: anim.fps, background: anim.background, thumbnail: anim.thumbnail,
          frames: share.allowDownload ? anim.frames : undefined,
          frameCount: anim.frames.length,
        },
      },
    };
  });

  registerLensAction("animation", "share-revoke", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shares = getShares(s);
    const share = shares.get(String(params.token));
    if (!share || share.ownerId !== anAid(ctx)) return { ok: false, error: "share link not found" };
    shares.delete(share.token);
    const owner = s.projects.get(share.ownerId) || [];
    const anim = owner.find((a) => a.id === share.animId);
    if (anim && anim.shareToken === share.token) delete anim.shareToken;
    saveAnimState();
    return { ok: true, result: { revoked: share.token } };
  });
}
