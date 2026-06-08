// tests/depth/poetry-behavior.test.js — REAL behavioral tests for the
// poetry domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact prosody calcs (syllable counts, rhyme
// schemes, form detection) + CRUD round-trips + validation rejections.
// Every lensRun("poetry", "<macro>", …) call literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation.
//
// Pure-network macros (poetrydb-search, poetrydb-authors, feed,
// word-suggest, poem-of-the-day, themed-collection) are intentionally NOT
// covered here — their behavior depends on live PoetryDB/Datamuse egress
// (blocked by the no-egress preload). The deterministic prosody + workspace
// surface below is what carries real assertable contracts.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("poetry — prosody calc contracts (exact computed values)", () => {
  it("meterAnalysis: a 5-7-5 poem reports exact per-line syllables and detects haiku", async () => {
    const r = await lensRun("poetry", "meterAnalysis", {
      data: { text: "an old silent pond\na frog leaps into water\nripples spread outward" },
    });
    assert.equal(r.result.lines, 3);
    assert.deepEqual(r.result.syllablesPerLine, [5, 7, 5]);
    // avg = (5+7+5)/3 = 5.666… → rounded to one decimal.
    assert.equal(r.result.avgSyllables, 5.7);
    // max-min = 7-5 = 2 ≤ 2 → regular.
    assert.equal(r.result.meterConsistency, "regular");
    assert.equal(r.result.possibleForm, "haiku");
  });

  it("meterAnalysis: irregular line lengths are flagged irregular", async () => {
    const r = await lensRun("poetry", "meterAnalysis", {
      data: { text: "a\nthe quick brown fox jumped over the lazy dog again" },
    });
    // line 1 = 1 syllable, line 2 ≫ → spread > 2.
    assert.equal(r.result.lines, 2);
    assert.equal(r.result.syllablesPerLine[0], 1);
    assert.equal(r.result.meterConsistency, "irregular");
  });

  it("meterAnalysis: empty text returns a prompt message, not an analysis", async () => {
    const r = await lensRun("poetry", "meterAnalysis", { data: {} });
    assert.equal(r.result.message.includes("Add poem text"), true);
  });

  it("rhymeScheme: alternate-rhyme end-words map to ABAB", async () => {
    const r = await lensRun("poetry", "rhymeScheme", {
      data: { text: "the cat\na log\na mat\na dog" },
    });
    // endings: at, og, at, og → ABAB.
    assert.equal(r.result.scheme, "ABAB");
    assert.equal(r.result.form, "alternate-rhyme");
    assert.deepEqual(r.result.endWords, ["cat", "log", "mat", "dog"]);
    assert.equal(r.result.rhyming, true);
  });

  it("rhymeScheme: enclosed end-words map to ABBA enclosed-rhyme", async () => {
    const r = await lensRun("poetry", "rhymeScheme", {
      data: { text: "the cat\na log\na dog\na mat" },
    });
    assert.equal(r.result.scheme, "ABBA");
    assert.equal(r.result.form, "enclosed-rhyme");
  });

  it("rhymeScheme: rhyming couplets map to AABB couplets", async () => {
    const r = await lensRun("poetry", "rhymeScheme", {
      data: { text: "the cat\na mat\na log\na dog" },
    });
    assert.equal(r.result.scheme, "AABB");
    assert.equal(r.result.form, "couplets");
  });

  it("wordFrequency: counts non-stopwords, ranks them, and computes lexical density", async () => {
    const r = await lensRun("poetry", "wordFrequency", {
      data: { text: "The river flows. The river runs. River river light light light." },
    });
    // 11 total words; stopword "the" excluded → 4 unique (river, flows, runs, light).
    assert.equal(r.result.totalWords, 11);
    assert.equal(r.result.uniqueWords, 4);
    const river = r.result.topWords.find((w) => w.word === "river");
    assert.equal(river.count, 4);
    const light = r.result.topWords.find((w) => w.word === "light");
    assert.equal(light.count, 3);
    // top word by count comes first.
    assert.equal(r.result.topWords[0].word, "river");
    // lexicalDensity = round(4/11*100) = 36.
    assert.equal(r.result.lexicalDensity, 36);
  });

  it("formGuide: a known form returns its line count and structure; unknown falls back to free-verse", async () => {
    const sonnet = await lensRun("poetry", "formGuide", { data: { form: "Sonnet" } });
    assert.equal(sonnet.result.form, "sonnet");
    assert.equal(sonnet.result.lines, 14);
    assert.equal(sonnet.result.meter.includes("iambic pentameter"), true);

    const haiku = await lensRun("poetry", "formGuide", { data: { form: "haiku" } });
    assert.equal(haiku.result.lines, 3);
    assert.equal(haiku.result.meter, "5-7-5 syllables");

    const unknown = await lensRun("poetry", "formGuide", { data: { form: "nonexistent-form" } });
    assert.equal(unknown.result.lines, "any"); // free-verse fallback
  });
});

