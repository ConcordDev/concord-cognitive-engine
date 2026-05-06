// DTU (Discrete Thought Unit) types

export type DTUTier = 'regular' | 'mega' | 'hyper' | 'shadow' | 'archive';

/**
 * The four documented layers a DTU can carry (CLAUDE.md "DTU substrate"):
 *   - human    — readable summary (TLDR, bullets, narrative for UI)
 *   - core     — structured claims/definitions/invariants for retrieval
 *   - machine  — tags, embeddings, verifier hashes for indexing
 *   - artifact — optional binary metadata (the bytes live at ./data/artifacts/{dtuId}/)
 *   - creti    — Composition / Resonance / Engagement / Trust / Influence
 *                scores produced by the resonance engine.
 *   - cretiHuman — natural-language explanation of the CRETI score for UI display.
 *
 * Every layer is OPTIONAL — older DTUs predate one or more layers; consumers
 * must null-check before reading. Producers (server/economy/dtu-pipeline.js,
 * server/lib/forge.js) populate them as data becomes available.
 *
 * Layer fields use index-signature `[key: string]: unknown` so server-side
 * additions don't require a TS update for non-load-bearing fields. The
 * documented fields are typed strictly; everything else is escape-hatched.
 */
export interface DTUHumanLayer {
  summary?: string;
  tldr?: string;
  bullets?: string[];
  narrative?: string;
  question?: string;
  answer?: string;
  [key: string]: unknown;
}

export interface DTUCoreLayer {
  claims?: string[];
  // Definitions: server emits an array of definition strings
  // (each "term: meaning"); leaving as string[] matches the wire shape.
  definitions?: string[];
  invariants?: string[];
  contradictions?: string[];
  examples?: string[];
  [key: string]: unknown;
}

export interface DTUMachineLayer {
  tags?: string[];
  embedding?: number[];
  verifier?: string;
  [key: string]: unknown;
}

export interface DTUArtifactLayer {
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  storageUri?: string;
  [key: string]: unknown;
}

export interface DTUCretiScores {
  composition?: number;
  resonance?: number;
  engagement?: number;
  trust?: number;
  influence?: number;
  total?: number;
  [key: string]: unknown;
}

export interface DTU {
  id: string;
  tier: DTUTier;
  content: string;
  summary: string;
  timestamp: string;
  updatedAt?: string;

  // Four-layer substrate (see types above). Each is optional — a freshly
  // forged DTU may only have `human`; a fully-processed one has all four
  // plus creti scoring.
  human?: DTUHumanLayer;
  core?: DTUCoreLayer;
  machine?: DTUMachineLayer;
  artifact?: DTUArtifactLayer;
  creti?: DTUCretiScores;
  cretiHuman?: string;

  // Display helper populated server-side for some queries.
  primaryType?: string;

  // Relationships
  parentId?: string;
  childIds?: string[];
  relatedIds?: string[];

  // Metrics
  resonance?: number;
  coherence?: number;
  stability?: number;

  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;

  // Governance
  ownerId?: string;
  permissions?: DTUPermissions;
}

export interface DTUPermissions {
  read: string[];
  write: string[];
  delete: string[];
  promote: string[];
}

export interface DTULineage {
  dtu: DTU;
  ancestors: DTU[];
  descendants: DTU[];
  depth: number;
}

export interface DTUCreateInput {
  content: string;
  tier?: DTUTier;
  parentId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DTUUpdateInput {
  content?: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DTUPromoteInput {
  targetTier: DTUTier;
  reason?: string;
}

export interface DTUSearchParams {
  query?: string;
  tier?: DTUTier | DTUTier[];
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'resonance' | 'coherence';
  sortOrder?: 'asc' | 'desc';
}

export interface DTUSearchResult {
  dtus: DTU[];
  total: number;
  hasMore: boolean;
}

// Tier configuration
export const DTU_TIER_CONFIG: Record<
  DTUTier,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    minResonance: number;
    maxChildren: number;
  }
> = {
  regular: {
    label: 'Regular',
    color: 'text-neon-blue',
    bgColor: 'bg-neon-blue/10',
    borderColor: 'border-neon-blue/30',
    minResonance: 0,
    maxChildren: 10,
  },
  mega: {
    label: 'Mega',
    color: 'text-neon-purple',
    bgColor: 'bg-neon-purple/10',
    borderColor: 'border-neon-purple/30',
    minResonance: 0.5,
    maxChildren: 50,
  },
  hyper: {
    label: 'Hyper',
    color: 'text-neon-pink',
    bgColor: 'bg-neon-pink/10',
    borderColor: 'border-neon-pink/30',
    minResonance: 0.8,
    maxChildren: 100,
  },
  shadow: {
    label: 'Shadow',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/30',
    minResonance: 0,
    maxChildren: 5,
  },
  archive: {
    label: 'Archive',
    color: 'text-gray-500',
    bgColor: 'bg-gray-600/10',
    borderColor: 'border-gray-600/30',
    minResonance: 0,
    maxChildren: 0,
  },
};

export function canPromote(currentTier: DTUTier, targetTier: DTUTier): boolean {
  const tierOrder: DTUTier[] = ['regular', 'mega', 'hyper'];
  const currentIndex = tierOrder.indexOf(currentTier);
  const targetIndex = tierOrder.indexOf(targetTier);

  // Shadow DTUs cannot be promoted
  if (currentTier === 'shadow') return false;

  // Can only promote to higher tier
  return targetIndex > currentIndex;
}
