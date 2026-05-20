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
  registerLensAction("photography", "exposureCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const iso = parseInt(data.iso) || 100; const aperture = parseFloat(data.aperture) || 5.6; const ev = parseFloat(data.ev) || 12; const shutterSpeed = 1 / (Math.pow(2, ev) * Math.pow(aperture, 2) / (iso * 0.297)); const readable = shutterSpeed >= 1 ? `${Math.round(shutterSpeed)}s` : `1/${Math.round(1/shutterSpeed)}s`; return { ok: true, result: { iso, aperture: `f/${aperture}`, ev, shutterSpeed: readable, depthOfField: aperture <= 2.8 ? "shallow" : aperture <= 8 ? "moderate" : "deep", motionBlur: shutterSpeed > 0.033 ? "likely" : "frozen", handheld: shutterSpeed < 1/(aperture*2) ? "ok" : "use-tripod" } }; });
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
