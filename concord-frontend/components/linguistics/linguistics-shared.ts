'use client';

export type ModeTab = 'Analyses' | 'Lexicon' | 'Grammars' | 'Corpora' | 'Translations' | 'Dashboard';
export type ArtifactType = 'Analysis' | 'LexiconEntry' | 'Grammar' | 'Corpus' | 'Translation';
export type LingSubfield = 'phonology' | 'morphology' | 'syntax' | 'semantics' | 'pragmatics' | 'sociolinguistics' | 'historical' | 'computational' | 'other';

export interface LinguisticsArtifact {
  artifactType: ArtifactType;
  subfield: LingSubfield;
  language?: string;
  description: string;
  sourceText?: string;
  targetText?: string;
  glosses?: string[];
  morphemes?: string[];
  syntaxTree?: string;
  ipa?: string;
  examples?: string[];
  notes?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export type LinguisticsView =
  | 'Analyses'
  | 'Lexicon'
  | 'Grammars'
  | 'Corpora'
  | 'Translations'
  | 'Dashboard'
  | 'analyze'
  | 'lookup'
  | 'learning'
  | 'workbench';

export const NOTEBOOK_TABS: { id: ModeTab; label: string; type: ArtifactType }[] = [
  { id: 'Analyses', label: 'Analyses', type: 'Analysis' },
  { id: 'Lexicon', label: 'Lexicon', type: 'LexiconEntry' },
  { id: 'Grammars', label: 'Grammars', type: 'Grammar' },
  { id: 'Corpora', label: 'Corpora', type: 'Corpus' },
  { id: 'Translations', label: 'Translations', type: 'Translation' },
  { id: 'Dashboard', label: 'Dashboard', type: 'Analysis' },
];

export const SUBFIELD_COLORS: Record<LingSubfield, string> = {
  phonology: 'text-pink-400',
  morphology: 'text-purple-400',
  syntax: 'text-blue-400',
  semantics: 'text-green-400',
  pragmatics: 'text-yellow-400',
  sociolinguistics: 'text-orange-400',
  historical: 'text-cyan-400',
  computational: 'text-neon-cyan',
  other: 'text-gray-400',
};
