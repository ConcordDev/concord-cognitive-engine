'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Wheat,
  Tractor,
  Bug,
  Droplets,
  Plus,
  Search,
  Filter,
  X,
  Edit2,
  Trash2,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  Calendar,
  MapPin,
  TrendingUp,
  Beef,
  ShieldCheck,
  Scale,
  Clock,
  Layers,
  Sprout,
  ChevronDown,
  Zap,
  Map,
  Sun,
  CloudRain,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModeTab =
  | 'fields'
  | 'crops'
  | 'livestock'
  | 'equipment'
  | 'water'
  | 'harvest'
  | 'certifications'
  | 'map';
type ArtifactType =
  | 'Field'
  | 'Crop'
  | 'Animal'
  | 'FarmEquipment'
  | 'WaterSystem'
  | 'Harvest'
  | 'Certification';
type Status = 'planned' | 'planted' | 'growing' | 'ready' | 'harvested' | 'stored' | 'sold';

interface AgricultureArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  // Field-specific
  acreage?: number;
  soilType?: string;
  location?: string;
  lat?: number;
  lng?: number;
  currentCrop?: string;
  lastTested?: string;
  phLevel?: number;
  nitrogenPpm?: number;
  // Crop-specific
  variety?: string;
  fieldName?: string;
  plantDate?: string;
  expectedHarvest?: string;
  seedSource?: string;
  rowSpacing?: string;
  estimatedYield?: number;
  yieldUnit?: string;
  pestPressure?: string;
  // Animal-specific
  species?: string;
  breed?: string;
  headCount?: number;
  pasture?: string;
  lastVetVisit?: string;
  nextVetVisit?: string;
  feedType?: string;
  weightAvg?: number;
  // Equipment-specific
  equipmentType?: string;
  make?: string;
  model?: string;
  year?: number;
  hours?: number;
  lastService?: string;
  nextService?: string;
  condition?: string;
  // Water-specific
  systemType?: string;
  coverageAcres?: number;
  flowRate?: number;
  flowUnit?: string;
  waterSource?: string;
  scheduleFreq?: string;
  lastInspection?: string;
  // Harvest-specific
  crop?: string;
  field?: string;
  harvestDate?: string;
  quantity?: number;
  quantityUnit?: string;
  quality?: string;
  storageLocation?: string;
  pricePerUnit?: number;
  buyer?: string;
  // Certification-specific
  certBody?: string;
  certType?: string;
  issueDate?: string;
  expiryDate?: string;
  certNumber?: string;
  inspectionDue?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Wheat; artifactType: ArtifactType }[] =
  [
    { id: 'fields', label: 'Fields', icon: Layers, artifactType: 'Field' },
    { id: 'crops', label: 'Crops', icon: Sprout, artifactType: 'Crop' },
    { id: 'livestock', label: 'Livestock', icon: Beef, artifactType: 'Animal' },
    { id: 'equipment', label: 'Equipment', icon: Tractor, artifactType: 'FarmEquipment' },
    { id: 'water', label: 'Water', icon: Droplets, artifactType: 'WaterSystem' },
    { id: 'harvest', label: 'Harvest', icon: Wheat, artifactType: 'Harvest' },
    {
      id: 'certifications',
      label: 'Certifications',
      icon: ShieldCheck,
      artifactType: 'Certification',
    },
    { id: 'map', label: 'Map', icon: Map, artifactType: 'Field' },
  ];

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'gray-400' },
  planted: { label: 'Planted', color: 'blue-400' },
  growing: { label: 'Growing', color: 'green-400' },
  ready: { label: 'Ready', color: 'yellow-400' },
  harvested: { label: 'Harvested', color: 'orange-400' },
  stored: { label: 'Stored', color: 'purple-400' },
  sold: { label: 'Sold', color: 'emerald-400' },
};

