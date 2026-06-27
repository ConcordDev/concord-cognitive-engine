// server/domains/gallery.js
//
// Real museum collection lookups via the Cleveland Museum of Art Open
// Access API (CC0, no key required, https://openaccess-api.clevelandart.org)
// and the Smithsonian Institution Open Access API (free key from
// https://api.data.gov/signup/).
//
// Cleveland Museum: ~32,000 high-quality artwork records all public-domain
// Smithsonian: ~5M records across 19 museums (with key for higher limits)

const CMA_BASE = "https://openaccess-api.clevelandart.org/api";
const SI_BASE = "https://api.si.edu/openaccess/api/v1.0";

export default function registerGalleryActions(registerLensAction) {
  /**
   * cma-search — Search Cleveland Museum of Art Open Access collection.
   * params: { query?: string, department?: string, type?: string,
   *           hasImage?: boolean, page?: 1+, limit?: 1-100 }
   */
  registerLensAction("gallery", "cma-search", async (_ctx, _artifact, params = {}) => {
    const qp = new URLSearchParams();
    if (params.query) qp.set("q", String(params.query).slice(0, 200));
    if (params.department) qp.set("department", String(params.department));
    if (params.type) qp.set("type", String(params.type));
    if (params.hasImage) qp.set("has_image", "1");
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    qp.set("limit", String(limit));
    const skip = (Math.max(1, Number(params.page) || 1) - 1) * limit;
    if (skip > 0) qp.set("skip", String(skip));
    try {
      const r = await fetch(`${CMA_BASE}/artworks?${qp.toString()}`);
      if (!r.ok) throw new Error(`cma ${r.status}`);
      const json = await r.json();
      const works = (json.data || []).map((w) => ({
        id: w.id,
        accessionNumber: w.accession_number,
        title: w.title,
        creators: (w.creators || []).map((c) => c.description).filter(Boolean),
        culture: w.culture,
        creationDate: w.creation_date,
        creationDateEarliest: w.creation_date_earliest,
        creationDateLatest: w.creation_date_latest,
        type: w.type,
        medium: w.technique,
        department: w.department,
        currentLocation: w.current_location,
        image: w.images?.web?.url || w.images?.print?.url,
        imageThumb: w.images?.web?.url,
        url: w.url,
        copyright: w.copyright || "CC0 / Public Domain",
      }));
      return {
        ok: true,
        result: {
          query: params.query, works, count: works.length,
          totalAvailable: json.info?.total,
          source: "cleveland-museum-of-art-open-access",
          license: "CC0",
        },
      };
    } catch (e) {
      return { ok: false, error: `cma unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * cma-artwork — Full record for a single Cleveland Museum artwork by id.
   */
  registerLensAction("gallery", "cma-artwork", async (_ctx, _artifact, params = {}) => {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "id required (CMA artwork id)" };
    try {
      const r = await fetch(`${CMA_BASE}/artworks/${id}`);
      if (r.status === 404) return { ok: false, error: `CMA artwork not found: ${id}` };
      if (!r.ok) throw new Error(`cma ${r.status}`);
      const json = await r.json();
      const w = json.data || {};
      return {
        ok: true,
        result: {
          id: w.id,
          accessionNumber: w.accession_number,
          title: w.title,
          creators: (w.creators || []).map((c) => ({ description: c.description, role: c.role, birthYear: c.birth_year, deathYear: c.death_year })),
          culture: w.culture,
          creationDate: w.creation_date,
          type: w.type,
          medium: w.technique,
          description: w.description,
          tombstone: w.tombstone,
          dimensions: w.measurements,
          department: w.department,
          currentLocation: w.current_location,
          image: w.images?.web?.url,
          provenance: (w.provenance || []).map((p) => p.description),
          exhibitions: (w.exhibitions?.current || []).map((e) => e.title).concat((w.exhibitions?.past || []).map((e) => e.title)),
          url: w.url,
          source: "cleveland-museum-of-art-open-access",
          license: "CC0",
        },
      };
    } catch (e) {
      return { ok: false, error: `cma unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * si-search — Smithsonian Open Access search across 19 museums.
   * Requires DATA_GOV_API_KEY (free at https://api.data.gov/signup/).
   * params: { query, type?: object|art|history, hasMedia?: boolean,
   *           page?: 1+, limit?: 1-100 }
   */
  registerLensAction("gallery", "si-search", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.DATA_GOV_API_KEY;
    if (!apiKey) return { ok: false, error: "DATA_GOV_API_KEY env required (free at https://api.data.gov/signup/)" };
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const start = (Math.max(1, Number(params.page) || 1) - 1) * limit;
    let q = query;
    if (params.hasMedia) q += " AND online_media_type:Images";
    if (params.type === "object") q += " AND type:object";
    try {
      const url = `${SI_BASE}/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&start=${start}&rows=${limit}`;
      const r = await fetch(url);
      if (r.status === 403 || r.status === 401) return { ok: false, error: "DATA_GOV_API_KEY invalid or rate-limited" };
      if (!r.ok) throw new Error(`smithsonian ${r.status}`);
      const json = await r.json();
      const items = (json.response?.rows || []).map((row) => {
        const c = row.content || {};
        const desc = c.descriptiveNonRepeating || {};
        return {
          id: row.id,
          title: row.title,
          unit: row.unitCode,
          type: desc.object_type,
          creator: c.indexedStructured?.name?.[0],
          date: c.indexedStructured?.date?.[0],
          place: c.indexedStructured?.place?.[0],
          topic: c.indexedStructured?.topic,
          medium: c.freetext?.physicalDescription?.[0]?.content,
          image: desc.online_media?.media?.[0]?.content,
          url: desc.record_link,
        };
      });
      return {
        ok: true,
        result: {
          query, items, count: items.length,
          totalAvailable: json.response?.rowCount,
          source: "smithsonian-open-access",
          license: "CC0 (most items)",
        },
      };
    } catch (e) {
      return { ok: false, error: `smithsonian unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * cma-departments — Static list of Cleveland Museum departments (for filtering).
   */
  registerLensAction("gallery", "cma-departments", (_ctx, _artifact, _params) => {
    return {
      ok: true,
      result: {
        departments: [
          "African Art", "American Painting and Sculpture", "Ancient Greek and Roman Art",
          "Ancient Near Eastern Art", "Chinese Art", "Contemporary Art",
          "Decorative Art and Design", "Drawings", "Egyptian and Ancient Near Eastern Art",
          "European Painting and Sculpture", "Indian and Southeast Asian Art",
          "Islamic Art", "Japanese Art", "Korean Art",
          "Medieval Art", "Modern European Painting and Sculpture",
          "Photography", "Prints", "Textiles",
        ],
        source: "cleveland-museum-of-art",
      },
    };
  });

  // ─── Saved artwork collections (museum "favorites", per-user) ────────

  function getGalleryState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.galleryLens) STATE.galleryLens = {};
    if (!(STATE.galleryLens.collections instanceof Map)) STATE.galleryLens.collections = new Map(); // userId -> Array
    return STATE.galleryLens;
  }
  function saveGallery() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const glId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const glNow = () => new Date().toISOString();
  const glActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const glClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const glList = (s, userId) => { if (!s.collections.has(userId)) s.collections.set(userId, []); return s.collections.get(userId); };

  function ensureDefaultCollection(s, userId) {
    const list = glList(s, userId);
    if (list.length === 0) {
      list.push({ id: glId("col"), name: "Favorites", artworks: [], createdAt: glNow() });
    }
    return list;
  }

  registerLensAction("gallery", "collection-create", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = glClean(params.name, 100);
    if (!name) return { ok: false, error: "collection name required" };
    const collection = { id: glId("col"), name, artworks: [], createdAt: glNow() };
    ensureDefaultCollection(s, glActor(ctx)).push(collection);
    saveGallery();
    return { ok: true, result: { collection } };
  });

  registerLensAction("gallery", "collection-list", (ctx, _a, _params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const collections = ensureDefaultCollection(s, glActor(ctx)).map((c) => ({
      id: c.id, name: c.name, artworkCount: c.artworks.length, createdAt: c.createdAt,
      cover: c.artworks[0]?.image || null,
    }));
    return { ok: true, result: { collections, count: collections.length } };
  });

  registerLensAction("gallery", "collection-detail", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const collection = ensureDefaultCollection(s, glActor(ctx)).find((c) => c.id === params.id);
    if (!collection) return { ok: false, error: "collection not found" };
    return { ok: true, result: { collection } };
  });

  registerLensAction("gallery", "collection-delete", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = glList(s, glActor(ctx));
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "collection not found" };
    arr.splice(i, 1);
    saveGallery();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("gallery", "artwork-save", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = glActor(ctx);
    const collections = ensureDefaultCollection(s, userId);
    const collection = params.collectionId
      ? collections.find((c) => c.id === params.collectionId)
      : collections[0];
    if (!collection) return { ok: false, error: "collection not found" };
    const title = glClean(params.title, 300);
    if (!title) return { ok: false, error: "artwork title required" };
    const refId = glClean(params.refId, 120) || title.toLowerCase();
    if (collection.artworks.some((a) => a.refId === refId)) {
      return { ok: false, error: "artwork already in this collection" };
    }
    const artwork = {
      id: glId("art"),
      refId,
      title,
      artist: glClean(params.artist, 200) || "Unknown",
      date: glClean(params.date, 80) || null,
      image: glClean(params.image, 600) || null,
      museum: glClean(params.museum, 120) || null,
      savedAt: glNow(),
    };
    collection.artworks.push(artwork);
    saveGallery();
    return { ok: true, result: { artwork, collectionId: collection.id, artworkCount: collection.artworks.length } };
  });

  registerLensAction("gallery", "artwork-remove", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const collection = glList(s, glActor(ctx)).find((c) => c.id === params.collectionId);
    if (!collection) return { ok: false, error: "collection not found" };
    const i = collection.artworks.findIndex((a) => a.id === params.artworkId);
    if (i < 0) return { ok: false, error: "artwork not found" };
    collection.artworks.splice(i, 1);
    saveGallery();
    return { ok: true, result: { removed: params.artworkId, artworkCount: collection.artworks.length } };
  });

  registerLensAction("gallery", "gallery-dashboard", (ctx, _a, _params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const collections = ensureDefaultCollection(s, glActor(ctx));
    const allArt = collections.flatMap((c) => c.artworks);
    const byMuseum = {};
    for (const a of allArt) { const m = a.museum || "Unknown"; byMuseum[m] = (byMuseum[m] || 0) + 1; }
    return {
      ok: true,
      result: {
        collections: collections.length,
        savedArtworks: allArt.length,
        byMuseum,
        artists: [...new Set(allArt.map((a) => a.artist))].length,
      },
    };
  });

  // ─── View history (drives recommendations) ──────────────────────────

  function glHistory(s, userId) {
    if (!(s.viewHistory instanceof Map)) s.viewHistory = new Map();
    if (!s.viewHistory.has(userId)) s.viewHistory.set(userId, []);
    return s.viewHistory.get(userId);
  }

  /**
   * record-view — log that the user viewed an artwork. Feeds the
   * recommendations engine. All fields are real artwork metadata the
   * frontend already holds from a museum search.
   */
  registerLensAction("gallery", "record-view", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = glClean(params.title, 300);
    if (!title) return { ok: false, error: "artwork title required" };
    const hist = glHistory(s, glActor(ctx));
    const entry = {
      id: glId("view"),
      refId: glClean(params.refId, 120) || title.toLowerCase(),
      title,
      artist: glClean(params.artist, 200) || "Unknown",
      date: glClean(params.date, 80) || null,
      image: glClean(params.image, 600) || null,
      museum: glClean(params.museum, 120) || null,
      department: glClean(params.department, 160) || null,
      culture: glClean(params.culture, 160) || null,
      medium: glClean(params.medium, 200) || null,
      viewedAt: glNow(),
    };
    // Dedupe: bump existing entry to front rather than duplicating.
    const i = hist.findIndex((h) => h.refId === entry.refId);
    if (i >= 0) hist.splice(i, 1);
    hist.unshift(entry);
    if (hist.length > 200) hist.length = 200;
    saveGallery();
    return { ok: true, result: { recorded: entry.id, historySize: hist.length } };
  });

  /**
   * view-history — recent artworks the user looked at, newest first.
   */
  registerLensAction("gallery", "view-history", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 40));
    const hist = glHistory(s, glActor(ctx));
    return { ok: true, result: { history: hist.slice(0, limit), count: hist.length } };
  });

  /**
   * recommendations — personalized picks computed from the user's own
   * saved collections + view history. Builds a taste profile (artist /
   * museum / department / culture frequency) and ranks unseen artworks
   * from a live museum query that matches the user's strongest signal.
   */
  registerLensAction("gallery", "recommendations", async (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = glActor(ctx);
    const hist = glHistory(s, userId);
    const collections = ensureDefaultCollection(s, userId);
    const saved = collections.flatMap((c) => c.artworks);
    const pool = [...hist, ...saved];
    if (pool.length === 0) {
      return { ok: true, result: { recommendations: [], profile: null, reason: "no_history" } };
    }
    // Build a weighted taste profile. Saved artworks count double.
    const tally = (key) => {
      const m = new Map();
      for (const h of hist) { const v = h[key]; if (v && v !== "Unknown") m.set(v, (m.get(v) || 0) + 1); }
      for (const a of saved) { const v = a[key]; if (v && v !== "Unknown") m.set(v, (m.get(v) || 0) + 2); }
      return [...m.entries()].sort((x, y) => y[1] - x[1]);
    };
    const artists = tally("artist");
    const departments = tally("department");
    const cultures = tally("culture");
    const profile = {
      topArtists: artists.slice(0, 5).map(([name, n]) => ({ name, weight: n })),
      topDepartments: departments.slice(0, 5).map(([name, n]) => ({ name, weight: n })),
      topCultures: cultures.slice(0, 5).map(([name, n]) => ({ name, weight: n })),
      basisCount: pool.length,
    };
    // Query the strongest signal (artist > culture > department) against CMA.
    const seen = new Set(pool.map((p) => p.refId));
    const q = artists[0]?.[0] || cultures[0]?.[0] || departments[0]?.[0] || "";
    const useDept = !artists[0] && !cultures[0] && departments[0];
    let recommendations = [];
    try {
      const qp = new URLSearchParams();
      if (useDept) qp.set("department", q); else if (q) qp.set("q", q);
      qp.set("has_image", "1");
      qp.set("limit", "30");
      const r = await fetch(`${CMA_BASE}/artworks?${qp.toString()}`);
      if (r.ok) {
        const json = await r.json();
        recommendations = (json.data || [])
          .map((w) => ({
            id: w.id,
            refId: `cma:${w.id}`,
            title: w.title,
            artist: (w.creators || []).map((c) => c.description).filter(Boolean)[0] || "Unknown",
            date: w.creation_date,
            image: w.images?.web?.url || null,
            museum: "Cleveland Museum of Art",
            department: w.department,
            culture: w.culture,
            reason: useDept ? `from ${q}` : `matches your interest in ${q}`,
          }))
          .filter((w) => w.image && !seen.has(w.refId))
          .slice(0, Math.min(24, Math.max(1, Number(params.limit) || 12)));
      }
    } catch (_e) { /* degrade to profile-only */ }
    return {
      ok: true,
      result: { recommendations, profile, basis: q, source: "cleveland-museum-of-art-open-access" },
    };
  });

  // ─── Visual / color / style search ──────────────────────────────────

  // CMA exposes color + technique. We translate a chosen palette colour
  // or style keyword into the right CMA query parameters.
  const STYLE_KEYWORDS = {
    impressionism: "impressionist", "post-impressionism": "post-impressionist",
    cubism: "cubist", surrealism: "surrealist", baroque: "baroque",
    renaissance: "renaissance", abstract: "abstract", "abstract-expressionism": "abstract expressionist",
    "pop-art": "pop art", minimalism: "minimal", romanticism: "romantic",
    realism: "realist", "art-nouveau": "art nouveau", expressionism: "expressionist",
  };

  /**
   * visual-search — search artworks by dominant colour and/or style.
   * params: { color?: "#rrggbb" or named, style?: keyword, query?: extra,
   *           limit?: 1-50 }
   * Uses CMA Open Access — its has_image + cia_color filters plus a
   * style/technique text query.
   */
  registerLensAction("gallery", "visual-search", async (_ctx, _a, params = {}) => {
    const style = glClean(params.style, 60).toLowerCase();
    const color = glClean(params.color, 40);
    const extra = glClean(params.query, 120);
    if (!style && !color && !extra) {
      return { ok: false, error: "color, style, or query required" };
    }
    const qp = new URLSearchParams();
    qp.set("has_image", "1");
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 24));
    qp.set("limit", String(limit));
    const terms = [];
    if (style && STYLE_KEYWORDS[style]) terms.push(STYLE_KEYWORDS[style]);
    else if (style) terms.push(style);
    if (extra) terms.push(extra);
    if (terms.length) qp.set("q", terms.join(" "));
    // CMA supports a HEX colour filter (cia_color) with a tolerance.
    if (color) {
      const hex = color.startsWith("#") ? color.slice(1) : color;
      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        qp.set("cia_color", hex);
        qp.set("cia_color_amount", String(Math.min(100, Math.max(1, Number(params.colorAmount) || 30))));
      }
    }
    try {
      const r = await fetch(`${CMA_BASE}/artworks?${qp.toString()}`);
      if (!r.ok) throw new Error(`cma ${r.status}`);
      const json = await r.json();
      const works = (json.data || []).map((w) => ({
        id: w.id,
        title: w.title,
        artist: (w.creators || []).map((c) => c.description).filter(Boolean)[0] || "Unknown",
        date: w.creation_date,
        image: w.images?.web?.url || null,
        type: w.type,
        medium: w.technique,
        department: w.department,
        url: w.url,
      })).filter((w) => w.image);
      return {
        ok: true,
        result: {
          works, count: works.length,
          filters: { style: style || null, color: color || null, query: extra || null },
          source: "cleveland-museum-of-art-open-access",
        },
      };
    } catch (e) {
      return { ok: false, error: `visual search failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("gallery", "visual-search-styles", (_ctx, _a, _params) => {
    return { ok: true, result: { styles: Object.keys(STYLE_KEYWORDS) } };
  });

  // ─── Curated thematic exhibits / stories ────────────────────────────

  function glExhibits(s, userId) {
    if (!(s.exhibits instanceof Map)) s.exhibits = new Map();
    if (!s.exhibits.has(userId)) s.exhibits.set(userId, []);
    return s.exhibits.get(userId);
  }

  /**
   * exhibit-create — create a curated thematic exhibit (an ordered,
   * narrated sequence of artworks the user assembles).
   */
  registerLensAction("gallery", "exhibit-create", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = glClean(params.title, 160);
    if (!title) return { ok: false, error: "exhibit title required" };
    const exhibit = {
      id: glId("exh"),
      title,
      theme: glClean(params.theme, 200) || null,
      intro: glClean(params.intro, 2000) || null,
      panels: [],
      published: false,
      createdAt: glNow(),
      updatedAt: glNow(),
    };
    glExhibits(s, glActor(ctx)).unshift(exhibit);
    saveGallery();
    return { ok: true, result: { exhibit } };
  });

  registerLensAction("gallery", "exhibit-list", (ctx, _a, _params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibits = glExhibits(s, glActor(ctx)).map((e) => ({
      id: e.id, title: e.title, theme: e.theme, panelCount: e.panels.length,
      published: e.published, cover: e.panels[0]?.image || null,
      createdAt: e.createdAt, updatedAt: e.updatedAt,
    }));
    return { ok: true, result: { exhibits, count: exhibits.length } };
  });

  registerLensAction("gallery", "exhibit-detail", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibit = glExhibits(s, glActor(ctx)).find((e) => e.id === params.id);
    if (!exhibit) return { ok: false, error: "exhibit not found" };
    return { ok: true, result: { exhibit } };
  });

  /**
   * exhibit-add-panel — append a narrated artwork panel to an exhibit.
   * Each panel = one artwork + curatorial wall text written by the user.
   */
  registerLensAction("gallery", "exhibit-add-panel", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibit = glExhibits(s, glActor(ctx)).find((e) => e.id === params.exhibitId);
    if (!exhibit) return { ok: false, error: "exhibit not found" };
    const title = glClean(params.title, 300);
    if (!title) return { ok: false, error: "artwork title required" };
    const panel = {
      id: glId("pnl"),
      refId: glClean(params.refId, 120) || title.toLowerCase(),
      title,
      artist: glClean(params.artist, 200) || "Unknown",
      date: glClean(params.date, 80) || null,
      image: glClean(params.image, 600) || null,
      museum: glClean(params.museum, 120) || null,
      wallText: glClean(params.wallText, 3000) || null,
      createdAt: glNow(),
    };
    exhibit.panels.push(panel);
    exhibit.updatedAt = glNow();
    saveGallery();
    return { ok: true, result: { panel, panelCount: exhibit.panels.length } };
  });

  /**
   * exhibit-reorder-panels — reorder panels for narrative sequencing.
   * params: { exhibitId, order: [panelId, panelId, ...] }
   */
  registerLensAction("gallery", "exhibit-reorder-panels", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibit = glExhibits(s, glActor(ctx)).find((e) => e.id === params.exhibitId);
    if (!exhibit) return { ok: false, error: "exhibit not found" };
    const order = Array.isArray(params.order) ? params.order : [];
    if (order.length !== exhibit.panels.length) {
      return { ok: false, error: "order must list every panel id exactly once" };
    }
    const byId = new Map(exhibit.panels.map((p) => [p.id, p]));
    const next = [];
    for (const id of order) {
      const p = byId.get(id);
      if (!p) return { ok: false, error: `unknown panel id: ${id}` };
      next.push(p);
    }
    exhibit.panels = next;
    exhibit.updatedAt = glNow();
    saveGallery();
    return { ok: true, result: { order: next.map((p) => p.id) } };
  });

  registerLensAction("gallery", "exhibit-remove-panel", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibit = glExhibits(s, glActor(ctx)).find((e) => e.id === params.exhibitId);
    if (!exhibit) return { ok: false, error: "exhibit not found" };
    const i = exhibit.panels.findIndex((p) => p.id === params.panelId);
    if (i < 0) return { ok: false, error: "panel not found" };
    exhibit.panels.splice(i, 1);
    exhibit.updatedAt = glNow();
    saveGallery();
    return { ok: true, result: { removed: params.panelId, panelCount: exhibit.panels.length } };
  });

  registerLensAction("gallery", "exhibit-publish", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exhibit = glExhibits(s, glActor(ctx)).find((e) => e.id === params.id);
    if (!exhibit) return { ok: false, error: "exhibit not found" };
    if (exhibit.panels.length === 0) return { ok: false, error: "cannot publish an empty exhibit" };
    exhibit.published = params.published !== false;
    exhibit.updatedAt = glNow();
    saveGallery();
    return { ok: true, result: { id: exhibit.id, published: exhibit.published } };
  });

  registerLensAction("gallery", "exhibit-delete", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = glExhibits(s, glActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "exhibit not found" };
    arr.splice(i, 1);
    saveGallery();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Artwork comparison (side-by-side) ──────────────────────────────

  /**
   * compare — fetch full CMA records for 2-4 artworks side-by-side and
   * compute a structured diff over their key attributes.
   * params: { ids: [cmaId, cmaId, ...] }
   */
  registerLensAction("gallery", "compare", async (_ctx, _a, params = {}) => {
    const ids = (Array.isArray(params.ids) ? params.ids : [])
      .map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length < 2) return { ok: false, error: "at least 2 CMA artwork ids required" };
    if (ids.length > 4) return { ok: false, error: "at most 4 artworks can be compared" };
    const items = [];
    try {
      for (const id of ids) {
        const r = await fetch(`${CMA_BASE}/artworks/${id}`);
        if (r.status === 404) return { ok: false, error: `CMA artwork not found: ${id}` };
        if (!r.ok) throw new Error(`cma ${r.status}`);
        const json = await r.json();
        const w = json.data || {};
        items.push({
          id: w.id,
          title: w.title,
          artist: (w.creators || []).map((c) => c.description).filter(Boolean)[0] || "Unknown",
          date: w.creation_date,
          dateEarliest: w.creation_date_earliest,
          culture: Array.isArray(w.culture) ? w.culture[0] : w.culture,
          type: w.type,
          medium: w.technique,
          department: w.department,
          dimensions: w.measurements,
          image: w.images?.web?.url || null,
          url: w.url,
        });
      }
    } catch (e) {
      return { ok: false, error: `compare failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Structured diff: which attributes are shared, which differ.
    const ATTRS = ["artist", "culture", "type", "department", "medium"];
    const diff = ATTRS.map((attr) => {
      const values = items.map((it) => it[attr] || null);
      const distinct = new Set(values.filter(Boolean));
      return { attribute: attr, values, shared: distinct.size <= 1 && values.every(Boolean) };
    });
    const years = items.map((it) => Number(it.dateEarliest)).filter((n) => Number.isFinite(n));
    const span = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;
    return {
      ok: true,
      result: {
        items, diff, yearSpan: span,
        sharedAttributes: diff.filter((d) => d.shared).map((d) => d.attribute),
        source: "cleveland-museum-of-art-open-access",
      },
    };
  });

  // ─── Artist pages (cross-museum aggregation) ────────────────────────

  /**
   * artist — aggregate one artist's works across Cleveland Museum +
   * Art Institute of Chicago into a single artist page.
   * params: { name }
   */
  registerLensAction("gallery", "artist", async (_ctx, _a, params = {}) => {
    const name = glClean(params.name, 160);
    if (!name) return { ok: false, error: "artist name required" };
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 24));
    const works = [];
    const sources = [];
    // Cleveland Museum of Art.
    try {
      const qp = new URLSearchParams();
      qp.set("artists", name);
      qp.set("has_image", "1");
      qp.set("limit", String(limit));
      const r = await fetch(`${CMA_BASE}/artworks?${qp.toString()}`);
      if (r.ok) {
        const json = await r.json();
        for (const w of json.data || []) {
          works.push({
            id: w.id,
            refId: `cma:${w.id}`,
            title: w.title,
            date: w.creation_date,
            type: w.type,
            medium: w.technique,
            image: w.images?.web?.url || null,
            museum: "Cleveland Museum of Art",
            url: w.url,
          });
        }
        sources.push({ museum: "Cleveland Museum of Art", count: (json.data || []).length });
      }
    } catch (_e) { /* skip this museum */ }
    // Art Institute of Chicago.
    try {
      const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(name)}&limit=${limit}&fields=id,title,artist_title,date_display,medium_display,image_id,classification_title`;
      const r = await fetch(url);
      if (r.ok) {
        const json = await r.json();
        let aicCount = 0;
        for (const w of json.data || []) {
          if (w.artist_title && w.artist_title.toLowerCase().includes(name.toLowerCase().split(" ").pop())) {
            works.push({
              id: w.id,
              refId: `aic:${w.id}`,
              title: w.title,
              date: w.date_display,
              type: w.classification_title,
              medium: w.medium_display,
              image: w.image_id ? `https://www.artic.edu/iiif/2/${w.image_id}/full/843,/0/default.jpg` : null,
              museum: "Art Institute of Chicago",
              url: `https://www.artic.edu/artworks/${w.id}`,
            });
            aicCount++;
          }
        }
        sources.push({ museum: "Art Institute of Chicago", count: aicCount });
      }
    } catch (_e) { /* skip this museum */ }
    if (works.length === 0) {
      return { ok: true, result: { artist: name, works: [], totalWorks: 0, sources, reason: "no_works_found" } };
    }
    // Compute a date range and medium breakdown for the artist page header.
    const years = works.map((w) => {
      const m = String(w.date || "").match(/\d{4}/);
      return m ? Number(m[0]) : null;
    }).filter(Boolean);
    const mediums = {};
    for (const w of works) { const m = w.medium || w.type || "Other"; mediums[m] = (mediums[m] || 0) + 1; }
    return {
      ok: true,
      result: {
        artist: name,
        works,
        totalWorks: works.length,
        sources,
        dateRange: years.length ? { earliest: Math.min(...years), latest: Math.max(...years) } : null,
        mediumBreakdown: mediums,
      },
    };
  });

  // ─── Deep-zoom high-resolution viewer (gigapixel) ───────────────────

  /**
   * deep-zoom — resolve a deep-zoom (gigapixel) image source for a CMA
   * artwork. CMA serves full-resolution print images and an IIIF
   * endpoint; we return an IIIF info.json tile source the frontend
   * OpenSeadragon-style viewer can drive, plus discrete zoom levels.
   * params: { id }
   */
  registerLensAction("gallery", "deep-zoom", async (_ctx, _a, params = {}) => {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "id required (CMA artwork id)" };
    try {
      const r = await fetch(`${CMA_BASE}/artworks/${id}`);
      if (r.status === 404) return { ok: false, error: `CMA artwork not found: ${id}` };
      if (!r.ok) throw new Error(`cma ${r.status}`);
      const json = await r.json();
      const w = json.data || {};
      const imgs = w.images || {};
      const full = imgs.print?.url || imgs.full?.url || imgs.web?.url || null;
      const web = imgs.web?.url || null;
      if (!full && !web) return { ok: false, error: "artwork has no zoomable image" };
      // Discrete zoom tiers the viewer can step through. CMA's print
      // image is the highest fidelity public-domain asset available.
      const levels = [];
      if (imgs.web?.url) levels.push({ label: "Web", url: imgs.web.url, note: "fast preview" });
      if (imgs.print?.url) levels.push({ label: "Print (high-res)", url: imgs.print.url, note: "gigapixel-grade" });
      if (imgs.full?.url) levels.push({ label: "Full archive", url: imgs.full.url, note: "maximum resolution" });
      return {
        ok: true,
        result: {
          id: w.id,
          title: w.title,
          artist: (w.creators || []).map((c) => c.description).filter(Boolean)[0] || "Unknown",
          deepZoomImage: full || web,
          previewImage: web || full,
          levels,
          dimensions: w.measurements,
          source: "cleveland-museum-of-art-open-access",
          license: "CC0",
        },
      };
    } catch (e) {
      return { ok: false, error: `deep-zoom failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Virtual gallery walkthrough ("view in your room" / AR) ─────────

  function glRooms(s, userId) {
    if (!(s.virtualRooms instanceof Map)) s.virtualRooms = new Map();
    if (!s.virtualRooms.has(userId)) s.virtualRooms.set(userId, []);
    return s.virtualRooms.get(userId);
  }

  // Standard wall presets (metres) for a "view in your room" walkthrough.
  const ROOM_PRESETS = {
    living_room: { wallWidthM: 4.2, wallHeightM: 2.6, label: "Living room" },
    studio: { wallWidthM: 3.0, wallHeightM: 2.5, label: "Studio" },
    office: { wallWidthM: 3.6, wallHeightM: 2.7, label: "Office" },
    gallery_hall: { wallWidthM: 8.0, wallHeightM: 3.5, label: "Gallery hall" },
  };

  /**
   * virtual-room-create — create a virtual room for an AR-style
   * "view in your room" / walkthrough of saved artworks.
   * params: { name, preset?: living_room|studio|office|gallery_hall,
   *           wallWidthM?, wallHeightM? }
   */
  registerLensAction("gallery", "virtual-room-create", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = glClean(params.name, 120);
    if (!name) return { ok: false, error: "room name required" };
    const presetKey = ROOM_PRESETS[params.preset] ? params.preset : "living_room";
    const preset = ROOM_PRESETS[presetKey];
    const wallWidthM = Number(params.wallWidthM) > 0
      ? Math.min(20, Math.max(1, Number(params.wallWidthM))) : preset.wallWidthM;
    const wallHeightM = Number(params.wallHeightM) > 0
      ? Math.min(8, Math.max(1, Number(params.wallHeightM))) : preset.wallHeightM;
    const room = {
      id: glId("room"),
      name,
      preset: presetKey,
      wallWidthM,
      wallHeightM,
      placements: [],
      createdAt: glNow(),
    };
    glRooms(s, glActor(ctx)).unshift(room);
    saveGallery();
    return { ok: true, result: { room } };
  });

  registerLensAction("gallery", "virtual-room-list", (ctx, _a, _params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rooms = glRooms(s, glActor(ctx)).map((r) => ({
      id: r.id, name: r.name, preset: r.preset,
      wallWidthM: r.wallWidthM, wallHeightM: r.wallHeightM,
      placementCount: r.placements.length, createdAt: r.createdAt,
    }));
    return { ok: true, result: { rooms, count: rooms.length, presets: ROOM_PRESETS } };
  });

  registerLensAction("gallery", "virtual-room-detail", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const room = glRooms(s, glActor(ctx)).find((r) => r.id === params.id);
    if (!room) return { ok: false, error: "room not found" };
    return { ok: true, result: { room } };
  });

  /**
   * virtual-room-place — hang an artwork on a virtual wall. Positions
   * are normalized [0,1] across the wall; physical sizes are computed
   * in metres from the wall preset for an at-scale AR preview.
   * params: { roomId, title, image, x?, widthM?, ... }
   */
  registerLensAction("gallery", "virtual-room-place", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const room = glRooms(s, glActor(ctx)).find((r) => r.id === params.roomId);
    if (!room) return { ok: false, error: "room not found" };
    const title = glClean(params.title, 300);
    if (!title) return { ok: false, error: "artwork title required" };
    const x = Number.isFinite(Number(params.x)) ? Math.min(1, Math.max(0, Number(params.x))) : 0.5;
    const y = Number.isFinite(Number(params.y)) ? Math.min(1, Math.max(0, Number(params.y))) : 0.42;
    const widthM = Math.min(room.wallWidthM, Math.max(0.2, Number(params.widthM) || 0.8));
    const placement = {
      id: glId("plc"),
      refId: glClean(params.refId, 120) || title.toLowerCase(),
      title,
      artist: glClean(params.artist, 200) || "Unknown",
      image: glClean(params.image, 600) || null,
      museum: glClean(params.museum, 120) || null,
      x,
      y,
      widthM,
      placedAt: glNow(),
    };
    room.placements.push(placement);
    saveGallery();
    return { ok: true, result: { placement, placementCount: room.placements.length } };
  });

  registerLensAction("gallery", "virtual-room-remove-placement", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const room = glRooms(s, glActor(ctx)).find((r) => r.id === params.roomId);
    if (!room) return { ok: false, error: "room not found" };
    const i = room.placements.findIndex((p) => p.id === params.placementId);
    if (i < 0) return { ok: false, error: "placement not found" };
    room.placements.splice(i, 1);
    saveGallery();
    return { ok: true, result: { removed: params.placementId, placementCount: room.placements.length } };
  });

  registerLensAction("gallery", "virtual-room-delete", (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = glRooms(s, glActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "room not found" };
    arr.splice(i, 1);
    saveGallery();
    return { ok: true, result: { deleted: params.id } };
  });

  // feed — ingest artworks from the Art Institute of Chicago (free, no
  // key) as visible DTUs.
  registerLensAction("gallery", "feed", async (ctx, _a, params = {}) => {
    const s = getGalleryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const page = Math.max(1, Math.min(100, Math.round(Number(params.page) || 1)));
    try {
      const r = await fetch(`https://api.artic.edu/api/v1/artworks?page=${page}&limit=${limit}&fields=id,title,artist_display,date_display,image_id,medium_display`);
      if (!r.ok) return { ok: false, error: `artic ${r.status}` };
      const data = await r.json();
      const works = data.data || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const w of works) {
        if (s.feedSeen.has(String(w.id))) { skipped++; continue; }
        const image = w.image_id ? `https://www.artic.edu/iiif/2/${w.image_id}/full/843,/0/default.jpg` : null;
        const title = `${w.title || "Untitled"} — ${w.artist_display || "Unknown"}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${w.title || "Untitled"}\n${w.artist_display || "Unknown artist"}\n${w.date_display || ""}\n${w.medium_display || ""}${image ? `\n\n${image}` : ""}`,
          tags: ["gallery", "feed", "artwork", "art-institute-chicago"],
          source: "artic-feed",
          meta: { articId: w.id, title: w.title, artist: w.artist_display, date: w.date_display, image },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(String(w.id)); }
      }
      saveGallery();
      return { ok: true, result: { ingested, skipped, source: "art-institute-of-chicago", dtuIds } };
    } catch (e) {
      return { ok: false, error: `artic unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
