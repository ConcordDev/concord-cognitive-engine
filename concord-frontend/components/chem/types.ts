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
  /** When the run happened, as stored on the record (ranAt); createdAt is
   *  the artifact's own creation stamp. `timestamp` is the legacy read —
   *  records never carried it, which is why rows read "Invalid Date". */
  ranAt?: string;
  createdAt?: string;
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
