// Contract tests for the three previously-orphan lens domains:
// society (World Bank Open Data), gallery (Cleveland Museum of Art +
// Smithsonian Open Access), classroom (Open Library).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocietyActions from "../domains/society.js";
import registerGalleryActions from "../domains/gallery.js";
import registerClassroomActions from "../domains/classroom.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerSocietyActions(register);
  registerGalleryActions(register);
  registerClassroomActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.DATA_GOV_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("society.wb-indicator (World Bank Open Data)", () => {
  it("rejects bad country code", async () => {
    assert.equal((await call("society.wb-indicator", ctxA, { country: "USA1", indicator: "population" })).ok, false);
    assert.equal((await call("society.wb-indicator", ctxA, { country: "US", indicator: "population" })).ok, false);
  });

  it("rejects missing indicator", async () => {
    const r = await call("society.wb-indicator", ctxA, { country: "USA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /indicator/);
  });

  it("resolves alias + parses indicator series", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { page: 1, pages: 1, total: 3, sourceid: "2" },
          [
            { country: { id: "US", value: "United States" }, date: "2022", value: 333287557, indicator: { id: "SP.POP.TOTL" } },
            { country: { id: "US", value: "United States" }, date: "2021", value: 332048977, indicator: { id: "SP.POP.TOTL" } },
            { country: { id: "US", value: "United States" }, date: "2020", value: null, indicator: { id: "SP.POP.TOTL" } },
          ],
        ]),
      };
    };
    const r = await call("society.wb-indicator", ctxA, { country: "USA", indicator: "population" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.worldbank\.org\/v2\/country\/USA\/indicator\/SP\.POP\.TOTL/);
    assert.equal(r.result.alias, "population");
    assert.equal(r.result.latest.year, 2022);
    assert.equal(r.result.latest.value, 333287557);
    // null-value row was filtered out
    assert.equal(r.result.count, 2);
    assert.equal(r.result.source, "world-bank-open-data");
  });

  it("surfaces World Bank in-body 'no data' error", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([{ message: [{ value: "No matches were found" }] }]),
    });
    const r = await call("society.wb-indicator", ctxA, { country: "USA", indicator: "BOGUS" });
    assert.equal(r.ok, false);
    assert.match(r.error, /No matches were found/);
  });
});

describe("society.wb-country + wb-compare + wb-common-indicators", () => {
  it("wb-country parses country profile", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([
        { page: 1 },
        [{ id: "USA", iso2Code: "US", name: "United States", capitalCity: "Washington D.C.",
          region: { value: "North America" }, incomeLevel: { value: "High income" },
          lendingType: { value: "Not classified" }, longitude: "-77.032", latitude: "38.8895" }],
      ]),
    });
    const r = await call("society.wb-country", ctxA, { country: "USA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.iso3, "USA");
    assert.equal(r.result.capital, "Washington D.C.");
    assert.equal(r.result.incomeLevel, "High income");
    assert.equal(r.result.longitude, -77.032);
  });

  it("wb-compare rejects <2 or >10 countries", async () => {
    assert.equal((await call("society.wb-compare", ctxA, { countries: ["USA"], indicator: "gdp" })).ok, false);
    assert.equal((await call("society.wb-compare", ctxA, {
      countries: ["USA", "GBR", "DEU", "FRA", "ITA", "ESP", "NLD", "BEL", "PRT", "GRC", "POL"],
      indicator: "gdp",
    })).ok, false);
  });

  it("wb-compare hits multi-country endpoint", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { page: 1 },
          [
            { countryiso3code: "USA", country: { value: "United States" }, date: "2022", value: 25462700 },
            { countryiso3code: "GBR", country: { value: "United Kingdom" }, date: "2022", value: 3070667 },
          ],
        ]),
      };
    };
    const r = await call("society.wb-compare", ctxA, { countries: ["USA", "GBR"], indicator: "gdp" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /country\/USA;GBR\/indicator/);
    assert.equal(r.result.points[0].value, 25462700);
  });

  it("wb-common-indicators returns the alias map", () => {
    const r = call("society.wb-common-indicators", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indicators.population, "SP.POP.TOTL");
    assert.ok(r.result.count > 5);
  });
});

