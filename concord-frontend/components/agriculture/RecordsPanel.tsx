'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bug,
  Calendar,
  CheckCircle2,
  Clock,
  Droplets,
  Edit2,
  Filter,
  Layers,
  MapPin,
  Plus,
  Scale,
  Search,
  Sprout,
  Trash2,
  TrendingUp,
  Wheat,
  X,
  Zap,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { useLensData, type LensItem } from '@/lib/hooks/use-lens-data';
import { useDensity } from '@/lib/hooks/useDensity';
import { useFarmDesk } from './FarmDeskContext';
import {
  CERT_TYPES,
  EQUIPMENT_TYPES,
  QUALITY_GRADES,
  SOIL_TYPES,
  SPECIES_LIST,
  STATUS_CONFIG,
  WATER_SYSTEMS,
  artifactTypeFor,
  type AgricultureArtifact,
  type RecordKind,
  type Status,
} from './ag-types';

interface FormState {
  name: string;
  description: string;
  status: Status;
  notes: string;
  acreage: string;
  soilType: string;
  location: string;
  currentCrop: string;
  phLevel: string;
  variety: string;
  fieldName: string;
  plantDate: string;
  expectedHarvest: string;
  estimatedYield: string;
  yieldUnit: string;
  species: string;
  breed: string;
  headCount: string;
  pasture: string;
  equipmentType: string;
  make: string;
  model: string;
  year: string;
  hours: string;
  condition: string;
  systemType: string;
  coverageAcres: string;
  flowRate: string;
  waterSource: string;
  crop: string;
  field: string;
  harvestDate: string;
  quantity: string;
  quality: string;
  pricePerUnit: string;
  buyer: string;
  certType: string;
  certBody: string;
  expiryDate: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  status: 'planned',
  notes: '',
  acreage: '',
  soilType: 'Loam',
  location: '',
  currentCrop: '',
  phLevel: '',
  variety: '',
  fieldName: '',
  plantDate: '',
  expectedHarvest: '',
  estimatedYield: '',
  yieldUnit: 'bu/ac',
  species: 'Cattle',
  breed: '',
  headCount: '',
  pasture: '',
  equipmentType: 'Tractor',
  make: '',
  model: '',
  year: '',
  hours: '',
  condition: 'Good',
  systemType: 'Center Pivot',
  coverageAcres: '',
  flowRate: '',
  waterSource: '',
  crop: '',
  field: '',
  harvestDate: '',
  quantity: '',
  quality: 'Grade A',
  pricePerUnit: '',
  buyer: '',
  certType: 'USDA Organic',
  certBody: '',
  expiryDate: '',
};

function formFromItem(item: LensItem<AgricultureArtifact>): FormState {
  const d = item.data;
  return {
    ...EMPTY_FORM,
    name: d.name || item.title,
    description: d.description || '',
    status: d.status || 'planned',
    notes: d.notes || '',
    acreage: String(d.acreage || ''),
    soilType: d.soilType || 'Loam',
    location: d.location || '',
    currentCrop: d.currentCrop || '',
    phLevel: String(d.phLevel || ''),
    variety: d.variety || '',
    fieldName: d.fieldName || '',
    plantDate: d.plantDate || '',
    expectedHarvest: d.expectedHarvest || '',
    estimatedYield: String(d.estimatedYield || ''),
    yieldUnit: d.yieldUnit || 'bu/ac',
    species: d.species || 'Cattle',
    breed: d.breed || '',
    headCount: String(d.headCount || ''),
    pasture: d.pasture || '',
    equipmentType: d.equipmentType || 'Tractor',
    make: d.make || '',
    model: d.model || '',
    year: String(d.year || ''),
    hours: String(d.hours || ''),
    condition: d.condition || 'Good',
    systemType: d.systemType || 'Center Pivot',
    coverageAcres: String(d.coverageAcres || ''),
    flowRate: String(d.flowRate || ''),
    waterSource: d.waterSource || '',
    crop: d.crop || '',
    field: d.field || '',
    harvestDate: d.harvestDate || '',
    quantity: String(d.quantity || ''),
    quality: d.quality || 'Grade A',
    pricePerUnit: String(d.pricePerUnit || ''),
    buyer: d.buyer || '',
    certType: d.certType || 'USDA Organic',
    certBody: d.certBody || '',
    expiryDate: d.expiryDate || '',
  };
}

