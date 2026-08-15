/**
 * Migration 407 — Lexicon Nodes + Semantic Vectors
 *
 * Sprint 33 Phase 2: CSL (Concord Semantic Language) substrate.
 * Builds the quad-mode retrieval lattice: lexicon_nodes stores canonical terms
 * with semantic classification; semantic_vectors maps embeddings to INT4 lattice coords.
 *
 * IMPORTANT: The INT4 lattice is a **recall-redundant pre-filter**, not authoritative.
 * Dense embeddings (embeddings_e5) remain the source of truth. Lattice is an
 * optimization for spatial adjacency queries (cite risk register Q2).
 *
 * Spec: docs/SPRINT-33-CSL-PLAN.md §2.1 (lexicon_nodes), §2.2 (semantic_vectors)
 */

export function up(db) {
  db.exec(`
    -- Lexicon: canonical semantic terms (system-invariant vocabulary)
    CREATE TABLE IF NOT EXISTS lexicon_nodes (
      node_id BIGSERIAL PRIMARY KEY,
      canonical_term VARCHAR(255) UNIQUE NOT NULL,
      part_of_speech VARCHAR(32) NOT NULL,
      semantic_class VARCHAR(64) NOT NULL,
      is_system_invariant BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_lexicon_pos_class
      ON lexicon_nodes(part_of_speech, semantic_class);
    CREATE INDEX IF NOT EXISTS idx_lexicon_term
      ON lexicon_nodes(canonical_term);

    -- Semantic vectors: embeddings mapped to INT4 lattice coordinates
    -- Lattice bounds: 24-bit signed INT4 range (-8,388,608 to +8,388,607)
    CREATE TABLE IF NOT EXISTS semantic_vectors (
      vector_id BIGSERIAL PRIMARY KEY,
      node_id BIGINT NOT NULL REFERENCES lexicon_nodes(node_id) ON DELETE CASCADE,
      lattice_x INT4 NOT NULL,
      lattice_y INT4 NOT NULL,
      lattice_z INT4 NOT NULL,
      category_codebook_id INT2 NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      valid_to TIMESTAMPTZ,
      CHECK (lattice_x BETWEEN -8388608 AND 8388607),
      CHECK (lattice_y BETWEEN -8388608 AND 8388607),
      CHECK (lattice_z BETWEEN -8388608 AND 8388607)
    );

    -- Unique partial index: one active vector per node (valid_to IS NULL)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_node_temporal
      ON semantic_vectors(node_id)
      WHERE valid_to IS NULL;

    -- Spatial lattice cube: adjacency lookups
    CREATE INDEX IF NOT EXISTS idx_spatial_lattice_cube
      ON semantic_vectors(lattice_x, lattice_y, lattice_z);
    CREATE INDEX IF NOT EXISTS idx_semantic_codebook
      ON semantic_vectors(category_codebook_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_semantic_codebook;
    DROP INDEX IF EXISTS idx_spatial_lattice_cube;
    DROP INDEX IF EXISTS idx_semantic_node_temporal;
    DROP TABLE IF EXISTS semantic_vectors;
    DROP INDEX IF EXISTS idx_lexicon_term;
    DROP INDEX IF EXISTS idx_lexicon_pos_class;
    DROP TABLE IF EXISTS lexicon_nodes;
  `);
}
