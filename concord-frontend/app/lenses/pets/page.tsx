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
  PawPrint, Plus, Search, Trash2, Calendar, Heart, Layers, ChevronDown,
  Syringe, X, BarChart3, DollarSign, Activity,
  Pill, UtensilsCrossed, Stethoscope, FileText,
  AlertTriangle, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'profiles' | 'health' | 'feeding' | 'activity' | 'expenses' | 'documents';
type ArtifactType = 'PetProfile' | 'HealthRecord' | 'FeedingSchedule' | 'ActivityLog' | 'Expense' | 'Document';
type Status = 'active' | 'scheduled' | 'completed' | 'overdue' | 'pending' | 'archived';

interface PetArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  species?: string; breed?: string; age?: number; weight?: number; color?: string; microchip?: string;
  vetName?: string; vetPhone?: string; nextVetVisit?: string;
  medications?: string; allergies?: string; conditions?: string;
  vaccineType?: string; vaccineDate?: string; vaccineExpiry?: string; vaccineBatch?: string;
  food?: string; feedingTime?: string; portion?: string; frequency?: string;
  activityType?: string; duration?: number; distance?: number; intensity?: string; date?: string;
  amount?: number; category?: string; vendor?: string; receiptDate?: string;
  docType?: string; docUrl?: string; issuedBy?: string; expiryDate?: string;
  petName?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof PawPrint; artifactType: ArtifactType }[] = [
  { id: 'profiles', label: 'Pets', icon: PawPrint, artifactType: 'PetProfile' },
  { id: 'health', label: 'Health', icon: Stethoscope, artifactType: 'HealthRecord' },
  { id: 'feeding', label: 'Feeding', icon: UtensilsCrossed, artifactType: 'FeedingSchedule' },
  { id: 'activity', label: 'Activity', icon: Activity, artifactType: 'ActivityLog' },
  { id: 'expenses', label: 'Expenses', icon: DollarSign, artifactType: 'Expense' },
  { id: 'documents', label: 'Documents', icon: FileText, artifactType: 'Document' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' }, scheduled: { label: 'Scheduled', color: 'blue-400' },
  completed: { label: 'Completed', color: 'emerald-400' }, overdue: { label: 'Overdue', color: 'red-400' },
  pending: { label: 'Pending', color: 'yellow-400' }, archived: { label: 'Archived', color: 'gray-400' },
};

const SPECIES_OPTIONS = ['Dog', 'Cat', 'Bird', 'Fish', 'Rabbit', 'Reptile', 'Hamster', 'Guinea Pig', 'Ferret', 'Horse', 'Other'];
const ACTIVITY_TYPES = ['Walk', 'Run', 'Play', 'Swim', 'Training', 'Grooming', 'Vet Visit', 'Socialization', 'Other'];
const EXPENSE_CATEGORIES = ['Food', 'Vet', 'Medication', 'Grooming', 'Accessories', 'Insurance', 'Training', 'Boarding', 'Other'];
const VACCINE_TYPES = ['Rabies', 'DHPP', 'Bordetella', 'Leptospirosis', 'Lyme', 'FVRCP', 'FeLV', 'Canine Influenza', 'Other'];

export default function PetsLensPage() {
  useLensNav('pets');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('pets');

  const [activeTab, setActiveTab] = useState<ModeTab>('profiles');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<PetArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formSpecies, setFormSpecies] = useState('Dog');
  const [formBreed, setFormBreed] = useState('');
  const [formAge, setFormAge] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formColor, setFormColor] = useState('');
  const [formMicrochip, setFormMicrochip] = useState('');
  const [formVetName, setFormVetName] = useState('');
  const [formVetPhone, setFormVetPhone] = useState('');
  const [formNextVetVisit, setFormNextVetVisit] = useState('');
  const [formMedications, setFormMedications] = useState('');
  const [formAllergies, setFormAllergies] = useState('');
  const [formConditions, setFormConditions] = useState('');
  const [formVaccineType, setFormVaccineType] = useState(VACCINE_TYPES[0]);
  const [formVaccineDate, setFormVaccineDate] = useState('');
  const [formVaccineExpiry, setFormVaccineExpiry] = useState('');
  const [formFood, setFormFood] = useState('');
  const [formFeedingTime, setFormFeedingTime] = useState('');
  const [formPortion, setFormPortion] = useState('');
  const [formFrequency, setFormFrequency] = useState('');
  const [formActivityType, setFormActivityType] = useState(ACTIVITY_TYPES[0]);
  const [formDuration, setFormDuration] = useState('');
  const [formDistance, setFormDistance] = useState('');
  const [formIntensity, setFormIntensity] = useState('moderate');
  const [formDate, setFormDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [formVendor, setFormVendor] = useState('');
  const [formPetName, setFormPetName] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'PetProfile';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<PetArtifact>('pets', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('pets');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as PetArtifact).description?.toLowerCase().includes(q) || (i.data as unknown as PetArtifact).petName?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as PetArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('active'); setFormNotes('');
    setFormSpecies('Dog'); setFormBreed(''); setFormAge(''); setFormWeight('');
    setFormColor(''); setFormMicrochip(''); setFormVetName(''); setFormVetPhone('');
    setFormNextVetVisit(''); setFormMedications(''); setFormAllergies(''); setFormConditions('');
    setFormVaccineType(VACCINE_TYPES[0]); setFormVaccineDate(''); setFormVaccineExpiry('');
    setFormFood(''); setFormFeedingTime(''); setFormPortion(''); setFormFrequency('');
    setFormActivityType(ACTIVITY_TYPES[0]); setFormDuration(''); setFormDistance('');
    setFormIntensity('moderate'); setFormDate(''); setFormAmount('');
    setFormCategory(EXPENSE_CATEGORIES[0]); setFormVendor(''); setFormPetName('');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<PetArtifact>) => {
    const d = item.data as unknown as PetArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'active'); setFormNotes(d.notes || '');
    setFormSpecies(d.species || 'Dog'); setFormBreed(d.breed || '');
    setFormAge(d.age?.toString() || ''); setFormWeight(d.weight?.toString() || '');
    setFormColor(d.color || ''); setFormMicrochip(d.microchip || '');
    setFormVetName(d.vetName || ''); setFormVetPhone(d.vetPhone || '');
    setFormNextVetVisit(d.nextVetVisit || ''); setFormMedications(d.medications || '');
    setFormAllergies(d.allergies || ''); setFormConditions(d.conditions || '');
    setFormVaccineType(d.vaccineType || VACCINE_TYPES[0]);
    setFormVaccineDate(d.vaccineDate || ''); setFormVaccineExpiry(d.vaccineExpiry || '');
    setFormFood(d.food || ''); setFormFeedingTime(d.feedingTime || '');
    setFormPortion(d.portion || ''); setFormFrequency(d.frequency || '');
    setFormActivityType(d.activityType || ACTIVITY_TYPES[0]);
    setFormDuration(d.duration?.toString() || ''); setFormDistance(d.distance?.toString() || '');
    setFormIntensity(d.intensity || 'moderate'); setFormDate(d.date || '');
    setFormAmount(d.amount?.toString() || ''); setFormCategory(d.category || EXPENSE_CATEGORIES[0]);
    setFormVendor(d.vendor || ''); setFormPetName(d.petName || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes, petName: formPetName,
      species: formSpecies, breed: formBreed,
      age: formAge ? parseFloat(formAge) : undefined,
      weight: formWeight ? parseFloat(formWeight) : undefined,
      color: formColor, microchip: formMicrochip,
      vetName: formVetName, vetPhone: formVetPhone, nextVetVisit: formNextVetVisit,
      medications: formMedications, allergies: formAllergies, conditions: formConditions,
      vaccineType: formVaccineType, vaccineDate: formVaccineDate, vaccineExpiry: formVaccineExpiry,
      food: formFood, feedingTime: formFeedingTime, portion: formPortion, frequency: formFrequency,
      activityType: formActivityType,
      duration: formDuration ? parseFloat(formDuration) : undefined,
      distance: formDistance ? parseFloat(formDistance) : undefined,
      intensity: formIntensity, date: formDate || new Date().toISOString().split('T')[0],
      amount: formAmount ? parseFloat(formAmount) : undefined,
      category: formCategory, vendor: formVendor,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as PetArtifact);
    const totalExpenses = all.reduce((s, e) => s + (e.amount || 0), 0);
    const speciesSet = [...new Set(all.map(a => a.species).filter(Boolean))];
    const upcomingVet = all.filter(a => { if (!a.nextVetVisit) return false; return new Date(a.nextVetVisit) <= new Date(Date.now() + 30 * 86400000); }).length;
    const overdueVaccines = all.filter(a => { if (!a.vaccineExpiry) return false; return new Date(a.vaccineExpiry) < new Date(); }).length;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><PawPrint className="w-5 h-5 text-amber-400 mb-2" /><p className={ds.textMuted}>Total Pets</p><p className="text-xl font-bold text-white">{all.filter(a => a.type === 'PetProfile' || !a.type).length || items.length}</p></div>
          <div className={ds.panel}><DollarSign className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Total Expenses</p><p className="text-xl font-bold text-white">${totalExpenses.toLocaleString()}</p></div>
          <div className={ds.panel}><Stethoscope className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Upcoming Vet</p><p className="text-xl font-bold text-white">{upcomingVet}</p></div>
          <div className={ds.panel}><AlertTriangle className="w-5 h-5 text-red-400 mb-2" /><p className={ds.textMuted}>Overdue Vaccines</p><p className="text-xl font-bold text-white">{overdueVaccines}</p></div>
        </div>
        {speciesSet.length > 0 && (
          <div className={ds.panel}>
            <h3 className={ds.heading3}>Species Breakdown</h3>
            <div className="flex flex-wrap gap-2 mt-2">
              {speciesSet.map(s => (
                <span key={s} className="px-3 py-1 rounded-full bg-amber-400/10 text-amber-400 text-sm">{s}: {all.filter(a => a.species === s).length}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType.replace(/([A-Z])/g, ' $1').trim()}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} placeholder={activeArtifactType === 'PetProfile' ? 'Pet name...' : 'Title...'} /></div>
            {activeArtifactType !== 'PetProfile' && (
              <div><label className={ds.label}>Pet</label><input className={ds.input} value={formPetName} onChange={e => setFormPetName(e.target.value)} placeholder="Which pet..." /></div>
            )}
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>

            {activeArtifactType === 'PetProfile' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Species</label><select className={ds.select} value={formSpecies} onChange={e => setFormSpecies(e.target.value)}>{SPECIES_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className={ds.label}>Breed</label><input className={ds.input} value={formBreed} onChange={e => setFormBreed(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Age (yrs)</label><input type="number" className={ds.input} value={formAge} onChange={e => setFormAge(e.target.value)} /></div>
                <div><label className={ds.label}>Weight (lbs)</label><input type="number" className={ds.input} value={formWeight} onChange={e => setFormWeight(e.target.value)} /></div>
                <div><label className={ds.label}>Color</label><input className={ds.input} value={formColor} onChange={e => setFormColor(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Microchip ID</label><input className={ds.input} value={formMicrochip} onChange={e => setFormMicrochip(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Vet Name</label><input className={ds.input} value={formVetName} onChange={e => setFormVetName(e.target.value)} /></div>
                <div><label className={ds.label}>Vet Phone</label><input className={ds.input} value={formVetPhone} onChange={e => setFormVetPhone(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Next Vet Visit</label><input type="date" className={ds.input} value={formNextVetVisit} onChange={e => setFormNextVetVisit(e.target.value)} /></div>
              <div><label className={ds.label}>Medications</label><input className={ds.input} value={formMedications} onChange={e => setFormMedications(e.target.value)} placeholder="Comma-separated..." /></div>
              <div><label className={ds.label}>Allergies</label><input className={ds.input} value={formAllergies} onChange={e => setFormAllergies(e.target.value)} placeholder="Comma-separated..." /></div>
              <div><label className={ds.label}>Medical Conditions</label><input className={ds.input} value={formConditions} onChange={e => setFormConditions(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'HealthRecord' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Vaccine Type</label><select className={ds.select} value={formVaccineType} onChange={e => setFormVaccineType(e.target.value)}>{VACCINE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                <div><label className={ds.label}>Weight (lbs)</label><input type="number" className={ds.input} value={formWeight} onChange={e => setFormWeight(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={formVaccineDate} onChange={e => setFormVaccineDate(e.target.value)} /></div>
                <div><label className={ds.label}>Expiry</label><input type="date" className={ds.input} value={formVaccineExpiry} onChange={e => setFormVaccineExpiry(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Conditions / Diagnosis</label><input className={ds.input} value={formConditions} onChange={e => setFormConditions(e.target.value)} /></div>
              <div><label className={ds.label}>Medications Prescribed</label><input className={ds.input} value={formMedications} onChange={e => setFormMedications(e.target.value)} /></div>
              <div><label className={ds.label}>Cost</label><input type="number" className={ds.input} value={formAmount} onChange={e => setFormAmount(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'FeedingSchedule' && (<>
              <div><label className={ds.label}>Food Brand / Type</label><input className={ds.input} value={formFood} onChange={e => setFormFood(e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Time</label><input type="time" className={ds.input} value={formFeedingTime} onChange={e => setFormFeedingTime(e.target.value)} /></div>
                <div><label className={ds.label}>Portion</label><input className={ds.input} value={formPortion} onChange={e => setFormPortion(e.target.value)} placeholder="1 cup..." /></div>
                <div><label className={ds.label}>Frequency</label><input className={ds.input} value={formFrequency} onChange={e => setFormFrequency(e.target.value)} placeholder="2x daily..." /></div>
              </div>
            </>)}

            {activeArtifactType === 'ActivityLog' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Activity</label><select className={ds.select} value={formActivityType} onChange={e => setFormActivityType(e.target.value)}>{ACTIVITY_TYPES.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Duration (min)</label><input type="number" className={ds.input} value={formDuration} onChange={e => setFormDuration(e.target.value)} /></div>
                <div><label className={ds.label}>Distance (mi)</label><input type="number" className={ds.input} value={formDistance} onChange={e => setFormDistance(e.target.value)} /></div>
                <div><label className={ds.label}>Intensity</label><select className={ds.select} value={formIntensity} onChange={e => setFormIntensity(e.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></div>
              </div>
            </>)}

            {activeArtifactType === 'Expense' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Category</label><select className={ds.select} value={formCategory} onChange={e => setFormCategory(e.target.value)}>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div><label className={ds.label}>Amount</label><input type="number" className={ds.input} value={formAmount} onChange={e => setFormAmount(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Vendor</label><input className={ds.input} value={formVendor} onChange={e => setFormVendor(e.target.value)} /></div>
                <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'Document' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Document Type</label><select className={ds.select} value={formCategory} onChange={e => setFormCategory(e.target.value)}><option value="Registration">Registration</option><option value="Insurance">Insurance</option><option value="Medical">Medical Record</option><option value="License">License</option><option value="Adoption">Adoption Papers</option><option value="Other">Other</option></select></div>
                <div><label className={ds.label}>Expiry</label><input type="date" className={ds.input} value={formVaccineExpiry} onChange={e => setFormVaccineExpiry(e.target.value)} /></div>
              </div>
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
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><PawPrint className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType.replace(/([A-Z])/g, ' $1').trim()} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as PetArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PawPrint className="w-5 h-5 text-amber-400" />
                <div>
                  <p className="text-white font-medium">{d.name || item.title}</p>
                  <p className={ds.textMuted}>
                    {d.petName && <span>{d.petName} &middot; </span>}
                    {d.species && <span>{d.species} </span>}
                    {d.breed && <span>({d.breed}) </span>}
                    {d.activityType && <span>{d.activityType} </span>}
                    {d.duration && <span>{d.duration}min </span>}
                    {d.food && <span>{d.food} </span>}
                    {d.vaccineType && <span>{d.vaccineType} </span>}
                    {d.category && activeArtifactType === 'Expense' && <span>{d.category} </span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {d.amount && <span className="text-xs text-green-400">${d.amount.toLocaleString()}</span>}
                {d.weight && activeArtifactType === 'PetProfile' && <span className="text-xs text-blue-400">{d.weight}lbs</span>}
                {d.age && <span className="text-xs text-purple-400">{d.age}y</span>}
                {d.nextVetVisit && <span className="text-xs text-yellow-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{d.nextVetVisit}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-amber-400" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="pets" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><PawPrint className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Pets</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Pet profiles, health records, feeding, activity, expenses, and documents</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-amber-400 animate-pulse">AI processing...</span>}<DTUExportButton domain="pets" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="pets" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="pets" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as PetArtifact); const speciesCount = [...new Set(all.map(a => a.species).filter(Boolean))].length; const needsVet = all.filter(a => { if (!a.nextVetVisit) return false; return new Date(a.nextVetVisit) <= new Date(Date.now() + 30 * 86400000); }).length; const onMeds = all.filter(a => a.medications && a.medications.length > 0).length; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><PawPrint className="w-5 h-5 text-amber-400 mb-2" /><p className={ds.textMuted}>Total Records</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Heart className="w-5 h-5 text-pink-400 mb-2" /><p className={ds.textMuted}>Species</p><p className="text-xl font-bold text-white">{speciesCount}</p></div>
          <div className={ds.panel}><Syringe className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Upcoming Vet</p><p className="text-xl font-bold text-white">{needsVet}</p></div>
          <div className={ds.panel}><Pill className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>On Medication</p><p className="text-xl font-bold text-white">{onMeds}</p></div>
        </div>
      ); })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-amber-400/20 text-amber-400' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="pets" /></div>}
      </div>
    </div>
  );
}
