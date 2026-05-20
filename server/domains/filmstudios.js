// server/domains/filmstudios.js
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

export default function registerFilmStudiosActions(registerLensAction) {
  registerLensAction("film-studios", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("filmstudios");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("film-studios", "budgetBreakdown", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const totalBudget = parseFloat(data.totalBudget) || 0;
    const categories = { "above-the-line": 0.25, "below-the-line": 0.40, "post-production": 0.15, "marketing": 0.15, "contingency": 0.05 };
    const breakdown = Object.entries(categories).map(([cat, pct]) => ({ category: cat.replace(/-/g, " "), percentage: pct * 100, amount: Math.round(totalBudget * pct * 100) / 100 }));
    return { ok: true, result: { totalBudget, breakdown, aboveTheLine: { talent: Math.round(totalBudget * 0.12), director: Math.round(totalBudget * 0.08), producer: Math.round(totalBudget * 0.05) }, tip: totalBudget > 1000000 ? "Consider completion bond insurance" : "Indie budget — maximize crew flexibility" } };
  });
  registerLensAction("film-studios", "scheduleShoot", (ctx, artifact, _params) => {
    const scenes = artifact.data?.scenes || [];
    if (scenes.length === 0) return { ok: true, result: { message: "Add scenes with location and cast to schedule." } };
    const byLocation = {};
    for (const s of scenes) { const loc = s.location || "Studio"; if (!byLocation[loc]) byLocation[loc] = []; byLocation[loc].push(s); }
    const schedule = Object.entries(byLocation).map(([loc, locationScenes]) => ({ location: loc, scenes: locationScenes.length, estimatedDays: Math.ceil(locationScenes.length / 3), cast: [...new Set(locationScenes.flatMap(s => s.cast || []))] }));
    const totalDays = schedule.reduce((s, loc) => s + loc.estimatedDays, 0);
    return { ok: true, result: { locations: schedule, totalScenes: scenes.length, totalShootDays: totalDays, totalWeeks: Math.ceil(totalDays / 5), avgScenesPerDay: Math.round(scenes.length / totalDays * 10) / 10 } };
  });
  registerLensAction("film-studios", "castAnalysis", (ctx, artifact, _params) => {
    const cast = artifact.data?.cast || [];
    if (cast.length === 0) return { ok: true, result: { message: "Add cast members to analyze." } };
    const analyzed = cast.map(c => ({ name: c.name, role: c.role || "supporting", scenes: parseInt(c.sceneCount) || 0, dailyRate: parseFloat(c.dailyRate) || 0, totalCost: (parseInt(c.sceneCount) || 0) * (parseFloat(c.dailyRate) || 0) / 3 }));
    const totalCastBudget = analyzed.reduce((s, c) => s + c.totalCost, 0);
    return { ok: true, result: { cast: analyzed, totalCast: cast.length, leads: cast.filter(c => (c.role || "").toLowerCase().includes("lead")).length, totalCastBudget: Math.round(totalCastBudget), topCost: analyzed.sort((a, b) => b.totalCost - a.totalCost)[0]?.name } };
  });
  registerLensAction("film-studios", "postProductionTimeline", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const runtime = parseInt(data.runtimeMinutes) || 90;
    const vfxShots = parseInt(data.vfxShots) || 0;
    const baseWeeks = Math.ceil(runtime / 15);
    const editWeeks = baseWeeks;
    const soundWeeks = Math.ceil(baseWeeks * 0.6);
    const vfxWeeks = vfxShots > 0 ? Math.ceil(vfxShots / 10) : 0;
    const colorWeeks = Math.ceil(baseWeeks * 0.3);
    const totalWeeks = editWeeks + Math.max(soundWeeks, vfxWeeks) + colorWeeks;
    return { ok: true, result: { runtime, vfxShots, phases: [{ phase: "Edit", weeks: editWeeks }, { phase: "Sound Design & Mix", weeks: soundWeeks }, { phase: "VFX", weeks: vfxWeeks }, { phase: "Color Grading", weeks: colorWeeks }], totalWeeks, parallelizable: "Sound and VFX can run in parallel", estimatedCompletion: `${totalWeeks} weeks from wrap` } };
  });

  // ─── StudioBinder + DaVinci Resolve + Frame.io 2026 parity ──────────
  // A real production suite: projects, screenplay scenes, script
  // breakdown, shot lists, stripboard scheduling + call sheets, budget,
  // cast & crew, an edit timeline with timecode, and timecoded review.

  function getFmState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.filmLens) STATE.filmLens = {};
    const s = STATE.filmLens;
    for (const k of ["projects", "scenes", "breakdownEls", "shots", "shootDays",
      "budget", "cast", "crew", "sequences", "clips", "versions", "notes"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveFmState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const fmId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fmNow = () => new Date().toISOString();
  const fmAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fmListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const fmNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const fmClean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);
  const fmPick = (v, allowed, dflt) => (allowed.includes(String(v)) ? String(v) : dflt);
  function fmProject(s, userId, projectId) {
    return (s.projects.get(userId) || []).find((p) => p.id === projectId) || null;
  }
  function fmTimecode(frames, fps) {
    const f = Math.max(0, Math.round(frames));
    const r = fps > 0 ? fps : 24;
    const p2 = (n) => String(n).padStart(2, "0");
    const ff = f % r;
    const totalSec = Math.floor(f / r);
    return `${p2(Math.floor(totalSec / 3600))}:${p2(Math.floor(totalSec / 60) % 60)}:${p2(totalSec % 60)}:${p2(ff)}`;
  }

  const FM_INT_EXT = ["INT", "EXT", "INT/EXT"];
  const FM_TIME_OF_DAY = ["DAY", "NIGHT", "DUSK", "DAWN", "MORNING", "EVENING", "CONTINUOUS"];
  const FM_BREAKDOWN_CATEGORIES = [
    "cast", "extras", "stunts", "vehicles", "animals", "props", "wardrobe",
    "makeup_hair", "sfx", "vfx", "set_dressing", "special_equipment",
    "sound", "music", "art_department", "notes",
  ];
  const FM_SHOT_SIZES = ["ECU", "CU", "MCU", "MS", "MWS", "WS", "EWS", "OTS", "POV", "INSERT"];
  const FM_SHOT_ANGLES = ["eye_level", "high", "low", "dutch", "overhead", "ots", "pov", "worm"];
  const FM_SHOT_MOVES = ["static", "pan", "tilt", "dolly", "track", "handheld", "steadicam", "crane", "zoom", "drone"];
  const FM_BUDGET_DEPTS = ["above_the_line", "production", "post_production", "marketing", "other"];
  const FM_CAST_ROLES = ["lead", "supporting", "day_player", "background"];
  const FM_TRACKS = ["V1", "V2", "V3", "A1", "A2", "A3"];
  const FM_TRANSITIONS = ["cut", "dissolve", "fade_in", "fade_out", "wipe"];

  function fmSlugline(scene) {
    return `${scene.intExt}. ${scene.location} - ${scene.timeOfDay}`;
  }

  // ── Projects ────────────────────────────────────────────────────────
  registerLensAction("film-studios", "project-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = fmClean(params.title, 160);
    if (!title) return { ok: false, error: "project title required" };
    const project = {
      id: fmId("prj"), title,
      format: fmPick(params.format, ["feature", "short", "series", "spec", "doc", "commercial"], "feature"),
      logline: fmClean(params.logline, 400) || null,
      createdAt: fmNow(),
    };
    fmListB(s.projects, fmAid(ctx)).push(project);
    saveFmState();
    return { ok: true, result: { project } };
  });

  registerLensAction("film-studios", "project-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = s.projects.get(fmAid(ctx)) || [];
    return { ok: true, result: { projects, count: projects.length } };
  });

  registerLensAction("film-studios", "project-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.projects.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    // cascade: drop all child records for this project
    for (const k of ["scenes", "breakdownEls", "shots", "shootDays", "budget",
      "cast", "crew", "sequences", "clips", "versions", "notes"]) {
      const list = s[k].get(userId);
      if (list) s[k].set(userId, list.filter((x) => x.projectId !== params.id));
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Scenes ──────────────────────────────────────────────────────────
  registerLensAction("film-studios", "scene-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const location = fmClean(params.location, 120);
    if (!location) return { ok: false, error: "scene location required" };
    const scene = {
      id: fmId("scn"), projectId: String(params.projectId),
      number: fmClean(params.number, 12) || String((s.scenes.get(userId) || []).filter((x) => x.projectId === params.projectId).length + 1),
      intExt: fmPick(params.intExt, FM_INT_EXT, "INT"),
      location,
      timeOfDay: fmPick(params.timeOfDay, FM_TIME_OF_DAY, "DAY"),
      description: fmClean(params.description, 2000) || null,
      pageEighths: Math.max(0, Math.round(fmNum(params.pageEighths))),
      castIds: Array.isArray(params.castIds) ? params.castIds.map(String).slice(0, 40) : [],
      shootDayId: null, stripOrder: 0,
      createdAt: fmNow(),
    };
    fmListB(s.scenes, userId).push(scene);
    saveFmState();
    return { ok: true, result: { scene: { ...scene, slugline: fmSlugline(scene) } } };
  });

  registerLensAction("film-studios", "scene-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const els = s.breakdownEls.get(userId) || [];
    const days = s.shootDays.get(userId) || [];
    const scenes = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === String(params.projectId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((sc) => ({
        ...sc,
        slugline: fmSlugline(sc),
        breakdownElements: els.filter((e) => e.sceneId === sc.id),
        shootDayNumber: days.find((d) => d.id === sc.shootDayId)?.dayNumber ?? null,
      }));
    const totalEighths = scenes.reduce((a, x) => a + x.pageEighths, 0);
    return {
      ok: true,
      result: { scenes, count: scenes.length, totalPages: Math.round((totalEighths / 8) * 10) / 10 },
    };
  });

  registerLensAction("film-studios", "scene-update", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scene = (s.scenes.get(fmAid(ctx)) || []).find((x) => x.id === params.id);
    if (!scene) return { ok: false, error: "scene not found" };
    if (params.intExt != null) scene.intExt = fmPick(params.intExt, FM_INT_EXT, scene.intExt);
    if (params.timeOfDay != null) scene.timeOfDay = fmPick(params.timeOfDay, FM_TIME_OF_DAY, scene.timeOfDay);
    if (params.location != null) scene.location = fmClean(params.location, 120) || scene.location;
    if (params.number != null) scene.number = fmClean(params.number, 12) || scene.number;
    if (params.description != null) scene.description = fmClean(params.description, 2000) || null;
    if (params.pageEighths != null) scene.pageEighths = Math.max(0, Math.round(fmNum(params.pageEighths)));
    if (Array.isArray(params.castIds)) scene.castIds = params.castIds.map(String).slice(0, 40);
    saveFmState();
    return { ok: true, result: { scene: { ...scene, slugline: fmSlugline(scene) } } };
  });

  registerLensAction("film-studios", "scene-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.scenes.get(userId) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "scene not found" };
    arr.splice(i, 1);
    s.breakdownEls.set(userId, (s.breakdownEls.get(userId) || []).filter((e) => e.sceneId !== params.id));
    s.shots.set(userId, (s.shots.get(userId) || []).filter((sh) => sh.sceneId !== params.id));
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Script breakdown ────────────────────────────────────────────────
  registerLensAction("film-studios", "breakdown-tag", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const name = fmClean(params.name, 120);
    if (!name) return { ok: false, error: "element name required" };
    const element = {
      id: fmId("brk"), sceneId: scene.id, projectId: scene.projectId,
      category: fmPick(params.category, FM_BREAKDOWN_CATEGORIES, "props"),
      name,
    };
    fmListB(s.breakdownEls, userId).push(element);
    saveFmState();
    return { ok: true, result: { element } };
  });

  registerLensAction("film-studios", "breakdown-untag", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.breakdownEls.get(userId) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "element not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("film-studios", "breakdown-summary", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const els = (s.breakdownEls.get(fmAid(ctx)) || []).filter((e) => e.projectId === String(params.projectId));
    const byCategory = {};
    for (const c of FM_BREAKDOWN_CATEGORIES) byCategory[c] = 0;
    for (const e of els) byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    return { ok: true, result: { byCategory, totalElements: els.length } };
  });

  // ── Shot list ───────────────────────────────────────────────────────
  registerLensAction("film-studios", "shot-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const existing = (s.shots.get(userId) || []).filter((x) => x.sceneId === scene.id).length;
    const shot = {
      id: fmId("sht"), sceneId: scene.id, projectId: scene.projectId,
      number: fmClean(params.number, 12) || String(existing + 1),
      size: fmPick(params.size, FM_SHOT_SIZES, "MS"),
      angle: fmPick(params.angle, FM_SHOT_ANGLES, "eye_level"),
      movement: fmPick(params.movement, FM_SHOT_MOVES, "static"),
      lens: fmClean(params.lens, 40) || null,
      equipment: fmClean(params.equipment, 80) || null,
      description: fmClean(params.description, 400) || null,
      status: "planned",
      createdAt: fmNow(),
    };
    fmListB(s.shots, userId).push(shot);
    saveFmState();
    return { ok: true, result: { shot } };
  });

  registerLensAction("film-studios", "shot-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let shots = (s.shots.get(fmAid(ctx)) || []);
    if (params.sceneId) shots = shots.filter((x) => x.sceneId === String(params.sceneId));
    else if (params.projectId) shots = shots.filter((x) => x.projectId === String(params.projectId));
    shots = [...shots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { shots, count: shots.length } };
  });

  registerLensAction("film-studios", "shot-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.shots.get(fmAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "shot not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Scheduling — stripboard ─────────────────────────────────────────
  registerLensAction("film-studios", "shoot-day-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const existing = (s.shootDays.get(userId) || []).filter((d) => d.projectId === params.projectId);
    const day = {
      id: fmId("day"), projectId: String(params.projectId),
      dayNumber: existing.length + 1,
      date: fmClean(params.date, 10).slice(0, 10) || null,
      location: fmClean(params.location, 120) || null,
      generalCall: fmClean(params.generalCall, 8) || null,
      notes: fmClean(params.notes, 400) || null,
      createdAt: fmNow(),
    };
    fmListB(s.shootDays, userId).push(day);
    saveFmState();
    return { ok: true, result: { day } };
  });

  registerLensAction("film-studios", "shoot-day-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = (s.shootDays.get(fmAid(ctx)) || [])
      .filter((d) => d.projectId === String(params.projectId))
      .sort((a, b) => a.dayNumber - b.dayNumber);
    return { ok: true, result: { days, count: days.length } };
  });

  registerLensAction("film-studios", "shoot-day-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.shootDays.get(userId) || [];
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "shoot day not found" };
    arr.splice(i, 1);
    for (const sc of s.scenes.get(userId) || []) {
      if (sc.shootDayId === params.id) sc.shootDayId = null;
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("film-studios", "strip-assign", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    if (params.shootDayId) {
      const day = (s.shootDays.get(userId) || []).find((d) => d.id === params.shootDayId);
      if (!day) return { ok: false, error: "shoot day not found" };
      scene.shootDayId = day.id;
      scene.stripOrder = fmNum(params.stripOrder, 0);
    } else {
      scene.shootDayId = null;
      scene.stripOrder = 0;
    }
    saveFmState();
    return { ok: true, result: { sceneId: scene.id, shootDayId: scene.shootDayId } };
  });

  registerLensAction("film-studios", "stripboard", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const projectId = String(params.projectId);
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === projectId);
    const days = (s.shootDays.get(userId) || [])
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((d) => {
        const dayScenes = scenes
          .filter((sc) => sc.shootDayId === d.id)
          .sort((a, b) => a.stripOrder - b.stripOrder)
          .map((sc) => ({ ...sc, slugline: fmSlugline(sc) }));
        return {
          ...d,
          scenes: dayScenes,
          sceneCount: dayScenes.length,
          pageEighths: dayScenes.reduce((a, x) => a + x.pageEighths, 0),
        };
      });
    const unscheduled = scenes
      .filter((sc) => !sc.shootDayId)
      .map((sc) => ({ ...sc, slugline: fmSlugline(sc) }));
    return { ok: true, result: { days, unscheduled, scheduledCount: scenes.length - unscheduled.length } };
  });

  // ── Call sheet ──────────────────────────────────────────────────────
  registerLensAction("film-studios", "call-sheet", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const day = (s.shootDays.get(userId) || []).find((d) => d.id === params.shootDayId);
    if (!day) return { ok: false, error: "shoot day not found" };
    const scenes = (s.scenes.get(userId) || [])
      .filter((sc) => sc.shootDayId === day.id)
      .sort((a, b) => a.stripOrder - b.stripOrder);
    const castMap = new Map((s.cast.get(userId) || []).map((c) => [c.id, c]));
    const castIds = [...new Set(scenes.flatMap((sc) => sc.castIds))];
    const cast = castIds.map((id) => castMap.get(id)).filter(Boolean)
      .map((c) => ({ id: c.id, name: c.name, characterName: c.characterName, role: c.role }));
    const crew = (s.crew.get(userId) || []).filter((c) => c.projectId === day.projectId)
      .map((c) => ({ name: c.name, department: c.department, position: c.position }));
    return {
      ok: true,
      result: {
        day: { dayNumber: day.dayNumber, date: day.date, location: day.location, generalCall: day.generalCall },
        scenes: scenes.map((sc) => ({ number: sc.number, slugline: fmSlugline(sc), pageEighths: sc.pageEighths })),
        cast, crew,
        totalPageEighths: scenes.reduce((a, x) => a + x.pageEighths, 0),
        sceneCount: scenes.length,
      },
    };
  });

  // ── Budget ──────────────────────────────────────────────────────────
  registerLensAction("film-studios", "budget-line-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const description = fmClean(params.description, 160);
    if (!description) return { ok: false, error: "line description required" };
    const line = {
      id: fmId("bdg"), projectId: String(params.projectId),
      department: fmPick(params.department, FM_BUDGET_DEPTS, "production"),
      description,
      estimated: Math.max(0, fmNum(params.estimated)),
      actual: Math.max(0, fmNum(params.actual)),
      createdAt: fmNow(),
    };
    fmListB(s.budget, userId).push(line);
    saveFmState();
    return { ok: true, result: { line } };
  });

  registerLensAction("film-studios", "budget-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lines = (s.budget.get(fmAid(ctx)) || []).filter((l) => l.projectId === String(params.projectId));
    const byDept = {};
    for (const d of FM_BUDGET_DEPTS) byDept[d] = { estimated: 0, actual: 0 };
    for (const l of lines) {
      byDept[l.department].estimated += l.estimated;
      byDept[l.department].actual += l.actual;
    }
    const totalEstimated = lines.reduce((a, l) => a + l.estimated, 0);
    const totalActual = lines.reduce((a, l) => a + l.actual, 0);
    return {
      ok: true,
      result: {
        lines, byDept, totalEstimated, totalActual,
        variance: Math.round((totalActual - totalEstimated) * 100) / 100,
      },
    };
  });

  registerLensAction("film-studios", "budget-line-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.budget.get(fmAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "budget line not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Cast ────────────────────────────────────────────────────────────
  registerLensAction("film-studios", "cast-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 100);
    if (!name) return { ok: false, error: "cast name required" };
    const member = {
      id: fmId("cst"), projectId: String(params.projectId), name,
      characterName: fmClean(params.characterName, 100) || null,
      role: fmPick(params.role, FM_CAST_ROLES, "supporting"),
      dailyRate: Math.max(0, fmNum(params.dailyRate)),
      createdAt: fmNow(),
    };
    fmListB(s.cast, userId).push(member);
    saveFmState();
    return { ok: true, result: { member } };
  });

  registerLensAction("film-studios", "cast-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const members = (s.cast.get(fmAid(ctx)) || []).filter((c) => c.projectId === String(params.projectId));
    return { ok: true, result: { members, count: members.length } };
  });

  registerLensAction("film-studios", "cast-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.cast.get(fmAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "cast member not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Crew ────────────────────────────────────────────────────────────
  registerLensAction("film-studios", "crew-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 100);
    if (!name) return { ok: false, error: "crew name required" };
    const member = {
      id: fmId("crw"), projectId: String(params.projectId), name,
      department: fmClean(params.department, 60) || "production",
      position: fmClean(params.position, 80) || null,
      rate: Math.max(0, fmNum(params.rate)),
      createdAt: fmNow(),
    };
    fmListB(s.crew, userId).push(member);
    saveFmState();
    return { ok: true, result: { member } };
  });

  registerLensAction("film-studios", "crew-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const members = (s.crew.get(fmAid(ctx)) || []).filter((c) => c.projectId === String(params.projectId));
    return { ok: true, result: { members, count: members.length } };
  });

  registerLensAction("film-studios", "crew-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.crew.get(fmAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "crew member not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Edit — sequences & timeline ─────────────────────────────────────
  registerLensAction("film-studios", "sequence-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 120);
    if (!name) return { ok: false, error: "sequence name required" };
    const sequence = {
      id: fmId("seq"), projectId: String(params.projectId), name,
      fps: fmPick(String(params.fps), ["23.976", "24", "25", "29.97", "30", "48", "60"], "24"),
      createdAt: fmNow(),
    };
    fmListB(s.sequences, userId).push(sequence);
    saveFmState();
    return { ok: true, result: { sequence } };
  });

  registerLensAction("film-studios", "sequence-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const clips = s.clips.get(userId) || [];
    const sequences = (s.sequences.get(userId) || [])
      .filter((q) => q.projectId === String(params.projectId))
      .map((q) => ({ ...q, clipCount: clips.filter((c) => c.sequenceId === q.id).length }));
    return { ok: true, result: { sequences, count: sequences.length } };
  });

  registerLensAction("film-studios", "clip-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const sequence = (s.sequences.get(userId) || []).find((q) => q.id === params.sequenceId);
    if (!sequence) return { ok: false, error: "sequence not found" };
    const name = fmClean(params.name, 120);
    if (!name) return { ok: false, error: "clip name required" };
    const fps = parseFloat(sequence.fps) || 24;
    let durationFrames = Math.round(fmNum(params.durationFrames));
    if (durationFrames <= 0) durationFrames = Math.round(Math.max(0, fmNum(params.durationSec)) * fps);
    if (durationFrames <= 0) return { ok: false, error: "clip duration required" };
    const track = fmPick(params.track, FM_TRACKS, "V1");
    const order = (s.clips.get(userId) || [])
      .filter((c) => c.sequenceId === sequence.id && c.track === track).length;
    const clip = {
      id: fmId("clp"), sequenceId: sequence.id, projectId: sequence.projectId,
      name, track, durationFrames,
      transition: fmPick(params.transition, FM_TRANSITIONS, "cut"),
      order, createdAt: fmNow(),
    };
    fmListB(s.clips, userId).push(clip);
    saveFmState();
    return { ok: true, result: { clip } };
  });

  registerLensAction("film-studios", "clip-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const sequence = (s.sequences.get(userId) || []).find((q) => q.id === params.sequenceId);
    if (!sequence) return { ok: false, error: "sequence not found" };
    const clips = (s.clips.get(userId) || [])
      .filter((c) => c.sequenceId === sequence.id)
      .sort((a, b) => a.track.localeCompare(b.track) || a.order - b.order);
    return { ok: true, result: { clips, count: clips.length, fps: sequence.fps } };
  });

  registerLensAction("film-studios", "clip-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.clips.get(fmAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "clip not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("film-studios", "cut-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const sequence = (s.sequences.get(userId) || []).find((q) => q.id === params.sequenceId);
    if (!sequence) return { ok: false, error: "sequence not found" };
    const fps = parseFloat(sequence.fps) || 24;
    const clips = (s.clips.get(userId) || []).filter((c) => c.sequenceId === sequence.id);
    const tracks = {};
    let longest = 0;
    for (const tr of FM_TRACKS) {
      const trackClips = clips.filter((c) => c.track === tr).sort((a, b) => a.order - b.order);
      if (!trackClips.length) continue;
      let frame = 0;
      tracks[tr] = trackClips.map((c) => {
        const startTc = fmTimecode(frame, fps);
        frame += c.durationFrames;
        return {
          id: c.id, name: c.name, transition: c.transition,
          durationFrames: c.durationFrames,
          startTimecode: startTc, endTimecode: fmTimecode(frame, fps),
        };
      });
      longest = Math.max(longest, frame);
    }
    return {
      ok: true,
      result: {
        sequence: sequence.name, fps: sequence.fps,
        tracks,
        totalFrames: longest,
        totalRuntime: fmTimecode(longest, fps),
      },
    };
  });

  // ── Review — versions & timecoded notes (Frame.io shape) ────────────
  registerLensAction("film-studios", "version-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const label = fmClean(params.label, 100);
    if (!label) return { ok: false, error: "version label required" };
    const version = {
      id: fmId("ver"), projectId: String(params.projectId), label,
      stage: fmPick(params.stage, ["assembly", "rough_cut", "fine_cut", "picture_lock", "final"], "rough_cut"),
      runtimeSec: Math.max(0, Math.round(fmNum(params.runtimeSec))),
      createdAt: fmNow(),
    };
    fmListB(s.versions, userId).push(version);
    saveFmState();
    return { ok: true, result: { version } };
  });

  registerLensAction("film-studios", "version-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const notes = s.notes.get(userId) || [];
    const versions = (s.versions.get(userId) || [])
      .filter((v) => v.projectId === String(params.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((v) => {
        const vNotes = notes.filter((n) => n.versionId === v.id);
        return { ...v, noteCount: vNotes.length, openNotes: vNotes.filter((n) => !n.resolved).length };
      });
    return { ok: true, result: { versions, count: versions.length } };
  });

  registerLensAction("film-studios", "note-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const version = (s.versions.get(userId) || []).find((v) => v.id === params.versionId);
    if (!version) return { ok: false, error: "version not found" };
    const body = fmClean(params.body, 800);
    if (!body) return { ok: false, error: "note body required" };
    const note = {
      id: fmId("not"), versionId: version.id, projectId: version.projectId,
      timecodeSec: Math.max(0, Math.round(fmNum(params.timecodeSec))),
      body,
      author: fmClean(params.author, 60) || "Reviewer",
      resolved: false,
      createdAt: fmNow(),
    };
    fmListB(s.notes, userId).push(note);
    saveFmState();
    return { ok: true, result: { note } };
  });

  registerLensAction("film-studios", "note-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = (s.notes.get(fmAid(ctx)) || [])
      .filter((n) => n.versionId === String(params.versionId))
      .sort((a, b) => a.timecodeSec - b.timecodeSec);
    return {
      ok: true,
      result: { notes, count: notes.length, openCount: notes.filter((n) => !n.resolved).length },
    };
  });

  registerLensAction("film-studios", "note-resolve", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const note = (s.notes.get(fmAid(ctx)) || []).find((n) => n.id === params.id);
    if (!note) return { ok: false, error: "note not found" };
    note.resolved = params.resolved !== false;
    saveFmState();
    return { ok: true, result: { note } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("film-studios", "film-dashboard", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const projectId = String(params.projectId);
    if (!fmProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === projectId);
    const budget = (s.budget.get(userId) || []).filter((x) => x.projectId === projectId);
    const totalEighths = scenes.reduce((a, x) => a + x.pageEighths, 0);
    return {
      ok: true,
      result: {
        scenes: scenes.length,
        scheduledScenes: scenes.filter((sc) => sc.shootDayId).length,
        pages: Math.round((totalEighths / 8) * 10) / 10,
        shots: (s.shots.get(userId) || []).filter((x) => x.projectId === projectId).length,
        shootDays: (s.shootDays.get(userId) || []).filter((x) => x.projectId === projectId).length,
        cast: (s.cast.get(userId) || []).filter((x) => x.projectId === projectId).length,
        crew: (s.crew.get(userId) || []).filter((x) => x.projectId === projectId).length,
        sequences: (s.sequences.get(userId) || []).filter((x) => x.projectId === projectId).length,
        versions: (s.versions.get(userId) || []).filter((x) => x.projectId === projectId).length,
        budgetEstimated: budget.reduce((a, l) => a + l.estimated, 0),
        budgetActual: budget.reduce((a, l) => a + l.actual, 0),
      },
    };
  });
}
