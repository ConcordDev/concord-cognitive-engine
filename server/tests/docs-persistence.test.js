// server/tests/docs-persistence.test.js
//
// Tier-2 contract tests for Docs Sprint A — DB substrate (migration
// 211). Real SQLite, real CRUD round-trip, real role enforcement,
// real version snapshot + restore, real backlink derivation, real
// comment threading, real soft-delete + restore.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createDocument, getDocument, getDocumentBySlug, updateDocument,
  softDelete, restore, listForOwner, listChildren,
  snapshotVersion, listVersions, restoreVersion,
  addComment, listComments, resolveComment,
  getRole, hasRole, inviteCollaborator, revokeCollaborator, listCollaborators,
  listOutgoingLinks, listIncomingLinks,
  recordAttachment, listAttachments, searchUserDocs,
} from "../lib/docs/persistence.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/211_documents.js");
  mig.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("docs-persistence: CRUD", () => {
  it("createDocument writes a row + auto-owner collaborator", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "First doc", contentHtml: "<p>Hello</p>" });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("doc:"));
    assert.equal(getRole(db, r.id, "u_alice"), "owner");
    const row = getDocument(db, r.id);
    assert.equal(row.title, "First doc");
    assert.equal(row.content_html, "<p>Hello</p>");
    assert.equal(row.word_count, 1);
  });

  it("createDocument trims oversize title to 240 chars", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "x".repeat(500) });
    const row = getDocument(db, r.id);
    assert.equal(row.title.length, 240);
  });

  it("updateDocument with new contentHtml refreshes md + word_count", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "Edit me" });
    const u = updateDocument(db, r.id, { contentHtml: "<p>One two three four</p>" });
    assert.equal(u.ok, true);
    assert.equal(u.row.word_count, 4);
    assert.ok((u.row.content_md || "").includes("One two three four"));
  });

  it("softDelete hides from getDocument and list", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "Will die" });
    softDelete(db, r.id, "u_alice");
    assert.equal(getDocument(db, r.id), null);
    const list = listForOwner(db, "u_alice");
    assert.ok(!list.find((d) => d.id === r.id));
  });

  it("restore brings back a soft-deleted doc", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "Recoverable" });
    softDelete(db, r.id, "u_alice");
    restore(db, r.id, "u_alice");
    assert.ok(getDocument(db, r.id));
  });

  it("non-owner cannot softDelete", () => {
    const r = createDocument(db, { ownerId: "u_alice", title: "Mine" });
    const del = softDelete(db, r.id, "u_mallory");
    assert.equal(del.ok, false);
    assert.equal(del.reason, "forbidden");
  });
});

describe("docs-persistence: page tree", () => {
  it("parent + child relationships round-trip", () => {
    const parent = createDocument(db, { ownerId: "u_bob", title: "Parent" });
    const child = createDocument(db, { ownerId: "u_bob", title: "Child", parentId: parent.id });
    const children = listChildren(db, parent.id);
    assert.equal(children.length, 1);
    assert.equal(children[0].id, child.id);
  });
});

