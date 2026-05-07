'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Users, UserPlus, Briefcase, Award,
  Plus, Search, X, Trash2, DollarSign,
  BarChart3, GraduationCap,
  Layers, ChevronDown, Building2, Heart, Shield, ClipboardList,
  UserCheck, UserMinus, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'employees' | 'recruiting' | 'onboarding' | 'performance' | 'benefits' | 'compliance' | 'training';
type ArtifactType = 'Employee' | 'JobPosting' | 'OnboardingPlan' | 'PerformanceReview' | 'BenefitPlan' | 'ComplianceItem' | 'TrainingProgram';
type Status = 'active' | 'pending' | 'on_leave' | 'terminated' | 'open' | 'closed' | 'in_progress' | 'completed';

interface HRArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  department?: string;
  position?: string;
  hireDate?: string;
  salary?: number;
  manager?: string;
  email?: string;
  phone?: string;
  // Recruiting
  jobTitle?: string;
  applicants?: number;
  location?: string;
  salaryRange?: string;
  postingDate?: string;
  closingDate?: string;
  // Performance
  reviewPeriod?: string;
  rating?: number;
  goals?: string;
  reviewer?: string;
  nextReview?: string;
  // Benefits
  benefitType?: string;
  provider?: string;
  coverage?: string;
  cost?: number;
  enrollmentDeadline?: string;
  // Training
  trainingType?: string;
  duration?: string;
  instructor?: string;
  capacity?: number;
  enrolled?: number;
  certificationOffered?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Users; artifactType: ArtifactType }[] = [
  { id: 'employees', label: 'Employees', icon: Users, artifactType: 'Employee' },
  { id: 'recruiting', label: 'Recruiting', icon: UserPlus, artifactType: 'JobPosting' },
  { id: 'onboarding', label: 'Onboarding', icon: ClipboardList, artifactType: 'OnboardingPlan' },
  { id: 'performance', label: 'Performance', icon: Award, artifactType: 'PerformanceReview' },
  { id: 'benefits', label: 'Benefits', icon: Heart, artifactType: 'BenefitPlan' },
  { id: 'compliance', label: 'Compliance', icon: Shield, artifactType: 'ComplianceItem' },
  { id: 'training', label: 'Training', icon: GraduationCap, artifactType: 'TrainingProgram' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  on_leave: { label: 'On Leave', color: 'blue-400' },
  terminated: { label: 'Terminated', color: 'red-400' },
  open: { label: 'Open', color: 'cyan-400' },
  closed: { label: 'Closed', color: 'gray-400' },
  in_progress: { label: 'In Progress', color: 'purple-400' },
  completed: { label: 'Completed', color: 'emerald-400' },
};

const DEPARTMENTS = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Legal', 'Product', 'Design', 'Support'];
const BENEFIT_TYPES = ['Health Insurance', 'Dental', 'Vision', '401k', 'Life Insurance', 'HSA', 'FSA', 'PTO', 'Disability', 'Tuition Reimbursement'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HRLensPage() {
  useLensNav('hr');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('hr');

  const [activeTab, setActiveTab] = useState<ModeTab>('employees');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<HRArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formDepartment, setFormDepartment] = useState('Engineering');
  const [formPosition, setFormPosition] = useState('');
  const [formSalary, setFormSalary] = useState('');
  const [formHireDate, setFormHireDate] = useState('');
  const [formManager, setFormManager] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formBenefitType, setFormBenefitType] = useState('Health Insurance');
  const [formDuration, setFormDuration] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Employee';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<HRArtifact>('hr', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('hr');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as HRArtifact).description?.toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as HRArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [filtered, runAction]);

  const openCreate = () => {
    setEditingItem(null); setFormName(''); setFormDescription(''); setFormStatus('active'); setFormNotes('');
    setFormDepartment('Engineering'); setFormPosition(''); setFormSalary(''); setFormHireDate('');
    setFormManager(''); setFormEmail(''); setFormBenefitType('Health Insurance'); setFormDuration('');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<HRArtifact>) => {
    const d = item.data as unknown as HRArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'active'); setFormNotes(d.notes || '');
    setFormDepartment(d.department || 'Engineering'); setFormPosition(d.position || '');
    setFormSalary(d.salary?.toString() || ''); setFormHireDate(d.hireDate || '');
    setFormManager(d.manager || ''); setFormEmail(d.email || '');
    setFormBenefitType(d.benefitType || 'Health Insurance'); setFormDuration(d.duration || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus, description: formDescription, notes: formNotes,
      department: formDepartment, position: formPosition, salary: formSalary ? parseFloat(formSalary) : undefined,
      hireDate: formHireDate, manager: formManager, email: formEmail,
      benefitType: formBenefitType, duration: formDuration,
    };
    if (editingItem) {
      await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    } else {
      await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    }
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const employees = items.map(i => i.data as unknown as HRArtifact);
    const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0);
    return (
      <div data-lens-theme="hr" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Users className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Total Headcount</p><p className="text-xl font-bold text-white">{items.length}</p></div>
        <div className={ds.panel}><DollarSign className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Payroll (Annual)</p><p className="text-xl font-bold text-white">${totalSalary.toLocaleString()}</p></div>
        <div className={ds.panel}><UserPlus className="w-5 h-5 text-cyan-400 mb-2" /><p className={ds.textMuted}>Open Positions</p><p className="text-xl font-bold text-white">{employees.filter(e => e.status === 'open').length}</p></div>
        <div className={ds.panel}><Award className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Pending Reviews</p><p className="text-xl font-bold text-white">{employees.filter(e => e.status === 'pending').length}</p></div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div><label className={ds.label}>Status</label>
              <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div><label className={ds.label}>Department</label>
              <select className={ds.select} value={formDepartment} onChange={e => setFormDepartment(e.target.value)}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {activeArtifactType === 'Employee' && (
              <>
                <div><label className={ds.label}>Position</label><input className={ds.input} value={formPosition} onChange={e => setFormPosition(e.target.value)} /></div>
                <div><label className={ds.label}>Salary</label><input type="number" className={ds.input} value={formSalary} onChange={e => setFormSalary(e.target.value)} /></div>
                <div><label className={ds.label}>Hire Date</label><input type="date" className={ds.input} value={formHireDate} onChange={e => setFormHireDate(e.target.value)} /></div>
                <div><label className={ds.label}>Manager</label><input className={ds.input} value={formManager} onChange={e => setFormManager(e.target.value)} /></div>
                <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={formEmail} onChange={e => setFormEmail(e.target.value)} /></div>
              </>
            )}
            {activeArtifactType === 'BenefitPlan' && (
              <div><label className={ds.label}>Benefit Type</label>
                <select className={ds.select} value={formBenefitType} onChange={e => setFormBenefitType(e.target.value)}>
                  {BENEFIT_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}
            {activeArtifactType === 'TrainingProgram' && (
              <div><label className={ds.label}>Duration</label><input className={ds.input} value={formDuration} onChange={e => setFormDuration(e.target.value)} placeholder="e.g., 2 weeks" /></div>
            )}
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button>
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
          <input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
        {filtered.map((item, idx) => {
          const d = item.data as unknown as HRArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
          const statusIcon = d.status === 'active' ? UserCheck : d.status === 'pending' ? UserPlus : d.status === 'terminated' ? UserMinus : Users;
          const StatusIcon = statusIcon;
          return (
            <motion.div key={item.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }} className={ds.panelHover} onClick={() => openEdit(item)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusIcon className={`w-5 h-5 text-${sc.color}`} />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>{d.department} {d.position ? `- ${d.position}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.salary && <span className="text-xs text-green-400">${d.salary.toLocaleString()}</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                  <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-cyan" /></button>
                  <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div>
              </div>
            </motion.div>
          );
        })}
        </AnimatePresence>
      )}
    </div>
  );

  /* Stat computations */
  const allEmployees = items.map(i => i.data as unknown as HRArtifact);
  const activeCount = allEmployees.filter(e => e.status === 'active').length;
  const onboardingCount = allEmployees.filter(e => e.status === 'pending').length;
  const offboardingCount = allEmployees.filter(e => e.status === 'terminated').length;
  const openPositions = allEmployees.filter(e => e.status === 'open').length;
  const deptCounts = DEPARTMENTS.reduce<Record<string, number>>((acc, dept) => {
    acc[dept] = allEmployees.filter(e => e.department === dept).length;
    return acc;
  }, {});
  const maxDeptCount = Math.max(1, ...Object.values(deptCounts));

  return (
    <div data-lens-theme="hr" className="space-y-6 p-6">
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2"><h1 className={ds.heading1}>Human Resources</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div>
            <p className={ds.textMuted}>Employees, recruiting, onboarding, performance, benefits, and training</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}
          <DTUExportButton domain="hr" data={{}} compact />
          <button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button>
        </div>
      </motion.header>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: UserCheck, label: 'Active', value: activeCount, color: 'text-green-400', bg: 'bg-green-400/10' },
          { icon: UserPlus, label: 'Onboarding', value: onboardingCount, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
          { icon: UserMinus, label: 'Offboarding', value: offboardingCount, color: 'text-red-400', bg: 'bg-red-400/10' },
          { icon: Briefcase, label: 'Open Positions', value: openPositions, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.35 }}
            className={cn(ds.panel, 'flex items-center gap-3')}>
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.bg)}>
              <stat.icon className={cn('w-5 h-5', stat.color)} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className={ds.textMuted}>{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Employee Status Badges & Department Headcount Bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className={cn(ds.panel, 'space-y-4')}>
        <h3 className={cn(ds.heading3, 'flex items-center gap-2')}><Building2 className="w-4 h-4 text-blue-400" /> Department Headcount</h3>
        <div className="space-y-2">
          {DEPARTMENTS.filter(d => deptCounts[d] > 0).map(dept => (
            <div key={dept} className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-24 truncate">{dept}</span>
              <div className="flex-1 h-5 bg-lattice-elevated rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(deptCounts[dept] / maxDeptCount) * 100}%` }} transition={{ duration: 0.6, delay: 0.1 }}
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" />
              </div>
              <span className="text-xs text-white font-medium w-6 text-right">{deptCounts[dept]}</span>
            </div>
          ))}
        </div>
      </motion.div>

      <RealtimeDataPanel domain="hr" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="hr" artifactId={items[0]?.id} compact />

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </nav>

      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="hr" /></div>}
      </div>
    </div>
  );
}
