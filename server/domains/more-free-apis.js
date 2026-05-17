// server/domains/more-free-apis.js
//
// Phase 4 cont'd — more REAL free-API wire-ups. All sources are public,
// require no API key, and return real data. None of the macros below
// invent or seed anything; on upstream failure they return
// { ok:false, reason } and the UI shows the failure honestly.
//
// Domains covered:
//   chem.live_pubchem          PubChem PUG REST — compound by name
//   bio.live_pubmed            NCBI E-utilities — PubMed search + summary
//   neuro.live_pubmed_neuro    NCBI E-utilities — PubMed filtered to neuroscience
//   mental-health.live_medlineplus  MedlinePlus Web Service — consumer health topics
//   podcast.live_itunes_search iTunes Search — podcast directory (no key)
//   global.live_countries      REST Countries v3.1 — country reference
//   environment.live_gbif      GBIF occurrence search (biodiversity)
//   paper.live_openlibrary     Open Library Search API — books / authors
//
// Honesty contract: each handler attributes its source in the response
// envelope, declares fetchedAt, and surfaces a real reason on failure.

const FETCH_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchTextWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export default function registerMoreFreeApiMacros(register) {
  // ───────────────────────────────────────────────────────────────────
  // CHEM — PubChem PUG REST (free, no key)
  // ───────────────────────────────────────────────────────────────────
  register("chem", "live_pubchem", async (_ctx, input = {}) => {
    const name = String(input.query || "").trim();
    if (!name) return { ok: false, reason: "missing_query" };
    if (name.length > 200) return { ok: false, reason: "query_too_long" };
    const encoded = encodeURIComponent(name);
    try {
      // First get CIDs by compound name.
      const cidData = await fetchJsonWithTimeout(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/cids/JSON`,
      );
      const cids = (cidData.IdentifierList?.CID || []).slice(0, 5);
      if (cids.length === 0) {
        return { ok: true, source: "PubChem", fetchedAt: Math.floor(Date.now() / 1000), query: name, total: 0, compounds: [] };
      }
      // Fetch property summary for each.
      const props = await fetchJsonWithTimeout(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cids.join(",")}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,InChIKey,IUPACName/JSON`,
      );
      const compounds = (props.PropertyTable?.Properties || []).map(p => ({
        cid: p.CID,
        molecularFormula: p.MolecularFormula,
        molecularWeight: p.MolecularWeight,
        smiles: p.CanonicalSMILES,
        inchiKey: p.InChIKey,
        iupacName: p.IUPACName,
        pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
      }));
      return {
        ok: true,
        source: "PubChem (NIH)",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: name,
        total: compounds.length,
        compounds,
      };
    } catch (e) {
      return { ok: false, reason: "pubchem_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live PubChem compound lookup" });

  // ───────────────────────────────────────────────────────────────────
  // BIO / NEURO — NCBI E-utilities (PubMed, free, no key)
  // ───────────────────────────────────────────────────────────────────
  const pubmedSearch = async (queryString, opts = {}) => {
    const max = Math.min(Math.max(opts.limit || 10, 1), 25);
    try {
      // 1. esearch for IDs.
      const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}&sort=date&term=${encodeURIComponent(queryString)}`;
      const search = await fetchJsonWithTimeout(esearchUrl);
      const ids = search.esearchresult?.idlist || [];
      if (ids.length === 0) {
        return { ok: true, source: "PubMed (NCBI)", fetchedAt: Math.floor(Date.now() / 1000), query: queryString, total: 0, articles: [] };
      }
      // 2. esummary for metadata.
      const sumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
      const sum = await fetchJsonWithTimeout(sumUrl);
      const articles = ids.map(id => {
        const r = sum.result?.[id];
        if (!r) return null;
        return {
          pmid: id,
          title: r.title,
          journal: r.fulljournalname || r.source,
          pubdate: r.pubdate,
          authors: (r.authors || []).slice(0, 6).map(a => a.name),
          doi: (r.elocationid || "").replace(/^doi:\s*/, "") || null,
          pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        };
      }).filter(Boolean);
      return {
        ok: true,
        source: "PubMed (NCBI)",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: queryString,
        total: parseInt(search.esearchresult?.count || "0", 10),
        articles,
      };
    } catch (e) {
      return { ok: false, reason: "pubmed_unreachable", error: String(e?.message || e) };
    }
  };

  register("bio", "live_pubmed", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 300) return { ok: false, reason: "query_too_long" };
    return await pubmedSearch(q, { limit: input.limit });
  }, { note: "live PubMed search" });

  register("neuro", "live_pubmed_neuro", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 300) return { ok: false, reason: "query_too_long" };
    // Pre-filter to neuroscience-tagged PubMed.
    return await pubmedSearch(`${q} AND (neuroscience[MeSH] OR neuroscience[Title/Abstract])`, { limit: input.limit });
  }, { note: "live PubMed search (neuroscience-filtered)" });

  // ───────────────────────────────────────────────────────────────────
  // MENTAL-HEALTH — MedlinePlus Web Service (free, no key)
  // ───────────────────────────────────────────────────────────────────
  register("mental-health", "live_medlineplus", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 200) return { ok: false, reason: "query_too_long" };
    // MedlinePlus has a Web Service that returns XML (JSON is partial).
    // We use the connect.gov REST endpoint that returns JSON.
    const url = `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(q)}&retmax=15&rettype=brief`;
    try {
      // It returns XML; parse minimally.
      const xml = await fetchTextWithTimeout(url);
      // Extract <document url="..."><content name="title">...</content>...</document>
      const docs = [];
      const docRe = /<document[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g;
      const fieldRe = /<content[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/content>/g;
      let m;
      while ((m = docRe.exec(xml)) !== null) {
        const url = m[1];
        const body = m[2];
        const fields = {};
        let f;
        while ((f = fieldRe.exec(body)) !== null) {
          fields[f[1]] = f[2]
            .replace(/<span[^>]*>/g, "")
            .replace(/<\/span>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        }
        docs.push({
          url,
          title: fields.title || "",
          altTitle: fields["alt-title"] || null,
          snippet: fields.snippet || fields.fullSummary || "",
          group: fields.groupName || null,
        });
      }
      return {
        ok: true,
        source: "MedlinePlus (NLM/NIH)",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: docs.length,
        topics: docs,
      };
    } catch (e) {
      return { ok: false, reason: "medlineplus_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live MedlinePlus consumer-health topic search" });

  // ───────────────────────────────────────────────────────────────────
  // PODCAST — iTunes Search API (free, no key)
  // ───────────────────────────────────────────────────────────────────
  register("podcast", "live_itunes_search", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 200) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
    const url = `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(q)}&limit=${limit}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const podcasts = (data.results || []).map(p => ({
        trackId: p.trackId,
        collectionId: p.collectionId,
        name: p.collectionName || p.trackName,
        artist: p.artistName,
        feedUrl: p.feedUrl || null,
        artworkUrl: p.artworkUrl600 || p.artworkUrl100 || null,
        primaryGenre: p.primaryGenreName,
        genres: p.genres || [],
        releaseDate: p.releaseDate,
        trackCount: p.trackCount,
        country: p.country,
        contentAdvisoryRating: p.contentAdvisoryRating || null,
        itunesUrl: p.collectionViewUrl || null,
      }));
      return {
        ok: true,
        source: "iTunes Search API",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.resultCount || podcasts.length,
        podcasts,
      };
    } catch (e) {
      return { ok: false, reason: "itunes_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live iTunes podcast directory search" });

  // ───────────────────────────────────────────────────────────────────
  // GLOBAL — REST Countries v3.1 (free, no key)
  // ───────────────────────────────────────────────────────────────────
  register("global", "live_countries", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
    try {
      const base = "https://restcountries.com/v3.1";
      const url = q
        ? `${base}/name/${encodeURIComponent(q)}?fields=name,cca2,cca3,capital,region,subregion,population,area,flags,languages,currencies,timezones,latlng`
        : `${base}/all?fields=name,cca2,cca3,capital,region,subregion,population,area,flags,languages,currencies,timezones,latlng`;
      const data = await fetchJsonWithTimeout(url);
      const list = (Array.isArray(data) ? data : []).slice(0, limit).map(c => ({
        commonName: c.name?.common,
        officialName: c.name?.official,
        code2: c.cca2,
        code3: c.cca3,
        capital: (c.capital || [])[0] || null,
        region: c.region,
        subregion: c.subregion || null,
        population: c.population || 0,
        areaKm2: c.area || 0,
        flagPng: c.flags?.png || null,
        languages: c.languages ? Object.values(c.languages) : [],
        currencies: c.currencies ? Object.entries(c.currencies).map(([code, v]) => ({ code, name: v.name, symbol: v.symbol })) : [],
        timezones: (c.timezones || []).slice(0, 4),
        latlng: c.latlng || null,
      }));
      return {
        ok: true,
        source: "REST Countries",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q || null,
        total: Array.isArray(data) ? data.length : 0,
        countries: list,
      };
    } catch (e) {
      return { ok: false, reason: "rest_countries_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live REST Countries reference data" });

  // ───────────────────────────────────────────────────────────────────
  // ENVIRONMENT / FORESTRY / AGRICULTURE — GBIF occurrence search (free, no key)
  // ───────────────────────────────────────────────────────────────────
  const gbifSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 200) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
    try {
      // Resolve species name to GBIF taxonKey first.
      const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(q)}`;
      const match = await fetchJsonWithTimeout(matchUrl);
      const taxonKey = match.usageKey || match.acceptedUsageKey;
      const taxon = {
        scientificName: match.scientificName || null,
        canonicalName: match.canonicalName || null,
        kingdom: match.kingdom || null,
        phylum: match.phylum || null,
        class: match.class || null,
        order: match.order || null,
        family: match.family || null,
        genus: match.genus || null,
        rank: match.rank || null,
        status: match.status || null,
        matchType: match.matchType || null,
      };
      // Fetch occurrences if we matched.
      let occurrences = [];
      let total = 0;
      if (taxonKey) {
        const occUrl = `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxonKey}&limit=${limit}&hasCoordinate=true`;
        const occData = await fetchJsonWithTimeout(occUrl);
        total = occData.count || 0;
        occurrences = (occData.results || []).map(o => ({
          key: o.key,
          country: o.country || null,
          stateProvince: o.stateProvince || null,
          latitude: o.decimalLatitude,
          longitude: o.decimalLongitude,
          eventDate: o.eventDate || null,
          basisOfRecord: o.basisOfRecord,
          datasetName: o.datasetName || null,
          institutionCode: o.institutionCode || null,
        }));
      }
      return {
        ok: true,
        source: "GBIF (Global Biodiversity Information Facility)",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        taxonKey,
        taxon,
        total,
        occurrences,
      };
    } catch (e) {
      return { ok: false, reason: "gbif_unreachable", error: String(e?.message || e) };
    }
  };
  register("environment", "live_gbif", gbifSearch, { note: "live GBIF species occurrence search" });
  register("forestry", "live_gbif", gbifSearch, { note: "live GBIF species occurrence search" });
  register("agriculture", "live_gbif", gbifSearch, { note: "live GBIF species occurrence search" });

  // ───────────────────────────────────────────────────────────────────
  // PAPER / EDUCATION — Open Library Search (free, no key)
  // ───────────────────────────────────────────────────────────────────
  const openLibSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 300) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 30);
    try {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,first_publish_year,isbn,cover_i,publisher,language,subject,number_of_pages_median,ratings_average`;
      const data = await fetchJsonWithTimeout(url);
      const books = (data.docs || []).map(d => ({
        key: d.key,
        title: d.title,
        authors: d.author_name || [],
        firstPublishYear: d.first_publish_year || null,
        isbn: (d.isbn || []).slice(0, 3),
        publishers: (d.publisher || []).slice(0, 3),
        languages: (d.language || []).slice(0, 3),
        subjects: (d.subject || []).slice(0, 6),
        pages: d.number_of_pages_median || null,
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        openLibraryUrl: `https://openlibrary.org${d.key}`,
        avgRating: d.ratings_average || null,
      }));
      return {
        ok: true,
        source: "Open Library",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.numFound || books.length,
        books,
      };
    } catch (e) {
      return { ok: false, reason: "openlibrary_unreachable", error: String(e?.message || e) };
    }
  };
  register("paper", "live_openlibrary", openLibSearch, { note: "live Open Library book search" });
  register("education", "live_openlibrary", openLibSearch, { note: "live Open Library book search" });
}
