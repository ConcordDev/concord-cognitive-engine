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
}