function payloadFromForm(form: FormState, type: AgricultureArtifact['type']): AgricultureArtifact {
  const base: AgricultureArtifact = {
    name: form.name,
    type,
    status: form.status,
    description: form.description,
    notes: form.notes,
  };
  if (type === 'Field') {
    Object.assign(base, {
      acreage: parseFloat(form.acreage) || 0,
      soilType: form.soilType,
      location: form.location,
      currentCrop: form.currentCrop,
      phLevel: parseFloat(form.phLevel) || 0,
    });
  } else if (type === 'Crop') {
    Object.assign(base, {
      variety: form.variety,
      fieldName: form.fieldName,
      plantDate: form.plantDate,
      expectedHarvest: form.expectedHarvest,
      estimatedYield: parseFloat(form.estimatedYield) || 0,
      yieldUnit: form.yieldUnit,
    });
  } else if (type === 'Animal') {
    Object.assign(base, {
      species: form.species,
      breed: form.breed,
      headCount: parseInt(form.headCount, 10) || 0,
      pasture: form.pasture,
    });
  } else if (type === 'FarmEquipment') {
    Object.assign(base, {
      equipmentType: form.equipmentType,
      make: form.make,
      model: form.model,
      year: parseInt(form.year, 10) || 0,
      hours: parseInt(form.hours, 10) || 0,
      condition: form.condition,
    });
  } else if (type === 'WaterSystem') {
    Object.assign(base, {
      systemType: form.systemType,
      coverageAcres: parseFloat(form.coverageAcres) || 0,
      flowRate: parseFloat(form.flowRate) || 0,
      waterSource: form.waterSource,
    });
  } else if (type === 'Harvest') {
    Object.assign(base, {
      crop: form.crop,
      field: form.field,
      harvestDate: form.harvestDate,
      quantity: parseFloat(form.quantity) || 0,
      quality: form.quality,
      pricePerUnit: parseFloat(form.pricePerUnit) || 0,
      buyer: form.buyer,
    });
  } else if (type === 'Certification') {
    Object.assign(base, {
      certType: form.certType,
      certBody: form.certBody,
      expiryDate: form.expiryDate,
    });
  }
  return base;
}

