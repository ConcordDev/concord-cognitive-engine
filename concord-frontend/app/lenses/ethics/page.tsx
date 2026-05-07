'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Scale,
  Brain,
  Shield,
  Gavel,
  BookOpen,
  Plus,
  Search,
  Trash2,
  X,
  BarChart3,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Lightbulb,
} from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab = 'frameworks' | 'dilemmas' | 'cases' | 'principles' | 'reviews' | 'policies';
type ArtifactType = 'Framework' | 'Dilemma' | 'Case' | 'Principle' | 'Review' | 'Policy';
type Status = 'active' | 'resolved' | 'pending' | 'contested' | 'archived' | 'draft';

interface EthicsArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  framework?: string;
  weight?: number;
  principle?: string;
  focus?: string;
  dilemma?: string;
  analysis?: string;
  verdict?: string;
  stakeholders?: string;
  consequences?: string;
  alternatives?: string;
  caseTitle?: string;
  jurisdiction?: string;
  precedent?: string;
  outcome?: string;
  category?: string;
  source?: string;
  scope?: string;
  reviewer?: string;
  recommendation?: string;
  riskLevel?: string;
  policyArea?: string;
  effectiveDate?: string;
  expiryDate?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Scale; artifactType: ArtifactType }[] =
  [
    { id: 'frameworks', label: 'Frameworks', icon: Scale, artifactType: 'Framework' },
    { id: 'dilemmas', label: 'Dilemmas', icon: Gavel, artifactType: 'Dilemma' },
    { id: 'cases', label: 'Cases', icon: BookOpen, artifactType: 'Case' },
    { id: 'principles', label: 'Principles', icon: Lightbulb, artifactType: 'Principle' },
    { id: 'reviews', label: 'Reviews', icon: Eye, artifactType: 'Review' },
    { id: 'policies', label: 'Policies', icon: Shield, artifactType: 'Policy' },
  ];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' },
  resolved: { label: 'Resolved', color: 'emerald-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  contested: { label: 'Contested', color: 'red-400' },
  archived: { label: 'Archived', color: 'gray-400' },
  draft: { label: 'Draft', color: 'blue-400' },
};

const FRAMEWORK_TYPES = [
  'Utilitarian',
  'Deontological',
  'Virtue Ethics',
  'Care Ethics',
  'Rights-Based',
  'Justice',
  'Contractarian',
  'Pragmatic',
  'Custom',
];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const CATEGORIES = [
  'AI Ethics',
  'Bioethics',
  'Business Ethics',
  'Environmental',
  'Social Justice',
  'Privacy',
  'Governance',
  'Technology',
  'Other',
];

