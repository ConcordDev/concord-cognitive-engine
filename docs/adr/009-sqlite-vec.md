# ADR 009: Local vector index via sqlite-vec

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Status     | Accepted                                               |
| Date       | 2026-06-22                                             |
| Authors    | Literary Resonance Lattice (LRL) initiative            |
| Supersedes | N/A                                                    |
| Scope      | server runtime dependency                               |

## Context

The Literary Resonance Lattice (LRL / Literary Lattice Shell) turns the
public-domain literary corpus into a queryable semantic substrate inside the DTU
lattice. Retrieval is hybrid: BM25 (SQLite FTS5) for sparse + dense embedding
similarity, fused with Reciprocal Rank Fusion. The dense half needs an
approximate-nearest-neighbour (ANN) index that scales past the ~thousands-of-rows
ceiling where a full in-memory cosine scan stops being acceptable (the corpus
target is 10k–20k high-value works → millions of chunks).

The existing embedding path (`server/embeddings.js`) already stores 768-dim
vectors and does an in-memory cosine rerank over a candidate set — fine for the
DTU corpus today, but not for a literary corpus an order of magnitude larger.
There is an *optional* Qdrant client in the tree, but standing up a Qdrant
service breaks the local-first/sovereign story (ADR 003) for this subsystem and
adds an external process to operate.

## Decision

Add **`sqlite-vec`** as a server runtime dependency and use its `vec0` virtual
table as the literary ANN index, living **inside the same `better-sqlite3` file**
as the rest of the substrate. This keeps LRL 100% local — no external vector
service, no new process, one file to back up — directly honouring ADR 003
(local-first sovereignty) and the existing single-process SQLite architecture.

`vec0` keys on an integer rowid, so the TEXT `dtu_id` rides as an auxiliary
column; upsert is delete-then-insert (vec0 has no native UPSERT). KNN is
`WHERE embedding MATCH ? AND k = ? ORDER BY distance`.

The integration is **behind a kill-switch and degrades gracefully**
(`server/lib/literary-vec.js`): `LRL_VECTOR_BACKEND` selects
`sqlite-vec` (default) | `blob-cosine` | `off`. If the loadable extension cannot
be loaded for any reason, `ensureVec()` returns false and every caller falls back
to the existing `embedding_cache` + `cosineSimilarity` scan. Nothing in LRL
*requires* sqlite-vec to function — search still works (keyword + in-memory dense
fallback); sqlite-vec is purely the scale optimisation. This bounds the
operational and supply-chain risk: a problem with the native extension never
takes the feature down, only its scale ceiling.

## Why not the alternatives

- **Qdrant (already vendored as optional):** breaks local-first sovereignty for
  this subsystem (external service + process), heavier to operate, and
  unnecessary at the MVP corpus size. Left available for users who *want* an
  external ANN via the existing `VECTOR_DB=qdrant` path; LRL doesn't depend on it.
- **FAISS:** index-only — no persistence, CRUD, or metadata; we'd hand-roll
  on-disk persistence and the join back to SQLite. sqlite-vec gives persistence +
  the SQL join for free.
- **Keep the in-memory cosine scan only:** correct and dependency-free, but O(n)
  per query; it's the *fallback*, not the scale answer. Capped at
  `LRL_DENSE_SCAN_CAP` (4000) today.

## Consequences

- One new native dependency (`sqlite-vec`, MIT). It is loaded lazily and only
  touched by the literary subsystem; the rest of the server is unaffected and the
  extension is never required to boot.
- Embeddings are written to both `embedding_cache` (the existing store) and the
  `literary_vec` index at ingest time, so the two stay consistent and either can
  serve dense retrieval.
- Re-embedding / dimension changes require rebuilding the `vec0` table (fixed dim
  at creation); handled as a Phase-3 re-embedding job when the embedding model is
  swapped (`EMBEDDING_MODEL`).
