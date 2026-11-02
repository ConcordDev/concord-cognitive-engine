// S7 (F10) — citation strictness via CSL-as-data. Pins the strict
// output of the ONE citation engine (formatCitation in research.js)
// behind reference-detail / cite-format / bibliography-build /
// generate-bibliography, for the review's fixture references:
//   - AlphaGo (Silver et al., Nature 2016, 20 authors as imported)
//   - Attention Is All You Need (Vaswani et al., 2017, 8 authors)
// F10's headline defect: APA printed full first names ("David Silver,
// Aja Huang, …") where APA requires surnames + initials.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerResearchActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  assert.ok(fn, `research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerResearchActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

let seq = 0;
function addRef(over = {}) {
  seq += 1;
  return call("reference-add", ctxA, { doi: `10.5555/s7.${seq}`, ...over }).result.reference;
}
const cite = (ref, style) => call("cite-format", ctxA, { id: ref.id, style }).result.citation;

// The AlphaGo record as the review filed it (Discover/OpenAlex import:
// authors stored as one natural-order display string).
const ALPHAGO = {
  title: "Mastering the game of Go with deep neural networks and tree search",
  authors: [
    "David Silver", "Aja Huang", "Chris J. Maddison", "Arthur Guez",
    "Laurent Sifre", "George van den Driessche", "Julian Schrittwieser",
    "Ioannis Antonoglou", "Veda Panneershelvam", "Marc Lanctot",
    "Sander Dieleman", "Dominik Grewe", "John Nham", "Nal Kalchbrenner",
    "Ilya Sutskever", "Timothy Lillicrap", "Madeleine Leach",
    "Koray Kavukcuoglu", "Thore Graepel", "Demis Hassabis",
  ].join(", "),
  year: 2016, journal: "Nature", doi: "10.1038/nature16961", type: "article",
};
const ATTENTION = {
  title: "Attention Is All You Need",
  authors: [
    "Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit",
    "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin",
  ].join(", "),
  year: 2017, journal: "Advances in Neural Information Processing Systems",
  doi: "10.48550/arXiv.1706.03762", type: "article",
};

describe("research.citations — strict APA (F10 headline)", () => {
  it("AlphaGo: surnames + initials for all 20 authors, & before the last", () => {
    const r = addRef(ALPHAGO);
    assert.equal(cite(r, "apa"),
      "Silver, D., Huang, A., Maddison, C. J., Guez, A., Sifre, L., " +
      "van den Driessche, G., Schrittwieser, J., Antonoglou, I., " +
      "Panneershelvam, V., Lanctot, M., Dieleman, S., Grewe, D., Nham, J., " +
      "Kalchbrenner, N., Sutskever, I., Lillicrap, T., Leach, M., " +
      "Kavukcuoglu, K., Graepel, T., & Hassabis, D. (2016). " +
      "Mastering the game of Go with deep neural networks and tree search. " +
      "Nature. https://doi.org/10.1038/nature16961");
  });

  it("Attention: 8 authors, initials incl. diacritic and middle initial", () => {
    const r = addRef(ATTENTION);
    assert.equal(cite(r, "apa"),
      "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., " +
      "Gomez, A. N., Kaiser, Ł., & Polosukhin, I. (2017). " +
      "Attention Is All You Need. " +
      "Advances in Neural Information Processing Systems. " +
      "https://doi.org/10.48550/arXiv.1706.03762");
  });

  it("two authors take ', & '; one author stands alone", () => {
    const two = addRef({ title: "Pair Work", authors: "David Silver, Demis Hassabis", year: 2016, journal: "Nature", doi: "10.1/pair" });
    assert.equal(cite(two, "apa"), "Silver, D., & Hassabis, D. (2016). Pair Work. Nature. https://doi.org/10.1/pair");
    const one = addRef({ title: "Solo Work", authors: "Demis Hassabis", year: 2020, journal: null, doi: null });
    assert.equal(cite(one, "apa"), "Hassabis, D. (2020). Solo Work.");
  });

  it("21+ authors: first 19, an ellipsis, the last — no ampersand", () => {
    const names = [];
    for (let i = 1; i <= 21; i++) names.push(`Given${i} Family${i}`);
    const r = addRef({ title: "Crowd Work", authors: names.join(", "), year: 2021, journal: null, doi: null });
    const forms = names.map((n, i) => `Family${i + 1}, G.`);
    const expected = `${forms.slice(0, 19).join(", ")}, … ${forms[20]} (2021). Crowd Work.`;
    assert.equal(cite(r, "apa"), expected);
  });
});

