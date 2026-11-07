// Source pins for the Commonsense build (branch (b): the capture
// journal). These read the shipped FE page and assert the shapes the
// slices require — the D3 relabel, the exceptions view, provenance
// lines, the dispute toggle, the two-step delete, and save
// acknowledgements. Behavioural proof for the server halves lives in
// commonsense-checks-build.test.js; the standing thread suite
// (commonsense-thread.test.tsx) pins the page's interaction contract,
// including the accessible names this build preserves.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const page = read("app/lenses/commonsense/page.tsx");

describe("S-CS-1(b) / D3 — the plain-voice relabel", () => {
  it("the lens carries its tagline under the title", () => {
    assert.ok(page.includes("State the obvious. Note the exception."));
    assert.ok(page.includes("you state it, you date it, you keep it"));
  });
  it("the empty state teaches the loop and states the product", () => {
    assert.ok(page.includes("The thread is empty."));
    // Branch (a)/D2 amended this line (B16, disclosed pin update):
    // the thread now answers from the user's own stated findings —
    // the copy states exactly that, and nothing more.
    assert.ok(page.includes("The thread answers from what you stated: your words, dated. Nothing else answers for you."));
    assert.ok(page.includes("Ask a question below. Then state the obvious answer, in your own words"));
  });
  it("no answering capability beyond the user's own thread is claimed", () => {
    assert.ok(!page.includes("Ask anything"));
    assert.ok(!/AI answers|engine answers/i.test(page));
  });
});

describe("Branch (a) / D2 — the thread answers, in your own words", () => {
  it("the ask act consults the thread's answers through check-answer", () => {
    assert.ok(page.includes("'check-answer'"));
    assert.ok(page.includes("data-testid=\"cs-answer\""));
    assert.ok(page.includes("From your thread"));
  });
  it("answers are stamped as the user's own words with their date", () => {
    assert.ok(page.includes("You stated the obvious"));
    assert.ok(page.includes("answerDate(item.statedAt)"));
  });
  it("a disputed finding renders contested, never settled", () => {
    assert.ok(page.includes("You disputed this finding"));
    assert.ok(page.includes("It stands contested, not settled."));
  });
  it("the exception rides the answer as its boundary", () => {
    assert.ok(page.includes("Its boundary, as you noted it:"));
  });
  it("a miss answers honestly and offers the capture step", () => {
    assert.ok(page.includes("data-testid=\"cs-answer-miss\""));
    assert.ok(page.includes("You have not stated the obvious on this yet"));
  });
});

describe("D1 — the exceptions view and the asterisk", () => {
  it("the view lists exactly the entries carrying exceptions, count stated", () => {
    assert.ok(page.includes("Where the obvious breaks"));
    assert.ok(page.includes("checks.filter((item) => item.exception).length"));
    assert.ok(page.includes("entry carries"));
  });
  it("the asterisk marks exception-carrying entries, aria-hidden, names preserved", () => {
    assert.ok(page.includes('aria-hidden="true"'));
    assert.ok(page.includes("This one has a boundary"));
    assert.ok(page.includes("aria-label={item.question}"));
  });
});

describe("S-CS-2 — assertion hygiene", () => {
  it("a duplicate ask opens the standing entry and says so", () => {
    assert.ok(page.includes("created.duplicate"));
    assert.ok(page.includes("Already in your thread — opened the standing entry instead of duplicating it."));
  });
  it("delete is two-step and fires only from the confirm", () => {
    assert.ok(page.includes("confirmDelete"));
    assert.ok(page.includes("'check-delete'"));
    assert.ok(page.includes("Delete?"));
    assert.ok(page.includes("Delete this entry"));
  });
  it("the dispute toggle rides check-flag and renders the marker", () => {
    assert.ok(page.includes("'check-flag'"));
    assert.ok(page.includes("Dispute this finding"));
    assert.ok(page.includes("disputed by you"));
  });
});

describe("S-CS-3 — provenance minimum", () => {
  it("findings and exceptions render their author and date", () => {
    assert.ok(page.includes("Stated by you"));
    assert.ok(page.includes("Noted by you"));
    assert.ok(page.includes("provenanceDate(selected, 'findingAt')"));
    assert.ok(page.includes("provenanceDate(selected, 'exceptionAt')"));
  });
  it("the detail read carries the provenance fields", () => {
    assert.ok(page.includes("findingAt: typeof body.findingAt === 'string'"));
    assert.ok(page.includes("flagged: body.flagged === true"));
  });
});

describe("S-CS-5 — saves acknowledge", () => {
  it("every verified save sets the quiet acknowledgement", () => {
    assert.ok(page.includes("setSavedNote('Question added.')"));
    assert.ok(page.includes("setSavedNote('Finding saved.')"));
    assert.ok(page.includes("setSavedNote('Exception saved.')"));
    assert.ok(page.includes("setSavedNote('Entry deleted.')"));
    assert.ok(page.includes('data-testid="cs-saved"'));
  });
});
