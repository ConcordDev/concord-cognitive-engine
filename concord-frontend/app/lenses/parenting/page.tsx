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
  Baby, Plus, Search, Trash2, Calendar, Layers, ChevronDown,
  Milestone, Clock, X, BarChart3, Activity, TrendingUp,
  GraduationCap, Stethoscope, Zap,
  Star,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'milestones' | 'schedules' | 'health' | 'activities' | 'growth' | 'education';
type ArtifactType = 'Milestone' | 'Schedule' | 'HealthCheck' | 'Activity' | 'GrowthRecord' | 'LearningGoal';
type Status = 'recorded' | 'upcoming' | 'active' | 'completed' | 'missed' | 'ongoing';

interface ParentingArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  childName?: string; childAge?: string; date?: string;
  category?: string; milestone?: string;
  scheduleName?: string; time?: string; frequency?: string; days?: string;
  height?: number; weight?: number; headCirc?: number; measureDate?: string; percentile?: string;
  doctorName?: string; clinic?: string; nextVisit?: string; diagnosis?: string; medications?: string; vaccinations?: string;
  activityType?: string; duration?: number; location?: string; participants?: string;
  subject?: string; grade?: string; teacher?: string; term?: string; score?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Baby; artifactType: ArtifactType }[] = [
  { id: 'milestones', label: 'Milestones', icon: Milestone, artifactType: 'Milestone' },
  { id: 'schedules', label: 'Routines', icon: Clock, artifactType: 'Schedule' },
  { id: 'health', label: 'Health', icon: Stethoscope, artifactType: 'HealthCheck' },
  { id: 'activities', label: 'Activities', icon: Activity, artifactType: 'Activity' },
  { id: 'growth', label: 'Growth', icon: TrendingUp, artifactType: 'GrowthRecord' },
  { id: 'education', label: 'Education', icon: GraduationCap, artifactType: 'LearningGoal' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  recorded: { label: 'Recorded', color: 'green-400' }, upcoming: { label: 'Upcoming', color: 'blue-400' },
  active: { label: 'Active', color: 'cyan-400' }, completed: { label: 'Completed', color: 'emerald-400' },
  missed: { label: 'Missed', color: 'red-400' }, ongoing: { label: 'Ongoing', color: 'purple-400' },
};

const MILESTONE_CATEGORIES = ['Physical', 'Cognitive', 'Social', 'Language', 'Emotional', 'Self-Care', 'Motor Skills'];
const SCHEDULE_FREQUENCIES = ['Daily', 'Weekdays', 'Weekends', 'Weekly', 'Biweekly', 'Monthly'];
const ACTIVITY_TYPES = ['Playtime', 'Sports', 'Arts & Crafts', 'Music', 'Reading', 'Outdoor', 'Swimming', 'Playdate', 'Family Time', 'Other'];

export default function ParentingLensPage() {
  useLensNav('parenting');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('parenting');

  const [activeTab, setActiveTab] = useState<ModeTab>('milestones');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ParentingArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('recorded');
  const [formNotes, setFormNotes] = useState('');
  const [formChildName, setFormChildName] = useState('');
  const [formChildAge, setFormChildAge] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formCategory, setFormCategory] = useState(MILESTONE_CATEGORIES[0]);
  const [formTime, setFormTime] = useState('');
  const [formFrequency, setFormFrequency] = useState(SCHEDULE_FREQUENCIES[0]);
  const [formDays, setFormDays] = useState('');
  const [formHeight, setFormHeight] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formHeadCirc, setFormHeadCirc] = useState('');
  const [formPercentile, setFormPercentile] = useState('');
  const [formDoctorName, setFormDoctorName] = useState('');
  const [formClinic, setFormClinic] = useState('');
  const [formNextVisit, setFormNextVisit] = useState('');
  const [formDiagnosis, setFormDiagnosis] = useState('');
  const [formMedications, setFormMedications] = useState('');
  const [formVaccinations, setFormVaccinations] = useState('');
  const [formActivityType, setFormActivityType] = useState(ACTIVITY_TYPES[0]);
  const [formDuration, setFormDuration] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formParticipants, setFormParticipants] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formGrade, setFormGrade] = useState('');
  const [formTeacher, setFormTeacher] = useState('');
  const [formScore, setFormScore] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Milestone';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ParentingArtifact>('parenting', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('parenting');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as ParentingArtifact).childName?.toLowerCase().includes(q) || (i.data as unknown as ParentingArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as ParentingArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('recorded'); setFormNotes('');
    setFormChildName(''); setFormChildAge(''); setFormDate(''); setFormCategory(MILESTONE_CATEGORIES[0]);
    setFormTime(''); setFormFrequency(SCHEDULE_FREQUENCIES[0]); setFormDays('');
    setFormHeight(''); setFormWeight(''); setFormHeadCirc(''); setFormPercentile('');
    setFormDoctorName(''); setFormClinic(''); setFormNextVisit(''); setFormDiagnosis('');
    setFormMedications(''); setFormVaccinations('');
    setFormActivityType(ACTIVITY_TYPES[0]); setFormDuration(''); setFormLocation(''); setFormParticipants('');
    setFormSubject(''); setFormGrade(''); setFormTeacher(''); setFormScore('');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<ParentingArtifact>) => {
    const d = item.data as unknown as ParentingArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'recorded'); setFormNotes(d.notes || '');
    setFormChildName(d.childName || ''); setFormChildAge(d.childAge || '');
    setFormDate(d.date || ''); setFormCategory(d.category || MILESTONE_CATEGORIES[0]);
    setFormTime(d.time || ''); setFormFrequency(d.frequency || SCHEDULE_FREQUENCIES[0]); setFormDays(d.days || '');
    setFormHeight(d.height?.toString() || ''); setFormWeight(d.weight?.toString() || '');
    setFormHeadCirc(d.headCirc?.toString() || ''); setFormPercentile(d.percentile || '');
    setFormDoctorName(d.doctorName || ''); setFormClinic(d.clinic || '');
    setFormNextVisit(d.nextVisit || ''); setFormDiagnosis(d.diagnosis || '');
    setFormMedications(d.medications || ''); setFormVaccinations(d.vaccinations || '');
    setFormActivityType(d.activityType || ACTIVITY_TYPES[0]);
    setFormDuration(d.duration?.toString() || ''); setFormLocation(d.location || ''); setFormParticipants(d.participants || '');
    setFormSubject(d.subject || ''); setFormGrade(d.grade || '');
    setFormTeacher(d.teacher || ''); setFormScore(d.score || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes,
      childName: formChildName, childAge: formChildAge,
      date: formDate || new Date().toISOString().split('T')[0],
      category: formCategory, time: formTime, frequency: formFrequency, days: formDays,
      height: formHeight ? parseFloat(formHeight) : undefined,
      weight: formWeight ? parseFloat(formWeight) : undefined,
      headCirc: formHeadCirc ? parseFloat(formHeadCirc) : undefined,
      percentile: formPercentile,
      doctorName: formDoctorName, clinic: formClinic, nextVisit: formNextVisit,
      diagnosis: formDiagnosis, medications: formMedications, vaccinations: formVaccinations,
      activityType: formActivityType,
      duration: formDuration ? parseFloat(formDuration) : undefined,
      location: formLocation, participants: formParticipants,
      subject: formSubject, grade: formGrade, teacher: formTeacher, score: formScore,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as ParentingArtifact);
    const children = [...new Set(all.map(a => a.childName).filter(Boolean))];
    const categories = [...new Set(all.map(a => a.category).filter(Boolean))];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Baby className="w-5 h-5 text-pink-400 mb-2" /><p className={ds.textMuted}>Children</p><p className="text-xl font-bold text-white">{children.length}</p></div>
          <div className={ds.panel}><Milestone className="w-5 h-5 text-purple-400 mb-2" /><p className={ds.textMuted}>Total Records</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Star className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Categories</p><p className="text-xl font-bold text-white">{categories.length}</p></div>
          <div className={ds.panel}><Calendar className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>This Month</p><p className="text-xl font-bold text-white">{all.filter(a => { if (!a.date) return false; const d = new Date(a.date); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length}</p></div>
        </div>
        {children.length > 0 && (
          <div className={ds.panel}>
            <h3 className={ds.heading3}>Per-Child Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {children.map(child => (
                <div key={child} className="bg-lattice-elevated rounded-lg p-3">
                  <p className="text-white font-medium">{child}</p>
                  <p className={ds.textMuted}>{all.filter(a => a.childName === child).length} records</p>
                </div>
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
            <div><label className={ds.label}>Title</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Child&apos;s Name</label><input className={ds.input} value={formChildName} onChange={e => setFormChildName(e.target.value)} /></div>
              <div><label className={ds.label}>Child&apos;s Age</label><input className={ds.input} value={formChildAge} onChange={e => setFormChildAge(e.target.value)} placeholder="e.g. 2y 3m" /></div>
            </div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
            </div>

            {activeArtifactType === 'Milestone' && (
              <div><label className={ds.label}>Category</label><select className={ds.select} value={formCategory} onChange={e => setFormCategory(e.target.value)}>{MILESTONE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            )}

            {activeArtifactType === 'Schedule' && (<>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Time</label><input type="time" className={ds.input} value={formTime} onChange={e => setFormTime(e.target.value)} /></div>
                <div><label className={ds.label}>Frequency</label><select className={ds.select} value={formFrequency} onChange={e => setFormFrequency(e.target.value)}>{SCHEDULE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                <div><label className={ds.label}>Days</label><input className={ds.input} value={formDays} onChange={e => setFormDays(e.target.value)} placeholder="Mon,Tue..." /></div>
              </div>
            </>)}

            {activeArtifactType === 'HealthCheck' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Doctor</label><input className={ds.input} value={formDoctorName} onChange={e => setFormDoctorName(e.target.value)} /></div>
                <div><label className={ds.label}>Clinic</label><input className={ds.input} value={formClinic} onChange={e => setFormClinic(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Next Visit</label><input type="date" className={ds.input} value={formNextVisit} onChange={e => setFormNextVisit(e.target.value)} /></div>
              <div><label className={ds.label}>Diagnosis / Notes</label><input className={ds.input} value={formDiagnosis} onChange={e => setFormDiagnosis(e.target.value)} /></div>
              <div><label className={ds.label}>Medications</label><input className={ds.input} value={formMedications} onChange={e => setFormMedications(e.target.value)} /></div>
              <div><label className={ds.label}>Vaccinations</label><input className={ds.input} value={formVaccinations} onChange={e => setFormVaccinations(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Activity' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Activity Type</label><select className={ds.select} value={formActivityType} onChange={e => setFormActivityType(e.target.value)}>{ACTIVITY_TYPES.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label className={ds.label}>Duration (min)</label><input type="number" className={ds.input} value={formDuration} onChange={e => setFormDuration(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Location</label><input className={ds.input} value={formLocation} onChange={e => setFormLocation(e.target.value)} /></div>
                <div><label className={ds.label}>Participants</label><input className={ds.input} value={formParticipants} onChange={e => setFormParticipants(e.target.value)} /></div>
              </div>
            </>)}

            {activeArtifactType === 'GrowthRecord' && (<>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={ds.label}>Height (in)</label><input type="number" className={ds.input} value={formHeight} onChange={e => setFormHeight(e.target.value)} /></div>
                <div><label className={ds.label}>Weight (lbs)</label><input type="number" className={ds.input} value={formWeight} onChange={e => setFormWeight(e.target.value)} /></div>
                <div><label className={ds.label}>Head Circ (in)</label><input type="number" className={ds.input} value={formHeadCirc} onChange={e => setFormHeadCirc(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Percentile</label><input className={ds.input} value={formPercentile} onChange={e => setFormPercentile(e.target.value)} placeholder="e.g. 75th" /></div>
            </>)}

            {activeArtifactType === 'LearningGoal' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Subject</label><input className={ds.input} value={formSubject} onChange={e => setFormSubject(e.target.value)} /></div>
                <div><label className={ds.label}>Grade / Level</label><input className={ds.input} value={formGrade} onChange={e => setFormGrade(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Teacher</label><input className={ds.input} value={formTeacher} onChange={e => setFormTeacher(e.target.value)} /></div>
                <div><label className={ds.label}>Score</label><input className={ds.input} value={formScore} onChange={e => setFormScore(e.target.value)} /></div>
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
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Baby className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType.replace(/([A-Z])/g, ' $1').trim()} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as ParentingArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.recorded;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Baby className="w-5 h-5 text-pink-400" /><div>
                <p className="text-white font-medium">{d.name || item.title}</p>
                <p className={ds.textMuted}>
                  {d.childName && <span>{d.childName} </span>}
                  {d.childAge && <span>({d.childAge}) </span>}
                  {d.category && <span>&middot; {d.category} </span>}
                  {d.activityType && <span>&middot; {d.activityType} </span>}
                  {d.duration && <span>{d.duration}min </span>}
                  {d.subject && <span>&middot; {d.subject} </span>}
                  {d.height && <span>&middot; {d.height}in </span>}
                  {d.weight && <span>{d.weight}lbs </span>}
                </p>
              </div></div>
              <div className="flex items-center gap-2">
                {d.date && <span className="text-xs text-gray-400">{d.date}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-pink-400" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="parenting" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center"><Baby className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Parenting</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Milestones, routines, health, activities, growth tracking, and education</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-pink-400 animate-pulse">AI processing...</span>}<DTUExportButton domain="parenting" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="parenting" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="parenting" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as ParentingArtifact); const children = [...new Set(all.map(a => a.childName).filter(Boolean))].length; const thisMonth = all.filter(a => { if (!a.date) return false; const d = new Date(a.date); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length; const upcoming = all.filter(a => a.status === 'upcoming').length; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Baby className="w-5 h-5 text-pink-400 mb-2" /><p className={ds.textMuted}>Children</p><p className="text-xl font-bold text-white">{children}</p></div>
          <div className={ds.panel}><Milestone className="w-5 h-5 text-purple-400 mb-2" /><p className={ds.textMuted}>Total Records</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Calendar className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>This Month</p><p className="text-xl font-bold text-white">{thisMonth}</p></div>
          <div className={ds.panel}><Clock className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Upcoming</p><p className="text-xl font-bold text-white">{upcoming}</p></div>
        </div>
      ); })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-pink-500/20 text-pink-400' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="parenting" /></div>}
      </div>
    </div>
  );
}