describe("poetry — form rules + live form checking (exact computed values)", () => {
  it("form-rules: haiku returns the 5-7-5 constraint spec; unknown falls back to free-verse", async () => {
    const haiku = await lensRun("poetry", "form-rules", { params: { form: "haiku" } });
    assert.equal(haiku.result.form, "haiku");
    assert.equal(haiku.result.rules.lineCount, 3);
    assert.deepEqual(haiku.result.rules.syllablesPerLine, [5, 7, 5]);

    const unknown = await lensRun("poetry", "form-rules", { params: { form: "epic-saga" } });
    assert.equal(unknown.result.form, "epic-saga");
    assert.equal(unknown.result.rules.lineCount, null); // free-verse fallback
  });

  it("form-check: a valid 5-7-5 haiku passes with no violations", async () => {
    const r = await lensRun("poetry", "form-check", {
      params: { form: "haiku", body: "an old silent pond\na frog leaps into water\nripples spread outward" },
    });
    assert.equal(r.result.valid, true);
    assert.equal(r.result.violations.length, 0);
    assert.equal(r.result.lineCount, 3);
    assert.equal(r.result.expectedLineCount, 3);
    assert.deepEqual(r.result.lineReports.map((lr) => lr.syllables), [5, 7, 5]);
    assert.deepEqual(r.result.lineReports.map((lr) => lr.target), [5, 7, 5]);
    assert.equal(r.result.lineReports.every((lr) => lr.ok), true);
  });

  it("form-check: wrong line count and off-syllable lines produce named violations", async () => {
    const r = await lensRun("poetry", "form-check", {
      params: { form: "haiku", body: "way way way way way way\nway way way way way way way" },
    });
    assert.equal(r.result.valid, false);
    // expected 3 lines, found 2.
    assert.equal(r.result.violations.some((v) => v.includes("expected 3 lines")), true);
    // line 1 has 6 syllables, target 5 → off by 1 → violation listed.
    assert.equal(r.result.violations.some((v) => v.includes("line 1")), true);
  });
});

describe("poetry — discovery themes (deterministic curated set)", () => {
  it("discovery-themes: returns the curated themes with author counts", async () => {
    const r = await lensRun("poetry", "discovery-themes", {});
    assert.equal(r.result.count, 5);
    const love = r.result.themes.find((t) => t.id === "love-and-longing");
    assert.equal(love.label, "Love & Longing");
    assert.equal(love.authorCount, 3); // Browning, Keats, Rossetti
    const war = r.result.themes.find((t) => t.id === "war-and-loss");
    assert.equal(war.authorCount, 2); // Owen, Whitman
  });

  it("themed-collection: an unknown theme is rejected", async () => {
    const bad = await lensRun("poetry", "themed-collection", { params: { themeId: "no-such-theme" } });
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("unknown theme"), true);
  });
});