export default function EthicsLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('frameworks');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<EthicsArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formFramework, setFormFramework] = useState(FRAMEWORK_TYPES[0]);
  const [formWeight, setFormWeight] = useState('');
  const [formPrinciple, setFormPrinciple] = useState('');
  const [formFocus, setFormFocus] = useState('');
  const [formDilemma, setFormDilemma] = useState('');
  const [formAnalysis, setFormAnalysis] = useState('');
  const [formVerdict, setFormVerdict] = useState('');
  const [formStakeholders, setFormStakeholders] = useState('');
  const [formConsequences, setFormConsequences] = useState('');
  const [formAlternatives, setFormAlternatives] = useState('');
  const [formJurisdiction, setFormJurisdiction] = useState('');
  const [formPrecedent, setFormPrecedent] = useState('');
  const [formOutcome, setFormOutcome] = useState('');
  const [formCategory, setFormCategory] = useState(CATEGORIES[0]);
  const [formSource, setFormSource] = useState('');
  const [formScope, setFormScope] = useState('');
  const [formReviewer, setFormReviewer] = useState('');
  const [formRecommendation, setFormRecommendation] = useState('');
  const [formRiskLevel, setFormRiskLevel] = useState(RISK_LEVELS[0]);
  const [formPolicyArea, setFormPolicyArea] = useState('');
  const [formEffectiveDate, setFormEffectiveDate] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Framework';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<EthicsArtifact>('ethics', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('ethics');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as EthicsArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter((i) => (i.data as unknown as EthicsArtifact).status === filterStatus);
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
    setFormStatus('active');
    setFormNotes('');
    setFormFramework(FRAMEWORK_TYPES[0]);
    setFormWeight('');
    setFormPrinciple('');
    setFormFocus('');
    setFormDilemma('');
    setFormAnalysis('');
    setFormVerdict('');
    setFormStakeholders('');
    setFormConsequences('');
    setFormAlternatives('');
    setFormJurisdiction('');
    setFormPrecedent('');
    setFormOutcome('');
    setFormCategory(CATEGORIES[0]);
    setFormSource('');
    setFormScope('');
    setFormReviewer('');
    setFormRecommendation('');
    setFormRiskLevel(RISK_LEVELS[0]);
    setFormPolicyArea('');
    setFormEffectiveDate('');
    setFormExpiryDate('');
  };

  const openCreate = () => {
    setEditingItem(null);
    resetForm();
    setEditorOpen(true);
  };
  const openEdit = (item: LensItem<EthicsArtifact>) => {
    const d = item.data as unknown as EthicsArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'active');
    setFormNotes(d.notes || '');
    setFormFramework(d.framework || FRAMEWORK_TYPES[0]);
    setFormWeight(d.weight?.toString() || '');
    setFormPrinciple(d.principle || '');
    setFormFocus(d.focus || '');
    setFormDilemma(d.dilemma || '');
    setFormAnalysis(d.analysis || '');
    setFormVerdict(d.verdict || '');
    setFormStakeholders(d.stakeholders || '');
    setFormConsequences(d.consequences || '');
    setFormAlternatives(d.alternatives || '');
    setFormJurisdiction(d.jurisdiction || '');
    setFormPrecedent(d.precedent || '');
    setFormOutcome(d.outcome || '');
    setFormCategory(d.category || CATEGORIES[0]);
    setFormSource(d.source || '');
    setFormScope(d.scope || '');
    setFormReviewer(d.reviewer || '');
    setFormRecommendation(d.recommendation || '');
    setFormRiskLevel(d.riskLevel || RISK_LEVELS[0]);
    setFormPolicyArea(d.policyArea || '');
    setFormEffectiveDate(d.effectiveDate || '');
    setFormExpiryDate(d.expiryDate || '');
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
      framework: formFramework,
      weight: formWeight ? parseFloat(formWeight) : undefined,
      principle: formPrinciple,
      focus: formFocus,
      dilemma: formDilemma,
      analysis: formAnalysis,
      verdict: formVerdict,
      stakeholders: formStakeholders,
      consequences: formConsequences,
      alternatives: formAlternatives,
      jurisdiction: formJurisdiction,
      precedent: formPrecedent,
      outcome: formOutcome,
      source: formSource,
      scope: formScope,
      reviewer: formReviewer,
      recommendation: formRecommendation,
      riskLevel: formRiskLevel,
      policyArea: formPolicyArea,
      effectiveDate: formEffectiveDate,
      expiryDate: formExpiryDate,
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
    const all = items.map((i) => i.data as unknown as EthicsArtifact);
    const contested = all.filter((a) => a.status === 'contested').length;
    const resolved = all.filter((a) => a.status === 'resolved').length;
    const fws = [...new Set(all.map((a) => a.framework).filter(Boolean))].length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Scale className="w-5 h-5 text-neon-purple mb-2" />
          <p className={ds.textMuted}>Total Items</p>
          <p className="text-xl font-bold text-white">{items.length}</p>
        </div>
        <div className={ds.panel}>
          <Brain className="w-5 h-5 text-pink-400 mb-2" />
          <p className={ds.textMuted}>Frameworks</p>
          <p className="text-xl font-bold text-white">{fws}</p>
        </div>
        <div className={ds.panel}>
          <CheckCircle2 className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Resolved</p>
          <p className="text-xl font-bold text-white">{resolved}</p>
        </div>
        <div className={ds.panel}>
          <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
          <p className={ds.textMuted}>Contested</p>
          <p className="text-xl font-bold text-white">{contested}</p>
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

            {activeArtifactType === 'Framework' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Framework Type</label>
                    <select
                      className={ds.select}
                      value={formFramework}
                      onChange={(e) => setFormFramework(e.target.value)}
                    >
                      {FRAMEWORK_TYPES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Weight (0-1)</label>
                    <input
                      type="number"
                      step="0.01"
                      className={ds.input}
                      value={formWeight}
                      onChange={(e) => setFormWeight(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Core Principle</label>
                  <input
                    className={ds.input}
                    value={formPrinciple}
                    onChange={(e) => setFormPrinciple(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Focus Area</label>
                  <input
                    className={ds.input}
                    value={formFocus}
                    onChange={(e) => setFormFocus(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Dilemma' && (
              <>
                <div>
                  <label className={ds.label}>Dilemma Statement</label>
                  <textarea
                    className={ds.textarea}
                    rows={3}
                    value={formDilemma}
                    onChange={(e) => setFormDilemma(e.target.value)}
                    placeholder="Describe the ethical dilemma..."
                  />
                </div>
                <div>
                  <label className={ds.label}>Stakeholders</label>
                  <input
                    className={ds.input}
                    value={formStakeholders}
                    onChange={(e) => setFormStakeholders(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Consequences</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formConsequences}
                    onChange={(e) => setFormConsequences(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Alternatives</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formAlternatives}
                    onChange={(e) => setFormAlternatives(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Analysis</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formAnalysis}
                    onChange={(e) => setFormAnalysis(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Verdict</label>
                  <input
                    className={ds.input}
                    value={formVerdict}
                    onChange={(e) => setFormVerdict(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Case' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Jurisdiction</label>
                    <input
                      className={ds.input}
                      value={formJurisdiction}
                      onChange={(e) => setFormJurisdiction(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Source</label>
                    <input
                      className={ds.input}
                      value={formSource}
                      onChange={(e) => setFormSource(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Precedent</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formPrecedent}
                    onChange={(e) => setFormPrecedent(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Outcome</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formOutcome}
                    onChange={(e) => setFormOutcome(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Principle' && (
              <>
                <div>
                  <label className={ds.label}>Core Principle</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formPrinciple}
                    onChange={(e) => setFormPrinciple(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Scope</label>
                  <input
                    className={ds.input}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Source / Tradition</label>
                  <input
                    className={ds.input}
                    value={formSource}
                    onChange={(e) => setFormSource(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Review' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Reviewer</label>
                    <input
                      className={ds.input}
                      value={formReviewer}
                      onChange={(e) => setFormReviewer(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Risk Level</label>
                    <select
                      className={ds.select}
                      value={formRiskLevel}
                      onChange={(e) => setFormRiskLevel(e.target.value)}
                    >
                      {RISK_LEVELS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Recommendation</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formRecommendation}
                    onChange={(e) => setFormRecommendation(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Policy' && (
              <>
                <div>
                  <label className={ds.label}>Policy Area</label>
                  <input
                    className={ds.input}
                    value={formPolicyArea}
                    onChange={(e) => setFormPolicyArea(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Effective Date</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formEffectiveDate}
                      onChange={(e) => setFormEffectiveDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Expiry Date</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formExpiryDate}
                      onChange={(e) => setFormExpiryDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Scope</label>
                  <input
                    className={ds.input}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                  />
                </div>
              </>
            )}

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
          <div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Scale className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as EthicsArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
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
                  <Scale className="w-5 h-5 text-neon-purple" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.framework && <span>{d.framework} </span>}
                      {d.category && <span>&middot; {d.category} </span>}
                      {d.riskLevel && <span>&middot; Risk: {d.riskLevel} </span>}
                      {d.jurisdiction && <span>&middot; {d.jurisdiction} </span>}
                      {d.policyArea && <span>&middot; {d.policyArea} </span>}
                      {d.reviewer && <span>&middot; {d.reviewer} </span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.weight !== undefined && (
                    <span className="text-xs text-neon-cyan">{(d.weight * 100).toFixed(0)}%</span>
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
                    <Zap className="w-4 h-4 text-neon-purple" />
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
      domain="ethics"
      title="Ethics"
      description="Frameworks, dilemmas, cases, principles, reviews, and policies"
      headerIcon={<Scale className="w-6 h-6" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <>
          {runAction.isPending && (
            <span className="text-xs text-neon-purple animate-pulse">AI processing...</span>
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
      <UniversalActions domain="ethics" artifactId={items[0]?.id} compact />

      {(() => {
        const all = items.map((i) => i.data as unknown as EthicsArtifact);
        const fws = [...new Set(all.map((a) => a.framework).filter(Boolean))].length;
        const contested = all.filter((a) => a.status === 'contested').length;
        const resolved = all.filter((a) => a.status === 'resolved').length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={ds.panel}>
              <Scale className="w-5 h-5 text-neon-purple mb-2" />
              <p className={ds.textMuted}>Total Items</p>
              <p className="text-xl font-bold text-white">{items.length}</p>
            </div>
            <div className={ds.panel}>
              <Brain className="w-5 h-5 text-pink-400 mb-2" />
              <p className={ds.textMuted}>Frameworks</p>
              <p className="text-xl font-bold text-white">{fws}</p>
            </div>
            <div className={ds.panel}>
              <CheckCircle2 className="w-5 h-5 text-green-400 mb-2" />
              <p className={ds.textMuted}>Resolved</p>
              <p className="text-xl font-bold text-white">{resolved}</p>
            </div>
            <div className={ds.panel}>
              <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
              <p className={ds.textMuted}>Contested</p>
              <p className="text-xl font-bold text-white">{contested}</p>
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
                ? 'bg-neon-purple/20 text-neon-purple'
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