describe("docs-persistence: versions", () => {
  let docId;
  before(() => {
    const r = createDocument(db, { ownerId: "u_versions", title: "V0", contentHtml: "<p>v0</p>" });
    docId = r.id;
  });

  it("snapshotVersion creates a row", () => {
    const r = snapshotVersion(db, { documentId: docId, authorId: "u_versions", reason: "manual" });
    assert.equal(r.ok, true);
    const vs = listVersions(db, docId);
    assert.ok(vs.length >= 1);
  });

  it("restoreVersion swaps content + creates pre-restore snapshot", () => {
    const initialVersions = listVersions(db, docId).length;
    updateDocument(db, docId, { contentHtml: "<p>v1</p>" });
    snapshotVersion(db, { documentId: docId, authorId: "u_versions" });
    updateDocument(db, docId, { contentHtml: "<p>v2</p>" });
    const all = listVersions(db, docId);
    // restore to the v1 snapshot
    const v1Snap = all.find((v) => v.id !== all[0].id);
    const restored = restoreVersion(db, { documentId: docId, versionId: v1Snap.id, actorId: "u_versions" });
    assert.equal(restored.ok, true);
    const after = listVersions(db, docId);
    assert.ok(after.length > initialVersions, "restore created a pre-restore snapshot");
  });

  it("restoreVersion forbidden for non-editor", () => {
    const all = listVersions(db, docId);
    const r = restoreVersion(db, { documentId: docId, versionId: all[0].id, actorId: "u_outsider" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("docs-persistence: comments", () => {
  let docId;
  before(() => {
    const r = createDocument(db, { ownerId: "u_cmt", title: "Comments doc" });
    docId = r.id;
  });

  it("addComment writes a comment with self thread_id", () => {
    const r = addComment(db, { documentId: docId, authorId: "u_cmt", body: "First comment" });
    assert.equal(r.ok, true);
    assert.equal(r.threadId, r.id);
    const list = listComments(db, docId);
    assert.equal(list.length, 1);
  });

  it("addComment with threadId nests under existing thread", () => {
    const root = addComment(db, { documentId: docId, authorId: "u_cmt", body: "Root" });
    const reply = addComment(db, { documentId: docId, authorId: "u_cmt", body: "Reply", threadId: root.id });
    assert.equal(reply.threadId, root.id);
  });

  it("addComment forbidden for viewer-only", () => {
    inviteCollaborator(db, { documentId: docId, userId: "u_viewer", role: "viewer", invitedBy: "u_cmt" });
    const r = addComment(db, { documentId: docId, authorId: "u_viewer", body: "Hi" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("resolveComment marks resolved and gates by editor role", () => {
    const c = addComment(db, { documentId: docId, authorId: "u_cmt", body: "Resolveable" });
    const denied = resolveComment(db, { commentId: c.id, actorId: "u_viewer" });
    assert.equal(denied.ok, false);
    const ok = resolveComment(db, { commentId: c.id, actorId: "u_cmt" });
    assert.equal(ok.ok, true);
    const filtered = listComments(db, docId, { onlyUnresolved: true });
    assert.ok(!filtered.find((x) => x.id === c.id));
  });
});

describe("docs-persistence: collaborators + roles", () => {
  let docId;
  before(() => {
    const r = createDocument(db, { ownerId: "u_owner", title: "Shared" });
    docId = r.id;
  });

  it("inviteCollaborator gates by admin role", () => {
    const stranger = inviteCollaborator(db, { documentId: docId, userId: "u_x", role: "editor", invitedBy: "u_random" });
    assert.equal(stranger.ok, false);
    const okR = inviteCollaborator(db, { documentId: docId, userId: "u_editor", role: "editor", invitedBy: "u_owner" });
    assert.equal(okR.ok, true);
    assert.equal(getRole(db, docId, "u_editor"), "editor");
  });

  it("hasRole respects rank ordering", () => {
    assert.equal(hasRole(db, docId, "u_owner", "viewer"), true);
    assert.equal(hasRole(db, docId, "u_editor", "viewer"), true);
    assert.equal(hasRole(db, docId, "u_editor", "admin"), false);
  });

  it("revokeCollaborator cannot remove owner", () => {
    const tryRevoke = revokeCollaborator(db, { documentId: docId, userId: "u_owner", actorId: "u_owner" });
    assert.equal(tryRevoke.revoked, 0);
  });

  it("public visibility grants viewer to anyone", () => {
    updateDocument(db, docId, { visibility: "public", slug: "shared-doc" });
    assert.equal(getRole(db, docId, "u_random_stranger"), "viewer");
    const bySlug = getDocumentBySlug(db, "shared-doc");
    assert.ok(bySlug);
    assert.equal(bySlug.id, docId);
  });
});

describe("docs-persistence: backlinks", () => {
  it("updateDocument extracts doc: + dtu: + external href references", () => {
    const a = createDocument(db, { ownerId: "u_link", title: "Source", contentHtml: "" });
    const b = createDocument(db, { ownerId: "u_link", title: "Target" });
    const html =
      `<p><a href="${b.id}">target</a> and ` +
      `<a href="dtu:abc123">cite</a> and ` +
      `<a href="/lenses/whiteboard/xyz">board</a> and ` +
      `<a href="https://example.com">external</a></p>`;
    updateDocument(db, a.id, { contentHtml: html });
    const out = listOutgoingLinks(db, a.id);
    assert.ok(out.length >= 4, `expected >=4 outgoing links, got ${out.length}`);
    const incoming = listIncomingLinks(db, b.id);
    assert.equal(incoming.length, 1, "doc->doc link surfaces as incoming");
    assert.equal(incoming[0].source_doc_id, a.id);
  });
});

describe("docs-persistence: attachments", () => {
  it("recordAttachment + listAttachments round-trip", () => {
    const d = createDocument(db, { ownerId: "u_att", title: "With image" });
    const att = recordAttachment(db, {
      documentId: d.id, uploaderId: "u_att", kind: "image",
      url: "/api/docs-asset/dimg_test", byteSize: 1024, mimeType: "image/png",
    });
    assert.equal(att.ok, true);
    const list = listAttachments(db, d.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].mime_type, "image/png");
  });

  it("recordAttachment forbidden for viewer", () => {
    const d = createDocument(db, { ownerId: "u_att", title: "Locked" });
    inviteCollaborator(db, { documentId: d.id, userId: "u_v", role: "viewer", invitedBy: "u_att" });
    const r = recordAttachment(db, {
      documentId: d.id, uploaderId: "u_v", kind: "image", url: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("docs-persistence: search", () => {
  it("searchUserDocs returns substring matches on title + body", () => {
    createDocument(db, { ownerId: "u_search", title: "Apples and Oranges", contentHtml: "<p>fruit basket</p>" });
    createDocument(db, { ownerId: "u_search", title: "Banana split", contentHtml: "<p>dessert recipe</p>" });
    const r1 = searchUserDocs(db, { ownerId: "u_search", query: "apple" });
    assert.ok(r1.length >= 1);
    const r2 = searchUserDocs(db, { ownerId: "u_search", query: "fruit" });
    assert.ok(r2.length >= 1, "search hits markdown body");
    const r3 = searchUserDocs(db, { ownerId: "u_search", query: "xyzNeverAppears" });
    assert.equal(r3.length, 0);
  });
});

describe("docs-persistence: slug uniqueness", () => {
  it("publish with conflicting slug returns slug_taken", () => {
    const a = createDocument(db, { ownerId: "u_slug", title: "A" });
    const b = createDocument(db, { ownerId: "u_slug", title: "B" });
    const ok1 = updateDocument(db, a.id, { visibility: "public", slug: "shared-slug-test" });
    assert.equal(ok1.ok, true);
    const dup = updateDocument(db, b.id, { visibility: "public", slug: "shared-slug-test" });
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "slug_taken");
  });
});
