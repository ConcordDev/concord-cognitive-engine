// server/domains/understanding.js
//
// Understanding lens — knowledge-synthesis workbench (Obsidian / RemNote
// shape). The `understanding-engine` / `understanding-evolve` substrate
// (SQLite, registered inline in server.js) covers parse → compose →
// evolve → consolidate. This domain adds the *navigable knowledge tool*
// layer the feature-gap spec called for: user-authored notes with
// full-text search, tagging, manual linking (wiki-links + relations),
// backlinks, inline editing with revision history + diff, an
// interactive linked-knowledge graph, and markdown / DTU-pack export.
//
// All state is per-user, persisted in globalThis._concordSTATE Maps
// keyed by ctx.userId. No seed / demo / mock data — every note is real
// user input. Empty states return empty arrays.

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

  // Public projection of a note (everything except deep revision bodies).
  function shapeNote(n) {
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      revisionCount: n.revisions.length,
      wordCount: n.body.trim() ? n.body.trim().split(/\s+/).length : 0,
    };
  }

  function findNoteByTitle(notes, title) {
    const want = String(title || "").trim().toLowerCase();
    for (const n of notes.values()) {
      if (n.title.trim().toLowerCase() === want) return n;
    }
    return null;
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

    // Manual links pointing at this note.
    const manual = links
      .filter((l) => l.to === id)
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
      .filter((l) => l.from === id)
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

    // Manual link edges.
    for (const l of links) {
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
    for (const n of notes.values()) {
      for (const t of n.tags) tagSet.add(t);
      for (const t of extractWikiLinks(n.body)) {
        if (findNoteByTitle(notes, t)) wikiEdges++;
      }
    }
    return {
      ok: true,
      result: {
        noteCount: notes.size,
        manualLinkCount: links.length,
        wikiLinkCount: wikiEdges,
        tagCount: tagSet.size,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
