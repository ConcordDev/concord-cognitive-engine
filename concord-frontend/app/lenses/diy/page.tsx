'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Wrench,
  Plus,
  Search,
  Trash2,
  DollarSign,
  Clock,
  CheckCircle2,
  Hammer,
  Package,
  X,
  BarChart3,
  Zap,
  Camera,
  BookOpen,
  Lightbulb,
} from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab = 'projects' | 'tools' | 'materials' | 'instructions' | 'ideas' | 'gallery';
type ArtifactType = 'Project' | 'Tool' | 'Material' | 'Instruction' | 'Idea' | 'GalleryItem';
type Status =
  | 'idea'
  | 'gathering'
  | 'in_progress'
  | 'completed'
  | 'on_hold'
  | 'available'
  | 'in_use'
  | 'low_stock';

interface DIYArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  category?: string;
  difficulty?: string;
  estimatedHours?: number;
  hoursSpent?: number;
  cost?: number;
  budget?: number;
  toolName?: string;
  brand?: string;
  condition?: string;
  location?: string;
  materialName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  supplier?: string;
  step?: number;
  instruction?: string;
  safetyNotes?: string;
  tags?: string;
  imageUrl?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Wrench; artifactType: ArtifactType }[] =
  [
    { id: 'projects', label: 'Projects', icon: Hammer, artifactType: 'Project' },
    { id: 'tools', label: 'Tools', icon: Wrench, artifactType: 'Tool' },
    { id: 'materials', label: 'Materials', icon: Package, artifactType: 'Material' },
    { id: 'instructions', label: 'Instructions', icon: BookOpen, artifactType: 'Instruction' },
    { id: 'ideas', label: 'Ideas', icon: Lightbulb, artifactType: 'Idea' },
    { id: 'gallery', label: 'Gallery', icon: Camera, artifactType: 'GalleryItem' },
  ];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idea: { label: 'Idea', color: 'gray-400' },
  gathering: { label: 'Gathering', color: 'yellow-400' },
  in_progress: { label: 'In Progress', color: 'cyan-400' },
  completed: { label: 'Completed', color: 'green-400' },
  on_hold: { label: 'On Hold', color: 'orange-400' },
  available: { label: 'Available', color: 'green-400' },
  in_use: { label: 'In Use', color: 'blue-400' },
  low_stock: { label: 'Low Stock', color: 'red-400' },
};

const CATEGORIES = [
  'Woodworking',
  'Electronics',
  'Sewing',
  'Metalwork',
  'Painting',
  'Pottery',
  'Leatherwork',
  '3D Printing',
  'Jewelry',
  'Plumbing',
  'Automotive',
  'Garden',
  'Other',
];
const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const TOOL_CONDITIONS = ['New', 'Good', 'Fair', 'Needs Repair', 'Out of Service'];
const MATERIAL_UNITS = [
  'pcs',
  'ft',
  'in',
  'm',
  'kg',
  'lbs',
  'oz',
  'ml',
  'L',
  'rolls',
  'sheets',
  'boards',
];

