export interface Compound {
  id: string;
  name: string;
  formula: string;
  type: 'catalyst' | 'reagent' | 'product';
  molecularWeight?: number | null;
}

export interface Reaction {
  id: string;
  formula: string;
  timestamp: string;
  success: boolean;
}

export type ChemView =
  | 'elements'
  | 'reactions'
  | 'compounds'
  | 'workbench'
  | 'structure'
  | 'lab'
  | 'safety';