describe("research.citations — strict MLA 9", () => {
  it("3+ authors: first author inverted + et al.; headline-case title; DOI as URL", () => {
    const r = addRef(ALPHAGO);
    assert.equal(cite(r, "mla"),
      "Silver, David, et al. \"Mastering the Game of Go with Deep Neural " +
      "Networks and Tree Search.\" Nature, 2016, " +
      "https://doi.org/10.1038/nature16961.");
  });

  it("two authors: first inverted, second natural, joined with ', and'", () => {
    const r = addRef({ title: "Pair Work", authors: "David Silver, Demis Hassabis", year: 2016, journal: "Nature", doi: null });
    assert.equal(cite(r, "mla"), "Silver, David, and Demis Hassabis. \"Pair Work.\" Nature, 2016.");
  });

  it("Attention fixture in MLA", () => {
    const r = addRef(ATTENTION);
    assert.equal(cite(r, "mla"),
      "Vaswani, Ashish, et al. \"Attention Is All You Need.\" " +
      "Advances in Neural Information Processing Systems, 2017, " +
      "https://doi.org/10.48550/arXiv.1706.03762.");
  });
});

describe("research.citations — strict Chicago (bibliography)", () => {
  it("≤10 authors listed in full: first inverted, rest natural", () => {
    const r = addRef(ATTENTION);
    assert.equal(cite(r, "chicago"),
      "Vaswani, Ashish, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, " +
      "Llion Jones, Aidan N. Gomez, Łukasz Kaiser, and Illia Polosukhin. " +
      "\"Attention Is All You Need.\" " +
      "Advances in Neural Information Processing Systems (2017). " +
      "https://doi.org/10.48550/arXiv.1706.03762.");
  });

  it(">10 authors: first seven + et al.", () => {
    const r = addRef(ALPHAGO);
    assert.equal(cite(r, "chicago"),
      "Silver, David, Aja Huang, Chris J. Maddison, Arthur Guez, " +
      "Laurent Sifre, George van den Driessche, Julian Schrittwieser, " +
      "et al. \"Mastering the Game of Go with Deep Neural Networks and " +
      "Tree Search.\" Nature (2016). https://doi.org/10.1038/nature16961.");
  });
});

