// Upload body reader contract — the creative (a) fix return, half (i).
//
// readUploadRequest refused any raw upload whose Content-Type was
// text/plain, claiming a form/JSON body had been received. A raw
// .txt file IS text/plain, and the artifact store carries
// text/plain as a first-class artifact type — so text uploads could
// never succeed. The refusal now covers only genuine non-file
// bodies (JSON, form-encoded, missing type); every real file type,
// text included, reads as an upload.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readUploadRequest } from "../lib/multipart-body.js";

function fakeReq(body, contentType, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  return {
    headers: { ...(contentType ? { "content-type": contentType } : {}), ...headers },
    async *[Symbol.asyncIterator]() { if (buf.length) yield buf; },
  };
}

describe("readUploadRequest — raw bodies", () => {
  it("accepts a raw text file (text/plain is a file type, not a form)", async () => {
    const r = await readUploadRequest(fakeReq("harbour notes", "text/plain", {
      "x-filename": "notes.txt", "x-title": "notes.txt", "x-domain": "creative",
    }));
    assert.equal(r.ok, true);
    assert.equal(r.files.length, 1);
    assert.equal(r.files[0].contentType, "text/plain");
    assert.equal(r.files[0].filename, "notes.txt");
    assert.equal(r.files[0].buffer.toString("utf8"), "harbour notes");
    assert.equal(r.domain, "creative");
  });

  it("accepts a raw image body as before", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const r = await readUploadRequest(fakeReq(png, "image/png", { "x-filename": "a.png" }));
    assert.equal(r.ok, true);
    assert.equal(r.files[0].contentType, "image/png");
  });

  it("still refuses a JSON body, and the error describes it", async () => {
    const r = await readUploadRequest(fakeReq(JSON.stringify({ a: 1 }), "application/json"));
    assert.equal(r.ok, false);
    assert.match(r.error, /form or JSON body/);
  });

  it("still refuses a form-encoded body", async () => {
    const r = await readUploadRequest(fakeReq("a=1&b=2", "application/x-www-form-urlencoded"));
    assert.equal(r.ok, false);
  });

  it("refuses an empty body as empty", async () => {
    const r = await readUploadRequest(fakeReq("", "text/plain"));
    assert.equal(r.ok, false);
    assert.match(r.error, /empty/);
  });
});

describe("readUploadRequest — multipart bodies", () => {
  it("parses a multipart file field (unchanged behaviour)", async () => {
    const boundary = "----concordtest";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.txt"\r\nContent-Type: text/plain\r\n\r\nhello multipart\r\n--${boundary}--\r\n`,
    );
    const r = await readUploadRequest(fakeReq(body, `multipart/form-data; boundary=${boundary}`));
    assert.equal(r.ok, true);
    assert.equal(r.files.length, 1);
    assert.equal(r.files[0].filename, "clip.txt");
    assert.equal(r.files[0].buffer.toString("utf8"), "hello multipart");
  });
});