const SOIL_TYPES = ['Clay', 'Sandy', 'Loam', 'Silt', 'Peat', 'Chalk', 'Sandy Loam', 'Clay Loam'];
const SPECIES_LIST = ['Cattle', 'Poultry', 'Swine', 'Sheep', 'Goats', 'Horses', 'Bees'];
const EQUIPMENT_TYPES = [
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
const WATER_SYSTEMS = [
  'Center Pivot',
  'Drip',
  'Flood',
  'Sprinkler',
  'Subsurface',
  'Furrow',
  'Pond/Reservoir',
];
const CERT_TYPES = [
  'USDA Organic',
  'Non-GMO Verified',
  'GAP (Good Agricultural Practices)',
  'Animal Welfare Approved',
  'Rainforest Alliance',
  'Fair Trade',
  'Certified Naturally Grown',
];
const QUALITY_GRADES = ['Premium', 'Grade A', 'Grade B', 'Standard', 'Processing'];

const seedData: { title: string; data: Record<string, unknown> }[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgricultureLensPage() {
  useLensNav('agriculture');
  const {
    latestData: realtimeData,
    isLive,
    lastUpdated,
    insights,
  } = useRealtimeLens('agriculture');

  const [activeTab, setActiveTab] = useState<ModeTab>('fields');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<AgricultureArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // Editor form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('planned');
  const [formNotes, setFormNotes] = useState('');
  // Field
  const [formAcreage, setFormAcreage] = useState('');
  const [formSoilType, setFormSoilType] = useState('Loam');
  const [formLocation, setFormLocation] = useState('');
  const [formCurrentCrop, setFormCurrentCrop] = useState('');
  const [formPhLevel, setFormPhLevel] = useState('');
  // Crop
  const [formVariety, setFormVariety] = useState('');
  const [formFieldName, setFormFieldName] = useState('');
  const [formPlantDate, setFormPlantDate] = useState('');
  const [formExpectedHarvest, setFormExpectedHarvest] = useState('');
  const [formEstimatedYield, setFormEstimatedYield] = useState('');
  const [formYieldUnit, setFormYieldUnit] = useState('bu/ac');
  // Animal
  const [formSpecies, setFormSpecies] = useState('Cattle');
  const [formBreed, setFormBreed] = useState('');
  const [formHeadCount, setFormHeadCount] = useState('');
  const [formPasture, setFormPasture] = useState('');
  // Equipment
  const [formEquipmentType, setFormEquipmentType] = useState('Tractor');
  const [formMake, setFormMake] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formYear, setFormYear] = useState('');
  const [formHours, setFormHours] = useState('');
  const [formCondition, setFormCondition] = useState('Good');
  // Water
  const [formSystemType, setFormSystemType] = useState('Center Pivot');
  const [formCoverageAcres, setFormCoverageAcres] = useState('');
  const [formFlowRate, setFormFlowRate] = useState('');
  const [formWaterSource, setFormWaterSource] = useState('');
  // Harvest
  const [formCrop, setFormCrop] = useState('');
  const [formField, setFormField] = useState('');
  const [formHarvestDate, setFormHarvestDate] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formQuality, setFormQuality] = useState('Grade A');
  const [formPricePerUnit, setFormPricePerUnit] = useState('');
  const [formBuyer, setFormBuyer] = useState('');
  // Certification
  const [formCertType, setFormCertType] = useState('USDA Organic');
  const [formCertBody, setFormCertBody] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Field';

  const {
    items,
    isLoading,
    isError: isError,
    error: error,
    refetch: refetch,
    create,
    update,
    remove,
  } = useLensData<AgricultureArtifact>('agriculture', activeArtifactType, {
    seed: seedData.filter((s) => (s.data as Record<string, unknown>).type === activeArtifactType),
  });

  const runAction = useRunArtifact('agriculture');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as AgricultureArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      result = result.filter(
        (i) => (i.data as unknown as AgricultureArtifact).status === filterStatus
      );
    }
    return result;
  }, [items, searchQuery, filterStatus]);

  // ---------------------------------------------------------------------------
  // Editor helpers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormDescription('');
    setFormStatus('planned');
    setFormNotes('');
    setFormAcreage('');
    setFormSoilType('Loam');
    setFormLocation('');
    setFormCurrentCrop('');
    setFormPhLevel('');
    setFormVariety('');
    setFormFieldName('');
    setFormPlantDate('');
    setFormExpectedHarvest('');
    setFormEstimatedYield('');
    setFormYieldUnit('bu/ac');
    setFormSpecies('Cattle');
    setFormBreed('');
    setFormHeadCount('');
    setFormPasture('');
    setFormEquipmentType('Tractor');
    setFormMake('');
    setFormModel('');
    setFormYear('');
    setFormHours('');
    setFormCondition('Good');
    setFormSystemType('Center Pivot');
    setFormCoverageAcres('');
    setFormFlowRate('');
    setFormWaterSource('');
    setFormCrop('');
    setFormField('');
    setFormHarvestDate('');
    setFormQuantity('');
    setFormQuality('Grade A');
    setFormPricePerUnit('');
    setFormBuyer('');
    setFormCertType('USDA Organic');
    setFormCertBody('');
    setFormExpiryDate('');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<AgricultureArtifact>) => {
    const d = item.data as unknown as AgricultureArtifact;
    setEditingItem(item);
    setFormName(d.name || item.title);
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'planned');
    setFormNotes(d.notes || '');
    setFormAcreage(String(d.acreage || ''));
    setFormSoilType(d.soilType || 'Loam');
    setFormLocation(d.location || '');
    setFormCurrentCrop(d.currentCrop || '');
    setFormPhLevel(String(d.phLevel || ''));
    setFormVariety(d.variety || '');
    setFormFieldName(d.fieldName || '');
    setFormPlantDate(d.plantDate || '');
    setFormExpectedHarvest(d.expectedHarvest || '');
    setFormEstimatedYield(String(d.estimatedYield || ''));
    setFormYieldUnit(d.yieldUnit || 'bu/ac');
    setFormSpecies(d.species || 'Cattle');
    setFormBreed(d.breed || '');
    setFormHeadCount(String(d.headCount || ''));
    setFormPasture(d.pasture || '');
    setFormEquipmentType(d.equipmentType || 'Tractor');
    setFormMake(d.make || '');
    setFormModel(d.model || '');
    setFormYear(String(d.year || ''));
    setFormHours(String(d.hours || ''));
    setFormCondition(d.condition || 'Good');
    setFormSystemType(d.systemType || 'Center Pivot');
    setFormCoverageAcres(String(d.coverageAcres || ''));
    setFormFlowRate(String(d.flowRate || ''));
    setFormWaterSource(d.waterSource || '');
    setFormCrop(d.crop || '');
    setFormField(d.field || '');
    setFormHarvestDate(d.harvestDate || '');
    setFormQuantity(String(d.quantity || ''));
    setFormQuality(d.quality || 'Grade A');
    setFormPricePerUnit(String(d.pricePerUnit || ''));
    setFormBuyer(d.buyer || '');
    setFormCertType(d.certType || 'USDA Organic');
    setFormCertBody(d.certBody || '');
    setFormExpiryDate(d.expiryDate || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const base: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
    };
    if (activeArtifactType === 'Field') {
      Object.assign(base, {
        acreage: parseFloat(formAcreage) || 0,
        soilType: formSoilType,
        location: formLocation,
        currentCrop: formCurrentCrop,
        phLevel: parseFloat(formPhLevel) || 0,
      });
    } else if (activeArtifactType === 'Crop') {
      Object.assign(base, {
        variety: formVariety,
        fieldName: formFieldName,
        plantDate: formPlantDate,
        expectedHarvest: formExpectedHarvest,
        estimatedYield: parseFloat(formEstimatedYield) || 0,
        yieldUnit: formYieldUnit,
      });
    } else if (activeArtifactType === 'Animal') {
      Object.assign(base, {
        species: formSpecies,
        breed: formBreed,
        headCount: parseInt(formHeadCount) || 0,
        pasture: formPasture,
      });
    } else if (activeArtifactType === 'FarmEquipment') {
      Object.assign(base, {
        equipmentType: formEquipmentType,
        make: formMake,
        model: formModel,
        year: parseInt(formYear) || 0,
        hours: parseInt(formHours) || 0,
        condition: formCondition,
      });
    } else if (activeArtifactType === 'WaterSystem') {
      Object.assign(base, {
        systemType: formSystemType,
        coverageAcres: parseFloat(formCoverageAcres) || 0,
        flowRate: parseFloat(formFlowRate) || 0,
        waterSource: formWaterSource,
      });
    } else if (activeArtifactType === 'Harvest') {
      Object.assign(base, {
        crop: formCrop,
        field: formField,
        harvestDate: formHarvestDate,
        quantity: parseFloat(formQuantity) || 0,
        quality: formQuality,
        pricePerUnit: parseFloat(formPricePerUnit) || 0,
        buyer: formBuyer,
      });
    } else if (activeArtifactType === 'Certification') {
      Object.assign(base, {
        certType: formCertType,
        certBody: formCertBody,
        expiryDate: formExpiryDate,
      });
    }
    const payload = {
      title: formName,
      data: base as Partial<AgricultureArtifact>,
      meta: { status: formStatus, tags: [activeArtifactType] },
    };
    if (editingItem) {
      await update(editingItem.id, payload);
    } else {
      await create(payload);
    }
    setEditorOpen(false);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingItem?.id || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) {
        setActionResult({
          message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(result.result as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  const dashboardMetrics = useMemo(() => {
    const allData = items.map((i) => i.data as unknown as AgricultureArtifact);
    const totalAcres = allData
      .filter((d) => d.type === 'Field')
      .reduce((s, d) => s + (d.acreage || 0), 0);
    const totalHead = allData
      .filter((d) => d.type === 'Animal')
      .reduce((s, d) => s + (d.headCount || 0), 0);
    const cropsGrowing = allData.filter((d) => d.type === 'Crop' && d.status === 'growing').length;
    const harvestReady = allData.filter((d) => d.status === 'ready').length;
    const equipmentDue = allData.filter((d) => d.type === 'FarmEquipment' && d.nextService).length;
    const activeCerts = allData.filter(
      (d) => d.type === 'Certification' && d.expiryDate && new Date(d.expiryDate) > new Date()
    ).length;
    const totalRevenue = allData
      .filter((d) => d.type === 'Harvest' && d.status === 'sold')
      .reduce((s, d) => s + (d.quantity || 0) * (d.pricePerUnit || 0), 0);
    const byStatus: Record<string, number> = {};
    allData.forEach((d) => {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    });
    return {
      totalAcres,
      totalHead,
      cropsGrowing,
      harvestReady,
      equipmentDue,
      activeCerts,
      totalRevenue,
      byStatus,
      total: items.length,
    };
  }, [items]);

  const renderStatusBadge = (status: Status) => {
    const cfg = STATUS_CONFIG[status];
    return <span className={ds.badge(cfg.color)}>{cfg.label}</span>;
  };

  // ---------------------------------------------------------------------------
  // Render: Library
  // ---------------------------------------------------------------------------

  const renderLibrary = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className={cn(ds.input, 'pl-10')}
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as Status | 'all')}
          className={cn(ds.select, 'w-40')}
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setSearchQuery('');
            setFilterStatus('all');
          }}
          className={ds.btnGhost}
        >
          <Filter className="w-4 h-4" /> Clear
        </button>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New {activeArtifactType}
        </button>
      </div>

      {isLoading ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <p className={ds.textMuted}>Loading {activeTab}...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Wheat className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeTab} found. Create one to get started.</p>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item) => {
            const d = item.data as unknown as AgricultureArtifact;
            return (
              <div
                key={item.id}
                data-lens-theme="agriculture"
                className={ds.panelHover}
                onClick={() => openEdit(item)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className={ds.heading3}>{item.title}</h3>
                  {renderStatusBadge(d.status)}
                </div>
                {d.description && (
                  <p className={cn(ds.textMuted, 'line-clamp-2 mb-2')}>{d.description}</p>
                )}

                {/* Field */}
                {d.type === 'Field' && (
                  <div className="mt-2 space-y-1 text-sm">
                    {d.acreage && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Layers className="w-3 h-3" /> {d.acreage} acres - {d.soilType}
                      </p>
                    )}
                    {d.currentCrop && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Sprout className="w-3 h-3" /> {d.currentCrop}
                      </p>
                    )}
                    {d.phLevel && (
                      <p className="flex items-center gap-1 text-gray-400">
                        pH {d.phLevel} | N: {d.nitrogenPpm || '?'} ppm
                      </p>
                    )}
                    {d.location && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <MapPin className="w-3 h-3" /> {d.location}
                      </p>
                    )}
                  </div>
                )}

                {/* Crop */}
                {d.type === 'Crop' && (
                  <div className="mt-2 space-y-1 text-sm">
                    {d.variety && <p className="font-medium text-green-400">{d.variety}</p>}
                    {d.fieldName && <p className="text-gray-400">Field: {d.fieldName}</p>}
                    {d.plantDate && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Calendar className="w-3 h-3" /> Planted {d.plantDate}
                      </p>
                    )}
                    {d.estimatedYield && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <TrendingUp className="w-3 h-3" /> Est. yield: {d.estimatedYield}{' '}
                        {d.yieldUnit}
                      </p>
                    )}
                    {d.pestPressure && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Bug className="w-3 h-3" /> Pest pressure: {d.pestPressure}
                      </p>
                    )}
                  </div>
                )}

                {/* Animal */}
                {d.type === 'Animal' && (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="font-medium">
                      {d.species} - {d.breed}
                    </p>
                    <p className="text-gray-400">
                      Head count: <span className="text-white font-bold">{d.headCount}</span>
                    </p>
                    {d.pasture && <p className="text-gray-400">Pasture: {d.pasture}</p>}
                    {d.weightAvg && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Scale className="w-3 h-3" /> Avg weight: {d.weightAvg} lbs
                      </p>
                    )}
                    {d.nextVetVisit && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Calendar className="w-3 h-3" /> Next vet: {d.nextVetVisit}
                      </p>
                    )}
                  </div>
                )}

                {/* Equipment */}
                {d.type === 'FarmEquipment' && (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="font-medium">
                      {d.make} {d.model} ({d.year})
                    </p>
                    <p className="text-gray-400">
                      {d.equipmentType} - {d.condition}
                    </p>
                    {d.hours && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Clock className="w-3 h-3" /> {d.hours.toLocaleString()} hours
                      </p>
                    )}
                    {d.nextService && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Calendar className="w-3 h-3" /> Service due: {d.nextService}
                      </p>
                    )}
                  </div>
                )}

                {/* Water */}
                {d.type === 'WaterSystem' && (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="font-medium text-blue-400">{d.systemType}</p>
                    {d.coverageAcres && (
                      <p className="text-gray-400">{d.coverageAcres} acres coverage</p>
                    )}
                    {d.flowRate && (
                      <p className="flex items-center gap-1 text-gray-400">
                        <Droplets className="w-3 h-3" /> {d.flowRate} {d.flowUnit}
                      </p>
                    )}
                    {d.waterSource && <p className="text-gray-400">Source: {d.waterSource}</p>}
                  </div>
                )}

                {/* Harvest */}
                {d.type === 'Harvest' && (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="font-medium">
                      {d.crop} from {d.field}
                    </p>
                    {d.quantity && (
                      <p className="text-gray-400">
                        {d.quantity.toLocaleString()} {d.quantityUnit} - {d.quality}
                      </p>
                    )}
                    {d.pricePerUnit && d.quantity && (
                      <p className="text-green-400 font-bold">
                        ${(d.quantity * d.pricePerUnit).toLocaleString()} total
                      </p>
                    )}
                    {d.buyer && <p className="text-gray-400">Buyer: {d.buyer}</p>}
                  </div>
                )}

                {/* Certification */}
                {d.type === 'Certification' && (
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="font-medium text-green-400">{d.certType}</p>
                    {d.certBody && <p className="text-gray-400">Issued by: {d.certBody}</p>}
                    {d.expiryDate && (
                      <p
                        className={cn(
                          'flex items-center gap-1',
                          new Date(d.expiryDate) < new Date() ? 'text-red-400' : 'text-gray-400'
                        )}
                      >
                        <Calendar className="w-3 h-3" /> Expires: {d.expiryDate}
                      </p>
                    )}
                    {d.certNumber && (
                      <p className={cn(ds.textMono, 'text-gray-400')}>#{d.certNumber}</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(item);
                    }}
                    className={cn(ds.btnSmall, 'text-gray-400 hover:text-white')}
                  >
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction('analyze', item.id);
                    }}
                    className={cn(ds.btnSmall, 'text-neon-cyan hover:text-neon-cyan/80')}
                  >
                    <Zap className="w-3 h-3" /> Analyze
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Editor
  // ---------------------------------------------------------------------------

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className={ds.modalBackdrop} onClick={() => setEditorOpen(false)}>
        <div className={ds.modalContainer}>
          <div
            className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-y-auto')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-lattice-border">
              <h2 className={ds.heading2}>
                {editingItem ? `Edit ${activeArtifactType}` : `New ${activeArtifactType}`}
              </h2>
              <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={ds.label}>Name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={ds.input}
                  placeholder="Name..."
                />
              </div>
              <div>
                <label className={ds.label}>Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className={ds.textarea}
                />
              </div>
              <div>
                <label className={ds.label}>Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as Status)}
                  className={cn(ds.select, 'w-48')}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Field-specific */}
              {activeTab === 'fields' && (
                <div className={ds.grid3}>
                  <div>
                    <label className={ds.label}>Acreage</label>
                    <input
                      type="number"
                      value={formAcreage}
                      onChange={(e) => setFormAcreage(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Soil Type</label>
                    <select
                      value={formSoilType}
                      onChange={(e) => setFormSoilType(e.target.value)}
                      className={ds.select}
                    >
                      {SOIL_TYPES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>pH Level</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formPhLevel}
                      onChange={(e) => setFormPhLevel(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Location (GPS)</label>
                    <input
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className={ds.input}
                      placeholder="N40.82 W96.71"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={ds.label}>Current Crop</label>
                    <input
                      value={formCurrentCrop}
                      onChange={(e) => setFormCurrentCrop(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </div>
              )}

              {/* Crop-specific */}
              {activeTab === 'crops' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Variety</label>
                    <input
                      value={formVariety}
                      onChange={(e) => setFormVariety(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Field</label>
                    <input
                      value={formFieldName}
                      onChange={(e) => setFormFieldName(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Plant Date</label>
                    <input
                      type="date"
                      value={formPlantDate}
                      onChange={(e) => setFormPlantDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Expected Harvest</label>
                    <input
                      type="date"
                      value={formExpectedHarvest}
                      onChange={(e) => setFormExpectedHarvest(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Estimated Yield</label>
                    <input
                      type="number"
                      value={formEstimatedYield}
                      onChange={(e) => setFormEstimatedYield(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Yield Unit</label>
                    <select
                      value={formYieldUnit}
                      onChange={(e) => setFormYieldUnit(e.target.value)}
                      className={ds.select}
                    >
                      {['bu/ac', 'tons/ac', 'lbs/ac', 'cwt/ac'].map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Animal-specific */}
              {activeTab === 'livestock' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Species</label>
                    <select
                      value={formSpecies}
                      onChange={(e) => setFormSpecies(e.target.value)}
                      className={ds.select}
                    >
                      {SPECIES_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Breed</label>
                    <input
                      value={formBreed}
                      onChange={(e) => setFormBreed(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Head Count</label>
                    <input
                      type="number"
                      value={formHeadCount}
                      onChange={(e) => setFormHeadCount(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Pasture</label>
                    <input
                      value={formPasture}
                      onChange={(e) => setFormPasture(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </div>
              )}

              {/* Equipment-specific */}
              {activeTab === 'equipment' && (
                <div className={ds.grid3}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={formEquipmentType}
                      onChange={(e) => setFormEquipmentType(e.target.value)}
                      className={ds.select}
                    >
                      {EQUIPMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Make</label>
                    <input
                      value={formMake}
                      onChange={(e) => setFormMake(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Model</label>
                    <input
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Year</label>
                    <input
                      type="number"
                      value={formYear}
                      onChange={(e) => setFormYear(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Hours</label>
                    <input
                      type="number"
                      value={formHours}
                      onChange={(e) => setFormHours(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Condition</label>
                    <select
                      value={formCondition}
                      onChange={(e) => setFormCondition(e.target.value)}
                      className={ds.select}
                    >
                      {['Excellent', 'Good', 'Fair', 'Poor', 'Needs Repair'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Water-specific */}
              {activeTab === 'water' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>System Type</label>
                    <select
                      value={formSystemType}
                      onChange={(e) => setFormSystemType(e.target.value)}
                      className={ds.select}
                    >
                      {WATER_SYSTEMS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Coverage (acres)</label>
                    <input
                      type="number"
                      value={formCoverageAcres}
                      onChange={(e) => setFormCoverageAcres(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Flow Rate (gpm)</label>
                    <input
                      type="number"
                      value={formFlowRate}
                      onChange={(e) => setFormFlowRate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Water Source</label>
                    <input
                      value={formWaterSource}
                      onChange={(e) => setFormWaterSource(e.target.value)}
                      className={ds.input}
                      placeholder="Well, river, pond..."
                    />
                  </div>
                </div>
              )}

              {/* Harvest-specific */}
              {activeTab === 'harvest' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Crop</label>
                    <input
                      value={formCrop}
                      onChange={(e) => setFormCrop(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Field</label>
                    <input
                      value={formField}
                      onChange={(e) => setFormField(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Harvest Date</label>
                    <input
                      type="date"
                      value={formHarvestDate}
                      onChange={(e) => setFormHarvestDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Quantity</label>
                    <input
                      type="number"
                      value={formQuantity}
                      onChange={(e) => setFormQuantity(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Quality</label>
                    <select
                      value={formQuality}
                      onChange={(e) => setFormQuality(e.target.value)}
                      className={ds.select}
                    >
                      {QUALITY_GRADES.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Price / Unit ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formPricePerUnit}
                      onChange={(e) => setFormPricePerUnit(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={ds.label}>Buyer</label>
                    <input
                      value={formBuyer}
                      onChange={(e) => setFormBuyer(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </div>
              )}

              {/* Certification-specific */}
              {activeTab === 'certifications' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Certification Type</label>
                    <select
                      value={formCertType}
                      onChange={(e) => setFormCertType(e.target.value)}
                      className={ds.select}
                    >
                      {CERT_TYPES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Certifying Body</label>
                    <input
                      value={formCertBody}
                      onChange={(e) => setFormCertBody(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Expiry Date</label>
                    <input
                      type="date"
                      value={formExpiryDate}
                      onChange={(e) => setFormExpiryDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className={ds.label}>Notes</label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  className={ds.textarea}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
              <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>
                Cancel
              </button>
              <button onClick={handleSave} className={ds.btnPrimary}>
                <CheckCircle2 className="w-4 h-4" /> {editingItem ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Dashboard
  // ---------------------------------------------------------------------------

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Total Acreage</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.totalAcres.toLocaleString()}</p>
          <p className={ds.textMuted}>Across all fields</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Beef className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Livestock</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.totalHead}</p>
          <p className={ds.textMuted}>Total head count</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Sprout className="w-5 h-5 text-emerald-400" />
            <span className={ds.textMuted}>Crops Growing</span>
          </div>
          <p className="text-3xl font-bold text-green-400">{dashboardMetrics.cropsGrowing}</p>
          <p className={ds.textMuted}>{dashboardMetrics.harvestReady} ready for harvest</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            <span className={ds.textMuted}>Revenue (Sold)</span>
          </div>
          <p className="text-3xl font-bold text-neon-green">
            ${dashboardMetrics.totalRevenue.toLocaleString()}
          </p>
          <p className={ds.textMuted}>From harvests sold</p>
        </div>
      </div>

      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Status Breakdown</h3>
        <div className="space-y-3">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = dashboardMetrics.byStatus[key] || 0;
            const pct = dashboardMetrics.total > 0 ? (count / dashboardMetrics.total) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-400">{cfg.label}</span>
                <div className="flex-1 h-2 bg-lattice-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-${cfg.color} rounded-full transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <TrendingUp className="w-5 h-5 text-neon-cyan" /> Recent Items
        </h3>
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                No crops or fields tracked yet. Add your first planting to get started.
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Create your first farm item to get started
              </p>
            </div>
          ) : (
            items.slice(0, 5).map((item) => {
              const d = item.data as unknown as AgricultureArtifact;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-lattice-surface/50 hover:bg-lattice-surface cursor-pointer"
                  onClick={() => openEdit(item)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.title}</p>
                    <p className={ds.textMuted}>{d.type}</p>
                  </div>
                  {renderStatusBadge(d.status)}
                  <ArrowUpRight className="w-4 h-4 text-gray-500" />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-lime-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading field data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="agriculture" className={ds.pageContainer}>
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Wheat className="w-8 h-8 text-green-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Agriculture & Farming</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>
              Fields, crops, livestock, equipment, water systems, and harvest tracking
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="agriculture" data={{}} compact />
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
          {runAction.isPending && (
            <span className="text-xs text-neon-blue animate-pulse">Running...</span>
          )}
        </div>
      </header>

      <RealtimeDataPanel
        domain="agriculture"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />

      {/* AI Actions */}
      <UniversalActions domain="agriculture" artifactId={items[0]?.id} compact />

      {/* Stat Cards Row */}
      {(() => {
        const all = items.map((i) => i.data as unknown as AgricultureArtifact);
        const totalAcres = all.reduce((s, a) => s + (a.acreage || 0), 0);
        const totalHead = all.reduce((s, a) => s + (a.headCount || 0), 0);
        const totalYield = all.reduce((s, a) => s + (a.quantity || 0), 0);
        const cropCount = all.filter((a) => a.type === 'Crop').length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                icon: Sprout,
                label: 'Total Acreage',
                value: `${totalAcres.toLocaleString()} ac`,
                color: 'text-green-400',
              },
              { icon: Wheat, label: 'Active Crops', value: cropCount, color: 'text-amber-400' },
              {
                icon: Beef,
                label: 'Livestock Head',
                value: totalHead.toLocaleString(),
                color: 'text-orange-400',
              },
              {
                icon: Scale,
                label: 'Harvest Yield',
                value: totalYield.toLocaleString(),
                color: 'text-cyan-400',
              },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={ds.panel}
              >
                <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
                <p className={ds.textMuted}>{stat.label}</p>
                <p className="text-xl font-bold text-white">{stat.value}</p>
              </motion.div>
            ))}
          </div>
        );
      })()}

      {/* Crop Health Status Badges */}
      {(() => {
        const crops = items
          .filter((i) => (i.data as unknown as AgricultureArtifact).type === 'Crop')
          .map((i) => ({
            id: i.id,
            title: i.title,
            ...(i.data as unknown as AgricultureArtifact),
          }));
        if (crops.length === 0) return null;
        const healthMap = { low: 'thriving', medium: 'stressed', high: 'critical' } as Record<
          string,
          string
        >;
        const thriving = crops.filter((c) => !c.pestPressure || c.pestPressure === 'low').length;
        const stressed = crops.filter((c) => c.pestPressure === 'medium').length;
        const critical = crops.filter((c) => c.pestPressure === 'high').length;
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className={ds.panel}
          >
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-400" /> Crop Health Overview
            </h3>
            <div className="flex gap-3">
              <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 capitalize">
                {healthMap['low']}: {thriving}
              </span>
              <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400 capitalize">
                {healthMap['medium']}: {stressed}
              </span>
              <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 capitalize">
                {healthMap['high']}: {critical}
              </span>
            </div>
            {/* Harvest Yield Tracker */}
            {(() => {
              const harvests = items
                .filter((i) => (i.data as unknown as AgricultureArtifact).type === 'Harvest')
                .map((i) => i.data as unknown as AgricultureArtifact);
              const totalQty = harvests.reduce((s, h) => s + (h.quantity || 0), 0);
              const totalEstimated = crops.reduce((s, c) => s + (c.estimatedYield || 0), 0);
              if (totalEstimated === 0) return null;
              const pct = Math.min((totalQty / totalEstimated) * 100, 100);
              return (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Harvest Progress</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      className="h-full bg-gradient-to-r from-green-500 to-amber-400 rounded-full"
                    />
                  </div>
                </div>
              );
            })()}
            {/* Weather Impact Indicator */}
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <CloudRain className="w-3.5 h-3.5 text-blue-400" />
              <span>
                Weather impact:{' '}
                {critical > 0 ? (
                  <span className="text-red-400 font-medium">High stress detected</span>
                ) : stressed > 0 ? (
                  <span className="text-amber-400 font-medium">Moderate</span>
                ) : (
                  <span className="text-green-400 font-medium">Favorable conditions</span>
                )}
              </span>
            </div>
          </motion.div>
        );
      })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowDashboard(false);
            }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'map' ? (
        <div className={ds.panel}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-neon-blue" /> Field Mapping
          </h3>
          <MapView
            markers={items
              .filter((i) => {
                const d = i.data as unknown as AgricultureArtifact;
                return d.lat && d.lng;
              })
              .map((i) => {
                const d = i.data as unknown as AgricultureArtifact;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: d.name || i.title,
                  popup: `${d.location || ''} ${d.acreage ? d.acreage + ' acres' : ''}`.trim(),
                };
              })}
            className="h-[500px]"
          />
        </div>
      ) : showDashboard ? (
        renderDashboard()
      ) : (
        renderLibrary()
      )}

      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* rotationPlan */}
          {actionResult.fields !== undefined &&
            Array.isArray(actionResult.fields) &&
            (
              actionResult.fields as {
                fieldName?: string;
                lastCrop?: string;
                suggestedNext?: string[];
              }[]
            ).length > 0 &&
            !(actionResult.totalAcreage !== undefined) && (
              <div className="space-y-2">
                {(
                  actionResult.fields as {
                    fieldName?: string;
                    lastCrop?: string;
                    suggestedNext?: string[];
                    soilNote?: string;
                  }[]
                ).map((f, i) => (
                  <div key={i} className="p-2 bg-lattice-surface rounded">
                    <p className="text-xs font-semibold text-neon-cyan">{f.fieldName}</p>
                    <p className="text-[10px] text-gray-400">
                      Last crop: <span className="text-gray-200">{f.lastCrop}</span>
                    </p>
                    <p className="text-[10px] text-gray-400">
                      Suggested:{' '}
                      <span className="text-green-400">
                        {(f.suggestedNext || []).slice(0, 3).join(', ') || 'none'}
                      </span>
                    </p>
                    {f.soilNote && (
                      <p className="text-[10px] text-amber-400 mt-0.5">{f.soilNote}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          {/* yieldAnalysis */}
          {actionResult.fieldsAnalyzed !== undefined && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">
                  {String(actionResult.fieldsAnalyzed)}
                </p>
                <p className="text-[10px] text-gray-500">Fields Analyzed</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">
                  {String(actionResult.totalAcreage)} ac
                </p>
                <p className="text-[10px] text-gray-500">Total Acreage</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">
                  {String(actionResult.totalActualYield)}
                </p>
                <p className="text-[10px] text-gray-500">Actual Yield</p>
              </div>
              <div className={`p-2 bg-lattice-surface rounded text-center`}>
                <p
                  className={`text-sm font-bold ${Number(actionResult.overallVariancePct) >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {String(actionResult.overallVariancePct)}%
                </p>
                <p className="text-[10px] text-gray-500">Variance vs Expected</p>
              </div>
            </div>
          )}
          {/* equipmentDue */}
          {actionResult.overdueCount !== undefined &&
            actionResult.totalGallonsAllFields === undefined && (
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-red-400">
                    {String(actionResult.overdueCount)}
                  </p>
                  <p className="text-[10px] text-gray-500">Overdue</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-amber-400">
                    {String(actionResult.upcomingCount)}
                  </p>
                  <p className="text-[10px] text-gray-500">Upcoming</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">
                    {String(actionResult.totalEquipment)}
                  </p>
                  <p className="text-[10px] text-gray-500">Total Equipment</p>
                </div>
              </div>
            )}
          {/* waterSchedule */}
          {actionResult.totalGallonsAllFields !== undefined && (
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">
                  {Number(actionResult.totalGallonsAllFields).toLocaleString()}
                </p>
                <p className="text-[10px] text-gray-500">Total Gallons</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.daysAhead)}</p>
                <p className="text-[10px] text-gray-500">Days Scheduled</p>
              </div>
            </div>
          )}
        </div>
      )}

      {renderEditor()}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="agriculture" />
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="agriculture" />
          </div>
        )}
      </div>
    </div>
  );
}
