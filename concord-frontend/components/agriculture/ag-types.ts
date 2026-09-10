import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Beef,
  Bug,
  Droplets,
  Layers,
  Map,
  Satellite,
  ShieldCheck,
  Sprout,
  Tractor,
  Wheat,
} from 'lucide-react';

export type FarmDeskView =
  | 'ops'
  | 'fields'
  | 'crops'
  | 'livestock'
  | 'equipment'
  | 'water'
  | 'harvest'
  | 'certs'
  | 'map'
  | 'workbench'
  | 'precision'
  | 'operator'
  | 'scout';

export type RecordKind =
  | 'fields'
  | 'crops'
  | 'livestock'
  | 'equipment'
  | 'water'
  | 'harvest'
  | 'certs';

export type ArtifactType =
  | 'Field'
  | 'Crop'
  | 'Animal'
  | 'FarmEquipment'
  | 'WaterSystem'
  | 'Harvest'
  | 'Certification';

export type Status = 'planned' | 'planted' | 'growing' | 'ready' | 'harvested' | 'stored' | 'sold';

export interface AgricultureArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  acreage?: number;
  soilType?: string;
  location?: string;
  lat?: number;
  lng?: number;
  currentCrop?: string;
  lastTested?: string;
  phLevel?: number;
  nitrogenPpm?: number;
  variety?: string;
  fieldName?: string;
  plantDate?: string;
  expectedHarvest?: string;
  seedSource?: string;
  rowSpacing?: string;
  estimatedYield?: number;
  yieldUnit?: string;
  pestPressure?: string;
  species?: string;
  breed?: string;
  headCount?: number;
  pasture?: string;
  lastVetVisit?: string;
  nextVetVisit?: string;
  feedType?: string;
  weightAvg?: number;
  equipmentType?: string;
  make?: string;
  model?: string;
  year?: number;
  hours?: number;
  lastService?: string;
  nextService?: string;
  condition?: string;
  systemType?: string;
  coverageAcres?: number;
  flowRate?: number;
  flowUnit?: string;
  waterSource?: string;
  scheduleFreq?: string;
  lastInspection?: string;
  crop?: string;
  field?: string;
  harvestDate?: string;
  quantity?: number;
  quantityUnit?: string;
  quality?: string;
  storageLocation?: string;
  pricePerUnit?: number;
  buyer?: string;
  certBody?: string;
  certType?: string;
  issueDate?: string;
  expiryDate?: string;
  certNumber?: string;
  inspectionDue?: string;
}

export const RECORD_TABS: {
  id: RecordKind;
  label: string;
  icon: LucideIcon;
  artifactType: ArtifactType;
}[] = [
  { id: 'fields', label: 'Fields', icon: Layers, artifactType: 'Field' },
  { id: 'crops', label: 'Crops', icon: Sprout, artifactType: 'Crop' },
  { id: 'livestock', label: 'Livestock', icon: Beef, artifactType: 'Animal' },
  { id: 'equipment', label: 'Equipment', icon: Tractor, artifactType: 'FarmEquipment' },
  { id: 'water', label: 'Water', icon: Droplets, artifactType: 'WaterSystem' },
  { id: 'harvest', label: 'Harvest', icon: Wheat, artifactType: 'Harvest' },
  { id: 'certs', label: 'Certifications', icon: ShieldCheck, artifactType: 'Certification' },
];

export const FARM_DESK_TABS: { id: FarmDeskView; label: string; icon: LucideIcon }[] = [
  { id: 'ops', label: 'Ops', icon: BarChart3 },
  ...RECORD_TABS.map(({ id, label, icon }) => ({ id, label, icon })),
  { id: 'map', label: 'Map', icon: Map },
  { id: 'workbench', label: 'Ops Center', icon: Tractor },
  { id: 'precision', label: 'FieldView', icon: Satellite },
  { id: 'operator', label: 'Plans', icon: Droplets },
  { id: 'scout', label: 'Scout', icon: Bug },
];

export const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'gray-400' },
  planted: { label: 'Planted', color: 'blue-400' },
  growing: { label: 'Growing', color: 'green-400' },
  ready: { label: 'Ready', color: 'yellow-400' },
  harvested: { label: 'Harvested', color: 'orange-400' },
  stored: { label: 'Stored', color: 'purple-400' },
  sold: { label: 'Sold', color: 'emerald-400' },
};

export const SOIL_TYPES = ['Clay', 'Sandy', 'Loam', 'Silt', 'Peat', 'Chalk', 'Sandy Loam', 'Clay Loam'];
export const SPECIES_LIST = ['Cattle', 'Poultry', 'Swine', 'Sheep', 'Goats', 'Horses', 'Bees'];
export const EQUIPMENT_TYPES = [
  'Tractor',
  'Combine',
  'Planter',
  'Sprayer',
  'Irrigation Pump',
  'Loader',
  'Baler',
  'Disc',
  'Drill',
  'Trailer',
  'ATV',
];
export const WATER_SYSTEMS = [
  'Center Pivot',
  'Drip',
  'Flood',
  'Sprinkler',
  'Subsurface',
  'Furrow',
  'Pond/Reservoir',
];
export const CERT_TYPES = [
  'USDA Organic',
  'Non-GMO Verified',
  'GAP (Good Agricultural Practices)',
  'Animal Welfare Approved',
  'Rainforest Alliance',
  'Fair Trade',
  'Certified Naturally Grown',
];
export const QUALITY_GRADES = ['Premium', 'Grade A', 'Grade B', 'Standard', 'Processing'];

export function isRecordKind(v: string): v is RecordKind {
  return RECORD_TABS.some((t) => t.id === v);
}

export function artifactTypeFor(kind: RecordKind): ArtifactType {
  return RECORD_TABS.find((t) => t.id === kind)?.artifactType ?? 'Field';
}