describe("gallery.cma-search (Cleveland Museum of Art)", () => {
  it("hits CMA + parses CC0 artwork list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          info: { total: 1, page: 1 },
          data: [{
            id: 96877, accession_number: "1972.145",
            title: "Cypresses",
            creators: [{ description: "Vincent van Gogh (Dutch, 1853-1890)", role: "artist" }],
            culture: "Netherlands, France, 19th century",
            creation_date: "1889",
            creation_date_earliest: 1889,
            creation_date_latest: 1889,
            type: "Painting",
            technique: "Oil on fabric",
            department: "European Painting and Sculpture",
            current_location: "Gallery 224",
            images: { web: { url: "https://openaccess-cdn.clevelandart.org/1972.145/1972.145_web.jpg" } },
            url: "https://www.clevelandart.org/art/1972.145",
          }],
        }),
      };
    };
    const r = await call("gallery.cma-search", ctxA, { query: "van gogh", hasImage: true, limit: 5 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /openaccess-api\.clevelandart\.org\/api\/artworks/);
    assert.match(capturedUrl, /q=van\+gogh/);
    assert.match(capturedUrl, /has_image=1/);
    assert.equal(r.result.works[0].title, "Cypresses");
    assert.equal(r.result.works[0].creators[0], "Vincent van Gogh (Dutch, 1853-1890)");
    assert.equal(r.result.source, "cleveland-museum-of-art-open-access");
    assert.equal(r.result.license, "CC0");
  });

  it("cma-artwork rejects bad id", async () => {
    assert.equal((await call("gallery.cma-artwork", ctxA, {})).ok, false);
    assert.equal((await call("gallery.cma-artwork", ctxA, { id: -1 })).ok, false);
  });

  it("cma-artwork surfaces 404", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("gallery.cma-artwork", ctxA, { id: 99999999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("cma-departments returns the static list", () => {
    const r = call("gallery.cma-departments", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.departments.includes("Photography"));
    assert.ok(r.result.departments.includes("Japanese Art"));
  });
});

describe("gallery.si-search (Smithsonian Open Access)", () => {
  it("rejects missing api key", async () => {
    const r = await call("gallery.si-search", ctxA, { query: "lincoln" });
    assert.equal(r.ok, false);
    assert.match(r.error, /DATA_GOV_API_KEY/);
  });

  it("rejects empty query", async () => {
    process.env.DATA_GOV_API_KEY = "test";
    assert.equal((await call("gallery.si-search", ctxA, {})).ok, false);
  });

  it("sends api_key + parses Smithsonian rows", async () => {
    process.env.DATA_GOV_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          response: {
            rowCount: 1,
            rows: [{
              id: "edanmdm-nmah_2017.0023.01",
              title: "Lincoln's top hat",
              unitCode: "NMAH",
              content: {
                descriptiveNonRepeating: {
                  object_type: "Hats",
                  online_media: { media: [{ content: "https://ids.si.edu/ids/deliveryService?id=NMAH-1234" }] },
                  record_link: "https://americanhistory.si.edu/collections/search/object/nmah_1234",
                },
                indexedStructured: {
                  name: ["Lincoln, Abraham 1809-1865"],
                  date: ["1860s"],
                  place: ["United States"],
                  topic: ["Presidency"],
                },
                freetext: { physicalDescription: [{ content: "Beaver fur silk plush" }] },
              },
            }],
          },
        }),
      };
    };
    const r = await call("gallery.si-search", ctxA, { query: "lincoln", hasMedia: true });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.si\.edu\/openaccess\/api\/v1\.0\/search/);
    assert.match(capturedUrl, /api_key=test-key/);
    assert.match(capturedUrl, /Images/);
    assert.equal(r.result.items[0].title, "Lincoln's top hat");
    assert.equal(r.result.items[0].unit, "NMAH");
    assert.equal(r.result.source, "smithsonian-open-access");
  });

  it("surfaces 403 invalid key", async () => {
    process.env.DATA_GOV_API_KEY = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const r = await call("gallery.si-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid|rate-limited/);
  });
});

