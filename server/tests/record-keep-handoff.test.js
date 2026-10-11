// Board card detail, Goals detail, and TheVault submissions:
// create the record, keep it as a private DTU, GET /api/dtus/:id as the
// owner, then open a Thread draft that cites that DTU.
//
// GET /api/dtus/:id is the route in server/routes/dtus.js. It calls
// runMacro("dtu","get") and returns that body. This file mounts that route.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { lensRun, depthCtx, load } from "./depth/_harness.js";
import registerDtuRoutes from "../routes/dtus.js";

let http;

before(async () => {
  const { STATE, makeCtx, runMacro } = await load();
  http = await startHttp({ STATE, makeCtx, runMacro });
});

after(async () => {
  if (http) await http.close();
});

function summaryHasRecord(dtu, ...bits) {
  const summary = String(dtu?.human?.summary || "");
  const notes = String(dtu?.machine?.notes || "");
  const blob = `${summary}\n${notes}`;
  for (const bit of bits) assert.match(blob, new RegExp(bit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(/lorem|placeholder|Untitled DTU/i.test(blob), false);
}

async function keepAndRead(ctx, params, bits) {
  const created = await lensRun("dtu", "create", { params }, ctx);
  assert.equal(created.ok, true, "dtu.create should succeed");
  assert.equal(created.result?.ok, true, created.result?.error || "dtu.create refused");
  const dtuId = created.result.dtu.id;
  assert.ok(dtuId);

  const me = ctx.actor.userId;
  const ownerGet = await http.get(`/api/dtus/${dtuId}`, { userId: me });
  assert.equal(ownerGet.status, 200, JSON.stringify(ownerGet.body));
  assert.equal(ownerGet.body.dtu.id, dtuId);
  assert.equal(ownerGet.body.dtu.ownerId, me, "GET /api/dtus/:id owner must be the caller");
  assert.equal(ownerGet.body.dtu.visibility, "private");
  summaryHasRecord(ownerGet.body.dtu, ...bits);

  const accountB = await http.get(`/api/dtus/${dtuId}`, { userId: "account-b" });
  assert.equal(accountB.status, 404, "account B must not read a private DTU");
  const anon = await http.get(`/api/dtus/${dtuId}`);
  assert.equal(anon.status, 404);

  const content = `${params.human.summary}\n\nDTU ${dtuId}`;
  const drafted = await lensRun("thread", "thread-draft", {
    params: {
      title: params.title,
      content,
      platform: "x",
      citedDtuId: dtuId,
    },
  }, ctx);
  assert.equal(drafted.ok, true, "thread-draft should succeed");
  const draft = drafted.result.draft;
  assert.equal(draft.status, "draft");
  assert.equal(draft.citedDtuId, dtuId);
  assert.match(draft.content, new RegExp(dtuId));
  for (const bit of bits) assert.match(draft.content, new RegExp(bit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const back = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
  assert.equal(back.ok, true);
  assert.equal(back.result.draft.citedDtuId, dtuId);
  assert.match(back.result.draft.content, new RegExp(dtuId));
  assert.equal(back.result.draft.status, "draft");
  return dtuId;
}

describe("board card detail keep", () => {
  it("creates a card, keeps it, GET /api/dtus/:id is owned by me with the card fields, and the Thread draft cites it", async () => {
    const ctx = await depthCtx("board-card-keep");
    const created = await lensRun("board", "board-create", { params: { name: "Proof Board" } }, ctx);
    assert.equal(created.ok, true);
    const board = created.result.board;
    const column = board.columns[0];
    const cardR = await lensRun("board", "card-create", {
      params: {
        boardId: board.id,
        columnId: column.id,
        title: "Proof card",
        description: "Ship the checklist",
        labels: ["frontend"],
        dueDate: "2026-11-01",
        assignee: "alex",
      },
    }, ctx);
    assert.equal(cardR.ok, true);
    const detail = await lensRun("board", "card-detail", {
      params: { boardId: board.id, cardId: cardR.result.card.id },
    }, ctx);
    assert.equal(detail.ok, true);
    const card = detail.result.card;
    assert.equal(card.title, "Proof card");
    assert.equal(card.description, "Ship the checklist");

    const summary = [
      card.title,
      `Card ${card.id}`,
      `Board: ${board.name} (${board.id})`,
      `Column: ${column.name}`,
      `Description: ${card.description}`,
      `Due: ${card.dueDate}`,
      `Assignee: ${card.assignee}`,
      `Labels: ${(card.labels || []).join(", ")}`,
    ].join("\n");

    await keepAndRead(ctx, {
      title: card.title,
      tags: ["board", "card"],
      source: "board-lens:card",
      visibility: "private",
      content: summary,
      human: { summary },
      core: { definitions: [card.title], claims: [summary.slice(0, 240)] },
      machine: {
        kind: "board_card",
        cardId: card.id,
        title: card.title,
        boardId: board.id,
        boardName: board.name,
        columnId: column.id,
        columnName: column.name,
        description: card.description,
        dueDate: card.dueDate,
        assignee: card.assignee,
        labels: card.labels,
      },
      meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "board" },
    }, ["Proof card", "Ship the checklist", column.name, "alex"]);
  });
});

describe("goals detail keep", () => {
  it("creates a goal, keeps it, GET /api/dtus/:id is owned by me with the goal fields, and the Thread draft cites it", async () => {
    const ctx = await depthCtx("goals-detail-keep");
    const created = await lensRun("lens", "create", {
      params: {
        domain: "goals",
        type: "goal",
        title: "Ship the vault",
        data: {
          title: "Ship the vault",
          description: "Move three records into Thread.",
          category: "Career",
          progress: 0.5,
          priority: "high",
          targetDate: "2026-12-01",
          subtasks: [{ id: "st-0", label: "Write keep", done: false }],
          xp: 200,
          milestones: [],
          status: "active",
        },
      },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    const artifact = created.result.artifact;
    assert.ok(artifact?.id, "lens.create should return the goal");
    assert.equal(artifact.ownerId, ctx.actor.userId);

    const got = await lensRun("lens", "get", { params: { id: artifact.id } }, ctx);
    assert.equal(got.ok, true);
    const goal = { id: got.result.artifact.id, ...got.result.artifact.data };
    assert.equal(goal.title, "Ship the vault");
    assert.equal(goal.description, "Move three records into Thread.");

    const summary = [
      goal.title,
      `Goal ${goal.id}`,
      `Description: ${goal.description}`,
      `Category: ${goal.category}`,
      `Priority: ${goal.priority}`,
      `Status: ${goal.status}`,
      "Progress: 50%",
      `Target: ${goal.targetDate}`,
      "Steps:",
      "- [ ] Write keep",
    ].join("\n");

    const dtuId = await keepAndRead(ctx, {
      title: goal.title,
      tags: ["goals", "goal"],
      source: "goals-lens:goal",
      visibility: "private",
      content: summary,
      human: { summary },
      core: { definitions: [goal.title], claims: [summary.slice(0, 240)] },
      machine: {
        kind: "goal",
        goalId: goal.id,
        title: goal.title,
        description: goal.description,
        category: goal.category,
        priority: goal.priority,
        status: goal.status,
        progress: goal.progress,
        targetDate: goal.targetDate,
        steps: [{ label: "Write keep", done: false }],
      },
      meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "goals" },
    }, ["Ship the vault", "Move three records into Thread.", "Write keep", "Progress: 50%"]);

    const { runMacro } = await load();
    const read = await runMacro("dtu", "get", { id: dtuId }, ctx);
    assert.equal(read.dtu.machine.goalId, goal.id);
    assert.equal(read.dtu.machine.description, goal.description);
  });
});

describe("saved item keep", () => {
  it("saves an item, keeps it, GET /api/dtus/:id is owned by me with the item fields, account B gets 404, and the Thread draft cites it", async () => {
    const ctx = await depthCtx("saved-item-keep");
    const added = await lensRun("saved", "add", {
      params: {
        kind: "article",
        title: "Concord paper",
        author: "Ada",
        url: "https://example.com/concord",
        excerpt: "the actual excerpt",
        note: "why I kept it",
        tags: ["research"],
        sourceLens: "paper",
      },
    }, ctx);
    assert.equal(added.ok, true, JSON.stringify(added));
    const item = added.result.item || added.result.result?.item;
    assert.ok(item?.id, "saved.add should return the item");
    assert.equal(item.title, "Concord paper");
    assert.equal(item.excerpt, "the actual excerpt");

    const listed = await lensRun("saved", "list", { params: {} }, ctx);
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const rows = listed.result.items || listed.result.result?.items || [];
    const row = rows.find((s) => s.id === item.id);
    assert.ok(row, "saved.list should return the item");
    assert.equal(row.note, "why I kept it");

    const summary = [
      row.title,
      `Saved ${row.id}`,
      `Kind: ${row.kind}`,
      `Author: ${row.author}`,
      `URL: ${row.url}`,
      `Excerpt: ${row.excerpt}`,
      `Note: ${row.note}`,
      `Tags: ${(row.tags || []).join(", ")}`,
      `State: ${row.state}`,
      `Via: ${row.sourceLens}`,
    ].join("\n");

    const dtuId = await keepAndRead(ctx, {
      title: row.title,
      tags: ["saved", "item"],
      source: "saved-lens:item",
      visibility: "private",
      content: summary,
      human: { summary },
      core: { definitions: [row.title], claims: [summary.slice(0, 240)] },
      machine: {
        kind: "saved_item",
        itemId: row.id,
        title: row.title,
        itemKind: row.kind,
        author: row.author,
        url: row.url,
        excerpt: row.excerpt,
        note: row.note,
        tags: row.tags,
        state: row.state,
        sourceLens: row.sourceLens,
        refId: row.refId,
      },
      meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "saved" },
    }, ["Concord paper", "the actual excerpt", "why I kept it", "Ada"]);

    const { runMacro } = await load();
    const read = await runMacro("dtu", "get", { id: dtuId }, ctx);
    assert.equal(read.dtu.machine.itemId, row.id);
    assert.equal(read.dtu.machine.excerpt, row.excerpt);
  });
});

describe("paper item keep", () => {
  it("saves a paper, keeps it, GET /api/dtus/:id is owned by me with the paper fields, account B gets 404, and the Thread draft cites it", async () => {
    const ctx = await depthCtx("paper-item-keep");
    const saved = await lensRun("paper", "paper-save", {
      params: {
        title: "Night methods",
        authors: ["Ada"],
        year: 2024,
        venue: "Vault",
        abstract: "the actual abstract",
        doi: "10.1000/night",
      },
    }, ctx);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const created = saved.result.paper || saved.result.result?.paper;
    assert.ok(created?.id, "paper-save should return the paper");

    const detail = await lensRun("paper", "paper-detail", { params: { id: created.id } }, ctx);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    const paper = detail.result.paper || detail.result.result?.paper;
    assert.equal(paper.title, "Night methods");
    assert.equal(paper.abstract, "the actual abstract");
    assert.equal(paper.doi, "10.1000/night");

    const summary = [
      paper.title,
      `Paper ${paper.id}`,
      `Authors: ${(paper.authors || []).join(", ")}`,
      `Year: ${paper.year}`,
      `Venue: ${paper.venue}`,
      `DOI: ${paper.doi}`,
      `Status: ${paper.status}`,
      `Abstract: ${paper.abstract}`,
    ].join("\n");

    const dtuId = await keepAndRead(ctx, {
      title: paper.title,
      tags: ["paper", "library"],
      source: "paper-lens:paper",
      visibility: "private",
      content: summary,
      human: { summary },
      core: { definitions: [paper.title], claims: [summary.slice(0, 240)] },
      machine: {
        kind: "paper",
        paperId: paper.id,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        status: paper.status,
        abstract: paper.abstract,
        notes: paper.notes,
        tags: paper.tags,
      },
      meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "paper" },
    }, ["Night methods", "the actual abstract", "10.1000/night", "Ada"]);

    const { runMacro } = await load();
    const read = await runMacro("dtu", "get", { id: dtuId }, ctx);
    assert.equal(read.dtu.machine.paperId, paper.id);
    assert.equal(read.dtu.machine.abstract, paper.abstract);
  });
});

describe("vault submission keep", () => {
  it("submits a work, keeps it, GET /api/dtus/:id is owned by me with the submission fields, and the Thread draft cites it", async () => {
    const ctx = await depthCtx("vault-submission-keep");
    const submitted = await lensRun("vault", "submit", {
      params: {
        title: "Night tape",
        workKind: "writing",
        description: "A quiet piece.",
        body: "the actual text of the piece",
      },
    }, ctx);
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    const id = submitted.result.id;
    assert.ok(id);

    const mine = await lensRun("vault", "my_submissions", { params: {} }, ctx);
    assert.equal(mine.ok, true, JSON.stringify(mine));
    const row = (mine.result.submissions || []).find((s) => s.id === id);
    assert.ok(row, "my_submissions should return the work");
    assert.equal(row.title, "Night tape");
    assert.equal(row.workKind, "writing");
    assert.equal(row.status, "submitted");
    assert.equal(row.description, "A quiet piece.");
    assert.equal(row.body, "the actual text of the piece");

    const summary = [
      row.title,
      `Submission ${row.id}`,
      `Kind: ${row.workKind}`,
      `Status: ${row.status}`,
      `Description: ${row.description}`,
      "Work:",
      row.body,
    ].join("\n");

    await keepAndRead(ctx, {
      title: row.title,
      tags: ["vault", "submission"],
      source: "vault-lens:submission",
      visibility: "private",
      content: summary,
      human: { summary },
      core: { definitions: [row.title], claims: [summary.slice(0, 240)] },
      machine: {
        kind: "vault_submission",
        submissionId: row.id,
        title: row.title,
        status: row.status,
        workKind: row.workKind,
        description: row.description,
        body: row.body,
        submittedAt: row.submittedAt,
      },
      meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "vault" },
    }, ["Night tape", "A quiet piece.", "the actual text of the piece", "writing"]);
  });
});

async function startHttp({ STATE, makeCtx, runMacro }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user");
    if (uid) req.user = { id: uid, role: "member" };
    next();
  });
  const passthrough = () => (_req, _res, next) => next();
  registerDtuRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    dtuForClient: (d) => d,
    dtusArray: () => [...STATE.dtus.values()],
    userVisibleDTUs: () => [],
    _withAck: (out) => out,
    _saveStateDebounced: () => {},
    validate: passthrough,
    requireRole: () => passthrough(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;
  async function get(path, opts = {}) {
    const headers = {};
    if (opts.userId) headers["x-test-user"] = opts.userId;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  }
  return { get, close: () => new Promise((resolve) => server.close(resolve)) };
}
