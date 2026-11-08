/**
 * Source-pin suite for the creative Library list (the (a) fix
 * return, half (ii)). The Library uploader fired correctly, but
 * nothing it uploaded could ever appear: the Library artifacts grid
 * was fed from contextDTUs — context.query, a relevance search over
 * the whole lattice in which a fresh upload (title = its filename)
 * cannot rank — and the hook's domain list underneath sent the lens
 * name as `scope`, which dtu.list reads as the visibility scope, so
 * no domain narrowing ever happened. The grid now lists the lens's
 * own domain DTUs (artifact-bearing), and the hook asks the list
 * endpoint for the domain by its `domain` param.
 *
 * Each pin is verified against the shipped source below.
 */
import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../app/lenses/creative/page.tsx"), "utf8");
const hook = readFileSync(join(here, "../hooks/useLensDTUs.ts"), "utf8");

describe("creative Library — the grid lists the lens's own uploads", () => {
  it("the page takes domainDTUs from useLensDTUs", () => {
    assert.ok(page.includes("domainDTUs, hyperDTUs, megaDTUs, regularDTUs,"));
  });

  it("the artifacts grid is built from the domain list, artifact-bearing only", () => {
    assert.ok(page.includes("const creativeArtifacts = domainDTUs.filter((d: DTU) => d.artifact);"));
  });

  it("the grid is NOT built from the relevance search anymore", () => {
    assert.ok(!page.includes("creativeDTUs.filter"));
    assert.ok(!page.includes("contextDTUs: creativeDTUs"));
  });

  it("the uploader still refetches on completion", () => {
    assert.ok(page.includes('onUploadComplete={() => refetchDTUs()}'));
  });
});

describe("useLensDTUs — the domain list asks for the domain", () => {
  it("the domain query sends the domain param", () => {
    assert.ok(hook.includes("params: { domain: domain ?? lens, limit },"));
  });

  it("the domain query no longer sends the lens name as a visibility scope", () => {
    assert.ok(!hook.includes("params: { scope: domain ?? lens, limit },"));
  });
});
