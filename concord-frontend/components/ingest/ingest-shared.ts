'use client';

/** Shared ingest types/constants — extracted from page.tsx. */

export interface ParseDocumentResult {
  format: string;
  lineCount: number;
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;
  sectionCount: number;
  sections: string[];
  avgWordsPerSentence: number;
  avgWordsPerParagraph: number;
}

export interface ExtractEntitiesResult {
  emails: string[];
  urls: string[];
  dates: string[];
  phones: string[];
  numbers: string[];
  summary: { emailCount: number; urlCount: number; dateCount: number; phoneCount: number; numberCount: number };
}

export interface ValidateSchemaResult {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  validationRate: number;
  issues: { row: number; valid: boolean; missingFields: string[]; extraFields: string[]; nullFields: string[]; field?: string; message?: string; count?: number }[];
}

export interface DetectedField {
  field: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'null' | 'mixed' | 'object' | string;
  typeBreakdown: Record<string, number>;
  nullCount: number;
  nullablePct: number;
  nonNullCount: number;
  uniqueCount: number;
  uniquePct: number;
  likelyPrimaryKey: boolean;
  sampleValues: unknown[];
}

export interface DetectSchemaResult {
  recordCount: number;
  fieldCount: number;
  fields: DetectedField[];
  primaryKeyCandidates: string[];
}

export interface BatchStatusResult {
  totalItems: number;
  completed: number;
  pending: number;
  inProgress: number;
  failed: number;
  completionRate: number;
  statusBreakdown: Record<string, number>;
  recentErrors: { index: number; id: string; error: string }[];
  estimatedRemaining: number;
}

export interface IngestJob {
  id: string;
  filename?: string;
  status: string;
  dtusCreated?: number;
  chunksProcessed?: number;
  totalChunks?: number;
  createdAt?: string;
  error?: string;
}

// File extensions we extract text from in batch ingest (binaries are skipped).
// Module-scoped so it's a stable reference (not re-created per render).
export const TEXT_BATCH_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|xml|html)$/i;

// Ingest-analysis actions that read plain text (vs. a structured JSON array).
export const TEXT_ANALYSIS_ACTIONS = new Set(['parseDocument', 'extractEntities']);

// Type-badge colors for the Detect Schema results table — one visual voice
// per inferred column type, "mixed" reads as a warning (genuinely ambiguous
// data), not a normal type.
export const TYPE_BADGE_COLORS: Record<string, string> = {
  string: 'bg-gray-500/10 text-gray-300',
  integer: 'bg-neon-cyan/10 text-neon-cyan',
  number: 'bg-sky-500/10 text-sky-400',
  boolean: 'bg-neon-purple/10 text-neon-purple',
  date: 'bg-neon-green/10 text-neon-green',
  object: 'bg-amber-400/10 text-amber-400',
  null: 'bg-gray-600/10 text-gray-500',
  mixed: 'bg-red-500/10 text-red-400',
  default: 'bg-gray-500/10 text-gray-300',
};

export type IngestView = 'workbench' | 'pipeline' | 'seed' | 'repos';
