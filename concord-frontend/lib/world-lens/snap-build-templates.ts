/**
 * World Lens — Snap-Build Seed Templates
 *
 * Pre-validated building templates for casual users.
 * Each template is a complete, physics-validated structure
 * that can be placed directly into a district without
 * requiring engineering knowledge.
 */

export type SnapBuildCategory =
  | 'residential'
  | 'commercial'
  | 'public'
  | 'infrastructure'
  | 'industrial'
  | 'custom';

export type TemplateSize = '1x1' | '2x2' | '3x3' | '4x4+';

export interface SnapBuildTemplate {
  id: string;
  name: string;
  description: string;
  category: SnapBuildCategory;
  creator: string;
  creatorHandle: string;
  citations: number;
  validationStatus: 'validated';
  difficulty: 1 | 2 | 3 | 4 | 5;
  size: TemplateSize;
  materialSummary: string;
  infrastructureRequirements: string[];
  previewDescription: string;
  tags: string[];
  publishedAt: string;
  featured?: boolean;
  basedOn?: string; // citation chain — handle of original architect
}

export const SNAP_BUILD_CATEGORIES: {
  key: SnapBuildCategory;
  label: string;
  subcategories: string[];
}[] = [
  { key: 'residential', label: 'Residential', subcategories: ['houses', 'apartments'] },
  { key: 'commercial', label: 'Commercial', subcategories: ['shops', 'offices'] },
  { key: 'public', label: 'Public', subcategories: ['library', 'school', 'park'] },
  { key: 'infrastructure', label: 'Infrastructure', subcategories: ['power station', 'water treatment'] },
  { key: 'industrial', label: 'Industrial', subcategories: ['workshop', 'warehouse'] },
  { key: 'custom', label: 'Custom', subcategories: ['user-published templates'] },
];

// There is no seeded template catalog. The old SEED_SNAP_TEMPLATES list
// shipped invented templates with made-up creators (@architect_alex…),
// citation counts and "validated" badges. No snap-build template store
// persists across restarts yet, so the catalog is honestly empty.
