export interface Population {
  id: string;
  world_id: string;
  biome: string;
  species_id: string;
  lifestyle: string;
  current_count: number;
  topology?: string;
  clade?: string;
}

export interface LineageRow {
  child_id: string;
  parent_a: string | null;
  parent_b: string | null;
  generation: number;
  stability?: number;
  created_at?: number;
}

export interface BreedResult {
  ok: boolean;
  reason?: string;
  hybrid?: { id?: string; species_id?: string; topology?: string; massKg?: number; variant?: string | null };
  stability?: number;
  generation?: number;
}

export interface SpeciesRecord {
  species_id: string;
  clade: string;
  topology: string;
  diet: string;
  aquatic: boolean;
}

export interface TaxonomyLookup { clade: string; topology: string; diet: string }

export type CreaturesView = 'populations' | 'codex' | 'lineage';
