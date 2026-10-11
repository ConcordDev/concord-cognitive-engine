// INC-30: natural-language questions were sent raw to Wikipedia's
// CirrusSearch (every token ANDed; "?" is a wildcard) and to DuckDuckGo's
// instant-answer API, which is empty for questions. "Capital punishment"
// outranked the page that answers "what is the capital of France".
// Egress is mocked. These tests must not fetch the network.

import { readFileSync } from "node:fs";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  shapeSearchQuery,
  isWebSourceRelevant,
  webSearchForChat,
} from "../emergent/conscious-web-search.js";

const FRANCE_QUESTION = "What is the capital of France? Answer in one sentence.";
const FRANCE_PREFIXED = "EM18610 What is the capital of France? Answer in one sentence.";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function franceSearchPayload() {
  return {
    query: {
      search: [
        {
          title: "Question",
          snippet: "A question is an utterance which typically functions as a request for information.",
        },
        {
          title: "Capital punishment",
          snippet: "Capital punishment, also known as the death penalty, is the state-sanctioned killing of a person as punishment for a crime.",
        },
        {
          title: "Capital punishment in France",
          snippet: "Capital punishment in France (French: peine de mort en France) is banned by Article 66-1 of the Constitution of the French Republic.",
        },
        {
          title: "List of capitals of France",
          snippet: "This is a chronological list of <span class=\"searchmatch\">capitals</span> of <span class=\"searchmatch\">France</span>. The <span class=\"searchmatch\">capital</span> of <span class=\"searchmatch\">France</span> has been Paris since 1944.",
        },
        {
          title: "Paris",
          snippet: "Paris is the <span class=\"searchmatch\">capital</span> and largest city of <span class=\"searchmatch\">France</span>.",
        },
        {
          title: "Capital city",
          snippet: "A capital is typically a city that physically encompasses the government's offices and meeting places.",
        },
      ],
    },
  };
}