describe("classroom.ol-search (Open Library)", () => {
  it("rejects empty input", async () => {
    assert.equal((await call("classroom.ol-search", ctxA, {})).ok, false);
  });

  it("parses Open Library search response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          numFound: 215,
          docs: [{
            key: "/works/OL45883W",
            title: "Fahrenheit 451",
            author_name: ["Ray Bradbury"],
            first_publish_year: 1953,
            edition_count: 423,
            language: ["eng", "spa", "fre"],
            subject: ["Censorship", "Dystopias", "Book burning", "Science fiction"],
            isbn: ["9781451673319"],
            cover_i: 8228691,
            ebook_access: "borrowable",
            ia: ["fahrenheit451_201803"],
          }],
        }),
      };
    };
    const r = await call("classroom.ol-search", ctxA, { title: "fahrenheit 451" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /openlibrary\.org\/search\.json/);
    assert.match(capturedUrl, /title=fahrenheit\+451/);
    assert.equal(r.result.works[0].title, "Fahrenheit 451");
    assert.equal(r.result.works[0].authors[0], "Ray Bradbury");
    assert.equal(r.result.works[0].coverImage, "https://covers.openlibrary.org/b/id/8228691-M.jpg");
    assert.equal(r.result.works[0].readUrl, "https://archive.org/details/fahrenheit451_201803");
    assert.equal(r.result.source, "open-library");
  });
});

describe("classroom.ol-work + ol-subject + ol-isbn", () => {
  it("ol-work rejects bad workId format", async () => {
    assert.equal((await call("classroom.ol-work", ctxA, { workId: "bad" })).ok, false);
    assert.equal((await call("classroom.ol-work", ctxA, { workId: "OL12345" })).ok, false);
  });

  it("ol-work surfaces 404", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("classroom.ol-work", ctxA, { workId: "OL99999999W" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("ol-work parses string + object descriptions", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        title: "Fahrenheit 451",
        description: { value: "Dystopian novel about book burning", type: "/type/text" },
        subjects: ["Censorship", "Dystopias"],
        first_publish_date: "1953",
        covers: [8228691],
        authors: [{ author: { key: "/authors/OL2625462A" } }],
      }),
    });
    const r = await call("classroom.ol-work", ctxA, { workId: "OL45883W" });
    assert.equal(r.ok, true);
    assert.equal(r.result.description, "Dystopian novel about book burning");
    assert.equal(r.result.authorKeys[0], "/authors/OL2625462A");
    assert.equal(r.result.covers[0], "https://covers.openlibrary.org/b/id/8228691-L.jpg");
  });

  it("ol-subject normalizes the subject slug", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          name: "Computer Science",
          work_count: 8723,
          works: [{
            key: "/works/OL777W",
            title: "Structure and Interpretation of Computer Programs",
            authors: [{ name: "Harold Abelson" }, { name: "Gerald Jay Sussman" }],
            first_publish_year: 1985,
            edition_count: 12,
            cover_id: 12345,
            has_fulltext: true,
            ia: "sicp_201803",
          }],
        }),
      };
    };
    const r = await call("classroom.ol-subject", ctxA, { subject: "Computer Science!", limit: 10 });
    assert.equal(r.ok, true);
    // " " → "_", "!" stripped
    assert.match(capturedUrl, /\/subjects\/computer_science\.json/);
    assert.equal(r.result.works[0].workId, "OL777W");
    assert.equal(r.result.works[0].readUrl, "https://archive.org/details/sicp_201803");
  });

  it("ol-isbn rejects non-10/13 digit input", async () => {
    assert.equal((await call("classroom.ol-isbn", ctxA, { isbn: "12345" })).ok, false);
    assert.equal((await call("classroom.ol-isbn", ctxA, { isbn: "this-is-not-an-isbn" })).ok, false);
  });

  it("ol-isbn parses edition record", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          title: "Clean Code",
          publishers: ["Prentice Hall"],
          publish_date: "Aug 11, 2008",
          number_of_pages: 464,
          languages: [{ key: "/languages/eng" }],
          subjects: ["Computer programming", "Software engineering"],
          covers: [7222246],
          works: [{ key: "/works/OL16800437W" }],
          authors: [{ key: "/authors/OL1394245A" }],
        }),
      };
    };
    const r = await call("classroom.ol-isbn", ctxA, { isbn: "978-0132350884" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/isbn\/9780132350884\.json/);
    assert.equal(r.result.title, "Clean Code");
    assert.equal(r.result.languages[0], "eng");
    assert.equal(r.result.workKey, "/works/OL16800437W");
  });
});
