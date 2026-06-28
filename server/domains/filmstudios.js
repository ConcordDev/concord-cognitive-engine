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
    // Fail CLOSED on poisoned numerics: parseFloat passes Infinity / 1e400
    // straight through, and `|| 0` can't catch a truthy non-finite value, so
    // an unbounded totalBudget would mint absurd (non-finite) breakdown
    // amounts. Clamp to a finite, non-negative budget before any math.
    const parsed = parseFloat(data.totalBudget);
    const totalBudget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
    // Fail CLOSED: parseFloat passes Infinity / 1e400 through (and `|| 0`
    // can't catch a truthy non-finite), so a poisoned dailyRate would mint a
    // non-finite totalCost / totalCastBudget. Clamp to finite, non-negative.
    const finiteNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const finiteInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
    const analyzed = cast.map(c => ({ name: c.name, role: c.role || "supporting", scenes: finiteInt(c.sceneCount), dailyRate: finiteNum(c.dailyRate), totalCost: finiteInt(c.sceneCount) * finiteNum(c.dailyRate) / 3 }));
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
      "budget", "cast", "crew", "sequences", "clips", "versions", "notes",
      "locations", "tasks", "markers"]) {
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
        locations: (s.locations.get(userId) || []).filter((x) => x.projectId === projectId).length,
        openTasks: (s.tasks.get(userId) || []).filter((x) => x.projectId === projectId && x.status !== "done").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── StudioBinder + Frame.io parity — completion modules ────────────

  const FM_SCRIPT_ELEMENTS = ["heading", "action", "character", "dialogue", "parenthetical", "transition"];
  const FM_TASK_STATUS = ["todo", "in_progress", "done"];
  const FM_VERSION_STATUS = ["in_review", "approved", "needs_changes"];

  // ── Locations ───────────────────────────────────────────────────────
  registerLensAction("film-studios", "location-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 120);
    if (!name) return { ok: false, error: "location name required" };
    const location = {
      id: fmId("loc"), projectId: String(params.projectId), name,
      address: fmClean(params.address, 240) || null,
      contact: fmClean(params.contact, 120) || null,
      notes: fmClean(params.notes, 400) || null,
      createdAt: fmNow(),
    };
    fmListB(s.locations, userId).push(location);
    saveFmState();
    return { ok: true, result: { location } };
  });

  registerLensAction("film-studios", "location-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const locations = (s.locations.get(fmAid(ctx)) || []).filter((l) => l.projectId === String(params.projectId));
    return { ok: true, result: { locations, count: locations.length } };
  });

  registerLensAction("film-studios", "location-update", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const loc = (s.locations.get(fmAid(ctx)) || []).find((l) => l.id === params.id);
    if (!loc) return { ok: false, error: "location not found" };
    if (params.name != null) loc.name = fmClean(params.name, 120) || loc.name;
    if (params.address != null) loc.address = fmClean(params.address, 240) || null;
    if (params.contact != null) loc.contact = fmClean(params.contact, 120) || null;
    if (params.notes != null) loc.notes = fmClean(params.notes, 400) || null;
    saveFmState();
    return { ok: true, result: { location: loc } };
  });

  registerLensAction("film-studios", "location-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.locations.get(userId) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "location not found" };
    arr.splice(i, 1);
    for (const sc of s.scenes.get(userId) || []) {
      if (sc.locationId === params.id) sc.locationId = null;
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Screenplay ──────────────────────────────────────────────────────
  registerLensAction("film-studios", "scene-script-set", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scene = (s.scenes.get(fmAid(ctx)) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const els = Array.isArray(params.elements) ? params.elements : [];
    scene.script = els.slice(0, 2000).map((e) => ({
      type: FM_SCRIPT_ELEMENTS.includes(String(e?.type)) ? String(e.type) : "action",
      text: fmClean(e?.text, 2000),
    }));
    if (params.locationId !== undefined) {
      const lid = params.locationId ? String(params.locationId) : null;
      scene.locationId = (lid && (s.locations.get(fmAid(ctx)) || []).some((l) => l.id === lid)) ? lid : null;
    }
    saveFmState();
    return { ok: true, result: { sceneId: scene.id, elementCount: scene.script.length } };
  });

  registerLensAction("film-studios", "scene-script-get", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scene = (s.scenes.get(fmAid(ctx)) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    return { ok: true, result: { sceneId: scene.id, script: scene.script || [], locationId: scene.locationId || null } };
  });

  registerLensAction("film-studios", "screenplay", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === String(params.projectId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const totalEighths = scenes.reduce((a, x) => a + x.pageEighths, 0);
    return {
      ok: true,
      result: {
        scenes: scenes.map((sc) => ({
          id: sc.id, number: sc.number, slugline: `${sc.intExt}. ${sc.location} - ${sc.timeOfDay}`,
          script: sc.script || [],
        })),
        sceneCount: scenes.length,
        pageCount: Math.round((totalEighths / 8) * 10) / 10,
      },
    };
  });

  // ── Storyboard ──────────────────────────────────────────────────────
  registerLensAction("film-studios", "shot-storyboard-set", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shot = (s.shots.get(fmAid(ctx)) || []).find((x) => x.id === params.shotId);
    if (!shot) return { ok: false, error: "shot not found" };
    const url = fmClean(params.imageUrl, 600);
    if (url && !/^https?:\/\//.test(url)) return { ok: false, error: "imageUrl must be http(s)" };
    shot.storyboardUrl = url || null;
    shot.frameNotes = fmClean(params.frameNotes, 400) || null;
    saveFmState();
    return { ok: true, result: { shotId: shot.id, storyboardUrl: shot.storyboardUrl } };
  });

  registerLensAction("film-studios", "storyboard", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const frames = (s.shots.get(fmAid(ctx)) || [])
      .filter((x) => x.projectId === String(params.projectId) && x.storyboardUrl)
      .map((x) => ({
        shotId: x.id, sceneId: x.sceneId, number: x.number, size: x.size,
        storyboardUrl: x.storyboardUrl, frameNotes: x.frameNotes || null, description: x.description,
      }));
    return { ok: true, result: { frames, count: frames.length } };
  });

  // ── Day Out of Days ─────────────────────────────────────────────────
  registerLensAction("film-studios", "dood-report", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const projectId = String(params.projectId);
    if (!fmProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const days = (s.shootDays.get(userId) || [])
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => a.dayNumber - b.dayNumber);
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === projectId);
    const cast = (s.cast.get(userId) || []).filter((c) => c.projectId === projectId);
    const rows = cast.map((c) => {
      // which day numbers this cast member works
      const worked = days
        .filter((d) => scenes.some((sc) => sc.shootDayId === d.id && sc.castIds.includes(c.id)))
        .map((d) => d.dayNumber)
        .sort((a, b) => a - b);
      const cells = days.map((d) => {
        if (!worked.length) return { day: d.dayNumber, code: "" };
        if (d.dayNumber < worked[0] || d.dayNumber > worked[worked.length - 1]) {
          return { day: d.dayNumber, code: "" };
        }
        let code = "W";
        if (d.dayNumber === worked[0] && worked.length === 1) code = "SWF";
        else if (d.dayNumber === worked[0]) code = "S";
        else if (d.dayNumber === worked[worked.length - 1]) code = "F";
        else if (!worked.includes(d.dayNumber)) code = "H";
        return { day: d.dayNumber, code };
      });
      return {
        castId: c.id, name: c.name, character: c.characterName,
        workDays: worked.length, cells,
      };
    });
    return { ok: true, result: { days: days.map((d) => d.dayNumber), rows } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Element-list report ─────────────────────────────────────────────
  registerLensAction("film-studios", "element-list-report", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const els = (s.breakdownEls.get(userId) || []).filter((e) => e.projectId === String(params.projectId));
    const sceneMap = new Map((s.scenes.get(userId) || []).map((sc) => [sc.id, sc.number]));
    const byCategory = {};
    for (const e of els) {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      const existing = byCategory[e.category].find((x) => x.name.toLowerCase() === e.name.toLowerCase());
      if (existing) existing.scenes.push(sceneMap.get(e.sceneId) || "?");
      else byCategory[e.category].push({ name: e.name, scenes: [sceneMap.get(e.sceneId) || "?"] });
    }
    return { ok: true, result: { byCategory, totalElements: els.length } };
  });

  // ── Production tasks ────────────────────────────────────────────────
  registerLensAction("film-studios", "task-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const title = fmClean(params.title, 200);
    if (!title) return { ok: false, error: "task title required" };
    const task = {
      id: fmId("ftk"), projectId: String(params.projectId), title,
      department: fmClean(params.department, 60) || "production",
      assignee: fmClean(params.assignee, 80) || null,
      dueDate: fmClean(params.dueDate, 10).slice(0, 10) || null,
      status: "todo", createdAt: fmNow(),
    };
    fmListB(s.tasks, userId).push(task);
    saveFmState();
    return { ok: true, result: { task } };
  });

  registerLensAction("film-studios", "task-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tasks = (s.tasks.get(fmAid(ctx)) || [])
      .filter((t) => t.projectId === String(params.projectId))
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    return { ok: true, result: { tasks, count: tasks.length } };
  });

  registerLensAction("film-studios", "task-update", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = (s.tasks.get(fmAid(ctx)) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (params.title != null) task.title = fmClean(params.title, 200) || task.title;
    if (params.department != null) task.department = fmClean(params.department, 60) || task.department;
    if (params.assignee != null) task.assignee = fmClean(params.assignee, 80) || null;
    if (params.dueDate != null) task.dueDate = fmClean(params.dueDate, 10).slice(0, 10) || null;
    if (params.status != null) task.status = FM_TASK_STATUS.includes(String(params.status)) ? String(params.status) : task.status;
    saveFmState();
    return { ok: true, result: { task } };
  });

  registerLensAction("film-studios", "task-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.tasks.get(fmAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "task not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Production calendar ─────────────────────────────────────────────
  registerLensAction("film-studios", "production-calendar", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const projectId = String(params.projectId);
    const now = new Date();
    const year = Math.round(fmNum(params.year, now.getUTCFullYear()));
    const month = Math.max(1, Math.min(12, Math.round(fmNum(params.month, now.getUTCMonth() + 1))));
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const days = {};
    const add = (date, item) => {
      if (!date || !date.startsWith(prefix)) return;
      const d = date.slice(8, 10);
      if (!days[d]) days[d] = [];
      days[d].push(item);
    };
    for (const sd of (s.shootDays.get(userId) || []).filter((x) => x.projectId === projectId)) {
      add(sd.date, { type: "shoot_day", label: `Day ${sd.dayNumber}`, id: sd.id });
    }
    for (const t of (s.tasks.get(userId) || []).filter((x) => x.projectId === projectId)) {
      add(t.dueDate, { type: "task", label: t.title, id: t.id, status: t.status });
    }
    return { ok: true, result: { year, month, days } };
  });

  // ── Timeline markers ────────────────────────────────────────────────
  registerLensAction("film-studios", "marker-add", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const sequence = (s.sequences.get(userId) || []).find((q) => q.id === params.sequenceId);
    if (!sequence) return { ok: false, error: "sequence not found" };
    const label = fmClean(params.label, 120);
    if (!label) return { ok: false, error: "marker label required" };
    const marker = {
      id: fmId("mk"), sequenceId: sequence.id, label,
      frame: Math.max(0, Math.round(fmNum(params.frame))),
      color: fmClean(params.color, 16) || "amber",
      createdAt: fmNow(),
    };
    fmListB(s.markers, userId).push(marker);
    saveFmState();
    return { ok: true, result: { marker } };
  });

  registerLensAction("film-studios", "marker-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const markers = (s.markers.get(fmAid(ctx)) || [])
      .filter((m) => m.sequenceId === String(params.sequenceId))
      .sort((a, b) => a.frame - b.frame);
    return { ok: true, result: { markers, count: markers.length } };
  });

  registerLensAction("film-studios", "marker-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.markers.get(fmAid(ctx)) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "marker not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Version approval ────────────────────────────────────────────────
  registerLensAction("film-studios", "version-set-status", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const version = (s.versions.get(fmAid(ctx)) || []).find((v) => v.id === params.id);
    if (!version) return { ok: false, error: "version not found" };
    version.approvalStatus = FM_VERSION_STATUS.includes(String(params.status))
      ? String(params.status) : "in_review";
    saveFmState();
    return { ok: true, result: { id: version.id, approvalStatus: version.approvalStatus } };
  });

  // ════════════════════════════════════════════════════════════════════
  //  Feature-parity backlog — NLE timeline, collaborative script,
  //  storyboard drag-link, watch-party sync, budget actuals, multicam /
  //  proxy media, festival submission tracker.
  // ════════════════════════════════════════════════════════════════════

  function getFmExtra() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.filmLensX) STATE.filmLensX = {};
    const s = STATE.filmLensX;
    for (const k of ["revisions", "media", "mcamGroups", "parties",
      "partyChat", "festivals"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // ── 1. Real NLE timeline — trim / ripple / reorder / transitions ────
  registerLensAction("film-studios", "clip-update", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const clip = (s.clips.get(userId) || []).find((c) => c.id === params.id);
    if (!clip) return { ok: false, error: "clip not found" };
    const seq = (s.sequences.get(userId) || []).find((q) => q.id === clip.sequenceId);
    const fps = seq ? (parseFloat(seq.fps) || 24) : 24;
    if (params.name != null) {
      const nm = fmClean(params.name, 120);
      if (nm) clip.name = nm;
    }
    // Trim: set in/out points (frames into the source clip).
    if (params.inFrame != null) clip.inFrame = Math.max(0, Math.round(fmNum(params.inFrame)));
    if (params.outFrame != null) clip.outFrame = Math.max(0, Math.round(fmNum(params.outFrame)));
    // Duration recomputed from trim handles when both are set, else direct.
    if (clip.inFrame != null && clip.outFrame != null && clip.outFrame > clip.inFrame) {
      clip.durationFrames = clip.outFrame - clip.inFrame;
    } else if (params.durationFrames != null) {
      const df = Math.round(fmNum(params.durationFrames));
      if (df > 0) clip.durationFrames = df;
    } else if (params.durationSec != null) {
      const df = Math.round(Math.max(0, fmNum(params.durationSec)) * fps);
      if (df > 0) clip.durationFrames = df;
    }
    if (params.transition != null) {
      clip.transition = fmPick(params.transition, FM_TRANSITIONS, clip.transition);
    }
    if (params.transitionFrames != null) {
      clip.transitionFrames = Math.max(0, Math.round(fmNum(params.transitionFrames)));
    }
    if (params.track != null) {
      const tr = fmPick(params.track, FM_TRACKS, clip.track);
      if (tr !== clip.track) {
        clip.track = tr;
        clip.order = (s.clips.get(userId) || [])
          .filter((c) => c.sequenceId === clip.sequenceId && c.track === tr && c.id !== clip.id).length;
      }
    }
    saveFmState();
    return { ok: true, result: { clip } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "clip-reorder", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const seq = (s.sequences.get(userId) || []).find((q) => q.id === params.sequenceId);
    if (!seq) return { ok: false, error: "sequence not found" };
    const track = fmPick(params.track, FM_TRACKS, "V1");
    const ordered = Array.isArray(params.clipIds) ? params.clipIds.map(String) : [];
    if (!ordered.length) return { ok: false, error: "clipIds array required" };
    const trackClips = (s.clips.get(userId) || [])
      .filter((c) => c.sequenceId === seq.id && c.track === track);
    const byId = new Map(trackClips.map((c) => [c.id, c]));
    let next = 0;
    // Apply requested order first, then any remaining clips (ripple-safe).
    for (const id of ordered) { const c = byId.get(id); if (c) { c.order = next++; byId.delete(id); } }
    for (const c of [...byId.values()].sort((a, b) => a.order - b.order)) c.order = next++;
    saveFmState();
    return { ok: true, result: { sequenceId: seq.id, track, count: next } };
  });

  registerLensAction("film-studios", "clip-ripple-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.clips.get(userId) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "clip not found" };
    const removed = arr[i];
    arr.splice(i, 1);
    // Ripple: close the gap on the same track.
    const trackClips = arr
      .filter((c) => c.sequenceId === removed.sequenceId && c.track === removed.track)
      .sort((a, b) => a.order - b.order);
    trackClips.forEach((c, idx) => { c.order = idx; });
    saveFmState();
    return { ok: true, result: { deleted: params.id, rippled: trackClips.length } };
  });

  // ── 2. Collaborative script editor — revisions & locked pages ───────
  const FM_REVISION_COLORS = [
    "white", "blue", "pink", "yellow", "green", "goldenrod",
    "buff", "salmon", "cherry",
  ];
  registerLensAction("film-studios", "revision-create", (ctx, _a, params = {}) => {
  try {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const label = fmClean(params.label, 80);
    if (!label) return { ok: false, error: "revision label required" };
    const existing = (x.revisions.get(userId) || []).filter((r) => r.projectId === String(params.projectId));
    const revision = {
      id: fmId("rev"), projectId: String(params.projectId), label,
      color: fmPick(params.color, FM_REVISION_COLORS, FM_REVISION_COLORS[existing.length % FM_REVISION_COLORS.length]),
      ordinal: existing.length + 1,
      author: fmClean(params.author, 60) || "Writer",
      lockedPages: [],
      createdAt: fmNow(),
    };
    fmListB(x.revisions, userId).push(revision);
    saveFmState();
    return { ok: true, result: { revision } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "revision-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const revisions = (x.revisions.get(fmAid(ctx)) || [])
      .filter((r) => r.projectId === String(params.projectId))
      .sort((a, b) => a.ordinal - b.ordinal);
    return { ok: true, result: { revisions, count: revisions.length } };
  });

  registerLensAction("film-studios", "revision-delete", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const arr = x.revisions.get(fmAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "revision not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("film-studios", "page-lock-toggle", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const rev = (x.revisions.get(fmAid(ctx)) || []).find((r) => r.id === params.revisionId);
    if (!rev) return { ok: false, error: "revision not found" };
    const page = fmClean(params.page, 16);
    if (!page) return { ok: false, error: "page required" };
    const idx = rev.lockedPages.indexOf(page);
    if (idx >= 0) rev.lockedPages.splice(idx, 1);
    else rev.lockedPages.push(page);
    rev.lockedPages.sort();
    saveFmState();
    return { ok: true, result: { revisionId: rev.id, lockedPages: rev.lockedPages, locked: idx < 0 } };
  });

  registerLensAction("film-studios", "scene-revision-tag", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const x = getFmExtra();
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((sc) => sc.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    if (params.revisionId) {
      const rev = (x.revisions.get(userId) || []).find((r) => r.id === params.revisionId);
      if (!rev) return { ok: false, error: "revision not found" };
      scene.revisionId = rev.id;
      scene.revisionColor = rev.color;
    } else {
      scene.revisionId = null;
      scene.revisionColor = null;
    }
    saveFmState();
    return { ok: true, result: { sceneId: scene.id, revisionId: scene.revisionId, revisionColor: scene.revisionColor } };
  });

  // ── 3. Shot-list ↔ storyboard drag-link ─────────────────────────────
  registerLensAction("film-studios", "shot-relink-scene", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const shot = (s.shots.get(userId) || []).find((sh) => sh.id === params.shotId);
    if (!shot) return { ok: false, error: "shot not found" };
    const scene = (s.scenes.get(userId) || []).find((sc) => sc.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    shot.sceneId = scene.id;
    shot.projectId = scene.projectId;
    shot.number = String(
      (s.shots.get(userId) || []).filter((sh) => sh.sceneId === scene.id && sh.id !== shot.id).length + 1,
    );
    saveFmState();
    return { ok: true, result: { shotId: shot.id, sceneId: scene.id } };
  });

  registerLensAction("film-studios", "storyboard-reorder", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((sc) => sc.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const ordered = Array.isArray(params.shotIds) ? params.shotIds.map(String) : [];
    if (!ordered.length) return { ok: false, error: "shotIds array required" };
    const sceneShots = (s.shots.get(userId) || []).filter((sh) => sh.sceneId === scene.id);
    const byId = new Map(sceneShots.map((sh) => [sh.id, sh]));
    let n = 1;
    for (const id of ordered) { const sh = byId.get(id); if (sh) { sh.boardOrder = n++; byId.delete(id); } }
    for (const sh of byId.values()) sh.boardOrder = n++;
    saveFmState();
    return { ok: true, result: { sceneId: scene.id, count: n - 1 } };
  });

  registerLensAction("film-studios", "shot-board-sequence", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((sc) => sc.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const shots = (s.shots.get(userId) || [])
      .filter((sh) => sh.sceneId === scene.id)
      .sort((a, b) => (a.boardOrder || 999) - (b.boardOrder || 999)
        || a.createdAt.localeCompare(b.createdAt))
      .map((sh, i) => ({
        shotId: sh.id, number: sh.number, position: i + 1,
        size: sh.size, angle: sh.angle, movement: sh.movement,
        description: sh.description || null,
        storyboardUrl: sh.storyboardUrl || null,
        frameNotes: sh.frameNotes || null,
        hasFrame: !!sh.storyboardUrl,
      }));
    return {
      ok: true,
      result: {
        sceneId: scene.id, slugline: fmSlugline(scene),
        frames: shots, count: shots.length,
        framedCount: shots.filter((f) => f.hasFrame).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 4. Watch-party synced playback + chat ───────────────────────────
  registerLensAction("film-studios", "party-create", (ctx, _a, params = {}) => {
  try {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const title = fmClean(params.title, 120);
    if (!title) return { ok: false, error: "party title required" };
    let versionId = null;
    if (params.versionId) {
      const v = (s.versions.get(userId) || []).find((vv) => vv.id === params.versionId);
      if (!v) return { ok: false, error: "version not found" };
      versionId = v.id;
    }
    const code = `FILM-${Math.floor(1000 + Math.random() * 9000)}`;
    const party = {
      id: fmId("pty"), projectId: String(params.projectId), title, code,
      versionId, host: userId,
      playing: false, positionSec: 0, updatedAt: fmNow(),
      participants: [userId], createdAt: fmNow(),
    };
    fmListB(x.parties, userId).push(party);
    x.partyChat.set(party.id, []);
    saveFmState();
    return { ok: true, result: { party } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "party-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const parties = (x.parties.get(fmAid(ctx)) || [])
      .filter((p) => p.projectId === String(params.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { parties, count: parties.length } };
  });

  registerLensAction("film-studios", "party-state", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const party = (x.parties.get(fmAid(ctx)) || []).find((p) => p.id === params.id);
    if (!party) return { ok: false, error: "party not found" };
    // Project the live position forward if playing.
    let position = party.positionSec;
    if (party.playing) {
      const drift = (Date.now() - new Date(party.updatedAt).getTime()) / 1000;
      position = Math.max(0, party.positionSec + drift);
    }
    return {
      ok: true,
      result: {
        party: {
          id: party.id, title: party.title, code: party.code,
          versionId: party.versionId, playing: party.playing,
          positionSec: Math.round(position * 100) / 100,
          participantCount: party.participants.length,
        },
      },
    };
  });

  registerLensAction("film-studios", "party-sync", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const party = (x.parties.get(fmAid(ctx)) || []).find((p) => p.id === params.id);
    if (!party) return { ok: false, error: "party not found" };
    if (params.positionSec != null) party.positionSec = Math.max(0, fmNum(params.positionSec));
    if (params.playing != null) party.playing = !!params.playing;
    party.updatedAt = fmNow();
    saveFmState();
    return { ok: true, result: { id: party.id, playing: party.playing, positionSec: party.positionSec } };
  });

  registerLensAction("film-studios", "party-chat-post", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const party = (x.parties.get(fmAid(ctx)) || []).find((p) => p.id === params.id);
    if (!party) return { ok: false, error: "party not found" };
    const text = fmClean(params.text, 500);
    if (!text) return { ok: false, error: "message text required" };
    const msg = {
      id: fmId("msg"), partyId: party.id,
      author: fmClean(params.author, 60) || "Guest",
      text,
      atSec: Math.max(0, Math.round(fmNum(params.atSec))),
      createdAt: fmNow(),
    };
    if (!(x.partyChat.get(party.id) instanceof Array)) x.partyChat.set(party.id, []);
    x.partyChat.get(party.id).push(msg);
    saveFmState();
    return { ok: true, result: { message: msg } };
  });

  registerLensAction("film-studios", "party-chat-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const party = (x.parties.get(fmAid(ctx)) || []).find((p) => p.id === params.id);
    if (!party) return { ok: false, error: "party not found" };
    const messages = (x.partyChat.get(party.id) || [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { messages, count: messages.length } };
  });

  registerLensAction("film-studios", "party-delete", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const arr = x.parties.get(fmAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "party not found" };
    x.partyChat.delete(params.id);
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── 5. Budget actuals vs estimate + cost report ─────────────────────
  registerLensAction("film-studios", "budget-line-update", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const line = (s.budget.get(fmAid(ctx)) || []).find((l) => l.id === params.id);
    if (!line) return { ok: false, error: "budget line not found" };
    if (params.description != null) {
      const d = fmClean(params.description, 160);
      if (d) line.description = d;
    }
    if (params.department != null) line.department = fmPick(params.department, FM_BUDGET_DEPTS, line.department);
    if (params.estimated != null) line.estimated = Math.max(0, fmNum(params.estimated));
    if (params.actual != null) line.actual = Math.max(0, fmNum(params.actual));
    saveFmState();
    return { ok: true, result: { line } };
  });

  registerLensAction("film-studios", "cost-report", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const projectId = String(params.projectId);
    if (!fmProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const lines = (s.budget.get(userId) || []).filter((l) => l.projectId === projectId);
    const byDept = {};
    for (const d of FM_BUDGET_DEPTS) {
      byDept[d] = { estimated: 0, actual: 0, variance: 0, lineCount: 0, overItems: 0 };
    }
    for (const l of lines) {
      const b = byDept[l.department];
      b.estimated += l.estimated;
      b.actual += l.actual;
      b.lineCount += 1;
      if (l.actual > l.estimated) b.overItems += 1;
    }
    for (const d of FM_BUDGET_DEPTS) {
      byDept[d].variance = Math.round((byDept[d].actual - byDept[d].estimated) * 100) / 100;
    }
    const totalEstimated = lines.reduce((a, l) => a + l.estimated, 0);
    const totalActual = lines.reduce((a, l) => a + l.actual, 0);
    const variance = Math.round((totalActual - totalEstimated) * 100) / 100;
    const committed = lines.filter((l) => l.actual > 0).reduce((a, l) => a + l.actual, 0);
    // Per-line variance, biggest overruns first.
    const lineReport = lines
      .map((l) => ({
        id: l.id, description: l.description, department: l.department,
        estimated: l.estimated, actual: l.actual,
        variance: Math.round((l.actual - l.estimated) * 100) / 100,
        variancePct: l.estimated > 0
          ? Math.round(((l.actual - l.estimated) / l.estimated) * 1000) / 10 : 0,
        status: l.actual === 0 ? "pending" : l.actual > l.estimated ? "over" : l.actual < l.estimated ? "under" : "on_budget",
      }))
      .sort((a, b) => b.variance - a.variance);
    return {
      ok: true,
      result: {
        totalEstimated, totalActual, variance, committed,
        spentPct: totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 1000) / 10 : 0,
        overBudget: variance > 0,
        byDept, lines: lineReport,
        overrunLines: lineReport.filter((l) => l.status === "over").length,
        topOverrun: lineReport.find((l) => l.status === "over")?.description || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 6. Multicam / proxy media handling ──────────────────────────────
  const FM_MEDIA_KIND = ["video", "audio", "image"];
  const FM_PROXY_QUALITY = ["full", "proxy", "offline"];
  registerLensAction("film-studios", "media-register", (ctx, _a, params = {}) => {
  try {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 160);
    if (!name) return { ok: false, error: "media name required" };
    const sourceUrl = fmClean(params.sourceUrl, 600);
    if (sourceUrl && !/^https?:\/\//.test(sourceUrl)) return { ok: false, error: "sourceUrl must be http(s)" };
    const proxyUrl = fmClean(params.proxyUrl, 600);
    if (proxyUrl && !/^https?:\/\//.test(proxyUrl)) return { ok: false, error: "proxyUrl must be http(s)" };
    const media = {
      id: fmId("mda"), projectId: String(params.projectId), name,
      kind: fmPick(params.kind, FM_MEDIA_KIND, "video"),
      sourceUrl: sourceUrl || null,
      proxyUrl: proxyUrl || null,
      quality: proxyUrl ? "proxy" : fmPick(params.quality, FM_PROXY_QUALITY, "full"),
      camera: fmClean(params.camera, 40) || null,
      fps: parseFloat(params.fps) || null,
      durationFrames: Math.max(0, Math.round(fmNum(params.durationFrames))),
      mcamGroupId: null,
      createdAt: fmNow(),
    };
    fmListB(x.media, userId).push(media);
    saveFmState();
    return { ok: true, result: { media } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "media-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const media = (x.media.get(fmAid(ctx)) || [])
      .filter((m) => m.projectId === String(params.projectId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      ok: true,
      result: {
        media, count: media.length,
        proxyCount: media.filter((m) => m.quality === "proxy").length,
      },
    };
  });

  registerLensAction("film-studios", "media-set-quality", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const media = (x.media.get(fmAid(ctx)) || []).find((m) => m.id === params.id);
    if (!media) return { ok: false, error: "media not found" };
    media.quality = fmPick(params.quality, FM_PROXY_QUALITY, media.quality);
    saveFmState();
    return { ok: true, result: { id: media.id, quality: media.quality } };
  });

  registerLensAction("film-studios", "media-delete", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    const arr = x.media.get(userId) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "media not found" };
    arr.splice(i, 1);
    // Detach from any clips referencing it.
    for (const c of s.clips.get(userId) || []) {
      if (c.mediaId === params.id) c.mediaId = null;
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("film-studios", "clip-set-media", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const x = getFmExtra();
    const userId = fmAid(ctx);
    const clip = (s.clips.get(userId) || []).find((c) => c.id === params.clipId);
    if (!clip) return { ok: false, error: "clip not found" };
    if (params.mediaId) {
      const media = (x.media.get(userId) || []).find((m) => m.id === params.mediaId);
      if (!media) return { ok: false, error: "media not found" };
      clip.mediaId = media.id;
    } else {
      clip.mediaId = null;
    }
    if (params.mcamAngle != null) {
      const a = Math.round(fmNum(params.mcamAngle));
      clip.mcamAngle = a > 0 ? a : null;
    }
    saveFmState();
    return { ok: true, result: { clipId: clip.id, mediaId: clip.mediaId, mcamAngle: clip.mcamAngle || null } };
  });

  registerLensAction("film-studios", "multicam-group", (ctx, _a, params = {}) => {
  try {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = fmClean(params.name, 120);
    if (!name) return { ok: false, error: "group name required" };
    const mediaIds = Array.isArray(params.mediaIds) ? params.mediaIds.map(String) : [];
    if (mediaIds.length < 2) return { ok: false, error: "multicam group needs at least 2 media items" };
    const projectMedia = (x.media.get(userId) || []).filter((m) => m.projectId === String(params.projectId));
    const valid = mediaIds.filter((id) => projectMedia.some((m) => m.id === id));
    if (valid.length < 2) return { ok: false, error: "at least 2 media items must belong to the project" };
    const group = {
      id: fmId("mcg"), projectId: String(params.projectId), name,
      mediaIds: valid, angleCount: valid.length, createdAt: fmNow(),
    };
    fmListB(x.mcamGroups, userId).push(group);
    // Stamp angle index onto member media.
    valid.forEach((id, idx) => {
      const m = projectMedia.find((mm) => mm.id === id);
      if (m) { m.mcamGroupId = group.id; m.mcamAngle = idx + 1; }
    });
    saveFmState();
    return { ok: true, result: { group } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "multicam-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const mediaMap = new Map((x.media.get(userId) || []).map((m) => [m.id, m]));
    const groups = (x.mcamGroups.get(userId) || [])
      .filter((g) => g.projectId === String(params.projectId))
      .map((g) => ({
        ...g,
        angles: g.mediaIds
          .map((id) => mediaMap.get(id))
          .filter(Boolean)
          .map((m) => ({ id: m.id, name: m.name, camera: m.camera, quality: m.quality, mcamAngle: m.mcamAngle || null })),
      }));
    return { ok: true, result: { groups, count: groups.length } };
  });

  registerLensAction("film-studios", "multicam-delete", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = x.mcamGroups.get(userId) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "multicam group not found" };
    const [removed] = arr.splice(i, 1);
    for (const m of x.media.get(userId) || []) {
      if (m.mcamGroupId === removed.id) { m.mcamGroupId = null; m.mcamAngle = null; }
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── 7. Distribution / festival submission tracker ───────────────────
  const FM_FESTIVAL_STATUS = [
    "researching", "submitted", "in_consideration", "selected",
    "rejected", "screened", "awarded", "withdrawn",
  ];
  registerLensAction("film-studios", "festival-submit", (ctx, _a, params = {}) => {
  try {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const s = getFmState(); const userId = fmAid(ctx);
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const festival = fmClean(params.festival, 160);
    if (!festival) return { ok: false, error: "festival name required" };
    const submission = {
      id: fmId("fst"), projectId: String(params.projectId), festival,
      category: fmClean(params.category, 100) || null,
      status: fmPick(params.status, FM_FESTIVAL_STATUS, "researching"),
      submittedDate: fmClean(params.submittedDate, 10).slice(0, 10) || null,
      deadline: fmClean(params.deadline, 10).slice(0, 10) || null,
      fee: Math.max(0, fmNum(params.fee)),
      platform: fmClean(params.platform, 60) || null,
      notes: fmClean(params.notes, 600) || null,
      createdAt: fmNow(),
    };
    fmListB(x.festivals, userId).push(submission);
    saveFmState();
    return { ok: true, result: { submission } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("film-studios", "festival-list", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const subs = (x.festivals.get(fmAid(ctx)) || [])
      .filter((f) => f.projectId === String(params.projectId))
      .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    const byStatus = {};
    for (const st of FM_FESTIVAL_STATUS) byStatus[st] = 0;
    let totalFees = 0;
    for (const f of subs) { byStatus[f.status] = (byStatus[f.status] || 0) + 1; totalFees += f.fee; }
    return {
      ok: true,
      result: {
        submissions: subs, count: subs.length, byStatus, totalFees,
        selected: subs.filter((f) => ["selected", "screened", "awarded"].includes(f.status)).length,
        pending: subs.filter((f) => ["submitted", "in_consideration"].includes(f.status)).length,
      },
    };
  });

  registerLensAction("film-studios", "festival-update", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const sub = (x.festivals.get(fmAid(ctx)) || []).find((f) => f.id === params.id);
    if (!sub) return { ok: false, error: "submission not found" };
    if (params.festival != null) {
      const fv = fmClean(params.festival, 160);
      if (fv) sub.festival = fv;
    }
    if (params.category != null) sub.category = fmClean(params.category, 100) || null;
    if (params.status != null) sub.status = fmPick(params.status, FM_FESTIVAL_STATUS, sub.status);
    if (params.submittedDate != null) sub.submittedDate = fmClean(params.submittedDate, 10).slice(0, 10) || null;
    if (params.deadline != null) sub.deadline = fmClean(params.deadline, 10).slice(0, 10) || null;
    if (params.fee != null) sub.fee = Math.max(0, fmNum(params.fee));
    if (params.platform != null) sub.platform = fmClean(params.platform, 60) || null;
    if (params.notes != null) sub.notes = fmClean(params.notes, 600) || null;
    saveFmState();
    return { ok: true, result: { submission: sub } };
  });

  registerLensAction("film-studios", "festival-delete", (ctx, _a, params = {}) => {
    const x = getFmExtra(); if (!x) return { ok: false, error: "STATE unavailable" };
    const arr = x.festivals.get(fmAid(ctx)) || [];
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "submission not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });
}
