// server/domains/understanding.js
//
// Understanding lens — knowledge-synthesis workbench (Obsidian / RemNote
// shape). The `understanding-engine` / `understanding-evolve` substrate
// (SQLite, registered inline in server.js) covers parse → compose →
// evolve → consolidate. This domain adds the *navigable knowledge tool*
// layer the feature-gap spec called for: user-authored notes with
// full-text search, tagging, manual linking (wiki-links + relations),
// backlinks, inline editing with revision history + diff, an
// interactive linked-knowledge graph, markdown / DTU-pack export, a real
// nested/outline note hierarchy, and a real note-level spaced-repetition
// review queue.
//
// All state is per-user, persisted in globalThis._concordSTATE Maps
// keyed by ctx.userId. No seed / demo / mock data — every note is real
// user input. Empty states return empty arrays.
//
// Outline structure (parent/child) is built on the SAME manual-link
// mechanism `link`/`unlink` already provide, using a reserved relation
// name `"outline-child"` (from = parent, to = child) plus an `order`
// field for sibling position — not a parallel substrate. The generic
// `link` macro refuses to create that relation directly (see below) so
// every outline edit goes through `move`/`reorder`, which enforce the
// single-parent + no-cycle invariants a free-form link graph doesn't.
//
// Spaced repetition here schedules the *notes themselves* (RemNote's
// "any note can be a reviewable rem" model), not separately-authored
// flashcards — that's already a full, real, Anki/FSRS-parity system at
// `server/domains/srs.js` (deck/card/study substrate). Duplicating that
// engine here would be redundant; this schedules review dates directly
// on a note via the classic textbook SM-2 algorithm (Wozniak 1987) —
// deliberately the simpler, well-understood algorithm, since the harder
// "modern scheduler" problem is already solved by the srs domain and
// this lens's job is proving notes are reviewable in place, in the
// knowledge tool, without leaving to build a separate deck.

