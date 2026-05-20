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
  function blankFrame() {
    return { id: anId("frm"), exposure: 1, strokes: [] };
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
    const copy = {
      id: anId("frm"), exposure: src.exposure,
      strokes: src.strokes.map((st) => ({ ...st, id: anId("stk"), points: st.points.map((p) => [...p]) })),
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

  // ── Strokes ─────────────────────────────────────────────────────────
  registerLensAction("animation", "anim-stroke-commit", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    if (frame.strokes.length >= AN_MAX_STROKES) return { ok: false, error: "frame stroke limit reached" };
    const stroke = anSanitizeStroke(params.stroke, anim);
    if (!stroke) return { ok: false, error: "invalid stroke" };
    frame.strokes.push(stroke);
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { strokeId: stroke.id, strokeCount: frame.strokes.length } };
  });

  registerLensAction("animation", "anim-stroke-batch", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const incoming = Array.isArray(params.strokes) ? params.strokes : [];
    let added = 0;
    for (const raw of incoming) {
      if (frame.strokes.length >= AN_MAX_STROKES) break;
      const stroke = anSanitizeStroke(raw, anim);
      if (stroke) { frame.strokes.push(stroke); added += 1; }
    }
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { added, strokeCount: frame.strokes.length } };
  });

  registerLensAction("animation", "anim-stroke-undo", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    const removed = frame.strokes.pop() || null;
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { removed: removed?.id || null, strokeCount: frame.strokes.length } };
  });

  registerLensAction("animation", "frame-clear", (ctx, _a, params = {}) => {
    const s = getAnimState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = findAnim(s, anAid(ctx), params.animId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    frame.strokes = [];
    anim.updatedAt = anNow();
    saveAnimState();
    return { ok: true, result: { cleared: frame.id } };
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
}
