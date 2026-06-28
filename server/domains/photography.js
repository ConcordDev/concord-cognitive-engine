// server/domains/photography.js
//
// Pure-compute photography helpers (exposure calc, composition score,
// gear recommendation, print size, vision via LLaVA) plus real Pexels
// stock photo search (free with API key from pexels.com/api).

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

const PEXELS_BASE = "https://api.pexels.com/v1";

export default function registerPhotographyActions(registerLensAction) {
  registerLensAction("photography", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("photography");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("photography", "exposureCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const fin = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) && n !== 0 ? n : d; }; const finInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n !== 0 ? n : d; }; const iso = finInt(data.iso, 100); const aperture = fin(data.aperture, 5.6); const ev = fin(data.ev, 12); const shutterSpeed = 1 / (Math.pow(2, ev) * Math.pow(aperture, 2) / (iso * 0.297)); const readable = shutterSpeed >= 1 ? `${Math.round(shutterSpeed)}s` : `1/${Math.round(1/shutterSpeed)}s`; return { ok: true, result: { iso, aperture: `f/${aperture}`, ev, shutterSpeed: readable, depthOfField: aperture <= 2.8 ? "shallow" : aperture <= 8 ? "moderate" : "deep", motionBlur: shutterSpeed > 0.033 ? "likely" : "frozen", handheld: shutterSpeed < 1/(aperture*2) ? "ok" : "use-tripod" } }; });
  registerLensAction("photography", "compositionAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const rules = ["rule-of-thirds","leading-lines","symmetry","framing","depth","negative-space","golden-ratio","patterns"]; const applied = (data.compositionRules || []).filter(r => rules.includes(r.toLowerCase())); return { ok: true, result: { rulesApplied: applied, score: Math.round((applied.length / rules.length) * 100), allRules: rules, suggestions: rules.filter(r => !applied.includes(r)).slice(0,3), strength: applied.length >= 3 ? "strong-composition" : applied.length >= 1 ? "basic-composition" : "no-rules-applied" } }; });
  registerLensAction("photography", "gearRecommend", (ctx, artifact, _params) => { const data = artifact.data || {}; const genre = (data.genre || data.style || "general").toLowerCase(); const budget = (data.budget || "medium").toLowerCase(); const recs = { portrait: { lens: "85mm f/1.8", lighting: "Softbox or natural window light", accessory: "Reflector" }, landscape: { lens: "16-35mm f/4", lighting: "Golden hour", accessory: "Tripod + filters" }, street: { lens: "35mm f/2", lighting: "Available light", accessory: "Small bag" }, macro: { lens: "100mm f/2.8 Macro", lighting: "Ring light", accessory: "Focus rail" }, sports: { lens: "70-200mm f/2.8", lighting: "High ISO capability", accessory: "Monopod" }, general: { lens: "24-70mm f/2.8", lighting: "Speedlight", accessory: "Camera bag" } }; const rec = recs[genre] || recs.general; return { ok: true, result: { genre, budget, recommendation: rec, tip: genre === "portrait" ? "Shoot wide open for creamy bokeh" : genre === "landscape" ? "Use f/8-f/11 for maximum sharpness" : "Practice with what you have" } }; });
  registerLensAction("photography", "printSize", (ctx, artifact, _params) => { const data = artifact.data || {}; const widthPx = parseInt(data.widthPixels) || 4000; const heightPx = parseInt(data.heightPixels) || 3000; const dpi = parseInt(data.dpi) || 300; const widthIn = Math.round(widthPx / dpi * 10) / 10; const heightIn = Math.round(heightPx / dpi * 10) / 10; const megapixels = Math.round(widthPx * heightPx / 1000000 * 10) / 10; const maxPrint = { at300dpi: `${widthIn}" x ${heightIn}"`, at150dpi: `${Math.round(widthPx/150*10)/10}" x ${Math.round(heightPx/150*10)/10}"` }; return { ok: true, result: { resolution: `${widthPx} x ${heightPx}`, megapixels, maxPrintAt300DPI: maxPrint.at300dpi, maxPrintAt150DPI: maxPrint.at150dpi, quality: widthPx >= 4000 ? "professional" : widthPx >= 2000 ? "good" : "web-only" } }; });

  /**
   * pexels-search — Real Pexels stock photo search. Requires
   * PEXELS_API_KEY env (free at pexels.com/api).
   * params: { query, perPage?: 1-80, orientation?: "landscape"|"portrait"|"square" }
   */
  registerLensAction("photography", "pexels-search", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return { ok: false, error: "PEXELS_API_KEY env required (free at pexels.com/api)" };
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const perPage = Math.max(1, Math.min(80, Number(params.perPage) || 15));
    const orientation = ["landscape", "portrait", "square"].includes(params.orientation) ? `&orientation=${params.orientation}` : "";
    try {
      const r = await fetch(`${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orientation}`, {
        headers: { Authorization: apiKey },
      });
      if (r.status === 401) return { ok: false, error: "PEXELS_API_KEY invalid" };
      if (!r.ok) throw new Error(`pexels ${r.status}`);
      const data = await r.json();
      const photos = (data.photos || []).map((p) => ({
        id: p.id,
        photographer: p.photographer,
        photographerUrl: p.photographer_url,
        width: p.width,
        height: p.height,
        avgColor: p.avg_color,
        originalUrl: p.src?.original,
        largeUrl: p.src?.large,
        mediumUrl: p.src?.medium,
        smallUrl: p.src?.small,
        portraitUrl: p.src?.portrait,
        landscapeUrl: p.src?.landscape,
        tinyUrl: p.src?.tiny,
        pexelsUrl: p.url,
        alt: p.alt,
      }));
      return {
        ok: true,
        result: {
          query, photos, count: photos.length,
          totalResults: data.total_results,
          nextPage: data.next_page,
          source: "pexels",
        },
      };
    } catch (e) {
      return { ok: false, error: `pexels unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Adobe Lightroom 2026 parity — photo catalog ────────────────────
  // Catalog/library, albums, culling (rating/flag/colour), keywords,
  // develop presets + adjustments, shoots, export presets. All
  // STATE-backed, per-user scoped.

  function getPhotoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.photographyLens) STATE.photographyLens = {};
    const s = STATE.photographyLens;
    for (const k of ["photos", "albums", "presets", "shoots", "exportPresets"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePhotoState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const phid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const phnow = () => new Date().toISOString();
  const phaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const phlistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const phnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const phclamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const phclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const findPhoto = (s, userId, id) => (s.photos.get(userId) || []).find((p) => p.id === id) || null;

  // develop adjustment schema — each field clamped to a real range
  const ADJ_RANGES = {
    exposure: [-5, 5], contrast: [-100, 100], highlights: [-100, 100],
    shadows: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
    vibrance: [-100, 100], saturation: [-100, 100], clarity: [-100, 100],
    temperature: [2000, 50000], tint: [-150, 150], dehaze: [-100, 100],
  };
  function normalizeAdjustments(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [k, [lo, hi]] of Object.entries(ADJ_RANGES)) {
      if (raw[k] != null && Number.isFinite(Number(raw[k]))) {
        out[k] = phclamp(Number(raw[k]), lo, hi);
      }
    }
    return out;
  }

  // ── Photos / catalog ────────────────────────────────────────────────
  registerLensAction("photography", "photo-import", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const filename = phclean(params.filename, 200);
    if (!filename) return { ok: false, error: "filename required" };
    const photo = {
      id: phid("img"), filename,
      title: phclean(params.title, 160) || filename,
      camera: phclean(params.camera, 80) || null,
      lens: phclean(params.lens, 80) || null,
      iso: Math.max(0, Math.round(phnum(params.iso))) || null,
      aperture: phnum(params.aperture) || null,
      shutter: phclean(params.shutter, 24) || null,
      focalLength: Math.max(0, Math.round(phnum(params.focalLength))) || null,
      width: Math.max(0, Math.round(phnum(params.width))) || null,
      height: Math.max(0, Math.round(phnum(params.height))) || null,
      captureDate: phclean(params.captureDate, 10) || null,
      rating: 0, flag: "unflagged", colorLabel: null,
      keywords: [], develop: {}, shootId: null,
      importedAt: phnow(),
    };
    phlistB(s.photos, phaid(ctx)).push(photo);
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "photo-list", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let photos = [...(s.photos.get(phaid(ctx)) || [])];
    if (params.minRating != null) photos = photos.filter((p) => p.rating >= Math.round(phnum(params.minRating)));
    if (params.flag) photos = photos.filter((p) => p.flag === String(params.flag).toLowerCase());
    if (params.keyword) photos = photos.filter((p) => p.keywords.includes(String(params.keyword).toLowerCase()));
    if (params.shootId) photos = photos.filter((p) => p.shootId === String(params.shootId));
    photos.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    return { ok: true, result: { photos, count: photos.length } };
  });

  registerLensAction("photography", "photo-detail", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const albums = (s.albums.get(phaid(ctx)) || []).filter((al) => al.photoIds.includes(photo.id));
    return { ok: true, result: { photo, albums: albums.map((a) => ({ id: a.id, name: a.name })) } };
  });

  registerLensAction("photography", "photo-update", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    if (params.title != null) photo.title = phclean(params.title, 160) || photo.title;
    if (params.camera != null) photo.camera = phclean(params.camera, 80) || null;
    if (params.lens != null) photo.lens = phclean(params.lens, 80) || null;
    if (Array.isArray(params.keywords)) {
      photo.keywords = [...new Set(params.keywords.map((k) => phclean(k, 60).toLowerCase()).filter(Boolean))].slice(0, 50);
    }
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "photo-delete", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const arr = s.photos.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "photo not found" };
    arr.splice(i, 1);
    for (const al of s.albums.get(userId) || []) al.photoIds = al.photoIds.filter((x) => x !== params.id);
    savePhotoState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Culling — rating / flag / colour ────────────────────────────────
  registerLensAction("photography", "photo-rate", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    photo.rating = phclamp(Math.round(phnum(params.rating)), 0, 5);
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "photo-flag", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    photo.flag = ["pick", "reject", "unflagged"].includes(String(params.flag).toLowerCase())
      ? String(params.flag).toLowerCase() : "unflagged";
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "photo-color-label", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const label = String(params.colorLabel || "").toLowerCase();
    photo.colorLabel = ["red", "yellow", "green", "blue", "purple"].includes(label) ? label : null;
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "cull-summary", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photos = s.photos.get(phaid(ctx)) || [];
    const byRating = {};
    for (let r = 0; r <= 5; r++) byRating[r] = photos.filter((p) => p.rating === r).length;
    return {
      ok: true,
      result: {
        total: photos.length,
        picks: photos.filter((p) => p.flag === "pick").length,
        rejects: photos.filter((p) => p.flag === "reject").length,
        unflagged: photos.filter((p) => p.flag === "unflagged").length,
        byRating,
        fiveStar: byRating[5],
      },
    };
  });

  // ── Keywords + search ───────────────────────────────────────────────
  registerLensAction("photography", "keyword-add", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const kw = phclean(params.keyword, 60).toLowerCase();
    if (!kw) return { ok: false, error: "keyword required" };
    if (params.remove === true) photo.keywords = photo.keywords.filter((k) => k !== kw);
    else if (!photo.keywords.includes(kw)) photo.keywords.push(kw);
    savePhotoState();
    return { ok: true, result: { keywords: photo.keywords } };
  });

  registerLensAction("photography", "keyword-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = new Map();
    for (const p of s.photos.get(phaid(ctx)) || []) {
      for (const k of p.keywords) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const keywords = [...counts.entries()]
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, result: { keywords } };
  });

  registerLensAction("photography", "photo-search", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = phclean(params.query, 80).toLowerCase();
    let photos = [...(s.photos.get(phaid(ctx)) || [])];
    if (q) {
      photos = photos.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        (p.camera || "").toLowerCase().includes(q) ||
        (p.lens || "").toLowerCase().includes(q) ||
        p.keywords.some((k) => k.includes(q)));
    }
    return { ok: true, result: { photos, count: photos.length } };
  });

  // ── Develop presets + adjustments ───────────────────────────────────
  registerLensAction("photography", "preset-create", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 80);
    if (!name) return { ok: false, error: "preset name required" };
    const preset = {
      id: phid("pst"), name,
      category: phclean(params.category, 40).toLowerCase() || "user",
      adjustments: normalizeAdjustments(params.adjustments),
      createdAt: phnow(),
    };
    phlistB(s.presets, phaid(ctx)).push(preset);
    savePhotoState();
    return { ok: true, result: { preset } };
  });

  registerLensAction("photography", "preset-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { presets: s.presets.get(phaid(ctx)) || [] } };
  });

  registerLensAction("photography", "preset-apply", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photo = findPhoto(s, userId, params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    const preset = (s.presets.get(userId) || []).find((p) => p.id === params.presetId);
    if (!preset) return { ok: false, error: "preset not found" };
    photo.develop = { ...photo.develop, ...preset.adjustments };
    photo.appliedPreset = preset.name;
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("photography", "preset-delete", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.presets.get(phaid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "preset not found" };
    arr.splice(i, 1);
    savePhotoState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("photography", "develop-set", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    photo.develop = { ...photo.develop, ...normalizeAdjustments(params.adjustments) };
    photo.appliedPreset = null;
    savePhotoState();
    return { ok: true, result: { photo, ranges: ADJ_RANGES } };
  });

  registerLensAction("photography", "develop-reset", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    photo.develop = {};
    photo.appliedPreset = null;
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  // ── Shoots / sessions ───────────────────────────────────────────────
  registerLensAction("photography", "shoot-create", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 120);
    if (!name) return { ok: false, error: "shoot name required" };
    const shoot = {
      id: phid("sht"), name,
      date: phclean(params.date, 10) || null,
      location: phclean(params.location, 120) || null,
      client: phclean(params.client, 120) || null,
      createdAt: phnow(),
    };
    phlistB(s.shoots, phaid(ctx)).push(shoot);
    savePhotoState();
    return { ok: true, result: { shoot } };
  });

  registerLensAction("photography", "shoot-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photos = s.photos.get(userId) || [];
    const shoots = (s.shoots.get(userId) || []).map((sh) => ({
      ...sh, photoCount: photos.filter((p) => p.shootId === sh.id).length,
    }));
    return { ok: true, result: { shoots, count: shoots.length } };
  });

  registerLensAction("photography", "shoot-assign", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photo = findPhoto(s, userId, params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    if (params.shootId) {
      const shoot = (s.shoots.get(userId) || []).find((sh) => sh.id === params.shootId);
      if (!shoot) return { ok: false, error: "shoot not found" };
      photo.shootId = shoot.id;
    } else {
      photo.shootId = null;
    }
    savePhotoState();
    return { ok: true, result: { photo } };
  });

  // ── Albums ──────────────────────────────────────────────────────────
  registerLensAction("photography", "album-create", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 120);
    if (!name) return { ok: false, error: "album name required" };
    const album = {
      id: phid("alb"), name,
      description: phclean(params.description, 300) || null,
      photoIds: [], createdAt: phnow(),
    };
    phlistB(s.albums, phaid(ctx)).push(album);
    savePhotoState();
    return { ok: true, result: { album } };
  });

  registerLensAction("photography", "album-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const albums = (s.albums.get(phaid(ctx)) || []).map((a) => ({ ...a, photoCount: a.photoIds.length }));
    return { ok: true, result: { albums, count: albums.length } };
  });

  registerLensAction("photography", "album-add-photo", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const album = (s.albums.get(userId) || []).find((a) => a.id === params.albumId);
    if (!album) return { ok: false, error: "album not found" };
    if (!findPhoto(s, userId, params.photoId)) return { ok: false, error: "photo not found" };
    if (params.remove === true) album.photoIds = album.photoIds.filter((x) => x !== params.photoId);
    else if (!album.photoIds.includes(params.photoId)) album.photoIds.push(String(params.photoId));
    savePhotoState();
    return { ok: true, result: { albumId: album.id, photoCount: album.photoIds.length, added: !params.remove } };
  });

  registerLensAction("photography", "album-detail", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const album = (s.albums.get(userId) || []).find((a) => a.id === params.id);
    if (!album) return { ok: false, error: "album not found" };
    const photos = album.photoIds.map((id) => findPhoto(s, userId, id)).filter(Boolean);
    return { ok: true, result: { album, photos } };
  });

  registerLensAction("photography", "album-delete", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.albums.get(phaid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "album not found" };
    arr.splice(i, 1);
    savePhotoState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Export presets ──────────────────────────────────────────────────
  registerLensAction("photography", "export-preset-save", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 80);
    if (!name) return { ok: false, error: "preset name required" };
    const preset = {
      id: phid("exp"), name,
      format: ["jpeg", "png", "tiff", "webp", "dng"].includes(String(params.format).toLowerCase())
        ? String(params.format).toLowerCase() : "jpeg",
      quality: phclamp(Math.round(phnum(params.quality, 90)), 1, 100),
      longEdge: Math.max(0, Math.round(phnum(params.longEdge))) || null,
      watermark: params.watermark === true,
      createdAt: phnow(),
    };
    phlistB(s.exportPresets, phaid(ctx)).push(preset);
    savePhotoState();
    return { ok: true, result: { preset } };
  });

  registerLensAction("photography", "export-preset-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { presets: s.exportPresets.get(phaid(ctx)) || [] } };
  });

  // ── Catalog stats ───────────────────────────────────────────────────
  registerLensAction("photography", "catalog-stats", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photos = s.photos.get(userId) || [];
    const byCamera = {};
    const byLens = {};
    for (const p of photos) {
      if (p.camera) byCamera[p.camera] = (byCamera[p.camera] || 0) + 1;
      if (p.lens) byLens[p.lens] = (byLens[p.lens] || 0) + 1;
    }
    const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    return {
      ok: true,
      result: {
        photos: photos.length,
        albums: (s.albums.get(userId) || []).length,
        shoots: (s.shoots.get(userId) || []).length,
        presets: (s.presets.get(userId) || []).length,
        picks: photos.filter((p) => p.flag === "pick").length,
        edited: photos.filter((p) => Object.keys(p.develop).length > 0).length,
        topCameras: top(byCamera),
        topLenses: top(byLens),
      },
    };
  });

  // ─── Lightroom-parity backlog: RAW develop, histogram + tone curve,
  // local masks, cull filter, smart collections, face tags, batch
  // preset sync, lens correction + geometry. All STATE-backed,
  // per-user, pure-compute (no native RAW decoder needed). ──────────

  // Ensure the extra Maps exist on first touch.
  function getPhotoStateExt() {
    const s = getPhotoState();
    if (!s) return null;
    for (const k of ["toneCurves", "smartCollections"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // ── Item 1: RAW develop pipeline ────────────────────────────────────
  // True non-destructive tone-mapping math: a RAW file is modelled as a
  // linear-light buffer; we compute the develop transform (white
  // balance multipliers, tone curve, exposure) as a deterministic LUT
  // the client applies. No pixels are mutated server-side — the photo
  // keeps a `raw` flag + a `rawDevelop` settings object.
  const KELVIN_REF = 6500;
  function whiteBalanceMultipliers(tempK, tint) {
    // Approximate channel gains from colour temperature. Warmer (lower
    // K) lifts red, cooler lifts blue; tint shifts green↔magenta.
    const t = phclamp(phnum(tempK, KELVIN_REF), 2000, 50000);
    const ratio = KELVIN_REF / t;
    const rGain = Math.pow(ratio, 0.55);
    const bGain = Math.pow(1 / ratio, 0.55);
    const g = phclamp(phnum(tint, 0), -150, 150);
    const gGain = 1 - g / 600;
    const norm = (rGain + gGain + bGain) / 3;
    return {
      r: Math.round((rGain / norm) * 1000) / 1000,
      g: Math.round((gGain / norm) * 1000) / 1000,
      b: Math.round((bGain / norm) * 1000) / 1000,
    };
  }
  // Build a 256-entry tone LUT from a filmic-ish curve + exposure.
  function buildToneLUT(exposureStops, contrast, highlights, shadows) {
    const lut = new Array(256);
    const evMul = Math.pow(2, phclamp(phnum(exposureStops, 0), -5, 5));
    const c = phclamp(phnum(contrast, 0), -100, 100) / 100;
    const hi = phclamp(phnum(highlights, 0), -100, 100) / 100;
    const sh = phclamp(phnum(shadows, 0), -100, 100) / 100;
    for (let i = 0; i < 256; i++) {
      let v = (i / 255) * evMul;
      // S-curve contrast around mid-grey.
      v = v + c * (v - 0.5) * (1 - Math.abs(2 * v - 1));
      // Highlight + shadow region weighting.
      const hw = phclamp((v - 0.5) * 2, 0, 1);
      const sw = phclamp((0.5 - v) * 2, 0, 1);
      v = v + hi * hw * 0.25 - sh * sw * 0.25 * -1;
      lut[i] = phclamp(Math.round(v * 255), 0, 255);
    }
    return lut;
  }
  registerLensAction("photography", "raw-develop", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const isRaw = /\.(raw|dng|cr2|cr3|nef|arw|orf|raf|rw2)$/i.test(photo.filename || "");
    const adj = normalizeAdjustments(params.adjustments);
    const tempK = adj.temperature != null ? adj.temperature : KELVIN_REF;
    const wb = whiteBalanceMultipliers(tempK, adj.tint);
    const lut = buildToneLUT(adj.exposure, adj.contrast, adj.highlights, adj.shadows);
    photo.raw = isRaw;
    photo.rawDevelop = {
      whiteBalance: wb,
      temperature: tempK,
      tint: adj.tint != null ? adj.tint : 0,
      exposure: adj.exposure != null ? adj.exposure : 0,
      developedAt: phnow(),
    };
    photo.develop = { ...photo.develop, ...adj };
    savePhotoState();
    return {
      ok: true,
      result: {
        photoId: photo.id, isRaw,
        whiteBalance: wb,
        toneLUT: lut,
        rawDevelop: photo.rawDevelop,
      },
    };
  });
  registerLensAction("photography", "raw-decode-meta", (ctx, _a, params = {}) => {
  try {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const ext = (photo.filename || "").split(".").pop().toLowerCase();
    const RAW_FORMATS = {
      raw: "Generic RAW", dng: "Adobe DNG", cr2: "Canon RAW", cr3: "Canon RAW v3",
      nef: "Nikon RAW", arw: "Sony RAW", orf: "Olympus RAW", raf: "Fujifilm RAW", rw2: "Panasonic RAW",
    };
    const isRaw = !!RAW_FORMATS[ext];
    return {
      ok: true,
      result: {
        photoId: photo.id,
        format: RAW_FORMATS[ext] || "Non-RAW (JPEG/processed)",
        isRaw,
        bitDepth: isRaw ? 14 : 8,
        nondestructive: true,
        recoverableHighlights: isRaw ? "≈1.5 stops" : "minimal",
        recoverableShadows: isRaw ? "≈3 stops" : "≈1 stop",
        hasRawDevelop: !!photo.rawDevelop,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Item 2: Histogram + tone curve editor ───────────────────────────
  // Histogram is computed client-side from a sampled pixel buffer the
  // UI sends (256-bin RGB+luma counts). The macro validates, normalises
  // and derives clipping warnings. Tone curves are named, per-user,
  // reusable point sets (Lightroom point-curve idiom).
  registerLensAction("photography", "histogram-compute", (ctx, _a, params = {}) => {
  try {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const samples = Array.isArray(params.samples) ? params.samples : null;
    if (!samples || samples.length === 0) return { ok: false, error: "samples array required (pixel luma values 0-255)" };
    const luma = new Array(256).fill(0);
    const red = new Array(256).fill(0);
    const green = new Array(256).fill(0);
    const blue = new Array(256).fill(0);
    let total = 0;
    for (const px of samples) {
      if (Array.isArray(px) && px.length >= 3) {
        const r = phclamp(Math.round(phnum(px[0])), 0, 255);
        const g = phclamp(Math.round(phnum(px[1])), 0, 255);
        const b = phclamp(Math.round(phnum(px[2])), 0, 255);
        red[r]++; green[g]++; blue[b]++;
        luma[phclamp(Math.round(0.299 * r + 0.587 * g + 0.114 * b), 0, 255)]++;
      } else {
        const v = phclamp(Math.round(phnum(px)), 0, 255);
        luma[v]++; red[v]++; green[v]++; blue[v]++;
      }
      total++;
    }
    if (total === 0) return { ok: false, error: "no valid samples" };
    const clipShadows = luma[0] / total;
    const clipHighlights = luma[255] / total;
    let sum = 0, meanW = 0;
    for (let i = 0; i < 256; i++) { sum += luma[i]; meanW += i * luma[i]; }
    const mean = Math.round(meanW / sum);
    return {
      ok: true,
      result: {
        luma, red, green, blue, totalSamples: total,
        meanLuma: mean,
        clippedShadowsPct: Math.round(clipShadows * 1000) / 10,
        clippedHighlightsPct: Math.round(clipHighlights * 1000) / 10,
        exposureHint: mean < 85 ? "underexposed" : mean > 170 ? "overexposed" : "balanced",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  // Tone curve = ordered list of {x,y} control points, 0..255.
  function sanitizeCurvePoints(raw) {
    if (!Array.isArray(raw)) return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    const pts = raw
      .map((p) => ({ x: phclamp(Math.round(phnum(p && p.x)), 0, 255), y: phclamp(Math.round(phnum(p && p.y)), 0, 255) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    pts.sort((a, b) => a.x - b.x);
    if (pts.length < 2) return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    return pts.slice(0, 16);
  }
  // Build a 256-entry LUT by linear interpolation between curve points.
  function curveToLUT(points) {
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      let lo = points[0], hi = points[points.length - 1];
      for (let j = 0; j < points.length - 1; j++) {
        if (i >= points[j].x && i <= points[j + 1].x) { lo = points[j]; hi = points[j + 1]; break; }
      }
      const span = hi.x - lo.x;
      const t = span === 0 ? 0 : (i - lo.x) / span;
      lut[i] = phclamp(Math.round(lo.y + t * (hi.y - lo.y)), 0, 255);
    }
    return lut;
  }
  registerLensAction("photography", "tone-curve-save", (ctx, _a, params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 80);
    if (!name) return { ok: false, error: "curve name required" };
    const curve = {
      id: phid("crv"), name,
      channel: ["rgb", "red", "green", "blue"].includes(String(params.channel).toLowerCase())
        ? String(params.channel).toLowerCase() : "rgb",
      points: sanitizeCurvePoints(params.points),
      createdAt: phnow(),
    };
    phlistB(s.toneCurves, phaid(ctx)).push(curve);
    savePhotoState();
    return { ok: true, result: { curve, lut: curveToLUT(curve.points) } };
  });
  registerLensAction("photography", "tone-curve-list", (ctx, _a, _params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const curves = (s.toneCurves.get(phaid(ctx)) || []).map((c) => ({ ...c, lut: curveToLUT(c.points) }));
    return { ok: true, result: { curves, count: curves.length } };
  });
  registerLensAction("photography", "tone-curve-apply", (ctx, _a, params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photo = findPhoto(s, userId, params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    let points;
    if (Array.isArray(params.points)) {
      points = sanitizeCurvePoints(params.points);
    } else {
      const curve = (s.toneCurves.get(userId) || []).find((c) => c.id === params.curveId);
      if (!curve) return { ok: false, error: "tone curve not found" };
      points = curve.points;
    }
    photo.toneCurve = points;
    savePhotoState();
    return { ok: true, result: { photoId: photo.id, points, lut: curveToLUT(points) } };
  });
  registerLensAction("photography", "tone-curve-delete", (ctx, _a, params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.toneCurves.get(phaid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "tone curve not found" };
    arr.splice(i, 1);
    savePhotoState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Item 3: Local adjustments / masking ─────────────────────────────
  // Brush / linear-gradient / radial / subject masks. Each mask carries
  // a geometry spec + its own adjustment set. Stored on the photo.
  const MASK_KINDS = ["brush", "linear-gradient", "radial-gradient", "subject", "sky", "background"];
  function sanitizeMaskGeometry(kind, raw) {
    const g = raw && typeof raw === "object" ? raw : {};
    const num01 = (v, d = 0) => phclamp(phnum(v, d), 0, 1);
    if (kind === "radial-gradient") {
      return { cx: num01(g.cx, 0.5), cy: num01(g.cy, 0.5), rx: num01(g.rx, 0.25), ry: num01(g.ry, 0.25), feather: num01(g.feather, 0.5), invert: g.invert === true };
    }
    if (kind === "linear-gradient") {
      return { x1: num01(g.x1, 0.5), y1: num01(g.y1, 0), x2: num01(g.x2, 0.5), y2: num01(g.y2, 1), feather: num01(g.feather, 0.5) };
    }
    if (kind === "brush") {
      const strokes = Array.isArray(g.strokes) ? g.strokes.slice(0, 200).map((st) => ({
        x: num01(st && st.x), y: num01(st && st.y), size: num01(st && st.size, 0.05),
      })) : [];
      return { strokes, flow: num01(g.flow, 1) };
    }
    // subject / sky / background — AI-select masks carry just a label.
    return { autoSelect: kind };
  }
  registerLensAction("photography", "mask-create", (ctx, _a, params = {}) => {
  try {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    const kind = MASK_KINDS.includes(String(params.kind).toLowerCase())
      ? String(params.kind).toLowerCase() : null;
    if (!kind) return { ok: false, error: `kind must be one of ${MASK_KINDS.join(", ")}` };
    if (!Array.isArray(photo.masks)) photo.masks = [];
    const mask = {
      id: phid("msk"), kind,
      name: phclean(params.name, 80) || kind,
      geometry: sanitizeMaskGeometry(kind, params.geometry),
      adjustments: normalizeAdjustments(params.adjustments),
      opacity: phclamp(phnum(params.opacity, 1), 0, 1),
      createdAt: phnow(),
    };
    photo.masks.push(mask);
    savePhotoState();
    return { ok: true, result: { mask, maskCount: photo.masks.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("photography", "mask-list", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    return { ok: true, result: { masks: photo.masks || [], count: (photo.masks || []).length } };
  });
  registerLensAction("photography", "mask-update", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    const mask = (photo.masks || []).find((m) => m.id === params.maskId);
    if (!mask) return { ok: false, error: "mask not found" };
    if (params.name != null) mask.name = phclean(params.name, 80) || mask.name;
    if (params.geometry != null) mask.geometry = sanitizeMaskGeometry(mask.kind, params.geometry);
    if (params.adjustments != null) mask.adjustments = { ...mask.adjustments, ...normalizeAdjustments(params.adjustments) };
    if (params.opacity != null) mask.opacity = phclamp(phnum(params.opacity, mask.opacity), 0, 1);
    savePhotoState();
    return { ok: true, result: { mask } };
  });
  registerLensAction("photography", "mask-delete", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    const arr = photo.masks || [];
    const i = arr.findIndex((m) => m.id === params.maskId);
    if (i < 0) return { ok: false, error: "mask not found" };
    arr.splice(i, 1);
    savePhotoState();
    return { ok: true, result: { deleted: params.maskId, maskCount: arr.length } };
  });

  // ── Item 4: Star rating + color label filtering ─────────────────────
  // Full Lightroom cull filter — combine rating comparator, flag, and
  // colour-label set into one query.
  registerLensAction("photography", "cull-filter", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let photos = [...(s.photos.get(phaid(ctx)) || [])];
    const rating = params.rating != null ? phclamp(Math.round(phnum(params.rating)), 0, 5) : null;
    const cmp = ["gte", "lte", "eq"].includes(String(params.ratingCompare).toLowerCase())
      ? String(params.ratingCompare).toLowerCase() : "gte";
    if (rating != null) {
      photos = photos.filter((p) =>
        cmp === "eq" ? p.rating === rating : cmp === "lte" ? p.rating <= rating : p.rating >= rating);
    }
    if (params.flag) {
      const flags = (Array.isArray(params.flag) ? params.flag : [params.flag]).map((f) => String(f).toLowerCase());
      photos = photos.filter((p) => flags.includes(p.flag));
    }
    if (params.colorLabels) {
      const labels = (Array.isArray(params.colorLabels) ? params.colorLabels : [params.colorLabels])
        .map((c) => String(c).toLowerCase());
      photos = photos.filter((p) => p.colorLabel && labels.includes(p.colorLabel));
    }
    const sortBy = String(params.sortBy || "rating").toLowerCase();
    if (sortBy === "rating") photos.sort((a, b) => b.rating - a.rating);
    else photos.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    return {
      ok: true,
      result: {
        photos, count: photos.length,
        appliedFilter: { rating, ratingCompare: cmp, flag: params.flag || null, colorLabels: params.colorLabels || null, sortBy },
      },
    };
  });

  // ── Item 5: Keyword/face tags + smart collections ───────────────────
  // Face tags are per-photo named regions. Smart collections are saved
  // metadata queries that re-evaluate against the whole catalog.
  registerLensAction("photography", "face-tag-add", (ctx, _a, params = {}) => {
  try {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.photoId);
    if (!photo) return { ok: false, error: "photo not found" };
    const personName = phclean(params.personName, 80);
    if (!personName) return { ok: false, error: "personName required" };
    if (!Array.isArray(photo.faceTags)) photo.faceTags = [];
    const num01 = (v, d) => phclamp(phnum(v, d), 0, 1);
    const region = params.region && typeof params.region === "object"
      ? { x: num01(params.region.x, 0.4), y: num01(params.region.y, 0.3), w: num01(params.region.w, 0.2), h: num01(params.region.h, 0.2) }
      : { x: 0.4, y: 0.3, w: 0.2, h: 0.2 };
    if (params.remove === true) {
      photo.faceTags = photo.faceTags.filter((f) => f.personName.toLowerCase() !== personName.toLowerCase());
    } else {
      const tag = { id: phid("face"), personName, region };
      photo.faceTags.push(tag);
      // Also surface the person as a searchable keyword.
      const kw = personName.toLowerCase();
      if (!photo.keywords.includes(kw)) photo.keywords.push(kw);
    }
    savePhotoState();
    return { ok: true, result: { faceTags: photo.faceTags } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("photography", "face-tag-list", (ctx, _a, _params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = new Map();
    for (const p of s.photos.get(phaid(ctx)) || []) {
      for (const f of p.faceTags || []) {
        counts.set(f.personName, (counts.get(f.personName) || 0) + 1);
      }
    }
    const people = [...counts.entries()]
      .map(([personName, count]) => ({ personName, count }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, result: { people, count: people.length } };
  });
  // Smart collection rule evaluator — supports rating/flag/colour/
  // keyword/camera/lens/person criteria.
  function evalSmartRules(photo, rules) {
    for (const rule of rules) {
      const field = String(rule.field || "").toLowerCase();
      const op = String(rule.op || "eq").toLowerCase();
      const val = rule.value;
      let pv;
      if (field === "rating") pv = photo.rating;
      else if (field === "flag") pv = photo.flag;
      else if (field === "colorlabel") pv = photo.colorLabel;
      else if (field === "camera") pv = (photo.camera || "").toLowerCase();
      else if (field === "lens") pv = (photo.lens || "").toLowerCase();
      else if (field === "keyword") pv = photo.keywords;
      else if (field === "person") pv = (photo.faceTags || []).map((f) => f.personName.toLowerCase());
      else if (field === "edited") pv = Object.keys(photo.develop || {}).length > 0;
      else return false;
      const target = typeof val === "string" ? val.toLowerCase() : val;
      let pass;
      if (op === "contains" && Array.isArray(pv)) pass = pv.includes(target);
      else if (op === "gte") pass = phnum(pv) >= phnum(target);
      else if (op === "lte") pass = phnum(pv) <= phnum(target);
      else if (op === "neq") pass = pv !== target;
      else pass = Array.isArray(pv) ? pv.includes(target) : pv === target;
      if (!pass) return false;
    }
    return true;
  }
  registerLensAction("photography", "smart-collection-create", (ctx, _a, params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = phclean(params.name, 100);
    if (!name) return { ok: false, error: "collection name required" };
    const rawRules = Array.isArray(params.rules) ? params.rules : [];
    if (rawRules.length === 0) return { ok: false, error: "at least one rule required" };
    const rules = rawRules.slice(0, 12).map((r) => ({
      field: phclean(r && r.field, 30).toLowerCase(),
      op: phclean(r && r.op, 12).toLowerCase() || "eq",
      value: typeof (r && r.value) === "string" ? phclean(r.value, 80) : (r && r.value),
    }));
    const coll = { id: phid("smc"), name, rules, createdAt: phnow() };
    phlistB(s.smartCollections, phaid(ctx)).push(coll);
    savePhotoState();
    return { ok: true, result: { collection: coll } };
  });
  registerLensAction("photography", "smart-collection-list", (ctx, _a, _params = {}) => {
  try {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const photos = s.photos.get(userId) || [];
    const collections = (s.smartCollections.get(userId) || []).map((c) => ({
      ...c, matchCount: photos.filter((p) => evalSmartRules(p, c.rules)).length,
    }));
    return { ok: true, result: { collections, count: collections.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("photography", "smart-collection-eval", (ctx, _a, params = {}) => {
  try {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const coll = (s.smartCollections.get(userId) || []).find((c) => c.id === params.id);
    if (!coll) return { ok: false, error: "smart collection not found" };
    const photos = (s.photos.get(userId) || []).filter((p) => evalSmartRules(p, coll.rules));
    return { ok: true, result: { collection: { id: coll.id, name: coll.name }, photos, count: photos.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("photography", "smart-collection-delete", (ctx, _a, params = {}) => {
    const s = getPhotoStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.smartCollections.get(phaid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "smart collection not found" };
    arr.splice(i, 1);
    savePhotoState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Item 6: Preset sync + apply-to-batch ────────────────────────────
  // Copy develop settings (and optionally tone curve / lens correction)
  // across many photos in one call. Also a direct copy-from-photo path.
  registerLensAction("photography", "preset-apply-batch", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const preset = (s.presets.get(userId) || []).find((p) => p.id === params.presetId);
    if (!preset) return { ok: false, error: "preset not found" };
    const ids = Array.isArray(params.photoIds) ? params.photoIds : [];
    if (ids.length === 0) return { ok: false, error: "photoIds array required" };
    let applied = 0; const missed = [];
    for (const id of ids) {
      const photo = findPhoto(s, userId, id);
      if (!photo) { missed.push(id); continue; }
      photo.develop = { ...photo.develop, ...preset.adjustments };
      photo.appliedPreset = preset.name;
      applied++;
    }
    savePhotoState();
    return { ok: true, result: { applied, missed, presetName: preset.name } };
  });
  registerLensAction("photography", "develop-copy-paste", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phaid(ctx);
    const source = findPhoto(s, userId, params.sourceId);
    if (!source) return { ok: false, error: "source photo not found" };
    const ids = Array.isArray(params.targetIds) ? params.targetIds : [];
    if (ids.length === 0) return { ok: false, error: "targetIds array required" };
    const includeCurve = params.includeToneCurve === true;
    const includeLens = params.includeLensCorrection === true;
    let applied = 0; const missed = [];
    for (const id of ids) {
      const photo = findPhoto(s, userId, id);
      if (!photo || photo.id === source.id) { if (!photo) missed.push(id); continue; }
      photo.develop = { ...source.develop };
      photo.appliedPreset = source.appliedPreset || null;
      if (includeCurve && source.toneCurve) photo.toneCurve = [...source.toneCurve];
      if (includeLens && source.lensCorrection) photo.lensCorrection = { ...source.lensCorrection };
      applied++;
    }
    savePhotoState();
    return { ok: true, result: { applied, missed, sourceId: source.id, copiedToneCurve: includeCurve, copiedLensCorrection: includeLens } };
  });

  // ── Item 7: Lens correction / geometry ──────────────────────────────
  // Distortion / vignette / chromatic-aberration removal + perspective
  // (Upright) and crop/rotate geometry. Stored as a settings object the
  // client applies; values clamped to real ranges.
  registerLensAction("photography", "lens-correction-set", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    photo.lensCorrection = {
      enabled: params.enabled !== false,
      distortion: phclamp(phnum(params.distortion, 0), -100, 100),
      vignette: phclamp(phnum(params.vignette, 0), -100, 100),
      vignetteMidpoint: phclamp(phnum(params.vignetteMidpoint, 50), 0, 100),
      chromaticAberration: phclamp(phnum(params.chromaticAberration, 0), 0, 100),
      defringePurple: phclamp(phnum(params.defringePurple, 0), 0, 20),
      defringeGreen: phclamp(phnum(params.defringeGreen, 0), 0, 20),
      profile: phclean(params.profile, 80) || (photo.lens || "auto"),
      updatedAt: phnow(),
    };
    savePhotoState();
    return { ok: true, result: { photoId: photo.id, lensCorrection: photo.lensCorrection } };
  });
  registerLensAction("photography", "geometry-set", (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photo = findPhoto(s, phaid(ctx), params.id);
    if (!photo) return { ok: false, error: "photo not found" };
    const num01 = (v, d) => phclamp(phnum(v, d), 0, 1);
    const c = params.crop && typeof params.crop === "object" ? params.crop : {};
    photo.geometry = {
      rotation: phclamp(phnum(params.rotation, 0), -45, 45),
      straighten: phclamp(phnum(params.straighten, 0), -10, 10),
      verticalPerspective: phclamp(phnum(params.verticalPerspective, 0), -100, 100),
      horizontalPerspective: phclamp(phnum(params.horizontalPerspective, 0), -100, 100),
      aspectRatio: phclean(params.aspectRatio, 12) || "original",
      crop: {
        x: num01(c.x, 0), y: num01(c.y, 0),
        w: num01(c.w, 1), h: num01(c.h, 1),
      },
      flipHorizontal: params.flipHorizontal === true,
      flipVertical: params.flipVertical === true,
      updatedAt: phnow(),
    };
    savePhotoState();
    return { ok: true, result: { photoId: photo.id, geometry: photo.geometry } };
  });

  // feed — ingest real photography artworks from the Art Institute of
  // Chicago open API as visible DTUs. Free, no key.
  registerLensAction("photography", "feed", async (ctx, _a, params = {}) => {
    const s = getPhotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const page = (new Date().getDate() % 10) + 1;
    try {
      const r = await fetch(`https://api.artic.edu/api/v1/artworks/search?q=photograph&query[term][is_public_domain]=true&fields=id,title,artist_title,date_display,medium_display,image_id&limit=${limit}&page=${page}`);
      if (!r.ok) return { ok: false, error: `artic ${r.status}` };
      const data = await r.json();
      const works = (Array.isArray(data?.data) ? data.data : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const w of works) {
        const id = `artic_${w.id}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const title = `Photograph: ${w.title || "Untitled"}`;
        const imageUrl = w.image_id ? `https://www.artic.edu/iiif/2/${w.image_id}/full/843,/0/default.jpg` : null;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nArtist: ${w.artist_title || "Unknown"}\nDate: ${w.date_display || "?"}\nMedium: ${w.medium_display || "?"}\nCollection: Art Institute of Chicago`,
          tags: ["photography", "feed", "artwork", "artic"],
          source: "artic-feed",
          meta: { artworkId: w.id, title: w.title, artist: w.artist_title, imageUrl },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      savePhotoState();
      return { ok: true, result: { ingested, skipped, source: "artic-photography", dtuIds } };
    } catch (e) {
      return { ok: false, error: `artic unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
