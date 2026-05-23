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
    for (const k of ["projects", "chapters", "scenes", "characters", "threads", "sessions",
      "notes", "snapshots", "comments", "charRelations"]) {
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
      deadline: cwClean(params.deadline, 10).slice(0, 10) || null,
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
    if (params.deadline != null) project.deadline = cwClean(params.deadline, 10).slice(0, 10) || null;
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
    for (const k of ["chapters", "scenes", "characters", "threads", "sessions",
      "notes", "snapshots", "comments", "charRelations"]) {
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // ─── Scrivener + Dabble + Plottr — completion modules ───────────────

  const CW_NOTE_KINDS = ["research", "worldbuilding", "location", "item", "lore"];
  const CW_REL_KINDS = ["family", "romance", "friend", "rival", "mentor", "ally", "enemy", "other"];

  // ── Research / story notes ──────────────────────────────────────────
  registerLensAction("creative-writing", "note-create", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const title = cwClean(params.title, 160);
    if (!title) return { ok: false, error: "note title required" };
    const note = {
      id: cwId("note"), projectId: String(params.projectId), title,
      kind: cwPick(params.kind, CW_NOTE_KINDS, "research"),
      body: cwClean(params.body, 20000) || "",
      createdAt: cwNow(), updatedAt: cwNow(),
    };
    cwListB(s.notes, userId).push(note);
    saveCwState();
    return { ok: true, result: { note } };
  });

  registerLensAction("creative-writing", "note-list", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let notes = (s.notes.get(cwAid(ctx)) || []).filter((n) => n.projectId === String(params.projectId));
    if (params.kind) notes = notes.filter((n) => n.kind === String(params.kind));
    return { ok: true, result: { notes, count: notes.length } };
  });

  registerLensAction("creative-writing", "note-update", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const note = (s.notes.get(cwAid(ctx)) || []).find((n) => n.id === params.id);
    if (!note) return { ok: false, error: "note not found" };
    if (params.title != null) note.title = cwClean(params.title, 160) || note.title;
    if (params.kind != null) note.kind = cwPick(params.kind, CW_NOTE_KINDS, note.kind);
    if (params.body != null) note.body = cwClean(params.body, 20000);
    note.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { note } };
  });

  registerLensAction("creative-writing", "note-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.notes.get(cwAid(ctx)) || [];
    const i = arr.findIndex((n) => n.id === params.id);
    if (i < 0) return { ok: false, error: "note not found" };
    arr.splice(i, 1);
    saveCwState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Scene snapshots ─────────────────────────────────────────────────
  registerLensAction("creative-writing", "snapshot-take", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const snapshot = {
      id: cwId("snap"), sceneId: scene.id, projectId: scene.projectId,
      title: cwClean(params.title, 80) || `Snapshot ${cwNow().slice(0, 16)}`,
      content: scene.content || "", wordCount: scene.wordCount || 0,
      takenAt: cwNow(),
    };
    cwListB(s.snapshots, userId).push(snapshot);
    saveCwState();
    return { ok: true, result: { snapshot: { id: snapshot.id, title: snapshot.title, wordCount: snapshot.wordCount, takenAt: snapshot.takenAt } } };
  });

  registerLensAction("creative-writing", "snapshot-list", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const snapshots = (s.snapshots.get(cwAid(ctx)) || [])
      .filter((sn) => sn.sceneId === String(params.sceneId))
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
      .map((sn) => ({ id: sn.id, title: sn.title, wordCount: sn.wordCount, takenAt: sn.takenAt }));
    return { ok: true, result: { snapshots, count: snapshots.length } };
  });

  registerLensAction("creative-writing", "snapshot-restore", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const snap = (s.snapshots.get(userId) || []).find((sn) => sn.id === params.id);
    if (!snap) return { ok: false, error: "snapshot not found" };
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === snap.sceneId);
    if (!scene) return { ok: false, error: "scene no longer exists" };
    scene.content = snap.content;
    scene.wordCount = snap.wordCount;
    scene.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { sceneId: scene.id, wordCount: scene.wordCount } };
  });

  registerLensAction("creative-writing", "snapshot-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.snapshots.get(cwAid(ctx)) || [];
    const i = arr.findIndex((sn) => sn.id === params.id);
    if (i < 0) return { ok: false, error: "snapshot not found" };
    arr.splice(i, 1);
    saveCwState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Plot grid ───────────────────────────────────────────────────────
  registerLensAction("creative-writing", "plot-grid", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const chapters = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === String(params.projectId))
      .sort((a, b) => a.order - b.order);
    const threads = (s.threads.get(userId) || []).filter((t) => t.projectId === String(params.projectId));
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === String(params.projectId));
    const grid = chapters.map((ch) => ({
      chapterId: ch.id, title: ch.title,
      cells: threads.map((th) => {
        const hits = scenes.filter((sc) => sc.chapterId === ch.id && (sc.threadIds || []).includes(th.id));
        return { threadId: th.id, sceneCount: hits.length, scenes: hits.map((sc) => sc.title) };
      }),
    }));
    return {
      ok: true,
      result: { threads: threads.map((t) => ({ id: t.id, name: t.name, color: t.color })), grid },
    };
  });

  // ── Compile / export ────────────────────────────────────────────────
  registerLensAction("creative-writing", "compile", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const chapters = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    const includeDrafts = params.includeDrafts !== false;
    let text = `${project.title}\n${"=".repeat(project.title.length)}\n\n`;
    let wordCount = 0;
    const parts = [];
    for (const ch of chapters) {
      const chScenes = scenes.filter((sc) => sc.chapterId === ch.id).sort((a, b) => a.order - b.order);
      const usable = chScenes.filter((sc) => includeDrafts || sc.status === "final" || sc.status === "revised");
      if (!usable.length) continue;
      text += `\n${ch.title}\n${"-".repeat(ch.title.length)}\n\n`;
      for (const sc of usable) {
        if (sc.content) { text += `${sc.content}\n\n`; wordCount += sc.wordCount || 0; }
      }
      parts.push({ chapter: ch.title, scenes: usable.length });
    }
    return {
      ok: true,
      result: { title: project.title, manuscript: text, wordCount, chapters: parts },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Goal projection ─────────────────────────────────────────────────
  registerLensAction("creative-writing", "goal-projection", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    const current = scenes.reduce((a, x) => a + (x.wordCount || 0), 0);
    const wordsLeft = Math.max(0, project.targetWords - current);
    const sessions = (s.sessions.get(userId) || []).filter((x) => x.projectId === project.id);
    const recent = sessions.filter((x) => x.date >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    const pace = recent.length ? Math.round(recent.reduce((a, x) => a + x.words, 0) / 7) : 0;
    let daysLeft = null; let perDayNeeded = null; let onTrack = null;
    if (project.deadline) {
      daysLeft = Math.ceil((Date.parse(`${project.deadline}T00:00:00Z`) - Date.now()) / 86400000);
      if (daysLeft > 0) {
        perDayNeeded = Math.ceil(wordsLeft / daysLeft);
        onTrack = pace >= perDayNeeded;
      }
    }
    return {
      ok: true,
      result: {
        targetWords: project.targetWords, currentWords: current, wordsLeft,
        deadline: project.deadline, daysLeft, recentPace: pace, perDayNeeded, onTrack,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Scene comments / annotations ────────────────────────────────────
  registerLensAction("creative-writing", "scene-comment-add", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    const body = cwClean(params.body, 1000);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = {
      id: cwId("cmt"), sceneId: scene.id, projectId: scene.projectId, body,
      anchor: cwClean(params.anchor, 120) || null,
      resolved: false, createdAt: cwNow(),
    };
    cwListB(s.comments, userId).push(comment);
    saveCwState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("creative-writing", "scene-comment-list", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comments = (s.comments.get(cwAid(ctx)) || [])
      .filter((c) => c.sceneId === String(params.sceneId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { comments, count: comments.length } };
  });

  registerLensAction("creative-writing", "scene-comment-delete", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.comments.get(cwAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "comment not found" };
    arr.splice(i, 1);
    saveCwState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Character relationships ─────────────────────────────────────────
  registerLensAction("creative-writing", "character-relate", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const chars = s.characters.get(userId) || [];
    const from = chars.find((c) => c.id === params.fromId);
    const to = chars.find((c) => c.id === params.toId);
    if (!from || !to) return { ok: false, error: "both characters must exist" };
    if (from.id === to.id) return { ok: false, error: "a character cannot relate to itself" };
    const kind = cwPick(params.kind, CW_REL_KINDS, "other");
    const exists = (s.charRelations.get(userId) || []).some(
      (r) => r.fromId === from.id && r.toId === to.id);
    if (exists) return { ok: false, error: "relationship already exists" };
    const relation = {
      id: cwId("rel"), projectId: from.projectId,
      fromId: from.id, toId: to.id, kind,
      note: cwClean(params.note, 300) || null,
    };
    cwListB(s.charRelations, userId).push(relation);
    saveCwState();
    return { ok: true, result: { relation } };
  });

  registerLensAction("creative-writing", "character-relationships", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const chars = new Map((s.characters.get(userId) || []).map((c) => [c.id, c.name]));
    let rels = s.charRelations.get(userId) || [];
    if (params.characterId) {
      rels = rels.filter((r) => r.fromId === params.characterId || r.toId === params.characterId);
    } else if (params.projectId) {
      rels = rels.filter((r) => r.projectId === String(params.projectId));
    }
    return {
      ok: true,
      result: {
        relationships: rels.map((r) => ({
          id: r.id, kind: r.kind, note: r.note,
          fromId: r.fromId, fromName: chars.get(r.fromId) || "?",
          toId: r.toId, toName: chars.get(r.toId) || "?",
        })),
        count: rels.length,
      },
    };
  });

  registerLensAction("creative-writing", "character-unrelate", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.charRelations.get(cwAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "relationship not found" };
    arr.splice(i, 1);
    saveCwState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Feature-parity backlog — Scrivener / Sudowrite completion ──────
  // Draggable corkboard, format-aware compile, per-document targets,
  // scene-linked setting bible, snapshot diffing, manuscript statistics.

  // ── Visual corkboard — explicit-index reorder ───────────────────────
  // The arrow-key scene-reorder above does a swap; a draggable corkboard
  // needs to drop a card at an arbitrary index. scene-set-order takes the
  // full ordered list of sibling scene ids and renumbers them.
  registerLensAction("creative-writing", "scene-set-order", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const ids = Array.isArray(params.sceneIds) ? params.sceneIds.map(String) : [];
    if (!ids.length) return { ok: false, error: "sceneIds required" };
    const all = s.scenes.get(userId) || [];
    const targetChapter = params.chapterId ? String(params.chapterId) : null;
    if (targetChapter && !(s.chapters.get(userId) || []).some((c) => c.id === targetChapter)) {
      return { ok: false, error: "target chapter not found" };
    }
    const moved = [];
    ids.forEach((id, idx) => {
      const scene = all.find((x) => x.id === id && x.projectId === String(params.projectId));
      if (!scene) return;
      scene.chapterId = targetChapter;
      scene.order = idx;
      scene.updatedAt = cwNow();
      moved.push(scene.id);
    });
    if (!moved.length) return { ok: false, error: "no matching scenes" };
    saveCwState();
    return { ok: true, result: { order: moved, chapterId: targetChapter } };
  });

  // ── Compile / export with format presets ────────────────────────────
  // Builds a real downloadable document body for the requested format.
  // Keyless, dependency-free: Markdown, HTML, and EPUB-flavoured XHTML
  // are produced inline; the frontend turns the body into a Blob.
  const CW_COMPILE_FORMATS = ["markdown", "html", "epub", "text", "fountain"];
  const CW_COMPILE_PRESETS = {
    manuscript: { sceneBreak: "\n\n* * *\n\n", chapterNumbered: true, fontHint: "12pt serif" },
    ebook: { sceneBreak: "\n\n— ❖ —\n\n", chapterNumbered: false, fontHint: "1em serif" },
    proof: { sceneBreak: "\n\n[scene break]\n\n", chapterNumbered: true, fontHint: "12pt mono" },
  };
  function cwEsc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  registerLensAction("creative-writing", "compile-export", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const format = cwPick(params.format, CW_COMPILE_FORMATS, "markdown");
    const presetKey = CW_COMPILE_PRESETS[params.preset] ? params.preset : "manuscript";
    const preset = CW_COMPILE_PRESETS[presetKey];
    const includeDrafts = params.includeDrafts !== false;
    const includeSynopsis = params.includeSynopsis === true;
    const chapters = (s.chapters.get(userId) || [])
      .filter((c) => c.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    const scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    const usableScenes = (chId) => (s.scenes.get(userId) || [])
      .filter((sc) => sc.projectId === project.id && sc.chapterId === chId)
      .sort((a, b) => a.order - b.order)
      .filter((sc) => includeDrafts || sc.status === "final" || sc.status === "revised");

    const sections = [];
    let wordCount = 0;
    let chapterNum = 0;
    for (const ch of chapters) {
      const chScenes = usableScenes(ch.id);
      if (!chScenes.length) continue;
      chapterNum += 1;
      const heading = preset.chapterNumbered ? `Chapter ${chapterNum}: ${ch.title}` : ch.title;
      const sceneBodies = chScenes.map((sc) => {
        wordCount += sc.wordCount || 0;
        return { title: sc.title, synopsis: sc.synopsis || "", content: sc.content || "" };
      });
      sections.push({ heading, scenes: sceneBodies });
    }
    const unfiled = usableScenes(null);
    if (unfiled.length) {
      sections.push({
        heading: "Unfiled",
        scenes: unfiled.map((sc) => {
          wordCount += sc.wordCount || 0;
          return { title: sc.title, synopsis: sc.synopsis || "", content: sc.content || "" };
        }),
      });
    }

    let body = "";
    let mime = "text/plain";
    let extension = "txt";
    if (format === "markdown") {
      mime = "text/markdown"; extension = "md";
      body = `# ${project.title}\n\n`;
      if (project.logline) body += `*${project.logline}*\n\n`;
      for (const sec of sections) {
        body += `## ${sec.heading}\n\n`;
        sec.scenes.forEach((sc, i) => {
          if (includeSynopsis && sc.synopsis) body += `> ${sc.synopsis}\n\n`;
          if (sc.content) body += `${sc.content}\n`;
          if (i < sec.scenes.length - 1) body += preset.sceneBreak;
          else body += "\n";
        });
      }
    } else if (format === "html" || format === "epub") {
      mime = format === "epub" ? "application/xhtml+xml" : "text/html";
      extension = format === "epub" ? "xhtml" : "html";
      const chapHtml = sections.map((sec) => {
        const sceneHtml = sec.scenes.map((sc, i) => {
          const paras = (sc.content || "").split(/\n\n+/).filter(Boolean)
            .map((p) => `<p>${cwEsc(p).replace(/\n/g, "<br/>")}</p>`).join("\n");
          const syn = includeSynopsis && sc.synopsis
            ? `<p class="synopsis"><em>${cwEsc(sc.synopsis)}</em></p>\n` : "";
          const brk = i < sec.scenes.length - 1
            ? `<p class="scene-break">${cwEsc(preset.sceneBreak.trim())}</p>` : "";
          return `${syn}${paras || '<p class="empty">[empty scene]</p>'}\n${brk}`;
        }).join("\n");
        return `<section class="chapter">\n<h2>${cwEsc(sec.heading)}</h2>\n${sceneHtml}\n</section>`;
      }).join("\n");
      const docType = format === "epub"
        ? '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">'
        : "<!DOCTYPE html>\n<html>";
      body = `${docType}\n<head>\n<meta charset="UTF-8"/>\n<title>${cwEsc(project.title)}</title>\n` +
        `<style>body{font:${preset.fontHint};max-width:38em;margin:2em auto;line-height:1.6}` +
        `h1{text-align:center}.synopsis{color:#777}.scene-break{text-align:center}` +
        `.chapter{page-break-before:always}</style>\n</head>\n<body>\n` +
        `<h1>${cwEsc(project.title)}</h1>\n` +
        (project.logline ? `<p class="synopsis"><em>${cwEsc(project.logline)}</em></p>\n` : "") +
        `${chapHtml}\n</body>\n</html>`;
    } else if (format === "fountain") {
      mime = "text/plain"; extension = "fountain";
      body = `Title: ${project.title}\n\n`;
      for (const sec of sections) {
        body += `# ${sec.heading.toUpperCase()}\n\n`;
        sec.scenes.forEach((sc) => {
          if (sc.content) body += `${sc.content}\n\n`;
        });
      }
    } else {
      body = `${project.title}\n${"=".repeat(project.title.length)}\n\n`;
      for (const sec of sections) {
        body += `\n${sec.heading}\n${"-".repeat(sec.heading.length)}\n\n`;
        sec.scenes.forEach((sc, i) => {
          if (sc.content) body += `${sc.content}\n`;
          if (i < sec.scenes.length - 1) body += preset.sceneBreak;
        });
      }
    }
    const fileName = `${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
      .replace(/^-|-$/g, "") || "manuscript"}.${extension}`;
    return {
      ok: true,
      result: {
        format, preset: presetKey, mime, fileName, extension,
        body, wordCount,
        chapters: sections.map((s2) => ({ heading: s2.heading, scenes: s2.scenes.length })),
        sceneCount: scenes.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Per-document word-count targets ─────────────────────────────────
  // scene-set-target stores a goal on one scene; target-progress rolls
  // every scene's word count against its goal and the project total.
  registerLensAction("creative-writing", "scene-set-target", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scene = (s.scenes.get(cwAid(ctx)) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    scene.targetWords = Math.max(0, Math.round(cwNum(params.targetWords)));
    scene.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { sceneId: scene.id, targetWords: scene.targetWords } };
  });

  registerLensAction("creative-writing", "target-progress", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const scenes = (s.scenes.get(userId) || [])
      .filter((x) => x.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    const docs = scenes.map((sc) => {
      const target = Math.max(0, Math.round(cwNum(sc.targetWords)));
      const pct = target > 0 ? Math.min(999, Math.round((sc.wordCount / target) * 100)) : null;
      return {
        sceneId: sc.id, title: sc.title, chapterId: sc.chapterId,
        wordCount: sc.wordCount, targetWords: target,
        progressPct: pct,
        met: target > 0 ? sc.wordCount >= target : null,
      };
    });
    const totalWords = scenes.reduce((a, x) => a + x.wordCount, 0);
    const docsWithTargets = docs.filter((d) => d.targetWords > 0);
    const sceneTargetSum = docsWithTargets.reduce((a, d) => a + d.targetWords, 0);
    return {
      ok: true,
      result: {
        documents: docs,
        totalWords,
        projectTarget: project.targetWords,
        projectProgressPct: project.targetWords
          ? Math.min(999, Math.round((totalWords / project.targetWords) * 100)) : null,
        docsWithTargets: docsWithTargets.length,
        docsMet: docsWithTargets.filter((d) => d.met).length,
        sceneTargetSum,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── World / setting bible — notes linked into scenes ────────────────
  // Reuses the existing note substrate (kind location/lore/worldbuilding)
  // and adds a many-to-many link between notes and scenes.
  registerLensAction("creative-writing", "note-link-scene", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const note = (s.notes.get(userId) || []).find((n) => n.id === params.noteId);
    if (!note) return { ok: false, error: "note not found" };
    const scene = (s.scenes.get(userId) || []).find((x) => x.id === params.sceneId);
    if (!scene) return { ok: false, error: "scene not found" };
    if (note.projectId !== scene.projectId) {
      return { ok: false, error: "note and scene are in different projects" };
    }
    if (!Array.isArray(note.linkedSceneIds)) note.linkedSceneIds = [];
    const link = params.linked !== false;
    if (link && !note.linkedSceneIds.includes(scene.id)) note.linkedSceneIds.push(scene.id);
    if (!link) note.linkedSceneIds = note.linkedSceneIds.filter((id) => id !== scene.id);
    note.updatedAt = cwNow();
    saveCwState();
    return { ok: true, result: { noteId: note.id, linkedSceneIds: note.linkedSceneIds } };
  });

  registerLensAction("creative-writing", "setting-bible", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    if (!cwProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const sceneNames = new Map((s.scenes.get(userId) || [])
      .filter((x) => x.projectId === String(params.projectId))
      .map((x) => [x.id, x.title]));
    const settingKinds = ["location", "lore", "worldbuilding", "item"];
    let entries = (s.notes.get(userId) || [])
      .filter((n) => n.projectId === String(params.projectId) && settingKinds.includes(n.kind));
    if (params.kind) entries = entries.filter((n) => n.kind === String(params.kind));
    const mapped = entries.map((n) => {
      const linked = (Array.isArray(n.linkedSceneIds) ? n.linkedSceneIds : [])
        .filter((id) => sceneNames.has(id))
        .map((id) => ({ sceneId: id, title: sceneNames.get(id) }));
      return {
        id: n.id, title: n.title, kind: n.kind, body: n.body,
        linkedScenes: linked, linkedCount: linked.length,
        updatedAt: n.updatedAt,
      };
    });
    return {
      ok: true,
      result: {
        entries: mapped,
        count: mapped.length,
        byKind: settingKinds.map((k) => ({ kind: k, count: mapped.filter((e) => e.kind === k).length })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Revision snapshot diff ──────────────────────────────────────────
  // Line-level diff between a snapshot and either the live scene or
  // another snapshot, using a longest-common-subsequence walk.
  function cwDiffLines(aLines, bLines) {
    const n = aLines.length, m = bLines.length;
    const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = aLines[i] === bLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (aLines[i] === bLines[j]) { out.push({ type: "equal", text: aLines[i] }); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ type: "removed", text: aLines[i] }); i++; }
      else { out.push({ type: "added", text: bLines[j] }); j++; }
    }
    while (i < n) { out.push({ type: "removed", text: aLines[i] }); i++; }
    while (j < m) { out.push({ type: "added", text: bLines[j] }); j++; }
    return out;
  }
  registerLensAction("creative-writing", "snapshot-diff", (ctx, _a, params = {}) => {
  try {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const snaps = s.snapshots.get(userId) || [];
    const from = snaps.find((sn) => sn.id === params.fromId);
    if (!from) return { ok: false, error: "from snapshot not found" };
    let toContent; let toLabel;
    if (params.toId) {
      const to = snaps.find((sn) => sn.id === params.toId);
      if (!to) return { ok: false, error: "to snapshot not found" };
      toContent = to.content || ""; toLabel = to.title;
    } else {
      const scene = (s.scenes.get(userId) || []).find((x) => x.id === from.sceneId);
      if (!scene) return { ok: false, error: "scene no longer exists" };
      toContent = scene.content || ""; toLabel = "Current draft";
    }
    const aLines = String(from.content || "").split("\n");
    const bLines = String(toContent).split("\n");
    const diff = cwDiffLines(aLines, bLines);
    const added = diff.filter((d) => d.type === "added").length;
    const removed = diff.filter((d) => d.type === "removed").length;
    const fromWords = cwWords(from.content || "");
    const toWords = cwWords(toContent);
    return {
      ok: true,
      result: {
        fromLabel: from.title, toLabel,
        diff,
        addedLines: added, removedLines: removed,
        unchangedLines: diff.filter((d) => d.type === "equal").length,
        fromWords, toWords, wordDelta: toWords - fromWords,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Manuscript statistics — pacing, word frequency, dialogue ratio ──
  const CW_STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "as", "by", "is", "was", "were", "be", "been", "are", "it", "its",
    "he", "she", "they", "i", "you", "we", "him", "her", "them", "his", "their",
    "that", "this", "these", "those", "had", "has", "have", "not", "no", "so",
    "then", "than", "from", "up", "out", "down", "into", "over", "if", "all",
  ]);
  registerLensAction("creative-writing", "manuscript-stats", (ctx, _a, params = {}) => {
    const s = getCwState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cwAid(ctx);
    const project = cwProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    let scenes = (s.scenes.get(userId) || []).filter((x) => x.projectId === project.id);
    if (params.sceneId) scenes = scenes.filter((x) => x.id === String(params.sceneId));
    const text = scenes.map((sc) => sc.content || "").filter(Boolean).join("\n\n");
    if (!text.trim()) {
      return { ok: true, result: { hasData: false, message: "No prose written yet." } };
    }
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean);
    const paragraphs = text.split(/\n\n+/).map((x) => x.trim()).filter(Boolean);

    // Dialogue vs prose — characters inside matched quote pairs.
    const dialogueMatches = text.match(/[""][^""]*[""]|"[^"]*"/g) || [];
    const dialogueChars = dialogueMatches.reduce((a, q) => a + q.length, 0);
    const totalChars = text.replace(/\s+/g, " ").length || 1;
    const dialoguePct = Math.round((dialogueChars / totalChars) * 100);

    // Word frequency, stopwords filtered.
    const freq = new Map();
    for (const raw of words) {
      const w = raw.toLowerCase().replace(/[^a-z']/g, "");
      if (w.length < 3 || CW_STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    const topWords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    // Adverb (-ly) and overused-crutch detection.
    const lyWords = words.filter((w) => /ly[.,!?;:"']?$/i.test(w) && w.length > 4).length;
    const sentenceLengths = sentences.map((sn) => sn.split(/\s+/).filter(Boolean).length);
    const avgSentence = sentenceLengths.length
      ? Math.round((words.length / sentenceLengths.length) * 10) / 10 : 0;
    const longSentences = sentenceLengths.filter((l) => l > 30).length;
    const shortSentences = sentenceLengths.filter((l) => l <= 8).length;

    // Per-scene pacing — short avg-sentence + high dialogue reads "fast".
    const pacing = scenes.filter((sc) => sc.content).map((sc) => {
      const sw = (sc.content || "").split(/\s+/).filter(Boolean).length;
      const ss = (sc.content || "").split(/[.!?]+/).filter((x) => x.trim()).length || 1;
      const dq = ((sc.content || "").match(/[""][^""]*[""]|"[^"]*"/g) || []).length;
      const avg = sw / ss;
      return {
        sceneId: sc.id, title: sc.title, wordCount: sw,
        avgSentenceLength: Math.round(avg * 10) / 10,
        tempo: avg < 11 ? "fast" : avg < 17 ? "moderate" : "slow",
        dialogueLines: dq,
      };
    });

    return {
      ok: true,
      result: {
        hasData: true,
        wordCount: words.length,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        sceneCount: scenes.filter((sc) => sc.content).length,
        avgSentenceLength: avgSentence,
        avgParagraphWords: paragraphs.length
          ? Math.round(words.length / paragraphs.length) : 0,
        dialoguePct,
        prosePct: 100 - dialoguePct,
        uniqueWords: freq.size,
        adverbCount: lyWords,
        adverbPer1000: words.length ? Math.round((lyWords / words.length) * 1000) : 0,
        longSentences,
        shortSentences,
        topWords,
        pacing,
        estimatedReadMinutes: Math.ceil(words.length / 250),
      },
    };
  });
}
