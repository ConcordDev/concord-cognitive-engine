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
  /** Corpus member texts (S-LIN-3): a corpus is a managed collection of
   *  texts, not a titled note — members are stored on the record itself. */
  texts?: string[];
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

/** One node of a parsed bracket-notation syntax tree. */
export interface BracketTreeNode {
  label: string;
  children: BracketTreeNode[];
  /** Terminal word for leaf nodes (a pre-terminal's single word child). */
  word?: string;
}

/**
 * Validate + parse a bracket-notation tree ("[S [NP the fox] [VP sat]]").
 * Returns the parsed root on success; on failure, a message naming the
 * first problem and its character position — an unbalanced tree is refused
 * with the position named (S-LIN-3), never saved silently.
 */
export function parseBracketTree(input: string): { ok: true; root: BracketTreeNode } | { ok: false; error: string } {
  const src = String(input || '');
  const tokens: { t: '[' | ']' | 'w'; v: string; at: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '[' || ch === ']') { tokens.push({ t: ch, v: ch, at: i }); i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    let j = i;
    while (j < src.length && !/[\s[\]]/.test(src[j])) j++;
    tokens.push({ t: 'w', v: src.slice(i, j), at: i });
    i = j;
  }
  if (tokens.length === 0) return { ok: false, error: 'The tree is empty — write bracket notation, e.g. [S [NP the fox] [VP sat]].' };
  let pos = 0;
  const parseNode = (): BracketTreeNode | { error: string } => {
    const open = tokens[pos];
    if (!open || open.t !== '[') return { error: `Expected "[" at character ${open ? open.at : src.length}.` };
    pos++;
    const labelTok = tokens[pos];
    if (!labelTok || labelTok.t !== 'w') return { error: `Expected a node label after the "[" at character ${open.at}.` };
    pos++;
    const node: BracketTreeNode = { label: labelTok.v, children: [] };
    const words: string[] = [];
    for (;;) {
      const tok = tokens[pos];
      if (!tok) return { error: `Unbalanced tree: the node opened at character ${open.at} ("${node.label}") is never closed — missing "]".` };
      if (tok.t === ']') { pos++; break; }
      if (tok.t === '[') {
        const child = parseNode();
        if ('error' in child) return child;
        node.children.push(child);
        continue;
      }
      words.push(tok.v); pos++;
    }
    if (words.length > 0) node.word = words.join(' ');
    return node;
  };
  const root = parseNode();
  if ('error' in root) return { ok: false, error: root.error };
  if (pos < tokens.length) {
    const extra = tokens[pos];
    return { ok: false, error: `Unbalanced tree: unexpected "${extra.v}" at character ${extra.at} after the tree had already closed.` };
  }
  return { ok: true, root };
}
