// server/domains/creativewriting.js
export default function registerCreativeWritingActions(registerLensAction) {
  registerLensAction("creative-writing", "manuscriptAnalysis", (ctx, artifact, _params) => {
    const text = artifact.data?.content || artifact.data?.text || "";
    if (!text) return { ok: true, result: { message: "Add manuscript text to analyze." } };
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const paragraphs = text.split(/\n\n+/).filter(Boolean);
    const avgWordsPerSentence = sentences.length > 0 ? Math.round(words.length / sentences.length * 10) / 10 : 0;
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, ""))).size;
    const vocabularyRichness = words.length > 0 ? Math.round((uniqueWords / words.length) * 100) : 0;
    const dialogueLines = (text.match(/[""][^""]*[""]|["""][^""]*["""]/g) || []).length;
    const dialoguePercent = sentences.length > 0 ? Math.round((dialogueLines / sentences.length) * 100) : 0;
    return { ok: true, result: { wordCount: words.length, sentenceCount: sentences.length, paragraphCount: paragraphs.length, avgWordsPerSentence, vocabularyRichness, dialoguePercent, readingLevel: avgWordsPerSentence > 20 ? "advanced" : avgWordsPerSentence > 14 ? "intermediate" : "accessible", estimatedReadTime: `${Math.ceil(words.length / 250)} minutes`, pacing: avgWordsPerSentence < 12 ? "fast-paced" : avgWordsPerSentence < 18 ? "moderate" : "literary" } };
  });
  registerLensAction("creative-writing", "characterProfile", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const traits = data.traits || [];
    const motivations = data.motivations || [];
    const flaws = data.flaws || [];
    const complexity = Math.min(100, (traits.length * 10 + motivations.length * 15 + flaws.length * 20));
    return { ok: true, result: { name: data.characterName || data.name || artifact.title, role: data.role || "protagonist", traits, motivations, flaws, complexityScore: complexity, arcType: data.arcType || (flaws.length > 0 ? "transformation" : "flat"), dimensionality: complexity >= 60 ? "three-dimensional" : complexity >= 30 ? "two-dimensional" : "archetype", suggestions: flaws.length === 0 ? ["Add character flaws for depth"] : motivations.length === 0 ? ["Define core motivation"] : ["Character is well-developed"] } };
  });
  registerLensAction("creative-writing", "plotStructure", (ctx, artifact, _params) => {
    const beats = artifact.data?.beats || artifact.data?.plotPoints || [];
    const structure = artifact.data?.structure || "three-act";
    const structures = {
      "three-act": ["Setup", "Confrontation", "Resolution"],
      "heros-journey": ["Ordinary World", "Call to Adventure", "Refusal", "Meeting Mentor", "Crossing Threshold", "Tests", "Approach", "Ordeal", "Reward", "Road Back", "Resurrection", "Return"],
      "five-act": ["Exposition", "Rising Action", "Climax", "Falling Action", "Denouement"],
      "save-the-cat": ["Opening Image", "Theme Stated", "Setup", "Catalyst", "Debate", "Break into Two", "B Story", "Fun and Games", "Midpoint", "Bad Guys Close In", "All Is Lost", "Dark Night of the Soul", "Break into Three", "Finale", "Final Image"],
    };
    const template = structures[structure] || structures["three-act"];
    const coverage = template.map(beat => ({ beat, covered: beats.some(b => (b.name || b).toLowerCase().includes(beat.toLowerCase().slice(0, 5))), note: beats.find(b => (b.name || b).toLowerCase().includes(beat.toLowerCase().slice(0, 5)))?.name || null }));
    return { ok: true, result: { structure, beats: coverage, coveragePercent: Math.round((coverage.filter(c => c.covered).length / coverage.length) * 100), missingBeats: coverage.filter(c => !c.covered).map(c => c.beat), totalPlotPoints: beats.length } };
  });
  registerLensAction("creative-writing", "dialogueCheck", (ctx, artifact, _params) => {
    const dialogue = artifact.data?.dialogue || artifact.data?.content || "";
    const lines = dialogue.split("\n").filter(l => l.trim());
    const speakers = {};
    for (const line of lines) {
      const match = line.match(/^([^:""]+)[:]/);
      if (match) { const name = match[1].trim(); speakers[name] = (speakers[name] || 0) + 1; }
    }
    const totalLines = lines.length;
    const speakerCount = Object.keys(speakers).length;
    const avgLineLength = lines.length > 0 ? Math.round(lines.reduce((s, l) => s + l.length, 0) / lines.length) : 0;
    return { ok: true, result: { totalLines, speakers: Object.entries(speakers).map(([name, count]) => ({ name, lines: count, percent: Math.round((count / totalLines) * 100) })), speakerCount, avgLineLength, balance: speakerCount > 1 ? (Math.max(...Object.values(speakers)) / totalLines < 0.7 ? "balanced" : "one-character-dominant") : "monologue", pacing: avgLineLength < 50 ? "snappy" : avgLineLength < 100 ? "natural" : "long-winded" } };
  });

  // ─── Scrivener + Dabble + Plottr 2026 parity — manuscript studio ────
  // Projects with a chapter/scene binder, a corkboard of synopsis
  // cards, characters, plot threads, word-count goals and sessions.

  function getCwState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.writingLens) STATE.writingLens = {};
    const s = STATE.writingLens;
    for (const k of ["projects", "chapters", "scenes", "characters", "threads", "sessions"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveCwState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const cwId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cwNow = () => new Date().toISOString();
  const cwAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const cwListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const cwNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const cwClean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);
  const cwPick = (v, allowed, dflt) => (allowed.includes(String(v)) ? String(v) : dflt);
  const cwWords = (text) => cwClean(text, 200000).split(/\s+/).filter(Boolean).length;

  const CW_SCENE_STATUS = ["outline", "draft", "revised", "final"];
  const CW_CHAR_ROLES = ["protagonist", "antagonist", "supporting", "minor"];

  function cwProject(s, userId, projectId) {
    return (s.projects.get(userId) || []).find((p) => p.id === projectId) || null;
  }

  // ── Projects ────────────────────────────────────────────────────────
  registerLensAction("creative-writing", "project-create", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = cwClean(params.title, 160);
    if (!title) return { ok: false, error: "project title required" };
    const project = {
      id: cwId("man"), title,
      genre: cwClean(params.genre, 40) || "fiction",
      targetWords: Math.max(0, Math.round(cwNum(params.targetWords))),
      logline: cwClean(params.logline, 400) || null,
      createdAt: cwNow(), updatedAt: cwNow(),
    };
    cwListB(s.projects, cwAid(ctx)).push(project);
    saveCwState();
    return { ok: true, result: { project } };
  });

  registerLensAction("creative-writing", "project-list", (ctx, _a, _params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scenes = s.scenes.get(userId) || [];
    const projects = (s.projects.get(userId) || []).map((p) => ({
      ...p,
      wordCount: scenes.filter((x) => x.projectId === p.id).reduce((a, x) => a + x.wordCount, 0),
    }));
    return { ok: true, result: { projects, count: projects.length } };
  });

  registerLensAction("creative-writing", "project-get", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.id);
    if (!project) return { ok: false, error: "project not found" };
    const chapters = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    const scenes = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    return {
      ok: true,
      result: {
        project, chapters, scenes,
        characters: (s.characters.get(userId) || []).filter((c) => c.projectId === project.id),
        threads: (s.threads.get(userId) || []).filter((t) => t.projectId === project.id),
        wordCount: scenes.reduce((a, x) => a + x.wordCount, 0),
      },
    };
  });

  registerLensAction("creative-writing", "project-update", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = cwProject(s, cwAid(ctx), params.id);
    if (!project) return { ok: false, error: "project not found" };
    if (params.title != null) project.title = cwClean(params.title, 160) || project.title;
    if (params.genre != null) project.genre = cwClean(params.genre, 40) || project.genre;
    if (params.targetWords != null) project.targetWords = Math.max(0, Math.round(cwNum(params.targetWords)));
    if (params.logline != null) project.logline = cwClean(params.logline, 400) || null;
    project.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { project } };
  });

  registerLensAction("creative-writing", "project-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const arr = s.projects.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    for (const k of ["chapters", "scenes", "characters", "threads", "sessions"]) {
      const list = s[k].get(userId);
      if (list) s[k].set(userId, list.filter((x) => x.projectId !== params.id));
    }
    saveCwState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Chapters (binder folders) ───────────────────────────────────────
  registerLensAction("creative-writing", "chapter-add", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const existing = (s.chapters.get(userId) || []).filter((c) => c.projectId === params.projectId);
    const chapter = {
      id: cwId("chp"), projectId: String(params.projectId),
      title: cwClean(params.title, 160) || `Chapter ${existing.length + 1}`,
      order: existing.length, createdAt: cwNow(),
    };
    cwListB(s.chapters, userId).push(chapter);
    saveCwState();
    return { ok: true, result: { chapter } };
  });

  registerLensAction("creative-writing", "chapter-update", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const chapter = (s.chapters.get(cwAid(ctx)) || []).find((c) => c.id === params.chapterId);
    if (!chapter) return { ok: false, error: "chapter not found" };
    const title = cwClean(params.title, 160);
    if (!title) return { ok: false, error: "title required" };
    chapter.title = title;
    saveCwState();
    return { ok: true, result: { chapter } };
  });

  registerLensAction("creative-writing", "chapter-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const arr = s.chapters.get(userId) || [];
    const i = arr.findIndex((c) => c.id === params.chapterId);
    if (i < 0) return { ok: false, error: "chapter not found" };
    arr.splice(i, 1);
    // scenes in this chapter become unfiled (chapterId null)
    for (const sc of s.scenes.get(userId) || []) {
      if (sc.chapterId === params.chapterId) sc.chapterId = null;
    }
    saveCwState();
    return { ok: true, result: { deleted: params.chapterId } };
  });

  registerLensAction("creative-writing", "chapter-reorder", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const chapter = (s.chapters.get(userId) || []).find((c) => c.id === params.chapterId);
    if (!chapter) return { ok: false, error: "chapter not found" };
    const sibs = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === chapter.projectId)
      .sort((a, b) => a.order - b.order);
    const i = sibs.indexOf(chapter);
    const j = i + (params.direction === "down" ? 1 : -1);
    if (j >= 0 && j < sibs.length) {
      [sibs[i].order, sibs[j].order] = [sibs[j].order, sibs[i].order];
    }
    saveCwState();
    return { ok: true, result: { order: sibs.sort((a, b) => a.order - b.order).map((c) => c.id) } };
  });

  // ── Scenes (binder documents / corkboard cards) ─────────────────────
  registerLensAction("creative-writing", "scene-add", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    let chapterId = params.chapterId ? String(params.chapterId) : null;
    if (chapterId && !(s.chapters.get(userId) || []).some((c) => c.id === chapterId)) chapterId = null;
    const existing = (s.scenes.get(userId) || []).filter((x) => x.projectId === params.projectId);
    const scene = {
      id: cwId("scn"), projectId: String(params.projectId), chapterId,
      title: cwClean(params.title, 160) || `Scene ${existing.length + 1}`,
      synopsis: cwClean(params.synopsis, 600) || null,
      status: cwPick(params.status, CW_SCENE_STATUS, "outline"),
      content: "", wordCount: 0,
      povCharacterId: null, threadIds: [],
      order: existing.length, createdAt: cwNow(), updatedAt: cwNow(),
    };
    cwListB(s.scenes, userId).push(scene);
    saveCwState();
    return { ok: true, result: { scene } };
  });

  registerLensAction("creative-writing", "scene-update", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    if (params.title != null) scene.title = cwClean(params.title, 160) || scene.title;
    if (params.synopsis != null) scene.synopsis = cwClean(params.synopsis, 600) || null;
    if (params.status != null) scene.status = cwPick(params.status, CW_SCENE_STATUS, scene.status);
    if (params.povCharacterId !== undefined) {
      const cid = params.povCharacterId ? String(params.povCharacterId) : null;
      scene.povCharacterId = (cid && (s.characters.get(userId) || []).some((c) => c.id === cid)) ? cid : null;
    }
    scene.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { scene } };
  });

  registerLensAction("creative-writing", "scene-write", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scene = (s.scenes.get(cwAid(ctx)) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    scene.content = cwClean(params.content, 200000);
    scene.wordCount = cwWords(scene.content);
    scene.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { sceneId: scene.id, wordCount: scene.wordCount } };
  });

  registerLensAction("creative-writing", "scene-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.scenes.get(cwAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.sceneId);
    if (i < 0) return { ok: false, error: "scene not found" };
    arr.splice(i, 1);
    saveCwState();
    return { ok: true, result: { deleted: params.sceneId } };
  });

  registerLensAction("creative-writing", "scene-reorder", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const sibs = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === scene.projectId && x.chapterId === scene.chapterId)
      .sort((a, b) => a.order - b.order);
    const i = sibs.indexOf(scene);
    const j = i + (params.direction === "down" ? 1 : -1);
    if (j >= 0 && j < sibs.length) {
      [sibs[i].order, sibs[j].order] = [sibs[j].order, sibs[i].order];
    }
    saveCwState();
    return { ok: true, result: { order: sibs.sort((a, b) => a.order - b.order).map((x) => x.id) } };
  });

  registerLensAction("creative-writing", "scene-move", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    let chapterId = params.chapterId ? String(params.chapterId) : null;
    if (chapterId && !(s.chapters.get(userId) || []).some((c) => c.id === chapterId)) {
      return { ok: false, error: "target chapter not found" };
    }
    scene.chapterId = chapterId;
    scene.order = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === scene.projectId && x.chapterId === chapterId && x.id !== scene.id).length;
    saveCwState();
    return { ok: true, result: { sceneId: scene.id, chapterId } };
  });

  // ── Characters ──────────────────────────────────────────────────────
  registerLensAction("creative-writing", "character-add", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = cwClean(params.name, 100);
    if (!name) return { ok: false, error: "character name required" };
    const character = {
      id: cwId("cha"), projectId: String(params.projectId), name,
      role: cwPick(params.role, CW_CHAR_ROLES, "supporting"),
      description: cwClean(params.description, 1000) || null,
      arc: cwClean(params.arc, 1000) || null,
      createdAt: cwNow(),
    };
    cwListB(s.characters, userId).push(character);
    saveCwState();
    return { ok: true, result: { character } };
  });

  registerLensAction("creative-writing", "character-list", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const characters = (s.characters.get(cwAid(ctx)) || []).filter((c) => c.projectId === String(params.projectId));
    return { ok: true, result: { characters, count: characters.length } };
  });

  registerLensAction("creative-writing", "character-update", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const character = (s.characters.get(cwAid(ctx)) || []).find((c) => c.id === params.characterId);
    if (!character) return { ok: false, error: "character not found" };
    if (params.name != null) character.name = cwClean(params.name, 100) || character.name;
    if (params.role != null) character.role = cwPick(params.role, CW_CHAR_ROLES, character.role);
    if (params.description != null) character.description = cwClean(params.description, 1000) || null;
    if (params.arc != null) character.arc = cwClean(params.arc, 1000) || null;
    saveCwState();
    return { ok: true, result: { character } };
  });

  registerLensAction("creative-writing", "character-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const arr = s.characters.get(userId) || [];
    const i = arr.findIndex((c) => c.id === params.characterId);
    if (i < 0) return { ok: false, error: "character not found" };
    arr.splice(i, 1);
    for (const sc of s.scenes.get(userId) || []) {
      if (sc.povCharacterId === params.characterId) sc.povCharacterId = null;
    }
    saveCwState();
    return { ok: true, result: { deleted: params.characterId } };
  });

  // ── Plot threads (Plottr-style storylines) ──────────────────────────
  registerLensAction("creative-writing", "thread-create", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = cwClean(params.name, 100);
    if (!name) return { ok: false, error: "thread name required" };
    const thread = {
      id: cwId("thr"), projectId: String(params.projectId), name,
      color: cwClean(params.color, 16) || "indigo",
      createdAt: cwNow(),
    };
    cwListB(s.threads, userId).push(thread);
    saveCwState();
    return { ok: true, result: { thread } };
  });

  registerLensAction("creative-writing", "thread-list", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scenes = s.scenes.get(userId) || [];
    const threads = (s.threads.get(userId) || [])
      .filter((t) => t.projectId === String(params.projectId))
      .map((t) => ({ ...t, sceneCount: scenes.filter((sc) => sc.threadIds.includes(t.id)).length }));
    return { ok: true, result: { threads, count: threads.length } };
  });

  registerLensAction("creative-writing", "thread-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const arr = s.threads.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.threadId);
    if (i < 0) return { ok: false, error: "thread not found" };
    arr.splice(i, 1);
    for (const sc of s.scenes.get(userId) || []) {
      sc.threadIds = sc.threadIds.filter((id) => id !== params.threadId);
    }
    saveCwState();
    return { ok: true, result: { deleted: params.threadId } };
  });

  registerLensAction("creative-writing", "scene-thread-tag", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const thread = (s.threads.get(userId) || []).find((t) => t.id === params.threadId);
    if (!thread) return { ok: false, error: "thread not found" };
    const attach = params.attached !== false;
    if (attach && !scene.threadIds.includes(thread.id)) scene.threadIds.push(thread.id);
    if (!attach) scene.threadIds = scene.threadIds.filter((id) => id !== thread.id);
    saveCwState();
    return { ok: true, result: { sceneId: scene.id, threadIds: scene.threadIds } };
  });

  // ── Word-count sessions & stats ─────────────────────────────────────
  registerLensAction("creative-writing", "session-log", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const words = Math.round(cwNum(params.words));
    if (!words) return { ok: false, error: "words written required" };
    const session = {
      id: cwId("ses"), projectId: String(params.projectId), words,
      minutes: Math.max(0, Math.round(cwNum(params.minutes))),
      date: cwNow().slice(0, 10), at: cwNow(),
    };
    cwListB(s.sessions, userId).push(session);
    saveCwState();
    return { ok: true, result: { session } };
  });

  registerLensAction("creative-writing", "writing-stats", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    const chapters = (s.chapters.get(userId) || []).filter((c) => c.projectId === project.id);
    const sessions = (s.sessions.get(userId) || []).filter((x) => x.projectId === project.id);
    const totalWords = scenes.reduce((a, x) => a + x.wordCount, 0);
    const today = cwNow().slice(0, 10);
    const byChapter = chapters.map((c) => ({
      chapterId: c.id, title: c.title,
      words: scenes.filter((x) => x.chapterId === c.id).reduce((a, x) => a + x.wordCount, 0),
    }));
    const dates = new Set(sessions.map((x) => x.date));
    let streak = 0;
    const d = new Date();
    if (!dates.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    while (dates.has(d.toISOString().slice(0, 10))) { streak += 1; d.setUTCDate(d.getUTCDate() - 1); }
    return {
      ok: true,
      result: {
        totalWords,
        targetWords: project.targetWords,
        targetPct: project.targetWords ? Math.round((totalWords / project.targetWords) * 100) : 0,
        wordsToday: sessions.filter((x) => x.date === today).reduce((a, x) => a + x.words, 0),
        sessionWords: sessions.reduce((a, x) => a + x.words, 0),
        sessionCount: sessions.length,
        streak,
        byChapter,
        recentSessions: [...sessions].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14),
      },
    };
  });

  // ── Corkboard view ──────────────────────────────────────────────────
  registerLensAction("creative-writing", "corkboard", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const allScenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === String(params.projectId));
    const card = (sc) => ({
      id: sc.id, chapterId: sc.chapterId, title: sc.title,
      synopsis: sc.synopsis, status: sc.status, wordCount: sc.wordCount, threadIds: sc.threadIds,
    });
    const chapters = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === String(params.projectId))
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        id: c.id, title: c.title,
        cards: allScenes.filter((sc) => sc.chapterId === c.id).sort((a, b) => a.order - b.order).map(card),
      }));
    const unfiled = allScenes.filter((sc) => !sc.chapterId).sort((a, b) => a.order - b.order).map(card);
    return { ok: true, result: { chapters, unfiled } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("creative-writing", "project-dashboard", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    const byStatus = {};
    for (const st of CW_SCENE_STATUS) byStatus[st] = scenes.filter((x) => x.status === st).length;
    return {
      ok: true,
      result: {
        title: project.title,
        wordCount: scenes.reduce((a, x) => a + x.wordCount, 0),
        targetWords: project.targetWords,
        chapters: (s.chapters.get(userId) || []).filter((c) => c.projectId === project.id).length,
        scenes: scenes.length,
        characters: (s.characters.get(userId) || []).filter((c) => c.projectId === project.id).length,
        threads: (s.threads.get(userId) || []).filter((t) => t.projectId === project.id).length,
        byStatus,
      },
    };
  });
}