describe("research.citations — Vancouver (the fifth style, §7 S7)", () => {
  it("AlphaGo: first six authors, compact initials, et al.; doi: tag", () => {
    const r = addRef(ALPHAGO);
    assert.equal(cite(r, "vancouver"),
      "Silver D, Huang A, Maddison CJ, Guez A, Sifre L, " +
      "van den Driessche G, et al. Mastering the game of Go with deep " +
      "neural networks and tree search. Nature. 2016. " +
      "doi:10.1038/nature16961.");
  });

  it("exactly six authors are all listed; seven truncate to six + et al.", () => {
    const six = addRef({ title: "Six Work", authors: "Ann A, Bob B, Cat C, Dan D, Eve E, Fay F", year: 2000, journal: null, doi: null });
    assert.equal(cite(six, "vancouver"), "A A, B B, C C, D D, E E, F F. Six Work. 2000.");
    const seven = addRef({ title: "Seven Work", authors: "Ann A, Bob B, Cat C, Dan D, Eve E, Fay F, Gil G", year: 2000, journal: null, doi: null });
    assert.equal(cite(seven, "vancouver"), "A A, B B, C C, D D, E E, F F, et al. Seven Work. 2000.");
  });

  it("vancouver is selectable through cite-format, bibliography-build and generate-bibliography", () => {
    const r = addRef(ATTENTION);
    const one = call("cite-format", ctxA, { id: r.id, style: "vancouver" });
    assert.equal(one.result.style, "vancouver");
    assert.ok(one.result.citation.startsWith("Vaswani A, Shazeer N,"));
    const built = call("bibliography-build", ctxA, { style: "vancouver" });
    assert.equal(built.result.style, "vancouver");
    assert.equal(built.result.count, 1);
    const gen = call("generate-bibliography", ctxA, { style: "vancouver" });
    assert.equal(gen.result.style, "vancouver");
    assert.ok(gen.result.bibliography.includes("doi:10.48550/arXiv.1706.03762."));
  });

  it("reference-detail now carries all five styles from the one engine", () => {
    const r = addRef(ATTENTION);
    const d = call("reference-detail", ctxA, { id: r.id });
    for (const s of ["apa", "mla", "chicago", "vancouver", "bibtex"]) {
      assert.equal(typeof d.result.citations[s], "string", `citations.${s}`);
    }
    assert.equal(d.result.citations.vancouver, cite(r, "vancouver"));
    assert.equal(d.result.citations.apa, cite(r, "apa"));
  });

  it("an unknown style still falls back to APA (pre-S7 behaviour)", () => {
    const r = addRef(ATTENTION);
    const out = call("cite-format", ctxA, { id: r.id, style: "harvard" });
    assert.equal(out.result.style, "apa");
    assert.equal(out.result.citation, cite(r, "apa"));
  });
});

describe("research.citations — conservative author parsing", () => {
  it("hyphenated given name: Jean-Luc → J.-L.", () => {
    const r = addRef({ title: "Trek Work", authors: "Jean-Luc Picard", year: 2364, journal: null, doi: null });
    assert.equal(cite(r, "apa"), "Picard, J.-L. (2364). Trek Work.");
  });

  it("hand-entered inverted pairs render back in strict form", () => {
    const r = addRef({ title: "Inv Work", authors: "Silver, D., Hassabis, D.", year: 2016, journal: null, doi: null });
    assert.equal(cite(r, "apa"), "Silver, D., & Hassabis, D. (2016). Inv Work.");
    const full = addRef({ title: "Inv Full", authors: "Vaswani, Ashish", year: 2017, journal: null, doi: null });
    assert.equal(cite(full, "apa"), "Vaswani, A. (2017). Inv Full.");
    assert.equal(cite(full, "mla"), "Vaswani, Ashish. \"Inv Full.\" 2017.");
  });

  it("single-token and organisation authors are never split", () => {
    const plato = addRef({ title: "Old Work", authors: "Plato", year: 2000, journal: null, doi: null });
    assert.equal(cite(plato, "apa"), "Plato (2000). Old Work.");
    const who = addRef({ title: "Org Work", authors: "World Health Organization", year: 2020, journal: null, doi: null });
    assert.equal(cite(who, "apa"), "World Health Organization (2020). Org Work.");
    assert.equal(cite(who, "vancouver"), "World Health Organization. Org Work. 2020.");
  });

  it("suffixes survive: Martin Luther King Jr. → King, M. L., Jr.", () => {
    const r = addRef({ title: "Dream Work", authors: "Martin Luther King Jr.", year: 1963, journal: null, doi: null });
    assert.equal(cite(r, "apa"), "King, M. L., Jr. (1963). Dream Work.");
  });

  it("missing authors keep the pre-S7 'Unknown' placeholder; missing year is n.d.", () => {
    const r = addRef({ title: "Anon Work", authors: null, year: null, journal: null, doi: null });
    assert.equal(cite(r, "apa"), "Unknown (n.d.). Anon Work.");
  });
});