describe("poetry — poem workspace CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("poetry-crud"); });

  it("poem-create → poem-list → poem-detail: poem reads back with normalized form", async () => {
    const created = await lensRun("poetry", "poem-create", {
      params: { title: "Dawn", body: "light over the hills\nthe day begins again now\nshadows pull away", form: "HAIKU", tags: ["Nature", "morning"] },
    }, ctx);
    assert.equal(created.result.poem.title, "Dawn");
    assert.equal(created.result.poem.form, "haiku");   // lower-cased
    assert.equal(created.result.poem.status, "draft");
    assert.deepEqual(created.result.poem.tags, ["nature", "morning"]); // lower-cased
    const id = created.result.poem.id;

    const list = await lensRun("poetry", "poem-list", {}, ctx);
    assert.equal(list.result.poems.some((p) => p.id === id), true);

    const detail = await lensRun("poetry", "poem-detail", { params: { id } }, ctx);
    assert.equal(detail.result.poem.title, "Dawn");
    // lineCount derived from non-blank body lines.
    const summary = list.result.poems.find((p) => p.id === id);
    assert.equal(summary.lineCount, 3);
  });

  it("poem-create: a missing title is rejected", async () => {
    const bad = await lensRun("poetry", "poem-create", { params: { body: "untitled" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("title required"), true);
  });

  it("poem-update: edits round-trip; an invalid status is silently ignored", async () => {
    const created = await lensRun("poetry", "poem-create", { params: { title: "Revisable", body: "first draft line" } }, ctx);
    const id = created.result.poem.id;
    const upd = await lensRun("poetry", "poem-update", { params: { id, body: "a much better line\nand a second line", status: "revising" } }, ctx);
    assert.equal(upd.result.poem.status, "revising");
    assert.equal(upd.result.poem.body.includes("much better"), true);
    // Invalid status is not applied (stays revising).
    const bad = await lensRun("poetry", "poem-update", { params: { id, status: "published-everywhere" } }, ctx);
    assert.equal(bad.result.poem.status, "revising");
  });

  it("poem-update: a missing poem id is rejected", async () => {
    const bad = await lensRun("poetry", "poem-update", { params: { id: "pm_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("poem not found"), true);
  });

  it("poem-analyze: derives prosody from the stored poem body", async () => {
    const created = await lensRun("poetry", "poem-create", {
      params: { title: "Analyzed", body: "the cat\na mat\na log\na dog" },
    }, ctx);
    const r = await lensRun("poetry", "poem-analyze", { params: { id: created.result.poem.id } }, ctx);
    assert.equal(r.result.title, "Analyzed");
    assert.equal(r.result.analysis.lineCount, 4);
    assert.equal(r.result.analysis.rhymeScheme, "AABB");
    assert.equal(r.result.analysis.rhyming, true);
  });

  it("poem-analyze: a poem with no body text is rejected", async () => {
    const created = await lensRun("poetry", "poem-create", { params: { title: "Blank", body: "" } }, ctx);
    const bad = await lensRun("poetry", "poem-analyze", { params: { id: created.result.poem.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("no text"), true);
  });

  it("poem-delete removes the poem; a missing id is rejected", async () => {
    const created = await lensRun("poetry", "poem-create", { params: { title: "Doomed", body: "ephemeral verse" } }, ctx);
    const id = created.result.poem.id;
    const del = await lensRun("poetry", "poem-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("poetry", "poem-list", {}, ctx);
    assert.equal(list.result.poems.some((p) => p.id === id), false);
    const bad = await lensRun("poetry", "poem-delete", { params: { id: "pm_gone" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("poem not found"), true);
  });

  it("poetry-dashboard: tallies poems by status and form, summing total lines", async () => {
    const d = await depthCtx("poetry-dash");
    await lensRun("poetry", "poem-create", { params: { title: "One", body: "line a\nline b", form: "free-verse" } }, d);
    const two = await lensRun("poetry", "poem-create", { params: { title: "Two", body: "single line", form: "haiku" } }, d);
    await lensRun("poetry", "poem-update", { params: { id: two.result.poem.id, status: "finished" } }, d);
    const dash = await lensRun("poetry", "poetry-dashboard", {}, d);
    assert.equal(dash.result.poems, 2);
    assert.equal(dash.result.finished, 1);
    assert.equal(dash.result.drafts, 1);
    assert.equal(dash.result.totalLines, 3); // 2 + 1
    assert.equal(dash.result.byForm["free-verse"], 1);
    assert.equal(dash.result.byForm.haiku, 1);
  });
});

describe("poetry — favorites + reading history round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("poetry-favs"); });

  it("favorite-add → favorite-list → favorite-remove round-trips; re-add is idempotent", async () => {
    const add = await lensRun("poetry", "favorite-add", {
      params: { title: "Ozymandias", author: "Percy Bysshe Shelley", lines: ["I met a traveller", "from an antique land"] },
    }, ctx);
    assert.equal(add.result.favorite.title, "Ozymandias");
    assert.equal(add.result.favorite.lineCount, 2);
    const favId = add.result.favorite.id;

    const list = await lensRun("poetry", "favorite-list", {}, ctx);
    assert.equal(list.result.favorites.some((f) => f.id === favId), true);

    // Re-adding the same title/author returns already:true (deduped on ref).
    const again = await lensRun("poetry", "favorite-add", { params: { title: "Ozymandias", author: "Percy Bysshe Shelley" } }, ctx);
    assert.equal(again.result.already, true);

    const rm = await lensRun("poetry", "favorite-remove", { params: { id: favId } }, ctx);
    assert.equal(rm.result.removed, favId);
    const after = await lensRun("poetry", "favorite-list", {}, ctx);
    assert.equal(after.result.favorites.some((f) => f.id === favId), false);
  });

  it("favorite-add: a missing title is rejected", async () => {
    const bad = await lensRun("poetry", "favorite-add", { params: { author: "Anon" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("title required"), true);
  });

  it("favorite-remove: a missing favorite id is rejected", async () => {
    const bad = await lensRun("poetry", "favorite-remove", { params: { id: "fav_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("favorite not found"), true);
  });

  it("reading-log increments readCount on repeat reads; reading-history returns it newest-first", async () => {
    await lensRun("poetry", "reading-log", { params: { title: "The Road Not Taken", author: "Robert Frost" } }, ctx);
    await lensRun("poetry", "reading-log", { params: { title: "The Road Not Taken", author: "Robert Frost" } }, ctx);
    const hist = await lensRun("poetry", "reading-history", {}, ctx);
    const entry = hist.result.history.find((h) => h.title === "The Road Not Taken");
    assert.equal(entry.readCount, 2);
    assert.equal(entry.author, "Robert Frost");
  });

  it("reading-log: a missing title is rejected", async () => {
    const bad = await lensRun("poetry", "reading-log", { params: { author: "Nobody" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("title required"), true);
  });
});

describe("poetry — audio recordings round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("poetry-rec"); });

  it("recording-save → recording-list → recording-get → recording-delete round-trips", async () => {
    const poem = await lensRun("poetry", "poem-create", { params: { title: "Spoken", body: "read this aloud" } }, ctx);
    const poemId = poem.result.poem.id;
    const save = await lensRun("poetry", "recording-save", {
      params: { poemId, audioDataUrl: "data:audio/webm;base64,AAAA", durationSec: 42, mimeType: "audio/webm" },
    }, ctx);
    assert.equal(save.result.recording.poemId, poemId);
    assert.equal(save.result.recording.durationSec, 42);
    const recId = save.result.recording.id;

    const list = await lensRun("poetry", "recording-list", { params: { poemId } }, ctx);
    assert.equal(list.result.recordings.some((r) => r.id === recId), true);

    const get = await lensRun("poetry", "recording-get", { params: { id: recId } }, ctx);
    // recording-get includes the heavy payload that recording-list omits.
    assert.equal(get.result.recording.audioDataUrl, "data:audio/webm;base64,AAAA");

    const del = await lensRun("poetry", "recording-delete", { params: { id: recId } }, ctx);
    assert.equal(del.result.deleted, recId);
  });

  it("recording-save: a non-data-URL audio payload is rejected", async () => {
    const poem = await lensRun("poetry", "poem-create", { params: { title: "Rejecter", body: "x" } }, ctx);
    const bad = await lensRun("poetry", "recording-save", {
      params: { poemId: poem.result.poem.id, audioDataUrl: "http://example.com/a.webm" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("data URL required"), true);
  });

  it("recording-save: an unknown poem id is rejected", async () => {
    const bad = await lensRun("poetry", "recording-save", { params: { poemId: "pm_nope", audioDataUrl: "data:audio/webm;base64,AA" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("poem not found"), true);
  });
});

describe("poetry — workshop share + critique (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("poetry-workshop"); });

  it("workshop-share → workshop-detail → workshop-critique round-trips with line-level notes", async () => {
    const poem = await lensRun("poetry", "poem-create", {
      params: { title: "Shared Work", body: "first line here\nsecond line here", form: "free-verse" },
    }, ctx);
    const share = await lensRun("poetry", "workshop-share", { params: { poemId: poem.result.poem.id, authorName: "Bard" } }, ctx);
    assert.equal(share.result.share.critiqueCount, 0);
    const shareId = share.result.share.id;

    const listed = await lensRun("poetry", "workshop-list", {}, ctx);
    assert.equal(listed.result.shares.some((s) => s.id === shareId), true);

    const crit = await lensRun("poetry", "workshop-critique", {
      params: { id: shareId, lineIndex: 0, comment: "strong opening image", kind: "praise", criticName: "Editor" },
    }, ctx);
    assert.equal(crit.result.critiqueCount, 1);
    assert.equal(crit.result.critique.kind, "praise");
    assert.equal(crit.result.critique.lineIndex, 0);

    const detail = await lensRun("poetry", "workshop-detail", { params: { id: shareId } }, ctx);
    assert.equal(detail.result.share.critiques.length, 1);
    assert.equal(detail.result.share.critiques[0].comment, "strong opening image");
  });

  it("workshop-critique: an empty comment is rejected", async () => {
    const poem = await lensRun("poetry", "poem-create", { params: { title: "Critiqued", body: "a line" } }, ctx);
    const share = await lensRun("poetry", "workshop-share", { params: { poemId: poem.result.poem.id } }, ctx);
    const bad = await lensRun("poetry", "workshop-critique", { params: { id: share.result.share.id, comment: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("comment required"), true);
  });

  it("workshop-share: an unknown poem id is rejected", async () => {
    const bad = await lensRun("poetry", "workshop-share", { params: { poemId: "pm_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("poem not found"), true);
  });

  it("workshop-unshare: only the owner can unshare; the owner succeeds", async () => {
    const poem = await lensRun("poetry", "poem-create", { params: { title: "Unshareable", body: "one line" } }, ctx);
    const share = await lensRun("poetry", "workshop-share", { params: { poemId: poem.result.poem.id } }, ctx);
    const shareId = share.result.share.id;
    // A different user cannot unshare it.
    const otherCtx = await depthCtx("poetry-workshop-other");
    const denied = await lensRun("poetry", "workshop-unshare", { params: { id: shareId } }, otherCtx);
    assert.equal(denied.result.ok, false);
    assert.equal(denied.result.error.includes("only the owner"), true);
    // The owner succeeds.
    const ok = await lensRun("poetry", "workshop-unshare", { params: { id: shareId } }, ctx);
    assert.equal(ok.result.unshared, shareId);
  });
});

describe("poetry — chapbook export (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("poetry-chapbook"); });

  it("chapbook-export: assembles finished poems into a manuscript + print-ready HTML", async () => {
    const a = await lensRun("poetry", "poem-create", { params: { title: "First Poem", body: "alpha line\nbeta line" } }, ctx);
    const b = await lensRun("poetry", "poem-create", { params: { title: "Second Poem", body: "gamma line" } }, ctx);
    await lensRun("poetry", "poem-update", { params: { id: a.result.poem.id, status: "finished" } }, ctx);
    await lensRun("poetry", "poem-update", { params: { id: b.result.poem.id, status: "finished" } }, ctx);

    const r = await lensRun("poetry", "chapbook-export", { params: { title: "My Chapbook", author: "A Poet" } }, ctx);
    assert.equal(r.result.chapbook.title, "My Chapbook");
    assert.equal(r.result.chapbook.author, "A Poet");
    assert.equal(r.result.chapbook.poemCount, 2);
    // totalLines = 2 (First) + 1 (Second) = 3.
    assert.equal(r.result.chapbook.totalLines, 3);
    assert.equal(r.result.chapbook.manuscript[0].order, 1);
    // HTML escapes + embeds the titles; filename slugifies the chapbook title.
    assert.equal(r.result.html.includes("My Chapbook"), true);
    assert.equal(r.result.html.includes("First Poem"), true);
    assert.equal(r.result.filename, "my-chapbook.html");
  });

  it("chapbook-export: explicit poemIds override the finished-only default", async () => {
    const a = await lensRun("poetry", "poem-create", { params: { title: "Draft Only", body: "still drafting" } }, ctx);
    // Status is draft, but explicit ids include it.
    const r = await lensRun("poetry", "chapbook-export", { params: { title: "Forced", poemIds: [a.result.poem.id] } }, ctx);
    assert.equal(r.result.chapbook.poemCount, 1);
    assert.equal(r.result.chapbook.manuscript[0].title, "Draft Only");
  });

  it("chapbook-export: with no finished poems selected is rejected", async () => {
    const empty = await depthCtx("poetry-chapbook-empty");
    await lensRun("poetry", "poem-create", { params: { title: "Unfinished", body: "x" } }, empty); // stays draft
    const bad = await lensRun("poetry", "chapbook-export", { params: { title: "Nothing" } }, empty);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.includes("no poems selected"), true);
  });
});
