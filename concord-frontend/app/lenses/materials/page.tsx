'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Box, Layers, Plus, Trash2, Search, ChevronDown,
  Zap, Shield, FlaskConical, Microscope, X, BarChart3,
  Database, Beaker, Scale,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'library' | 'tests' | 'comparisons' | 'suppliers' | 'composites' | 'standards';
type ArtifactType = 'Material' | 'Test' | 'Comparison' | 'Supplier' | 'Composite' | 'Standard';
type Status = 'active' | 'tested' | 'pending' | 'approved' | 'rejected' | 'archived';

interface MaterialArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  category?: string; grade?: string;
  density?: number; tensileStrength?: number; thermalConductivity?: number;
  meltingPoint?: number; youngsModulus?: number; hardness?: number;
  electricalResistivity?: number; thermalExpansion?: number;
  applications?: string; composition?: string;
  testType?: string; testDate?: string; testResult?: string; specimen?: string;
  comparisonMaterials?: string; criteria?: string; winner?: string;
  supplierName?: string; leadTime?: string; moq?: number; pricePerUnit?: number; currency?: string;
  components?: string; ratio?: string; processMethod?: string;
  standardBody?: string; standardId?: string; scope?: string; version?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Box; artifactType: ArtifactType }[] = [
  { id: 'library', label: 'Library', icon: Database, artifactType: 'Material' },
  { id: 'tests', label: 'Tests', icon: FlaskConical, artifactType: 'Test' },
  { id: 'comparisons', label: 'Compare', icon: Scale, artifactType: 'Comparison' },
  { id: 'suppliers', label: 'Suppliers', icon: Box, artifactType: 'Supplier' },
  { id: 'composites', label: 'Composites', icon: Beaker, artifactType: 'Composite' },
  { id: 'standards', label: 'Standards', icon: Shield, artifactType: 'Standard' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' }, tested: { label: 'Tested', color: 'blue-400' },
  pending: { label: 'Pending', color: 'yellow-400' }, approved: { label: 'Approved', color: 'emerald-400' },
  rejected: { label: 'Rejected', color: 'red-400' }, archived: { label: 'Archived', color: 'gray-400' },
};

const MATERIAL_CATEGORIES = ['Metal', 'Polymer', 'Ceramic', 'Composite', 'Semiconductor', 'Biomaterial', 'Glass', 'Wood', 'Concrete', 'Textile'];
const TEST_TYPES = ['Tensile', 'Compression', 'Hardness', 'Fatigue', 'Impact', 'Creep', 'Corrosion', 'Thermal', 'Electrical', 'Chemical'];
const STANDARD_BODIES = ['ASTM', 'ISO', 'JIS', 'DIN', 'BS', 'AISI', 'SAE', 'UNS', 'Custom'];

export default function MaterialsLensPage() {
  useLensNav('materials');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('materials');

  const [activeTab, setActiveTab] = useState<ModeTab>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<MaterialArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formCategory, setFormCategory] = useState(MATERIAL_CATEGORIES[0]);
  const [formGrade, setFormGrade] = useState('');
  const [formDensity, setFormDensity] = useState('');
  const [formTensileStrength, setFormTensileStrength] = useState('');
  const [formThermalConductivity, setFormThermalConductivity] = useState('');
  const [formMeltingPoint, setFormMeltingPoint] = useState('');
  const [formYoungsModulus, setFormYoungsModulus] = useState('');
  const [formHardness, setFormHardness] = useState('');
  const [formApplications, setFormApplications] = useState('');
  const [formComposition, setFormComposition] = useState('');
  const [formTestType, setFormTestType] = useState(TEST_TYPES[0]);
  const [formTestDate, setFormTestDate] = useState('');
  const [formTestResult, setFormTestResult] = useState('');
  const [formSpecimen, setFormSpecimen] = useState('');
  const [formComparisonMaterials, setFormComparisonMaterials] = useState('');
  const [formCriteria, setFormCriteria] = useState('');
  const [formWinner, setFormWinner] = useState('');
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formLeadTime, setFormLeadTime] = useState('');
  const [formMoq, setFormMoq] = useState('');
  const [formPricePerUnit, setFormPricePerUnit] = useState('');
  const [formComponents, setFormComponents] = useState('');
  const [formRatio, setFormRatio] = useState('');
  const [formProcessMethod, setFormProcessMethod] = useState('');
  const [formStandardBody, setFormStandardBody] = useState(STANDARD_BODIES[0]);
  const [formStandardId, setFormStandardId] = useState('');
  const [formScope, setFormScope] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Material';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<MaterialArtifact>('materials', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('materials');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as MaterialArtifact).description?.toLowerCase().includes(q) || (i.data as unknown as MaterialArtifact).category?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as MaterialArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('active'); setFormNotes('');
    setFormCategory(MATERIAL_CATEGORIES[0]); setFormGrade('');
    setFormDensity(''); setFormTensileStrength(''); setFormThermalConductivity('');
    setFormMeltingPoint(''); setFormYoungsModulus(''); setFormHardness('');
    setFormApplications(''); setFormComposition('');
    setFormTestType(TEST_TYPES[0]); setFormTestDate(''); setFormTestResult(''); setFormSpecimen('');
    setFormComparisonMaterials(''); setFormCriteria(''); setFormWinner('');
    setFormSupplierName(''); setFormLeadTime(''); setFormMoq(''); setFormPricePerUnit('');
    setFormComponents(''); setFormRatio(''); setFormProcessMethod('');
    setFormStandardBody(STANDARD_BODIES[0]); setFormStandardId(''); setFormScope('');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<MaterialArtifact>) => {
    const d = item.data as unknown as MaterialArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'active'); setFormNotes(d.notes || '');
    setFormCategory(d.category || MATERIAL_CATEGORIES[0]); setFormGrade(d.grade || '');
    setFormDensity(d.density?.toString() || ''); setFormTensileStrength(d.tensileStrength?.toString() || '');
    setFormThermalConductivity(d.thermalConductivity?.toString() || '');
    setFormMeltingPoint(d.meltingPoint?.toString() || ''); setFormYoungsModulus(d.youngsModulus?.toString() || '');
    setFormHardness(d.hardness?.toString() || '');
    setFormApplications(d.applications || ''); setFormComposition(d.composition || '');
    setFormTestType(d.testType || TEST_TYPES[0]); setFormTestDate(d.testDate || '');
    setFormTestResult(d.testResult || ''); setFormSpecimen(d.specimen || '');
    setFormComparisonMaterials(d.comparisonMaterials || ''); setFormCriteria(d.criteria || '');
    setFormWinner(d.winner || '');
    setFormSupplierName(d.supplierName || ''); setFormLeadTime(d.leadTime || '');
    setFormMoq(d.moq?.toString() || ''); setFormPricePerUnit(d.pricePerUnit?.toString() || '');
    setFormComponents(d.components || ''); setFormRatio(d.ratio || '');
    setFormProcessMethod(d.processMethod || '');
    setFormStandardBody(d.standardBody || STANDARD_BODIES[0]); setFormStandardId(d.standardId || '');
    setFormScope(d.scope || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes, category: formCategory, grade: formGrade,
      density: formDensity ? parseFloat(formDensity) : undefined,
      tensileStrength: formTensileStrength ? parseFloat(formTensileStrength) : undefined,
      thermalConductivity: formThermalConductivity ? parseFloat(formThermalConductivity) : undefined,
      meltingPoint: formMeltingPoint ? parseFloat(formMeltingPoint) : undefined,
      youngsModulus: formYoungsModulus ? parseFloat(formYoungsModulus) : undefined,
      hardness: formHardness ? parseFloat(formHardness) : undefined,
      applications: formApplications, composition: formComposition,
      testType: formTestType, testDate: formTestDate, testResult: formTestResult, specimen: formSpecimen,
      comparisonMaterials: formComparisonMaterials, criteria: formCriteria, winner: formWinner,
      supplierName: formSupplierName, leadTime: formLeadTime,
      moq: formMoq ? parseInt(formMoq) : undefined,
      pricePerUnit: formPricePerUnit ? parseFloat(formPricePerUnit) : undefined,
      components: formComponents, ratio: formRatio, processMethod: formProcessMethod,
      standardBody: formStandardBody, standardId: formStandardId, scope: formScope,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as MaterialArtifact);
    const cats = [...new Set(all.map(m => m.category).filter(Boolean))].length;
    const tested = all.filter(m => m.status === 'tested' || m.status === 'approved').length;
    const props = ['density', 'tensileStrength', 'thermalConductivity', 'meltingPoint', 'youngsModulus', 'hardness'].filter(p => all.some(m => (m as unknown as Record<string, number>)[p] > 0)).length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Box className="w-5 h-5 text-zinc-300 mb-2" /><p className={ds.textMuted}>Catalog Size</p><p className="text-xl font-bold text-white">{items.length}</p></div>
        <div className={ds.panel}><Layers className="w-5 h-5 text-purple-400 mb-2" /><p className={ds.textMuted}>Categories</p><p className="text-xl font-bold text-white">{cats}</p></div>
        <div className={ds.panel}><FlaskConical className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Tested</p><p className="text-xl font-bold text-white">{tested}</p></div>
        <div className={ds.panel}><Microscope className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Properties</p><p className="text-xl font-bold text-white">{props}</p></div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={formCategory} onChange={e => setFormCategory(e.target.value)}>{MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>

            {activeArtifactType === 'Material' && (<>
              <div><label className={ds.label}>Grade / Alloy</label><input className={ds.input} value={formGrade} onChange={e => setFormGrade(e.target.value)} placeholder="e.g. 304, 6061-T6" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Density (g/cm3)</label><input type="number" step="0.01" className={ds.input} value={formDensity} onChange={e => setFormDensity(e.target.value)} /></div>
                <div><label className={ds.label}>Tensile (MPa)</label><input type="number" className={ds.input} value={formTensileStrength} onChange={e => setFormTensileStrength(e.target.value)} /></div>
                <div><label className={ds.label}>Hardness</label><input type="number" className={ds.input} value={formHardness} onChange={e => setFormHardness(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Thermal K (W/mK)</label><input type="number" step="0.1" className={ds.input} value={formThermalConductivity} onChange={e => setFormThermalConductivity(e.target.value)} /></div>
                <div><label className={ds.label}>Melting (C)</label><input type="number" className={ds.input} value={formMeltingPoint} onChange={e => setFormMeltingPoint(e.target.value)} /></div>
                <div><label className={ds.label}>Young&apos;s (GPa)</label><input type="number" step="0.1" className={ds.input} value={formYoungsModulus} onChange={e => setFormYoungsModulus(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Composition</label><input className={ds.input} value={formComposition} onChange={e => setFormComposition(e.target.value)} placeholder="Fe 70%, Cr 18%, Ni 8%..." /></div>
              <div><label className={ds.label}>Applications</label><input className={ds.input} value={formApplications} onChange={e => setFormApplications(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Test' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Test Type</label><select className={ds.select} value={formTestType} onChange={e => setFormTestType(e.target.value)}>{TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={formTestDate} onChange={e => setFormTestDate(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Specimen</label><input className={ds.input} value={formSpecimen} onChange={e => setFormSpecimen(e.target.value)} /></div>
              <div><label className={ds.label}>Result</label><textarea className={ds.textarea} rows={2} value={formTestResult} onChange={e => setFormTestResult(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Comparison' && (<>
              <div><label className={ds.label}>Materials to Compare</label><input className={ds.input} value={formComparisonMaterials} onChange={e => setFormComparisonMaterials(e.target.value)} placeholder="Comma-separated..." /></div>
              <div><label className={ds.label}>Criteria</label><input className={ds.input} value={formCriteria} onChange={e => setFormCriteria(e.target.value)} placeholder="Strength, weight, cost..." /></div>
              <div><label className={ds.label}>Winner</label><input className={ds.input} value={formWinner} onChange={e => setFormWinner(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Supplier' && (<>
              <div><label className={ds.label}>Supplier Name</label><input className={ds.input} value={formSupplierName} onChange={e => setFormSupplierName(e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Lead Time</label><input className={ds.input} value={formLeadTime} onChange={e => setFormLeadTime(e.target.value)} placeholder="2 weeks" /></div>
                <div><label className={ds.label}>MOQ</label><input type="number" className={ds.input} value={formMoq} onChange={e => setFormMoq(e.target.value)} /></div>
                <div><label className={ds.label}>Price/Unit</label><input type="number" step="0.01" className={ds.input} value={formPricePerUnit} onChange={e => setFormPricePerUnit(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Composite' && (<>
              <div><label className={ds.label}>Components</label><input className={ds.input} value={formComponents} onChange={e => setFormComponents(e.target.value)} placeholder="Carbon fiber, Epoxy resin..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Ratio</label><input className={ds.input} value={formRatio} onChange={e => setFormRatio(e.target.value)} placeholder="60/40" /></div>
                <div><label className={ds.label}>Process Method</label><input className={ds.input} value={formProcessMethod} onChange={e => setFormProcessMethod(e.target.value)} placeholder="Autoclave, RTM..." /></div>
              </div>
            </>)}

            {activeArtifactType === 'Standard' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Body</label><select className={ds.select} value={formStandardBody} onChange={e => setFormStandardBody(e.target.value)}>{STANDARD_BODIES.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                <div><label className={ds.label}>Standard ID</label><input className={ds.input} value={formStandardId} onChange={e => setFormStandardId(e.target.value)} placeholder="ASTM A36" /></div>
              </div>
              <div><label className={ds.label}>Scope</label><textarea className={ds.textarea} rows={2} value={formScope} onChange={e => setFormScope(e.target.value)} /></div>
            </>)}

            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button><button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button></div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" /><input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Status</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Box className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as MaterialArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Box className="w-5 h-5 text-zinc-300" /><div>
                <p className="text-white font-medium">{d.name || item.title}</p>
                <p className={ds.textMuted}>
                  {d.category && <span>{d.category} </span>}
                  {d.grade && <span>({d.grade}) </span>}
                  {d.testType && <span>{d.testType} test </span>}
                  {d.supplierName && <span>{d.supplierName} </span>}
                  {d.standardBody && d.standardId && <span>{d.standardBody} {d.standardId} </span>}
                  {d.components && <span>{d.components} </span>}
                  {d.density && <span>&middot; {d.density} g/cm3 </span>}
                  {d.tensileStrength && <span>&middot; {d.tensileStrength} MPa </span>}
                </p>
              </div></div>
              <div className="flex items-center gap-2">
                {d.meltingPoint && <span className="text-xs text-orange-400">{d.meltingPoint}&deg;C</span>}
                {d.pricePerUnit && <span className="text-xs text-green-400">${d.pricePerUnit}/unit</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-zinc-300" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="materials" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-400 to-slate-600 flex items-center justify-center"><Box className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Materials Science</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Material library, tests, comparisons, suppliers, composites, and standards</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-zinc-300 animate-pulse">AI processing...</span>}<DTUExportButton domain="materials" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="materials" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="materials" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as MaterialArtifact); const cats = [...new Set(all.map(m => m.category).filter(Boolean))].length; const tested = all.filter(m => m.status === 'tested' || m.status === 'approved').length; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Box className="w-5 h-5 text-zinc-300 mb-2" /><p className={ds.textMuted}>Catalog</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Layers className="w-5 h-5 text-purple-400 mb-2" /><p className={ds.textMuted}>Categories</p><p className="text-xl font-bold text-white">{cats}</p></div>
          <div className={ds.panel}><FlaskConical className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Tested</p><p className="text-xl font-bold text-white">{tested}</p></div>
          <div className={ds.panel}><Shield className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Approved</p><p className="text-xl font-bold text-white">{all.filter(m => m.status === 'approved').length}</p></div>
        </div>
      ); })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-zinc-300/20 text-zinc-300' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="materials" /></div>}
      </div>
    </div>
  );
}
