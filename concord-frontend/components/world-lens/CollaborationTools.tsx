'use client';

import React, { useState } from 'react';
import {
  Paintbrush, Hammer, Eye, MessageSquare,
  AlertTriangle, ThumbsUp, GraduationCap,
  ClipboardList, Layers, Send, Percent,
  UserCheck,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type TaskStatus = 'open' | 'claimed' | 'in-progress' | 'review' | 'complete';
type AnnotationType = 'suggestion' | 'issue' | 'praise';

interface BuildParticipant {
  id: string;
  name: string;
  cursorColor: string;
  isBuilding: boolean;
}

interface ProjectTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  claimedBy?: string;
  payment?: string;
}

interface ReviewAnnotation {
  id: string;
  type: AnnotationType;
  author: string;
  content: string;
  memberRef?: string;
  timestamp: string;
}

interface SharedWorkbench {
  partnerName: string;
  partnerId: string;
  outputPreview: string;
  royaltySplit: [number, number];
}

interface MentorshipState {
  active: boolean;
  role: 'mentor' | 'mentee';
  partnerName: string;
  partnerId: string;
}

interface CollaborationToolsProps {
  participants?: BuildParticipant[];
  projectBoard?: ProjectTask[];
  activeReview?: ReviewAnnotation[];
  mentorship?: MentorshipState;
  workbench?: SharedWorkbench;
  onClaimTask?: (taskId: string) => void;
  onSubmitReview?: (taskId: string) => void;
  onAnnotate?: (type: AnnotationType, content: string, memberRef?: string) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Open',        color: 'text-white/60',  bg: 'bg-white/10' },
  claimed:       { label: 'Claimed',     color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
  'in-progress': { label: 'In Progress', color: 'text-blue-400',  bg: 'bg-blue-500/15' },
  review:        { label: 'Review',      color: 'text-purple-400', bg: 'bg-purple-500/15' },
  complete:      { label: 'Complete',    color: 'text-green-400', bg: 'bg-green-500/15' },
};

const ANNOTATION_META: Record<AnnotationType, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  suggestion: { label: 'Suggestion', color: 'text-blue-400',  bg: 'bg-blue-500/15 border-blue-500/30',   icon: MessageSquare },
  issue:      { label: 'Issue',      color: 'text-red-400',   bg: 'bg-red-500/15 border-red-500/30',     icon: AlertTriangle },
  praise:     { label: 'Praise',     color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30', icon: ThumbsUp },
};

const KANBAN_COLUMNS: TaskStatus[] = ['open', 'claimed', 'in-progress', 'review', 'complete'];

/* ── Seed Data ─────────────────────────────────────────────────── */

const SEED_PARTICIPANTS: BuildParticipant[] = [
  { id: 'p1', name: 'ArchitectAlice', cursorColor: '#F59E0B', isBuilding: true },
  { id: 'p2', name: 'BuilderBob', cursorColor: '#3B82F6', isBuilding: true },
  { id: 'p4', name: 'DesignDave', cursorColor: '#EC4899', isBuilding: false },
  { id: 'p7', name: 'GridGrace', cursorColor: '#22C55E', isBuilding: true },
];

const SEED_TASKS: ProjectTask[] = [
  { id: 't1', title: 'Foundation slab for Tower B', description: 'Pour reinforced concrete slab 20x20m. Must support 12 floors.', status: 'complete', claimedBy: 'BuilderBob', payment: '150 tokens' },
  { id: 't2', title: 'Steel frame floors 1-4', description: 'Erect steel frame for first 4 floors using approved beam designs.', status: 'in-progress', claimedBy: 'ArchitectAlice', payment: '300 tokens' },
  { id: 't3', title: 'Electrical conduit layout', description: 'Route primary and secondary conduits per district energy code.', status: 'claimed', claimedBy: 'GridGrace', payment: '200 tokens' },
  { id: 't4', title: 'Facade design review', description: 'Design exterior cladding for floors 1-4. Must meet wind load requirements.', status: 'review', claimedBy: 'DesignDave', payment: '250 tokens' },
  { id: 't5', title: 'Interior partition plan', description: 'Design floor layouts for commercial tenants. Open plan preferred.', status: 'open', payment: '180 tokens' },
  { id: 't6', title: 'HVAC duct routing', description: 'Plan heating and cooling ductwork. Integrate with structural grid.', status: 'open', payment: '220 tokens' },
];

const SEED_ANNOTATIONS: ReviewAnnotation[] = [
  { id: 'a1', type: 'issue', author: 'ArchitectAlice', content: 'Connection plate at joint B7 looks undersized for the load path. Check calculations.', memberRef: 'Beam B7-C7', timestamp: '10 min ago' },
  { id: 'a2', type: 'suggestion', author: 'GridGrace', content: 'Consider using a moment frame here instead of braced frame for better open floor plan.', memberRef: 'Frame Grid Line 3', timestamp: '25 min ago' },
  { id: 'a3', type: 'praise', author: 'BuilderBob', content: 'Excellent detail on the curtain wall attachment. Clean and buildable.', memberRef: 'CW Detail 4A', timestamp: '1 hr ago' },
];

const SEED_WORKBENCH: SharedWorkbench = {
  partnerName: 'BuilderBob',
  partnerId: 'p2',
  outputPreview: 'Reinforced Steel Arch — Composite Beam',
  royaltySplit: [60, 40],
};

const SEED_MENTORSHIP: MentorshipState = {
  active: false,
  role: 'mentor',
  partnerName: 'NewbieNora',
  partnerId: 'p9',
};

/* ── Component ─────────────────────────────────────────────────── */

export default function CollaborationTools({
  participants = SEED_PARTICIPANTS,
  projectBoard = SEED_TASKS,
  activeReview = SEED_ANNOTATIONS,
  mentorship = SEED_MENTORSHIP,
  workbench = SEED_WORKBENCH,
  onClaimTask,
  onSubmitReview,
  onAnnotate,
}: CollaborationToolsProps) {
  const [activeTab, setActiveTab] = useState<'build' | 'board' | 'review' | 'workbench'>('build');
  const [mentorshipActive, setMentorshipActive] = useState(mentorship.active);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [annotationType, setAnnotationType] = useState<AnnotationType>('suggestion');

  const tasksByStatus = (status: TaskStatus) =>
    projectBoard.filter(t => t.status === status);

  const handleAnnotate = () => {
    if (!annotationDraft.trim()) return;
    onAnnotate?.(annotationType, annotationDraft.trim());
    setAnnotationDraft('');
  };

  /* ── Co-Build Panel ────────────────────────────────────────── */
  const renderBuild = () => (
    <div className="space-y-4 p-4">
      {/* Co-build indicator */}
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Paintbrush size={12} className="text-cyan-400" />
        <span>Co-Build Mode Active</span>
        <span className="ml-auto text-cyan-400">{participants.filter(p => p.isBuilding).length} building</span>
      </div>

      {/* Participant cursors */}
      <div className="space-y-2">
        <h4 className="text-xs text-white/50 uppercase tracking-wider">Builders in Area</h4>
        {participants.map(p => (
          <div key={p.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/5 transition-colors">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.cursorColor }} />
            <span className="text-sm text-white/80">{p.name}</span>
            <span className={`text-[10px] ml-auto ${p.isBuilding ? 'text-green-400' : 'text-white/30'}`}>
              {p.isBuilding ? 'Building' : 'Observing'}
            </span>
          </div>
        ))}
      </div>

      {/* Cursor color legend */}
      <div className="bg-white/5 rounded p-2 text-[10px] text-white/40">
        Cursor colors are shown on-canvas. Each builder has a unique color indicator on placed elements.
      </div>

      {/* Mentorship toggle */}
      <div className={`${panel} p-3 space-y-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <GraduationCap size={14} className="text-purple-400" />
            <span>Mentorship Mode</span>
          </div>
          <button
            onClick={() => setMentorshipActive(!mentorshipActive)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              mentorshipActive ? 'bg-purple-600/80 text-white' : 'bg-white/10 text-white/50'
            }`}
          >
            {mentorshipActive ? 'Active' : 'Inactive'}
          </button>
        </div>
        {mentorshipActive && (
          <div className="text-xs text-white/50">
            Role: <span className="text-purple-400 capitalize">{mentorship.role}</span> with <span className="text-white/70">{mentorship.partnerName}</span>.
            {mentorship.role === 'mentor' && ' You can annotate their build in real-time.'}
          </div>
        )}
      </div>
    </div>
  );

  /* ── Project Board (Kanban) ────────────────────────────────── */
  const renderBoard = () => (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-white/40 mb-2">
        <ClipboardList size={12} />
        <span>Project Board</span>
        <span className="ml-auto text-white/30">{projectBoard.length} tasks</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map(col => {
          const meta = STATUS_META[col];
          const tasks = tasksByStatus(col);
          return (
            <div key={col} className="min-w-[180px] flex-shrink-0">
              <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded ${meta.bg}`}>
                <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                <span className="text-[10px] text-white/30 ml-auto">{tasks.length}</span>
              </div>
              <div className="space-y-2">
                {tasks.map(task => (
                  <div key={task.id} className={`${panel} p-2.5 space-y-1.5`}>
                    <h5 className="text-xs text-white font-medium leading-tight">{task.title}</h5>
                    <p className="text-[10px] text-white/40 line-clamp-2">{task.description}</p>
                    {task.claimedBy && (
                      <div className="flex items-center gap-1 text-[10px] text-white/50">
                        <UserCheck size={10} /> {task.claimedBy}
                      </div>
                    )}
                    {task.payment && (
                      <span className="text-[10px] text-yellow-400/70">{task.payment}</span>
                    )}
                    <div className="flex gap-1.5 pt-1">
                      {task.status === 'open' && (
                        <button
                          onClick={() => onClaimTask?.(task.id)}
                          className="flex-1 px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-500 text-white text-[10px] font-medium transition-colors"
                        >
                          Claim Task
                        </button>
                      )}
                      {task.status === 'in-progress' && (
                        <button
                          onClick={() => onSubmitReview?.(task.id)}
                          className="flex-1 px-2 py-1 rounded bg-purple-600/80 hover:bg-purple-500 text-white text-[10px] font-medium transition-colors"
                        >
                          Submit for Review
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ── Design Review ─────────────────────────────────────────── */
  const renderReview = () => (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Eye size={12} />
        <span>Design Review</span>
        <span className="ml-auto text-white/30">{activeReview.length} annotations</span>
      </div>

      {/* Annotations list */}
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {activeReview.map(ann => {
          const meta = ANNOTATION_META[ann.type];
          return (
            <div key={ann.id} className={`rounded-lg border p-3 space-y-1 ${meta.bg}`}>
              <div className="flex items-center gap-2">
                {React.createElement(meta.icon, { className: `w-3 h-3 ${meta.color}` })}
                <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                <span className="text-[10px] text-white/30 ml-auto">{ann.timestamp}</span>
              </div>
              {ann.memberRef && (
                <div className="text-[10px] text-white/40 flex items-center gap-1">
                  <Layers size={9} /> {ann.memberRef}
                </div>
              )}
              <p className="text-xs text-white/70">{ann.content}</p>
              <span className="text-[10px] text-white/40">— {ann.author}</span>
            </div>
          );
        })}
      </div>

      {/* Add annotation */}
      <div className="space-y-2">
        <div className="flex gap-1">
          {(Object.keys(ANNOTATION_META) as AnnotationType[]).map(type => {
            const meta = ANNOTATION_META[type];
            return (
              <button
                key={type}
                onClick={() => setAnnotationType(type)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  annotationType === type ? `${meta.bg} ${meta.color} border` : 'bg-white/5 text-white/40'
                }`}
              >
                {React.createElement(meta.icon, { className: 'w-3 h-3' })}
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={annotationDraft}
            onChange={e => setAnnotationDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnnotate()}
            placeholder="Add annotation..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
          />
          <button
            onClick={handleAnnotate}
            disabled={!annotationDraft.trim()}
            className="p-1.5 rounded bg-blue-600/80 hover:bg-blue-500 disabled:opacity-30 text-white transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Shared Workbench ──────────────────────────────────────── */
  const renderWorkbench = () => (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Hammer size={12} className="text-orange-400" />
        <span>Shared Workbench</span>
      </div>

      <div className={`${panel} p-4 space-y-3`}>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-cyan-600/50 border-2 border-black flex items-center justify-center text-xs font-bold text-white/70">Y</div>
            <div className="w-8 h-8 rounded-full bg-orange-600/50 border-2 border-black flex items-center justify-center text-xs font-bold text-white/70">
              {workbench.partnerName.charAt(0)}
            </div>
          </div>
          <div>
            <span className="text-sm text-white/80">Co-crafting with <span className="text-white font-medium">{workbench.partnerName}</span></span>
          </div>
        </div>

        {/* Output preview */}
        <div className="bg-white/5 rounded-lg p-3">
          <span className="text-[10px] text-white/40 uppercase tracking-wider">Output Preview</span>
          <p className="text-sm text-white/80 mt-1">{workbench.outputPreview}</p>
        </div>

        {/* Royalty split */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-white/40 uppercase tracking-wider flex items-center gap-1">
            <Percent size={10} /> Royalty Split
          </span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-cyan-500/60 rounded-l-full"
                style={{ width: `${workbench.royaltySplit[0]}%` }}
              />
              <div
                className="h-full bg-orange-500/60 rounded-r-full"
                style={{ width: `${workbench.royaltySplit[1]}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-white/50">
            <span className="text-cyan-400">You: {workbench.royaltySplit[0]}%</span>
            <span className="text-orange-400">{workbench.partnerName}: {workbench.royaltySplit[1]}%</span>
          </div>
        </div>

        <button
          onClick={() => { window.dispatchEvent(new CustomEvent('collaboration:craft-together')); }}
          className="w-full px-4 py-2 rounded-lg bg-green-600/80 hover:bg-green-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Hammer size={14} /> Craft Together
        </button>
      </div>
    </div>
  );

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-2xl">
      {/* Tab bar */}
      <div className={`${panel} p-1 flex gap-1`}>
        {([
          { key: 'build', label: 'Co-Build', icon: Paintbrush },
          { key: 'board', label: 'Project Board', icon: ClipboardList },
          { key: 'review', label: 'Review', icon: Eye },
          { key: 'workbench', label: 'Workbench', icon: Hammer },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t.key ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {React.createElement(t.icon, { className: 'w-3.5 h-3.5' })}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`${panel}`}>
        {activeTab === 'build' && renderBuild()}
        {activeTab === 'board' && renderBoard()}
        {activeTab === 'review' && renderReview()}
        {activeTab === 'workbench' && renderWorkbench()}
      </div>
    </div>
  );
}