export default function DIYLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<DIYArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('idea');
  const [formNotes, setFormNotes] = useState('');
  const [formCategory, setFormCategory] = useState(CATEGORIES[0]);
  const [formDifficulty, setFormDifficulty] = useState(DIFFICULTIES[0]);
  const [formEstimatedHours, setFormEstimatedHours] = useState('');
  const [formHoursSpent, setFormHoursSpent] = useState('');
  const [formCost, setFormCost] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formCondition, setFormCondition] = useState(TOOL_CONDITIONS[0]);
  const [formLocation, setFormLocation] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formUnit, setFormUnit] = useState(MATERIAL_UNITS[0]);
  const [formUnitPrice, setFormUnitPrice] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formStep, setFormStep] = useState('');
  const [formInstruction, setFormInstruction] = useState('');
  const [formSafetyNotes, setFormSafetyNotes] = useState('');
  const [formTags, setFormTags] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Project';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<DIYArtifact>('diy', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('diy');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as DIYArtifact).description?.toLowerCase().includes(q) ||
          (i.data as unknown as DIYArtifact).category?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter((i) => (i.data as unknown as DIYArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || filtered[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [filtered, runAction]
  );

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormStatus('idea');
    setFormNotes('');
    setFormCategory(CATEGORIES[0]);
    setFormDifficulty(DIFFICULTIES[0]);
    setFormEstimatedHours('');
    setFormHoursSpent('');
    setFormCost('');
    setFormBudget('');
    setFormBrand('');
    setFormCondition(TOOL_CONDITIONS[0]);
    setFormLocation('');
    setFormQuantity('');
    setFormUnit(MATERIAL_UNITS[0]);
    setFormUnitPrice('');
    setFormSupplier('');
    setFormStep('');
    setFormInstruction('');
    setFormSafetyNotes('');
    setFormTags('');
  };

  const openCreate = () => {
    setEditingItem(null);
    resetForm();
    setEditorOpen(true);
  };
  const openEdit = (item: LensItem<DIYArtifact>) => {
    const d = item.data as unknown as DIYArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'idea');
    setFormNotes(d.notes || '');
    setFormCategory(d.category || CATEGORIES[0]);
    setFormDifficulty(d.difficulty || DIFFICULTIES[0]);
    setFormEstimatedHours(d.estimatedHours?.toString() || '');
    setFormHoursSpent(d.hoursSpent?.toString() || '');
    setFormCost(d.cost?.toString() || '');
    setFormBudget(d.budget?.toString() || '');
    setFormBrand(d.brand || '');
    setFormCondition(d.condition || TOOL_CONDITIONS[0]);
    setFormLocation(d.location || '');
    setFormQuantity(d.quantity?.toString() || '');
    setFormUnit(d.unit || MATERIAL_UNITS[0]);
    setFormUnitPrice(d.unitPrice?.toString() || '');
    setFormSupplier(d.supplier || '');
    setFormStep(d.step?.toString() || '');
    setFormInstruction(d.instruction || '');
    setFormSafetyNotes(d.safetyNotes || '');
    setFormTags(d.tags || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      category: formCategory,
      difficulty: formDifficulty,
      tags: formTags,
      estimatedHours: formEstimatedHours ? parseFloat(formEstimatedHours) : undefined,
      hoursSpent: formHoursSpent ? parseFloat(formHoursSpent) : undefined,
      cost: formCost ? parseFloat(formCost) : undefined,
      budget: formBudget ? parseFloat(formBudget) : undefined,
      brand: formBrand,
      condition: formCondition,
      location: formLocation,
      quantity: formQuantity ? parseFloat(formQuantity) : undefined,
      unit: formUnit,
      unitPrice: formUnitPrice ? parseFloat(formUnitPrice) : undefined,
      supplier: formSupplier,
      step: formStep ? parseInt(formStep) : undefined,
      instruction: formInstruction,
      safetyNotes: formSafetyNotes,
    };
    if (editingItem)
      await update(editingItem.id, {
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    else
      await create({
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    setEditorOpen(false);
  };

  const renderDashboard = () => {
    const all = items.map((i) => i.data as unknown as DIYArtifact);
    const totalCost = all.reduce((s, p) => s + (p.cost || 0), 0);
    const totalHours = all.reduce((s, p) => s + (p.hoursSpent || 0), 0);
    const completed = all.filter((p) => p.status === 'completed').length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Hammer className="w-5 h-5 text-orange-400 mb-2" />
          <p className={ds.textMuted}>Total Items</p>
          <p className="text-xl font-bold text-white">{items.length}</p>
        </div>
        <div className={ds.panel}>
          <CheckCircle2 className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Completed</p>
          <p className="text-xl font-bold text-white">{completed}</p>
        </div>
        <div className={ds.panel}>
          <Clock className="w-5 h-5 text-cyan-400 mb-2" />
          <p className={ds.textMuted}>Hours Spent</p>
          <p className="text-xl font-bold text-white">{totalHours}h</p>
        </div>
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-yellow-400 mb-2" />
          <p className={ds.textMuted}>Total Cost</p>
          <p className="text-xl font-bold text-white">${totalCost.toLocaleString()}</p>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setEditorOpen(false)}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType}
            </h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={ds.label}>Name</label>
              <input
                className={ds.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={ds.label}>Status</label>
                <select
                  className={ds.select}
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as Status)}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Category</label>
                <select
                  className={ds.select}
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {activeArtifactType === 'Project' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Difficulty</label>
                    <select
                      className={ds.select}
                      value={formDifficulty}
                      onChange={(e) => setFormDifficulty(e.target.value)}
                    >
                      {DIFFICULTIES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Budget</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formBudget}
                      onChange={(e) => setFormBudget(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={ds.label}>Est. Hours</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formEstimatedHours}
                      onChange={(e) => setFormEstimatedHours(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Hours Spent</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formHoursSpent}
                      onChange={(e) => setFormHoursSpent(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Cost</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formCost}
                      onChange={(e) => setFormCost(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {activeArtifactType === 'Tool' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Brand</label>
                    <input
                      className={ds.input}
                      value={formBrand}
                      onChange={(e) => setFormBrand(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Condition</label>
                    <select
                      className={ds.select}
                      value={formCondition}
                      onChange={(e) => setFormCondition(e.target.value)}
                    >
                      {TOOL_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Storage Location</label>
                  <input
                    className={ds.input}
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Material' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={ds.label}>Quantity</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formQuantity}
                      onChange={(e) => setFormQuantity(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Unit</label>
                    <select
                      className={ds.select}
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                    >
                      {MATERIAL_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Unit Price</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formUnitPrice}
                      onChange={(e) => setFormUnitPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Supplier</label>
                  <input
                    className={ds.input}
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Storage Location</label>
                  <input
                    className={ds.input}
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Instruction' && (
              <>
                <div>
                  <label className={ds.label}>Step Number</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formStep}
                    onChange={(e) => setFormStep(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Instruction</label>
                  <textarea
                    className={ds.textarea}
                    rows={3}
                    value={formInstruction}
                    onChange={(e) => setFormInstruction(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Safety Notes</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formSafetyNotes}
                    onChange={(e) => setFormSafetyNotes(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Idea' && (
              <>
                <div>
                  <label className={ds.label}>Difficulty</label>
                  <select
                    className={ds.select}
                    value={formDifficulty}
                    onChange={(e) => setFormDifficulty(e.target.value)}
                  >
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Est. Budget</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <label className={ds.label}>Tags</label>
              <input
                className={ds.input}
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="Comma-separated..."
              />
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>
              Cancel
            </button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={cn(ds.select, 'w-auto')}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Wrench className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as DIYArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.idea;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={ds.panelHover}
              onClick={() => openEdit(item)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Wrench className="w-5 h-5 text-orange-400" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.category && <span>{d.category} </span>}
                      {d.difficulty && <span>&middot; {d.difficulty} </span>}
                      {d.brand && <span>{d.brand} </span>}
                      {d.condition && <span>&middot; {d.condition} </span>}
                      {d.quantity && (
                        <span>
                          {d.quantity} {d.unit}{' '}
                        </span>
                      )}
                      {d.step && <span>Step {d.step} </span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.cost && <span className="text-xs text-green-400">${d.cost}</span>}
                  {d.estimatedHours && (
                    <span className="text-xs text-cyan-400">
                      {d.hoursSpent || 0}/{d.estimatedHours}h
                    </span>
                  )}
                  {d.unitPrice && d.quantity && (
                    <span className="text-xs text-green-400">
                      ${(d.unitPrice * d.quantity).toFixed(2)}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}
                  >
                    {sc.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction('analyze', item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Zap className="w-4 h-4 text-orange-400" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  return (
    <LensPageShell
      domain="diy"
      title="DIY"
      description="Projects, tools, materials, instructions, ideas, and gallery"
      headerIcon={<Wrench className="w-5 h-5 text-white" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <>
          {runAction.isPending && (
            <span className="text-xs text-orange-400 animate-pulse">AI processing...</span>
          )}
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </>
      }
    >
      <UniversalActions domain="diy" artifactId={items[0]?.id} compact />

      {(() => {
        const all = items.map((i) => i.data as unknown as DIYArtifact);
        const totalCost = all.reduce((s, p) => s + (p.cost || 0), 0);
        const totalHours = all.reduce((s, p) => s + (p.hoursSpent || 0), 0);
        const completed = all.filter((p) => p.status === 'completed').length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={ds.panel}>
              <Hammer className="w-5 h-5 text-orange-400 mb-2" />
              <p className={ds.textMuted}>Total Items</p>
              <p className="text-xl font-bold text-white">{items.length}</p>
            </div>
            <div className={ds.panel}>
              <CheckCircle2 className="w-5 h-5 text-green-400 mb-2" />
              <p className={ds.textMuted}>Completed</p>
              <p className="text-xl font-bold text-white">{completed}</p>
            </div>
            <div className={ds.panel}>
              <Clock className="w-5 h-5 text-cyan-400 mb-2" />
              <p className={ds.textMuted}>Hours Spent</p>
              <p className="text-xl font-bold text-white">{totalHours}h</p>
            </div>
            <div className={ds.panel}>
              <DollarSign className="w-5 h-5 text-yellow-400 mb-2" />
              <p className={ds.textMuted}>Total Cost</p>
              <p className="text-xl font-bold text-white">${totalCost.toLocaleString()}</p>
            </div>
          </div>
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
                ? 'bg-orange-500/20 text-orange-400'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
    </LensPageShell>
  );
}
