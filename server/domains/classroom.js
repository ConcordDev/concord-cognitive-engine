// server/domains/classroom.js
//
// Real educational-material lookups via Open Library (~30M books,
// no key required, https://openlibrary.org/developers/api) and the
// Internet Archive Scholar / OER bibliographic surfaces.
//
// Open Library is part of the Internet Archive (501(c)(3)) and exposes
// search/works/subjects endpoints with no auth and a sane public ToS.

const OL_BASE = "https://openlibrary.org";

export default function registerClassroomActions(registerLensAction) {
  /**
   * ol-search — Open Library book/work search (~30M records).
   * params: { query?: string, author?: string, title?: string,
   *           subject?: string, page?: 1+, limit?: 1-100 }
   */
  registerLensAction("classroom", "ol-search", async (_ctx, _artifact, params = {}) => {
    const qp = new URLSearchParams();
    if (params.query) qp.set("q", String(params.query).slice(0, 200));
    if (params.author) qp.set("author", String(params.author));
    if (params.title) qp.set("title", String(params.title));
    if (params.subject) qp.set("subject", String(params.subject));
    if (!qp.toString()) return { ok: false, error: "at least one of query/author/title/subject required" };
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    qp.set("limit", String(limit));
    const page = Math.max(1, Number(params.page) || 1);
    if (page > 1) qp.set("page", String(page));
    try {
      const r = await fetch(`${OL_BASE}/search.json?${qp.toString()}`);
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const json = await r.json();
      const works = (json.docs || []).map((d) => ({
        workId: d.key,
        title: d.title,
        authors: d.author_name || [],
        firstPublishYear: d.first_publish_year,
        editionCount: d.edition_count,
        languages: d.language || [],
        subjects: (d.subject || []).slice(0, 10),
        isbn: d.isbn?.[0],
        coverId: d.cover_i,
        coverImage: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        ebookAccess: d.ebook_access,
        iaIdentifier: d.ia?.[0],
        readUrl: d.ia?.[0] ? `https://archive.org/details/${d.ia[0]}` : null,
      }));
      return {
        ok: true,
        result: {
          query: params.query, works, count: works.length,
          totalResults: json.numFound,
          page,
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-work — Detailed work record by Open Library work id (e.g. "OL45883W").
   */
  registerLensAction("classroom", "ol-work", async (_ctx, _artifact, params = {}) => {
    const raw = String(params.workId || "").trim();
    if (!/^OL\d+W$/.test(raw)) return { ok: false, error: "workId required (e.g. 'OL45883W')" };
    try {
      const r = await fetch(`${OL_BASE}/works/${raw}.json`);
      if (r.status === 404) return { ok: false, error: `work not found: ${raw}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const w = await r.json();
      return {
        ok: true,
        result: {
          workId: raw,
          title: w.title,
          description: typeof w.description === "string" ? w.description : w.description?.value,
          subjects: w.subjects || [],
          subjectPlaces: w.subject_places || [],
          subjectPeople: w.subject_people || [],
          subjectTimes: w.subject_times || [],
          firstPublishDate: w.first_publish_date,
          covers: (w.covers || []).map((id) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`),
          authorKeys: (w.authors || []).map((a) => a.author?.key),
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-subject — Books filed under a subject heading (textbooks, biology,
   * mathematics, computer-science, etc.).
   * params: { subject: string, ebooks?: boolean, limit?: 1-100 }
   */
  registerLensAction("classroom", "ol-subject", async (_ctx, _artifact, params = {}) => {
    const subj = String(params.subject || "").trim().toLowerCase().replace(/[^a-z0-9_\-\s]/g, "").replace(/\s+/g, "_");
    if (!subj) return { ok: false, error: "subject required (e.g. 'biology', 'computer_science', 'world_history')" };
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const qp = new URLSearchParams({ limit: String(limit) });
    if (params.ebooks) qp.set("ebooks", "true");
    try {
      const r = await fetch(`${OL_BASE}/subjects/${subj}.json?${qp.toString()}`);
      if (r.status === 404) return { ok: false, error: `subject not found: ${subj}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const json = await r.json();
      const works = (json.works || []).map((w) => ({
        workId: w.key?.replace("/works/", ""),
        title: w.title,
        authors: (w.authors || []).map((a) => a.name),
        firstPublishYear: w.first_publish_year,
        editionCount: w.edition_count,
        coverId: w.cover_id,
        coverImage: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : null,
        hasFulltext: w.has_fulltext,
        iaIdentifier: w.ia,
        readUrl: w.ia ? `https://archive.org/details/${w.ia}` : null,
      }));
      return {
        ok: true,
        result: {
          subject: json.name || subj,
          works, count: works.length,
          totalWorks: json.work_count,
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-isbn — Look up a book by ISBN-10 or ISBN-13.
   */
  registerLensAction("classroom", "ol-isbn", async (_ctx, _artifact, params = {}) => {
    const isbn = String(params.isbn || "").replace(/[^0-9X]/gi, "");
    if (!(isbn.length === 10 || isbn.length === 13)) return { ok: false, error: "isbn must be 10 or 13 digits" };
    try {
      const r = await fetch(`${OL_BASE}/isbn/${isbn}.json`);
      if (r.status === 404) return { ok: false, error: `book not found: ${isbn}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const e = await r.json();
      return {
        ok: true,
        result: {
          isbn,
          title: e.title,
          subtitle: e.subtitle,
          publishers: e.publishers || [],
          publishDate: e.publish_date,
          pages: e.number_of_pages,
          languages: (e.languages || []).map((l) => l.key?.replace("/languages/", "")),
          subjects: e.subjects || [],
          coverImage: e.covers?.[0] ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-L.jpg` : null,
          workKey: e.works?.[0]?.key,
          authorKeys: (e.authors || []).map((a) => a.key),
          source: "open-library",
        },
      };
    } catch (err) {
      return { ok: false, error: `openlibrary unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}