export default function registerUnderstandingActions(registerLensAction) {
  // ── State plumbing ────────────────────────────────────────────────

  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.understandingLens) STATE.understandingLens = {};
    const s = STATE.understandingLens;
    if (!(s.notes instanceof Map)) s.notes = new Map();   // userId -> Map(noteId -> note)
    if (!(s.links instanceof Map)) s.links = new Map();   // userId -> Array<link>
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const now = () => new Date().toISOString();
  const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function notesFor(s, userId) {
    if (!s.notes.has(userId)) s.notes.set(userId, new Map());
    return s.notes.get(userId);
  }
  function linksFor(s, userId) {
    if (!s.links.has(userId)) s.links.set(userId, []);
    return s.links.get(userId);
  }

  // Normalize a tag list: lowercase, trimmed, deduped, max 24 chars each.
  function cleanTags(input) {
    const raw = Array.isArray(input)
      ? input
      : typeof input === "string"
        ? input.split(/[,\s]+/)
        : [];
    const out = [];
    for (const t of raw) {
      const tag = String(t || "").trim().toLowerCase().replace(/^#/, "").slice(0, 24);
      if (tag && !out.includes(tag)) out.push(tag);
    }
    return out.slice(0, 32);
  }

  // Extract [[wiki-links]] from a note body — these are title references.
  function extractWikiLinks(body) {
    const out = [];
    const re = /\[\[([^[\]]{1,120})\]\]/g;
    let m;
    while ((m = re.exec(String(body || ""))) !== null) {
      const title = m[1].trim();
      if (title && !out.includes(title)) out.push(title);
    }
    return out;
  }

  // Lazily backfill the srs sub-object for notes created before this
  // field existed (state persisted from an older build). Safe to call on
  // every read — idempotent, never overwrites an existing schedule.
  function ensureSrs(note) {
    if (!note.srs || typeof note.srs !== "object") {
      note.srs = {
        enabled: false,
        state: "new",
        ease: 2.5,
        reps: 0,
        lapses: 0,
        interval: 0,
        dueAt: note.createdAt || now(),
        lastReviewedAt: null,
      };
    }
    return note.srs;
  }

  // Public projection of a note (everything except deep revision bodies).
  function shapeNote(n) {
    const srs = ensureSrs(n);
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      revisionCount: n.revisions.length,
      wordCount: n.body.trim() ? n.body.trim().split(/\s+/).length : 0,
      srs: {
        enabled: !!srs.enabled,
        state: srs.state || "new",
        ease: typeof srs.ease === "number" ? srs.ease : 2.5,
        interval: srs.interval || 0,
        reps: srs.reps || 0,
        lapses: srs.lapses || 0,
        dueAt: srs.dueAt || null,
        lastReviewedAt: srs.lastReviewedAt || null,
      },
    };
  }

  function findNoteByTitle(notes, title) {
    const want = String(title || "").trim().toLowerCase();
    for (const n of notes.values()) {
      if (n.title.trim().toLowerCase() === want) return n;
    }
    return null;
  }

  // ── Outline (nested parent/child) helpers ─────────────────────────
  // Built on top of the same `links` array `link`/`unlink` use, via a
  // reserved relation name. See file header for why this reuses the
  // link mechanism instead of a parallel substrate.
  const OUTLINE_RELATION = "outline-child";

  function outlineChildLinks(links, parentId) {
    return links
      .filter((l) => l.relation === OUTLINE_RELATION && l.from === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  function outlineParentLink(links, childId) {
    return links.find((l) => l.relation === OUTLINE_RELATION && l.to === childId) || null;
  }
  // True when `nodeId` is `ancestorId` itself or lies anywhere in its
  // outline subtree — used to reject a `move` that would create a cycle.
  function isOutlineDescendant(links, ancestorId, nodeId) {
    if (ancestorId === nodeId) return true;
    const stack = outlineChildLinks(links, ancestorId).map((l) => l.to);
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === nodeId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const l of outlineChildLinks(links, cur)) stack.push(l.to);
    }
    return false;
  }
  function buildOutlineNode(links, notes, id, depth, seen) {
    if (depth > 64 || seen.has(id)) return null; // defensive cycle/depth guard
    seen.add(id);
    const note = notes.get(id);
    if (!note) return null;
    const children = outlineChildLinks(links, id)
      .map((l) => buildOutlineNode(links, notes, l.to, depth + 1, seen))
      .filter(Boolean);
    return {
      id: note.id,
      title: note.title,
      tags: note.tags,
      updatedAt: note.updatedAt,
      srsEnabled: !!ensureSrs(note).enabled,
      childCount: children.length,
      children,
    };
  }

  // ── Spaced repetition (SM-2, Wozniak 1987) ─────────────────────────
  // quality is an integer 0-5: 0 = complete blackout ... 5 = perfect
  // recall. q >= 3 counts as a correct/passing response. This is the
  // textbook algorithm, unmodified — see file header for why.
  function sm2Schedule(srs, quality) {
    const q = Math.max(0, Math.min(5, Math.round(Number(quality))));
    let ease = typeof srs.ease === "number" ? srs.ease : 2.5;
    let reps = srs.reps || 0;
    let interval;

    if (q < 3) {
      reps = 0;
      interval = 1;
    } else {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round((srs.interval || 1) * ease);
      reps += 1;
    }

    ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ease < 1.3) ease = 1.3;
    ease = Math.round(ease * 100) / 100;

    return { ease, reps, interval, lapsed: q < 3 };
  }

  // ── create — author a new note ────────────────────────────────────

  registerLensAction("understanding", "create", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const title = String(params.title || "").trim().slice(0, 200);
    if (!title) return { ok: false, error: "title required" };
    const body = String(params.body || "");
    const notes = notesFor(s, actor(ctx));
    const ts = now();
    const note = {
      id: uid("und"),
      title,
      body,
      tags: cleanTags(params.tags),
      createdAt: ts,
      updatedAt: ts,
      revisions: [{ at: ts, body, title }],
      rootOrder: notes.size, // append at the end of the root-level outline order
      srs: { enabled: false, state: "new", ease: 2.5, reps: 0, lapses: 0, interval: 0, dueAt: ts, lastReviewedAt: null },
    };
    notes.set(note.id, note);
    save();
    return { ok: true, result: { note: shapeNote(note) } };
  });

  // ── list — all notes, optional tag filter ─────────────────────────

  registerLensAction("understanding", "list", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const tagFilter = params.tag ? String(params.tag).toLowerCase() : null;
    let rows = [...notes.values()].map(shapeNote);
    if (tagFilter) rows = rows.filter((n) => n.tags.includes(tagFilter));
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { ok: true, result: { notes: rows, count: rows.length } };
  });

  // ── get — full note incl. revisions ───────────────────────────────

  registerLensAction("understanding", "get", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const note = notes.get(String(params.id || ""));
    if (!note) return { ok: false, error: "note not found" };
    return {
      ok: true,
      result: {
        note: shapeNote(note),
        revisions: note.revisions.map((r, i) => ({ index: i, at: r.at, title: r.title })),
        wikiLinks: extractWikiLinks(note.body),
      },
    };
  });

  // ── edit — inline body / title / tag update (records a revision) ──

  registerLensAction("understanding", "edit", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const note = notes.get(String(params.id || ""));
    if (!note) return { ok: false, error: "note not found" };
    const nextTitle = params.title != null
      ? String(params.title).trim().slice(0, 200)
      : note.title;
    if (!nextTitle) return { ok: false, error: "title cannot be empty" };
    const nextBody = params.body != null ? String(params.body) : note.body;
    const changed = nextTitle !== note.title || nextBody !== note.body;
    if (changed) {
      note.title = nextTitle;
      note.body = nextBody;
      note.updatedAt = now();
      note.revisions.push({ at: note.updatedAt, body: nextBody, title: nextTitle });
      if (note.revisions.length > 50) note.revisions.splice(0, note.revisions.length - 50);
    }
    if (params.tags != null) note.tags = cleanTags(params.tags);
    if (params.reviewEnabled != null) {
      ensureSrs(note).enabled = !!params.reviewEnabled;
    }
    save();
    return { ok: true, result: { note: shapeNote(note), changed } };
  });

  // ── remove — delete a note + its links ────────────────────────────

  registerLensAction("understanding", "remove", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const id = String(params.id || "");
    if (!notes.has(id)) return { ok: false, error: "note not found" };
    notes.delete(id);
    const links = linksFor(s, userId);
    const remaining = links.filter((l) => l.from !== id && l.to !== id);
    s.links.set(userId, remaining);
    save();
    return { ok: true, result: { deleted: id, count: notes.size } };
  });

  // ── search — full-text across titles + bodies + tags ─────────────

  registerLensAction("understanding", "search", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const q = String(params.query || "").trim().toLowerCase();
    if (!q) return { ok: true, result: { matches: [], count: 0, query: "" } };
    const notes = notesFor(s, actor(ctx));
    const matches = [];
    for (const n of notes.values()) {
      const title = n.title.toLowerCase();
      const body = n.body.toLowerCase();
      const inTitle = title.includes(q);
      const inBody = body.includes(q);
      const inTags = n.tags.some((t) => t.includes(q));
      if (!inTitle && !inBody && !inTags) continue;
      // Score: title hit > tag hit > body hit; count body occurrences.
      let score = 0;
      if (inTitle) score += 10;
      if (inTags) score += 4;
      if (inBody) score += Math.min(6, body.split(q).length - 1);
      // Context snippet around the first body hit.
      let snippet = "";
      const idx = body.indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        snippet = (start > 0 ? "…" : "")
          + n.body.slice(start, idx + q.length + 40).replace(/\s+/g, " ")
          + (idx + q.length + 40 < n.body.length ? "…" : "");
      }
      matches.push({ ...shapeNote(n), score, snippet, hitIn: { title: inTitle, body: inBody, tags: inTags } });
    }
    matches.sort((a, b) => b.score - a.score);
    return { ok: true, result: { matches, count: matches.length, query: q } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── link — manually relate two notes ──────────────────────────────

  registerLensAction("understanding", "link", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const from = String(params.from || "");
    const to = String(params.to || "");
    if (!from || !to) return { ok: false, error: "from and to required" };
    if (from === to) return { ok: false, error: "cannot link a note to itself" };
    if (!notes.has(from) || !notes.has(to)) return { ok: false, error: "note not found" };
    const relation = String(params.relation || "relates-to").trim().toLowerCase().slice(0, 40)
      || "relates-to";
    if (relation === OUTLINE_RELATION) {
      return { ok: false, error: "use understanding.move to manage outline structure" };
    }
    const links = linksFor(s, userId);
    const existing = links.find((l) => l.from === from && l.to === to && l.relation === relation);
    if (existing) return { ok: true, result: { link: existing, created: false } };
    const link = {
      id: uid("lnk"),
      from,
      to,
      relation,
      note: String(params.note || "").trim().slice(0, 200),
      createdAt: now(),
    };
    links.push(link);
    save();
    return { ok: true, result: { link, created: true } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── unlink — remove a manual link ─────────────────────────────────

  registerLensAction("understanding", "unlink", (ctx, _a, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const links = linksFor(s, userId);
    const id = String(params.linkId || "");
    const idx = links.findIndex((l) => l.id === id);
    if (idx < 0) return { ok: false, error: "link not found" };
    links.splice(idx, 1);
    save();
    return { ok: true, result: { deleted: id, count: links.length } };
  });

  // ── backlinks — "referenced by" for one note ──────────────────────
  // Combines manual links AND [[wiki-link]] references by title.

  registerLensAction("understanding", "backlinks", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const id = String(params.id || "");
    const target = notes.get(id);
    if (!target) return { ok: false, error: "note not found" };
    const links = linksFor(s, userId);

    // Manual links pointing at this note (outline structural edges are
    // surfaced via the dedicated `outline` macro, not mixed in here).
    const manual = links
      .filter((l) => l.to === id && l.relation !== OUTLINE_RELATION)
      .map((l) => {
        const src = notes.get(l.from);
        return {
          linkId: l.id,
          kind: "manual",
          relation: l.relation,
          noteId: l.from,
          title: src ? src.title : "(deleted)",
          context: l.note || null,
        };
      });

    // Wiki-link references — any note whose body contains [[this title]].
    const wiki = [];
    const wantTitle = target.title.trim().toLowerCase();
    for (const n of notes.values()) {
      if (n.id === id) continue;
      const refs = extractWikiLinks(n.body).map((t) => t.toLowerCase());
      if (refs.includes(wantTitle)) {
        wiki.push({ kind: "wiki", relation: "mentions", noteId: n.id, title: n.title, context: null });
      }
    }

    // Outbound: links + wiki-links FROM this note.
    const outboundManual = links
      .filter((l) => l.from === id && l.relation !== OUTLINE_RELATION)
      .map((l) => ({
        linkId: l.id,
        kind: "manual",
        relation: l.relation,
        noteId: l.to,
        title: notes.get(l.to)?.title || "(deleted)",
      }));
    const outboundWiki = extractWikiLinks(target.body)
      .map((t) => {
        const dst = findNoteByTitle(notes, t);
        return { kind: "wiki", relation: "mentions", title: t, noteId: dst ? dst.id : null, resolved: !!dst };
      });

    return {
      ok: true,
      result: {
        noteId: id,
        title: target.title,
        backlinks: [...manual, ...wiki],
        backlinkCount: manual.length + wiki.length,
        outbound: [...outboundManual, ...outboundWiki],
        outboundCount: outboundManual.length + outboundWiki.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── move — set/change a note's outline parent (nested structure) ──
  // Reuses the link substrate with the reserved "outline-child" relation.
  // Enforces the two invariants a free-form link graph doesn't: at most
  // one outline parent per note, and no cycles.

  registerLensAction("understanding", "move", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const id = String(params.id || "");
    const note = notes.get(id);
    if (!note) return { ok: false, error: "note not found" };
    const links = linksFor(s, userId);
    const rawParentId = params.parentId != null ? String(params.parentId).trim() : "";

    // Detach any existing outline-parent edge first (a note has at most
    // one — re-parenting always replaces, never adds a second edge).
    const existing = outlineParentLink(links, id);
    if (existing) {
      const idx = links.indexOf(existing);
      if (idx >= 0) links.splice(idx, 1);
    }

    if (!rawParentId) {
      // Detach to root level; append at the end of the root order.
      const rootIds = [...notes.values()].filter((n) => !outlineParentLink(links, n.id) && n.id !== id);
      note.rootOrder = rootIds.length;
      save();
      return { ok: true, result: { id, parentId: null } };
    }
    if (rawParentId === id) return { ok: false, error: "a note cannot be its own parent" };
    if (!notes.has(rawParentId)) return { ok: false, error: "parent note not found" };
    if (isOutlineDescendant(links, id, rawParentId)) {
      return { ok: false, error: "move would create a cycle" };
    }
    const siblingOrders = outlineChildLinks(links, rawParentId).map((l) => l.order ?? 0);
    const nextOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
    links.push({
      id: uid("lnk"),
      from: rawParentId,
      to: id,
      relation: OUTLINE_RELATION,
      order: nextOrder,
      note: "",
      createdAt: now(),
    });
    save();
    return { ok: true, result: { id, parentId: rawParentId, order: nextOrder } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── reorder — change a note's position among its outline siblings ──

  registerLensAction("understanding", "reorder", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const id = String(params.id || "");
    if (!notes.has(id)) return { ok: false, error: "note not found" };
    const links = linksFor(s, userId);
    const parentLink = outlineParentLink(links, id);
    const parentId = parentLink ? parentLink.from : null;

    const siblingIds = parentId
      ? outlineChildLinks(links, parentId).map((l) => l.to)
      : [...notes.values()]
          .filter((n) => !outlineParentLink(links, n.id))
          .sort((a, b) => (a.rootOrder ?? 0) - (b.rootOrder ?? 0))
          .map((n) => n.id);

    const withoutId = siblingIds.filter((sid) => sid !== id);
    const targetIndex = Math.max(0, Math.min(withoutId.length, parseInt(params.index, 10) || 0));
    withoutId.splice(targetIndex, 0, id);

    withoutId.forEach((sid, i) => {
      if (parentId) {
        const l = links.find((x) => x.relation === OUTLINE_RELATION && x.from === parentId && x.to === sid);
        if (l) l.order = i;
      } else {
        const n = notes.get(sid);
        if (n) n.rootOrder = i;
      }
    });
    save();
    return { ok: true, result: { id, parentId, order: withoutId } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── outline — nested tree (one subtree, or the full root forest) ──

  registerLensAction("understanding", "outline", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const links = linksFor(s, userId);

    if (params.rootId) {
      const rootId = String(params.rootId);
      if (!notes.has(rootId)) return { ok: false, error: "note not found" };
      const tree = buildOutlineNode(links, notes, rootId, 0, new Set());
      return { ok: true, result: { tree } };
    }

    const rootIds = [...notes.values()]
      .filter((n) => !outlineParentLink(links, n.id))
      .sort((a, b) => (a.rootOrder ?? 0) - (b.rootOrder ?? 0))
      .map((n) => n.id);
    const forest = rootIds
      .map((id) => buildOutlineNode(links, notes, id, 0, new Set()))
      .filter(Boolean);
    return { ok: true, result: { forest, rootCount: forest.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── review — submit a recall-quality rating; schedules the next due
  //    date via SM-2. Enrolls the note in the review queue if it wasn't
  //    already (reviewing a note is itself an opt-in signal). ──────────

  registerLensAction("understanding", "review", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const note = notes.get(String(params.id || ""));
    if (!note) return { ok: false, error: "note not found" };
    if (params.quality == null || params.quality === "") return { ok: false, error: "quality (0-5) required" };
    const quality = Number(params.quality);
    if (!Number.isFinite(quality)) return { ok: false, error: "quality must be a number 0-5" };

    const srs = ensureSrs(note);
    const sched = sm2Schedule(srs, quality);
    srs.enabled = true;
    srs.ease = sched.ease;
    srs.reps = sched.reps;
    srs.interval = sched.interval;
    srs.lapses = (srs.lapses || 0) + (sched.lapsed ? 1 : 0);
    srs.state = sched.lapsed ? "relearning" : sched.reps >= 3 ? "review" : "learning";
    srs.lastReviewedAt = now();
    srs.dueAt = new Date(Date.now() + sched.interval * 86400000).toISOString();
    save();
    return {
      ok: true,
      result: {
        noteId: note.id,
        quality: Math.max(0, Math.min(5, Math.round(quality))),
        nextReviewInDays: sched.interval,
        srs: { ...srs },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── due — notes enrolled in review whose dueAt has passed ──────────

  registerLensAction("understanding", "due", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const nowMs = Date.now();
    const rows = [];
    for (const n of notes.values()) {
      const srs = ensureSrs(n);
      if (!srs.enabled) continue;
      const dueMs = srs.dueAt ? new Date(srs.dueAt).getTime() : 0;
      if (dueMs <= nowMs) {
        rows.push({ ...shapeNote(n), overdueDays: Math.max(0, Math.floor((nowMs - dueMs) / 86400000)) });
      }
    }
    rows.sort((a, b) => String(a.srs.dueAt || "").localeCompare(String(b.srs.dueAt || "")));
    const limit = Math.max(1, Math.min(200, parseInt(params.limit, 10) || 50));
    return { ok: true, result: { due: rows.slice(0, limit), count: rows.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── graph — interactive linked-knowledge graph (nodes + edges) ────

  registerLensAction("understanding", "graph", (ctx, _a, _params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const links = linksFor(s, userId);

    const degree = new Map();
    const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
    const edges = [];

    // Manual link edges (outline structural edges have their own view —
    // see the `outline` macro — so they're excluded from this graph).
    for (const l of links) {
      if (l.relation === OUTLINE_RELATION) continue;
      if (!notes.has(l.from) || !notes.has(l.to)) continue;
      edges.push({ id: l.id, from: l.from, to: l.to, relation: l.relation, kind: "manual" });
      bump(l.from); bump(l.to);
    }
    // Wiki-link edges (resolved by title).
    for (const n of notes.values()) {
      for (const t of extractWikiLinks(n.body)) {
        const dst = findNoteByTitle(notes, t);
        if (!dst || dst.id === n.id) continue;
        edges.push({ id: `wiki_${n.id}_${dst.id}`, from: n.id, to: dst.id, relation: "mentions", kind: "wiki" });
        bump(n.id); bump(dst.id);
      }
    }

    const nodes = [...notes.values()].map((n) => ({
      id: n.id,
      label: n.title,
      tags: n.tags,
      degree: degree.get(n.id) || 0,
    }));
    const orphans = nodes.filter((n) => n.degree === 0).map((n) => n.id);

    return {
      ok: true,
      result: {
        nodes,
        edges,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        orphanCount: orphans.length,
        orphans,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── tags — all tags with counts (for tag-based filtering UI) ──────

  registerLensAction("understanding", "tags", (ctx, _a, _params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const counts = new Map();
    for (const n of notes.values()) {
      for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { ok: true, result: { tags, count: tags.length } };
  });

  // ── diff — line-level diff between two revisions of a note ───────

  registerLensAction("understanding", "diff", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const notes = notesFor(s, actor(ctx));
    const note = notes.get(String(params.id || ""));
    if (!note) return { ok: false, error: "note not found" };
    const revs = note.revisions;
    if (revs.length < 1) return { ok: false, error: "no revisions" };
    // Clamp a requested revision index into [0, revs.length-1]. A poisoned
    // value (NaN / Infinity / non-numeric) falls back to the provided default
    // rather than propagating a non-finite index into the diff output.
    const clampIdx = (raw, fallback) => {
      const v = parseInt(raw, 10);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(0, Math.min(revs.length - 1, v));
    };
    // Default: compare the previous revision against the latest.
    const toIdx = params.to != null
      ? clampIdx(params.to, revs.length - 1)
      : revs.length - 1;
    const fromIdx = params.from != null
      ? clampIdx(params.from, Math.max(0, toIdx - 1))
      : Math.max(0, toIdx - 1);
    const a = (revs[fromIdx]?.body || "").split("\n");
    const b = (revs[toIdx]?.body || "").split("\n");

    // Longest-common-subsequence line diff.
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const lines = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { lines.push({ type: "same", text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: "del", text: a[i] }); i++; }
      else { lines.push({ type: "add", text: b[j] }); j++; }
    }
    while (i < m) { lines.push({ type: "del", text: a[i] }); i++; }
    while (j < n) { lines.push({ type: "add", text: b[j] }); j++; }

    const added = lines.filter((l) => l.type === "add").length;
    const removed = lines.filter((l) => l.type === "del").length;
    return {
      ok: true,
      result: {
        noteId: note.id,
        fromRevision: fromIdx,
        toRevision: toIdx,
        fromAt: revs[fromIdx]?.at || null,
        toAt: revs[toIdx]?.at || null,
        lines,
        added,
        removed,
        unchanged: lines.length - added - removed,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── export — markdown or DTU-pack JSON for one note ──────────────

  registerLensAction("understanding", "export", (ctx, _a, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const note = notes.get(String(params.id || ""));
    if (!note) return { ok: false, error: "note not found" };
    const format = String(params.format || "markdown").toLowerCase();
    const links = linksFor(s, userId);
    const related = links
      .filter((l) => l.from === note.id || l.to === note.id)
      .map((l) => ({ relation: l.relation, from: l.from, to: l.to }));

    if (format === "dtu" || format === "dtu-pack" || format === "json") {
      const pack = {
        spec: "concord-understanding/v1",
        exportedAt: now(),
        understanding: {
          id: note.id,
          human: { title: note.title, summary: note.body.slice(0, 280) },
          core: { body: note.body, tags: note.tags },
          machine: {
            wikiLinks: extractWikiLinks(note.body),
            relations: related,
            revisionCount: note.revisions.length,
          },
        },
      };
      return { ok: true, result: { format: "dtu-pack", filename: `${note.title || note.id}.dtu.json`, content: pack } };
    }

    // Markdown with YAML frontmatter.
    const fm = [
      "---",
      `title: ${note.title}`,
      `tags: [${note.tags.join(", ")}]`,
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      "---",
      "",
    ].join("\n");
    let md = fm + `# ${note.title}\n\n${note.body}\n`;
    if (related.length > 0) {
      md += "\n## Related\n";
      for (const r of related) {
        const otherId = r.from === note.id ? r.to : r.from;
        const other = notes.get(otherId);
        md += `- ${r.relation}: [[${other ? other.title : otherId}]]\n`;
      }
    }
    return { ok: true, result: { format: "markdown", filename: `${note.title || note.id}.md`, content: md } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── overview — counts for the stats strip ─────────────────────────

  registerLensAction("understanding", "overview", (ctx, _a, _params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const notes = notesFor(s, userId);
    const links = linksFor(s, userId);
    let wikiEdges = 0;
    const tagSet = new Set();
    let reviewEnabledCount = 0;
    let dueForReviewCount = 0;
    const nowMs = Date.now();
    for (const n of notes.values()) {
      for (const t of n.tags) tagSet.add(t);
      for (const t of extractWikiLinks(n.body)) {
        if (findNoteByTitle(notes, t)) wikiEdges++;
      }
      const srs = ensureSrs(n);
      if (srs.enabled) {
        reviewEnabledCount++;
        if (srs.dueAt && new Date(srs.dueAt).getTime() <= nowMs) dueForReviewCount++;
      }
    }
    return {
      ok: true,
      result: {
        noteCount: notes.size,
        manualLinkCount: links.filter((l) => l.relation !== OUTLINE_RELATION).length,
        wikiLinkCount: wikiEdges,
        tagCount: tagSet.size,
        reviewEnabledCount,
        dueForReviewCount,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