export function RecordsPanel({ kind }: { kind: RecordKind }) {
  const artifactType = artifactTypeFor(kind);
  const { tokens } = useDensity();
  const { handleAction } = useFarmDesk();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<AgricultureArtifact> | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<AgricultureArtifact>('agriculture', artifactType, { noSeed: true });

  useEffect(() => {
    setEditorOpen(false);
    setEditingItem(null);
    setSearchQuery('');
    setFilterStatus('all');
  }, [kind]);

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.data.description?.toLowerCase().includes(q),
      );
    }
    if (filterStatus !== 'all') {
      result = result.filter((i) => i.data.status === filterStatus);
    }
    return result;
  }, [items, searchQuery, filterStatus]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<AgricultureArtifact>) => {
    setEditingItem(item);
    setForm(formFromItem(item));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data = payloadFromForm(form, artifactType);
    const payload = {
      title: form.name,
      data: data as Partial<AgricultureArtifact>,
      meta: { status: form.status, tags: [artifactType] },
    };
    if (editingItem) await update(editingItem.id, payload);
    else await create(payload);
    setEditorOpen(false);
  };

  if (isLoading) {
    return (
      <div className={ds.panel} role="status" aria-live="polite" aria-busy="true">
        <p className={ds.textMuted}>Loading {kind}…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert">
        <ErrorState error={error?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ gap: tokens.gapPx }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${kind}...`}
            className={cn(ds.input, 'pl-10')}
            aria-label={`Search ${kind}`}
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
          type="button"
          onClick={() => {
            setSearchQuery('');
            setFilterStatus('all');
          }}
          className={ds.btnGhost}
        >
          <Filter className="w-4 h-4" /> Clear
        </button>
        <DensityToggle variant="dropdown" />
        <button type="button" onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New {artifactType}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Wheat className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {kind} found. Create one to get started.</p>
          <button type="button" onClick={openCreate} className={cn(ds.btnPrimary, 'mt-4 mx-auto')}>
            <Plus className="w-4 h-4" /> Create your first {artifactType}
          </button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item) => (
            <RecordCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onAnalyze={() => handleAction('analyze', item.id)}
              onPlanCrop={() => handleAction('plan-crop', item.id)}
              onDelete={() => remove(item.id)}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <EditorModal
          kind={kind}
          artifactType={artifactType}
          form={form}
          setField={setField}
          editing={Boolean(editingItem)}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function RecordCard({
  item,
  onEdit,
  onAnalyze,
  onPlanCrop,
  onDelete,
}: {
  item: LensItem<AgricultureArtifact>;
  onEdit: () => void;
  onAnalyze: () => void;
  onPlanCrop: () => void;
  onDelete: () => void;
}) {
  const d = item.data;
  const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.planned;
  return (
    <div
      data-lens-theme="agriculture"
      className={ds.panelHover}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className={ds.heading3}>{item.title}</h3>
        <span className={ds.badge(cfg.color)}>{cfg.label}</span>
      </div>
      {d.description && <p className={cn(ds.textMuted, 'line-clamp-2 mb-2')}>{d.description}</p>}
      {d.type === 'Field' && (
        <div className="mt-2 space-y-1 text-sm">
          {d.acreage ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Layers className="w-3 h-3" /> {d.acreage} acres - {d.soilType}
            </p>
          ) : null}
          {d.currentCrop ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Sprout className="w-3 h-3" /> {d.currentCrop}
            </p>
          ) : null}
          {d.phLevel ? (
            <p className="flex items-center gap-1 text-gray-400">
              pH {d.phLevel} | N: {d.nitrogenPpm || '?'} ppm
            </p>
          ) : null}
          {d.location ? (
            <p className="flex items-center gap-1 text-gray-400">
              <MapPin className="w-3 h-3" /> {d.location}
            </p>
          ) : null}
        </div>
      )}
      {d.type === 'Crop' && (
        <div className="mt-2 space-y-1 text-sm">
          {d.variety && <p className="font-medium text-green-400">{d.variety}</p>}
          {d.fieldName && <p className="text-gray-400">Field: {d.fieldName}</p>}
          {d.plantDate && (
            <p className="flex items-center gap-1 text-gray-400">
              <Calendar className="w-3 h-3" /> Planted {d.plantDate}
            </p>
          )}
          {d.estimatedYield ? (
            <p className="flex items-center gap-1 text-gray-400">
              <TrendingUp className="w-3 h-3" /> Est. yield: {d.estimatedYield} {d.yieldUnit}
            </p>
          ) : null}
          {d.pestPressure ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Bug className="w-3 h-3" /> Pest pressure: {d.pestPressure}
            </p>
          ) : null}
        </div>
      )}
      {d.type === 'Animal' && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium">
            {d.species} - {d.breed}
          </p>
          <p className="text-gray-400">
            Head count: <span className="text-white font-bold">{d.headCount}</span>
          </p>
          {d.pasture && <p className="text-gray-400">Pasture: {d.pasture}</p>}
          {d.weightAvg ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Scale className="w-3 h-3" /> Avg weight: {d.weightAvg} lbs
            </p>
          ) : null}
          {d.nextVetVisit && (
            <p className="flex items-center gap-1 text-gray-400">
              <Calendar className="w-3 h-3" /> Next vet: {d.nextVetVisit}
            </p>
          )}
        </div>
      )}
      {d.type === 'FarmEquipment' && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium">
            {d.make} {d.model} ({d.year})
          </p>
          <p className="text-gray-400">
            {d.equipmentType} - {d.condition}
          </p>
          {d.hours ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Clock className="w-3 h-3" /> {d.hours.toLocaleString()} hours
            </p>
          ) : null}
          {d.nextService && (
            <p className="flex items-center gap-1 text-gray-400">
              <Calendar className="w-3 h-3" /> Service due: {d.nextService}
            </p>
          )}
        </div>
      )}
      {d.type === 'WaterSystem' && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium text-blue-400">{d.systemType}</p>
          {d.coverageAcres ? <p className="text-gray-400">{d.coverageAcres} acres coverage</p> : null}
          {d.flowRate ? (
            <p className="flex items-center gap-1 text-gray-400">
              <Droplets className="w-3 h-3" /> {d.flowRate} {d.flowUnit}
            </p>
          ) : null}
          {d.waterSource && <p className="text-gray-400">Source: {d.waterSource}</p>}
        </div>
      )}
      {d.type === 'Harvest' && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium">
            {d.crop} from {d.field}
          </p>
          {d.quantity ? (
            <p className="text-gray-400">
              {d.quantity.toLocaleString()} {d.quantityUnit} - {d.quality}
            </p>
          ) : null}
          {d.pricePerUnit && d.quantity ? (
            <p className="text-green-400 font-bold">
              ${(d.quantity * d.pricePerUnit).toLocaleString()} total
            </p>
          ) : null}
          {d.buyer && <p className="text-gray-400">Buyer: {d.buyer}</p>}
        </div>
      )}
      {d.type === 'Certification' && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium text-green-400">{d.certType}</p>
          {d.certBody && <p className="text-gray-400">Issued by: {d.certBody}</p>}
          {d.expiryDate && (
            <p
              className={cn(
                'flex items-center gap-1',
                new Date(d.expiryDate) < new Date() ? 'text-red-400' : 'text-gray-400',
              )}
            >
              <Calendar className="w-3 h-3" /> Expires: {d.expiryDate}
            </p>
          )}
          {d.certNumber && <p className={cn(ds.textMono, 'text-gray-400')}>#{d.certNumber}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={cn(ds.btnSmall, 'text-gray-400 hover:text-white')}
        >
          <Edit2 className="w-3 h-3" /> Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAnalyze();
          }}
          className={cn(ds.btnSmall, 'text-neon-cyan hover:text-neon-cyan/80')}
        >
          <Zap className="w-3 h-3" /> Analyze
        </button>
        {d.type === 'Field' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlanCrop();
            }}
            className={cn(ds.btnSmall, 'text-emerald-400 hover:text-emerald-300')}
          >
            <Sprout className="w-3 h-3" /> Plan crop
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}
        >
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </div>
    </div>
  );
}

function EditorModal({
  kind,
  artifactType,
  form,
  setField,
  editing,
  onClose,
  onSave,
}: {
  kind: RecordKind;
  artifactType: string;
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  editing: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className={ds.modalBackdrop}
      onClick={onClose}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className={ds.modalContainer}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${editing ? 'Edit' : 'New'} ${artifactType}`}
      >
        <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-y-auto')}>
          <div className="flex items-center justify-between p-6 border-b border-lattice-border">
            <h2 className={ds.heading2}>
              {editing ? `Edit ${artifactType}` : `New ${artifactType}`}
            </h2>
            <button type="button" onClick={onClose} className={ds.btnGhost} aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                className={ds.input}
                placeholder="Name..."
              />
            </Field>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={2}
                className={ds.textarea}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as Status)}
                className={cn(ds.select, 'w-48')}
              >
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>

            {kind === 'fields' && (
              <div className={ds.grid3}>
                <Field label="Acreage">
                  <input type="number" value={form.acreage} onChange={(e) => setField('acreage', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Soil Type">
                  <select value={form.soilType} onChange={(e) => setField('soilType', e.target.value)} className={ds.select}>
                    {SOIL_TYPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="pH Level">
                  <input type="number" step="0.1" value={form.phLevel} onChange={(e) => setField('phLevel', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Location (GPS)">
                  <input value={form.location} onChange={(e) => setField('location', e.target.value)} className={ds.input} placeholder="N40.82 W96.71" />
                </Field>
                <div className="col-span-2">
                  <Field label="Current Crop">
                    <input value={form.currentCrop} onChange={(e) => setField('currentCrop', e.target.value)} className={ds.input} />
                  </Field>
                </div>
              </div>
            )}

            {kind === 'crops' && (
              <div className={ds.grid2}>
                <Field label="Variety">
                  <input value={form.variety} onChange={(e) => setField('variety', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Field">
                  <input value={form.fieldName} onChange={(e) => setField('fieldName', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Plant Date">
                  <input type="date" value={form.plantDate} onChange={(e) => setField('plantDate', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Expected Harvest">
                  <input type="date" value={form.expectedHarvest} onChange={(e) => setField('expectedHarvest', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Estimated Yield">
                  <input type="number" value={form.estimatedYield} onChange={(e) => setField('estimatedYield', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Yield Unit">
                  <select value={form.yieldUnit} onChange={(e) => setField('yieldUnit', e.target.value)} className={ds.select}>
                    {['bu/ac', 'tons/ac', 'lbs/ac', 'cwt/ac'].map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {kind === 'livestock' && (
              <div className={ds.grid2}>
                <Field label="Species">
                  <select value={form.species} onChange={(e) => setField('species', e.target.value)} className={ds.select}>
                    {SPECIES_LIST.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Breed">
                  <input value={form.breed} onChange={(e) => setField('breed', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Head Count">
                  <input type="number" value={form.headCount} onChange={(e) => setField('headCount', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Pasture">
                  <input value={form.pasture} onChange={(e) => setField('pasture', e.target.value)} className={ds.input} />
                </Field>
              </div>
            )}

            {kind === 'equipment' && (
              <div className={ds.grid3}>
                <Field label="Type">
                  <select value={form.equipmentType} onChange={(e) => setField('equipmentType', e.target.value)} className={ds.select}>
                    {EQUIPMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Make">
                  <input value={form.make} onChange={(e) => setField('make', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Model">
                  <input value={form.model} onChange={(e) => setField('model', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Year">
                  <input type="number" value={form.year} onChange={(e) => setField('year', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Hours">
                  <input type="number" value={form.hours} onChange={(e) => setField('hours', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Condition">
                  <select value={form.condition} onChange={(e) => setField('condition', e.target.value)} className={ds.select}>
                    {['Excellent', 'Good', 'Fair', 'Poor', 'Needs Repair'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {kind === 'water' && (
              <div className={ds.grid2}>
                <Field label="System Type">
                  <select value={form.systemType} onChange={(e) => setField('systemType', e.target.value)} className={ds.select}>
                    {WATER_SYSTEMS.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Coverage (acres)">
                  <input type="number" value={form.coverageAcres} onChange={(e) => setField('coverageAcres', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Flow Rate (gpm)">
                  <input type="number" value={form.flowRate} onChange={(e) => setField('flowRate', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Water Source">
                  <input value={form.waterSource} onChange={(e) => setField('waterSource', e.target.value)} className={ds.input} placeholder="Well, river, pond..." />
                </Field>
              </div>
            )}

            {kind === 'harvest' && (
              <div className={ds.grid2}>
                <Field label="Crop">
                  <input value={form.crop} onChange={(e) => setField('crop', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Field">
                  <input value={form.field} onChange={(e) => setField('field', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Harvest Date">
                  <input type="date" value={form.harvestDate} onChange={(e) => setField('harvestDate', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Quantity">
                  <input type="number" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Quality">
                  <select value={form.quality} onChange={(e) => setField('quality', e.target.value)} className={ds.select}>
                    {QUALITY_GRADES.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Price / Unit ($)">
                  <input type="number" step="0.01" value={form.pricePerUnit} onChange={(e) => setField('pricePerUnit', e.target.value)} className={ds.input} />
                </Field>
                <div className="col-span-2">
                  <Field label="Buyer">
                    <input value={form.buyer} onChange={(e) => setField('buyer', e.target.value)} className={ds.input} />
                  </Field>
                </div>
              </div>
            )}

            {kind === 'certs' && (
              <div className={ds.grid2}>
                <Field label="Certification Type">
                  <select value={form.certType} onChange={(e) => setField('certType', e.target.value)} className={ds.select}>
                    {CERT_TYPES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Certifying Body">
                  <input value={form.certBody} onChange={(e) => setField('certBody', e.target.value)} className={ds.input} />
                </Field>
                <Field label="Expiry Date">
                  <input type="date" value={form.expiryDate} onChange={(e) => setField('expiryDate', e.target.value)} className={ds.input} />
                </Field>
              </div>
            )}

            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                rows={2}
                className={ds.textarea}
              />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
            <button type="button" onClick={onClose} className={ds.btnSecondary}>
              Cancel
            </button>
            <button type="button" onClick={onSave} className={ds.btnPrimary}>
              <CheckCircle2 className="w-4 h-4" /> {editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={ds.label}>{label}</label>
      {children}
    </div>
  );
}

export default RecordsPanel;