function installFetch({ searchPayload, ddg, onUrl }) {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (onUrl) onUrl(u);
    if (u.includes("api.duckduckgo.com")) return jsonResponse(ddg || { AbstractText: "", Answer: "", Heading: "" });
    if (u.includes("/robots.txt")) {
      return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /\n", json: async () => ({}) };
    }
    if (u.includes("list=search")) return jsonResponse(searchPayload || { query: { search: [] } });
    if (u.includes("prop=extracts")) {
      const title = decodeURIComponent(u.split("titles=")[1]?.split("&")[0] || "");
      const extracts = {
        "List of capitals of France": "The capital of France has been Paris since its liberation in 1944.",
        Paris: "Paris is the capital and largest city of France.",
        "Eiffel Tower": "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France. The tower is 330 metres (1,083 ft) tall.",
      };
      const extract = extracts[title];
      if (!extract) return jsonResponse({ query: { pages: {} } });
      return jsonResponse({ query: { pages: { 1: { extract } } } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return urls;
}

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("wikipedia courtesy delay", () => {
  it("waits 2s between article fetches in production and skips the wait under the test runner", () => {
    const src = readFileSync(new URL("../emergent/conscious-web-search.js", import.meta.url), "utf8");
    assert.match(src, /NODE_ENV\)\.toLowerCase\(\) === "test" \? 0 : 2000/);
  });
});

describe("shapeSearchQuery", () => {
  it("reduces a natural question and an id-prefixed question to the same keyword query", () => {
    assert.equal(shapeSearchQuery(FRANCE_QUESTION), "capital of France");
    assert.equal(shapeSearchQuery(FRANCE_PREFIXED), "capital of France");
    assert.equal(shapeSearchQuery("What is the capital of France?"), "capital of France");
    assert.equal(shapeSearchQuery("what's the capital of France"), "capital of France");
  });

  it("leaves chat-style keyword queries unchanged", () => {
    for (const q of ["capital of France", "France capital city", "Eiffel Tower", "boiling point of water"]) {
      assert.equal(shapeSearchQuery(q), q);
      assert.equal(shapeSearchQuery(shapeSearchQuery(q)), q);
    }
  });

  it("shapes a where-is question into the entity DuckDuckGo can answer", () => {
    assert.equal(shapeSearchQuery("Where is the Eiffel Tower?"), "Eiffel Tower");
  });

  it("returns nothing searchable for an empty or instruction-only string", () => {
    assert.equal(shapeSearchQuery(""), "");
    assert.equal(shapeSearchQuery("   "), "");
    assert.equal(shapeSearchQuery("EM18610"), "");
  });
});

describe("isWebSourceRelevant", () => {
  const q = FRANCE_QUESTION;

  it("rejects Capital punishment for a capital-city question", () => {
    assert.equal(
      isWebSourceRelevant(q, "Capital punishment", "Capital punishment, also known as the death penalty, is the state-sanctioned killing of a person as punishment for a crime."),
      false,
    );
    assert.equal(
      isWebSourceRelevant(q, "Capital punishment in France", "Capital punishment in France (French: peine de mort en France) is banned by Article 66-1 of the Constitution of the French Republic."),
      false,
    );
    assert.equal(
      isWebSourceRelevant(q, "Question", "A question is an utterance which typically functions as a request for information."),
      false,
    );
  });

  it("keeps the list of capitals and the Paris article", () => {
    assert.equal(
      isWebSourceRelevant(q, "List of capitals of France", "This is a chronological list of capitals of France. The capital of France has been Paris since 1944."),
      true,
    );
    assert.equal(
      isWebSourceRelevant(q, "Paris", "Paris is the capital and largest city of France."),
      true,
    );
  });

  it("keeps a keyword hit for a query chat would already have shaped", () => {
    assert.equal(
      isWebSourceRelevant("Eiffel Tower", "Eiffel Tower", "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France."),
      true,
    );
    assert.equal(
      isWebSourceRelevant("boiling point of water", "Boiling point", "The boiling point of water is 100 °C at atmospheric pressure."),
      true,
    );
    assert.equal(
      isWebSourceRelevant("boiling point of water", "Boiling Point (2021 film)", "Boiling Point is a 2021 British drama film."),
      false,
    );
  });
});

describe("webSearchForChat", () => {
  it("searches the shaped query and does not return Capital punishment", async () => {
    const urls = installFetch({
      searchPayload: franceSearchPayload(),
      ddg: {
        Heading: "Capital punishment",
        AbstractText: "Capital punishment, also known as the death penalty, is the state-sanctioned killing of a person as punishment for a crime.",
        AbstractURL: "https://en.wikipedia.org/wiki/Capital_punishment",
        Answer: "",
      },
    });

    const results = await webSearchForChat([FRANCE_PREFIXED]);
    const titles = results.map((r) => r.title);

    assert.deepEqual(titles, ["List of capitals of France", "Paris"]);
    assert.ok(titles.every((t) => !/capital punishment/i.test(t)));

    const wiki = urls.find((u) => u.includes("list=search"));
    assert.ok(wiki, "wikipedia search was called");
    const searched = new URL(wiki).searchParams.get("srsearch");
    assert.equal(searched, "capital of France");
    assert.equal(new URL(wiki).searchParams.get("srlimit"), "8");
    assert.ok(!wiki.includes("EM18610"));
    assert.ok(!/sentence/i.test(searched));

    const ddg = urls.find((u) => u.includes("api.duckduckgo.com"));
    assert.equal(new URL(ddg).searchParams.get("q"), "capital of France");

    const extracts = urls.filter((u) => u.includes("prop=extracts"));
    assert.equal(extracts.length, 2);
    assert.ok(extracts.every((u) => !u.includes("Capital%20punishment")));
  });

  it("returns no sources when every hit is irrelevant", async () => {
    const urls = installFetch({
      searchPayload: {
        query: {
          search: [
            {
              title: "Capital punishment",
              snippet: "Capital punishment, also known as the death penalty, is the state-sanctioned killing of a person as punishment for a crime.",
            },
            {
              title: "Question",
              snippet: "A question is an utterance which typically functions as a request for information.",
            },
          ],
        },
      },
      ddg: { AbstractText: "", Answer: "", Heading: "" },
    });

    const results = await webSearchForChat([FRANCE_QUESTION]);
    assert.deepEqual(results, []);
    assert.ok(!urls.some((u) => u.includes("prop=extracts")), "does not fetch an extract for a rejected hit");
  });

  it("still returns a relevant page for a keyword query chat already sends", async () => {
    const urls = installFetch({
      searchPayload: {
        query: {
          search: [
            { title: "Eiffel Tower", snippet: "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France." },
            { title: "Erika Eiffel", snippet: "Erika Eiffel is an American competitive archer." },
          ],
        },
      },
      ddg: {
        Heading: "Eiffel Tower",
        AbstractText: "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France.",
        AbstractURL: "https://en.wikipedia.org/wiki/Eiffel_Tower",
        AbstractSource: "Wikipedia",
        Answer: "",
      },
    });

    const results = await webSearchForChat(["Eiffel Tower"]);
    assert.ok(results.some((r) => r.title === "Eiffel Tower"));
    assert.ok(results.every((r) => r.title !== "Erika Eiffel"));
    assert.equal(new URL(urls.find((u) => u.includes("list=search"))).searchParams.get("srsearch"), "Eiffel Tower");
    // The search blurb is the first sentence. The height lives in the extract.
    const wiki = results.find((r) => r.source === "en.wikipedia.org" && r.title === "Eiffel Tower");
    assert.ok(wiki, "wikipedia lead extract is kept on content");
    assert.ok(wiki.content.includes("330 metres"));
    assert.ok(!wiki.snippet.includes("330"));
  });

  it("searches nothing when the query shapes to empty", async () => {
    const urls = installFetch({ searchPayload: franceSearchPayload() });
    const results = await webSearchForChat(["EM18610"]);
    assert.deepEqual(results, []);
    assert.equal(urls.length, 0);
  });
});
