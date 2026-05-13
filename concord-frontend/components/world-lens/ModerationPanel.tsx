'use client';

import React, { useState, useCallback } from 'react';
import {
  Shield, Flag, Undo2, Users, Ban, Eye, FileText, Zap,
  Clock, AlertTriangle, X, Check, ChevronDown, ChevronUp,
  Building2, User, Bot, Box, Trash2, VolumeX, LogOut,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type Role = 'player' | 'owner' | 'moderator';
type ReportTargetType = 'building' | 'player' | 'npc' | 'component';
type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';
type Permission = 'view' | 'build' | 'modify' | 'admin';

interface Report {
  id: string;
  targetType: ReportTargetType;
  targetName: string;
  description: string;
  status: ReportStatus;
  createdAt: string;
  reporterName?: string;
}

interface UndoAction {
  id: string;
  action: string;
  target: string;
  timestamp: string;
  canUndo: boolean;
}

interface ZonePermission {
  zoneName: string;
  permissions: Record<string, Permission[]>;
}

interface BanEntry {
  userId: string;
  username: string;
  reason: string;
  duration: string;
  bannedAt: string;
}

interface VisitorEntry {
  username: string;
  visitedAt: string;
  interactions: string[];
}

interface ModerationLog {
  id: string;
  action: string;
  moderator: string;
  target: string;
  timestamp: string;
}

interface ModerationPanelProps {
  role: Role;
  reports: Report[];
  permissions: ZonePermission[];
  undoHistory: UndoAction[];
  banList?: BanEntry[];
  visitorLog?: VisitorEntry[];
  moderationLog?: ModerationLog[];
  worldRules?: string;
  rateLimitRemaining?: number;
  rateLimitMax?: number;
  onReport: (targetType: ReportTargetType, description: string) => void;
  onUndo: (actionId: string) => void;
  onBan?: (userId: string, reason: string, duration: string) => void;
  onPermissionChange?: (zoneName: string, userId: string, permissions: Permission[]) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const REPORT_TARGET_ICONS: Record<ReportTargetType, React.ComponentType<{ className?: string }>> = {
  building: Building2,
  player: User,
  npc: Bot,
  component: Box,
};

const REPORT_STATUS_STYLES: Record<ReportStatus, { color: string; bg: string }> = {
  pending: { color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  reviewing: { color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  resolved: { color: 'text-green-400', bg: 'bg-green-500/10' },
  dismissed: { color: 'text-white/40', bg: 'bg-white/5' },
};

const ALL_PERMISSIONS: Permission[] = ['view', 'build', 'modify', 'admin'];

/* ── Component ─────────────────────────────────────────────────── */

export default function ModerationPanel({
  role,
  reports,
  permissions,
  undoHistory,
  banList = [],
  visitorLog = [],
  moderationLog = [],
  worldRules = '',
  rateLimitRemaining = 50,
  rateLimitMax = 50,
  onReport,
  onUndo,
  onBan,
  onPermissionChange,
}: ModerationPanelProps) {
  const [_activeSection, _setActiveSection] = useState<string>('report');
  const [reportTargetType, setReportTargetType] = useState<ReportTargetType>('building');
  const [reportDescription, setReportDescription] = useState('');
  const [newBanUser, setNewBanUser] = useState('');
  const [newBanReason, setNewBanReason] = useState('');
  const [newBanDuration, setNewBanDuration] = useState('24h');
  const [editingRules, setEditingRules] = useState(false);
  const [rulesText, setRulesText] = useState(worldRules);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    report: true,
    undo: false,
    permissions: false,
    bans: false,
    visitors: false,
    rules: false,
    modlog: false,
  });

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleSubmitReport = useCallback(() => {
    if (reportDescription.trim()) {
      onReport(reportTargetType, reportDescription);
      setReportDescription('');
    }
  }, [reportTargetType, reportDescription, onReport]);

  const handleBan = useCallback(() => {
    if (onBan && newBanUser.trim() && newBanReason.trim()) {
      onBan(newBanUser, newBanReason, newBanDuration);
      setNewBanUser('');
      setNewBanReason('');
    }
  }, [onBan, newBanUser, newBanReason, newBanDuration]);

  const isOwnerOrMod = role === 'owner' || role === 'moderator';

  return (
    <div className={`${panel} p-4 space-y-4 max-h-[85vh] overflow-y-auto`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" /> Moderation
        </h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
          role === 'owner' ? 'border-amber-500/40 text-amber-400' :
          role === 'moderator' ? 'border-purple-500/40 text-purple-400' :
          'border-white/20 text-white/50'
        }`}>
          {role}
        </span>
      </div>

      {/* Rate limit */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-md">
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs text-white/60">
          You can place <span className="text-white font-medium">{rateLimitRemaining}</span> more buildings this hour
        </span>
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden ml-2">
          <div
            className="h-full bg-cyan-500 rounded-full transition-all"
            style={{ width: `${(rateLimitRemaining / rateLimitMax) * 100}%` }}
          />
        </div>
      </div>

      {/* ─── Report Section ────────────────────────────────── */}
      <section>
        <button onClick={() => toggleSection('report')} className="w-full flex items-center justify-between py-2">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Flag className="w-4 h-4" /> Report Issue
          </h3>
          {expandedSections.report ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
        </button>
        {expandedSections.report && (
          <div className="space-y-3 pl-6">
            <div className="flex gap-2">
              {(['building', 'player', 'npc', 'component'] as const).map((t) => {
                const Icon = REPORT_TARGET_ICONS[t];
                return (
                  <button
                    key={t}
                    onClick={() => setReportTargetType(t)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors capitalize ${
                      reportTargetType === t
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    <Icon className="w-3 h-3" /> {t}
                  </button>
                );
              })}
            </div>
            <textarea
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              placeholder="Describe the issue..."
              className="w-full h-20 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-xs text-white/80 placeholder:text-white/30 resize-none focus:border-cyan-500/50 focus:outline-none"
            />
            <button
              onClick={handleSubmitReport}
              disabled={!reportDescription.trim()}
              className="px-4 py-1.5 text-xs rounded-md bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Submit Report
            </button>
          </div>
        )}
      </section>

      {/* ─── Report Status Tracker ─────────────────────────── */}
      {reports.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Your Reports
          </h3>
          <div className="space-y-1">
            {reports.map((r) => {
              const style = REPORT_STATUS_STYLES[r.status];
              return (
                <div key={r.id} className={`flex items-center justify-between px-3 py-2 rounded-md ${style.bg}`}>
                  <div className="flex items-center gap-2">
                    {React.createElement(REPORT_TARGET_ICONS[r.targetType], { className: 'w-3.5 h-3.5 text-white/50' })}
                    <span className="text-xs text-white/70">{r.targetName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30">{r.createdAt}</span>
                    <span className={`text-[10px] font-medium capitalize ${style.color}`}>{r.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Undo History ──────────────────────────────────── */}
      <section>
        <button onClick={() => toggleSection('undo')} className="w-full flex items-center justify-between py-2">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Undo2 className="w-4 h-4" /> Undo History
            <span className="text-[10px] text-white/30">(last 20, 5-min window)</span>
          </h3>
          {expandedSections.undo ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
        </button>
        {expandedSections.undo && (
          <div className="space-y-1 pl-6 max-h-48 overflow-y-auto">
            {undoHistory.length === 0 ? (
              <p className="text-xs text-white/30">No recent actions.</p>
            ) : (
              undoHistory.map((action) => (
                <div key={action.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                  <div>
                    <span className="text-xs text-white/70">{action.action}</span>
                    <span className="text-[10px] text-white/40 ml-2">{action.target}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30">{action.timestamp}</span>
                    {action.canUndo ? (
                      <button
                        onClick={() => onUndo(action.id)}
                        className="px-2 py-0.5 text-[10px] rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors"
                      >
                        Undo
                      </button>
                    ) : (
                      <span className="text-[10px] text-white/20">Expired</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* ─── Owner/Moderator Sections ──────────────────────── */}
      {isOwnerOrMod && (
        <>
          {/* Permission Matrix */}
          <section>
            <button onClick={() => toggleSection('permissions')} className="w-full flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Users className="w-4 h-4" /> Zone Permissions
              </h3>
              {expandedSections.permissions ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
            </button>
            {expandedSections.permissions && (
              <div className="space-y-3 pl-6">
                {permissions.map((zone) => (
                  <div key={zone.zoneName} className="space-y-2">
                    <h4 className="text-xs font-medium text-white/60">{zone.zoneName}</h4>
                    <div className={`${panel} divide-y divide-white/5`}>
                      <div className="flex px-3 py-1.5 text-[10px] text-white/30 uppercase tracking-wider">
                        <span className="flex-1">User</span>
                        {ALL_PERMISSIONS.map((p) => (
                          <span key={p} className="w-16 text-center capitalize">{p}</span>
                        ))}
                      </div>
                      {Object.entries(zone.permissions).map(([userId, perms]) => (
                        <div key={userId} className="flex items-center px-3 py-1.5">
                          <span className="flex-1 text-xs text-white/60">{userId}</span>
                          {ALL_PERMISSIONS.map((p) => (
                            <div key={p} className="w-16 flex justify-center">
                              <button
                                onClick={() => {
                                  if (onPermissionChange) {
                                    const newPerms = perms.includes(p)
                                      ? perms.filter((x) => x !== p)
                                      : [...perms, p];
                                    onPermissionChange(zone.zoneName, userId, newPerms);
                                  }
                                }}
                                className={`w-5 h-5 rounded border transition-colors flex items-center justify-center ${
                                  perms.includes(p)
                                    ? 'border-cyan-500 bg-cyan-500/20'
                                    : 'border-white/10 hover:border-white/30'
                                }`}
                              >
                                {perms.includes(p) && <Check className="w-3 h-3 text-cyan-400" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ban List */}
          <section>
            <button onClick={() => toggleSection('bans')} className="w-full flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Ban className="w-4 h-4" /> Ban Management
              </h3>
              {expandedSections.bans ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
            </button>
            {expandedSections.bans && (
              <div className="space-y-3 pl-6">
                {/* Add ban */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newBanUser}
                      onChange={(e) => setNewBanUser(e.target.value)}
                      placeholder="Username"
                      className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                    />
                    <select
                      value={newBanDuration}
                      onChange={(e) => setNewBanDuration(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 focus:outline-none"
                    >
                      <option value="1h">1 hour</option>
                      <option value="24h">24 hours</option>
                      <option value="7d">7 days</option>
                      <option value="30d">30 days</option>
                      <option value="permanent">Permanent</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newBanReason}
                      onChange={(e) => setNewBanReason(e.target.value)}
                      placeholder="Reason"
                      className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                    />
                    <button
                      onClick={handleBan}
                      disabled={!newBanUser.trim() || !newBanReason.trim()}
                      className="px-3 py-1 text-xs rounded bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Ban
                    </button>
                  </div>
                </div>

                {/* Ban list */}
                {banList.length === 0 ? (
                  <p className="text-xs text-white/30">No active bans.</p>
                ) : (
                  banList.map((ban) => (
                    <div key={ban.userId} className="flex items-center justify-between px-3 py-2 bg-red-500/5 rounded-md border border-red-500/10">
                      <div>
                        <span className="text-xs text-white/70 font-medium">{ban.username}</span>
                        <p className="text-[10px] text-white/40">{ban.reason}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/30">{ban.duration}</span>
                        <button
                          onClick={() => { window.dispatchEvent(new CustomEvent('moderation:unban', { detail: { userId: ban.userId } })); }}
                          aria-label="Unban"
                          className="text-white/30 hover:text-white/60 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Visitor Log */}
          <section>
            <button onClick={() => toggleSection('visitors')} className="w-full flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Eye className="w-4 h-4" /> Visitor Log
              </h3>
              {expandedSections.visitors ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
            </button>
            {expandedSections.visitors && (
              <div className="space-y-1 pl-6 max-h-48 overflow-y-auto">
                {visitorLog.length === 0 ? (
                  <p className="text-xs text-white/30">No recent visitors.</p>
                ) : (
                  visitorLog.map((visitor, i) => (
                    <div key={`${visitor.username}-${i}`} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <div>
                        <span className="text-xs text-white/70">{visitor.username}</span>
                        <div className="flex gap-1 mt-0.5">
                          {visitor.interactions.map((int, j) => (
                            <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{int}</span>
                          ))}
                        </div>
                      </div>
                      <span className="text-[10px] text-white/30">{visitor.visitedAt}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* World Rules */}
          <section>
            <button onClick={() => toggleSection('rules')} className="w-full flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <FileText className="w-4 h-4" /> World Rules
              </h3>
              {expandedSections.rules ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
            </button>
            {expandedSections.rules && (
              <div className="pl-6 space-y-2">
                {editingRules ? (
                  <>
                    <textarea
                      value={rulesText}
                      onChange={(e) => setRulesText(e.target.value)}
                      className="w-full h-32 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-xs text-white/80 resize-none focus:border-cyan-500/50 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingRules(false)}
                        className="px-3 py-1 text-xs rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                      >
                        Save Rules
                      </button>
                      <button
                        onClick={() => { setRulesText(worldRules); setEditingRules(false); }}
                        className="px-3 py-1 text-xs rounded-md border border-white/10 text-white/50 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-white/5 rounded-md text-xs text-white/60 whitespace-pre-wrap">
                      {rulesText || 'No rules set for this world.'}
                    </div>
                    <button
                      onClick={() => setEditingRules(true)}
                      className="px-3 py-1 text-xs rounded-md border border-white/10 text-white/50 hover:text-white transition-colors"
                    >
                      Edit Rules
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Moderation Log */}
          <section>
            <button onClick={() => toggleSection('modlog')} className="w-full flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Moderation Log
              </h3>
              {expandedSections.modlog ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
            </button>
            {expandedSections.modlog && (
              <div className="space-y-1 pl-6 max-h-48 overflow-y-auto">
                {moderationLog.length === 0 ? (
                  <p className="text-xs text-white/30">No moderation actions recorded.</p>
                ) : (
                  moderationLog.map((log) => (
                    <div key={log.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <div>
                        <span className="text-xs text-white/70">{log.action}</span>
                        <span className="text-[10px] text-white/40 ml-2">by {log.moderator}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40">{log.target}</span>
                        <span className="text-[10px] text-white/30">{log.timestamp}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Quick Actions */}
          <section className="pt-2 border-t border-white/10">
            <h3 className="text-sm font-medium text-white/70 mb-2">Quick Actions</h3>
            <div className="flex gap-2">
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('moderation:mute-player')); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"
              >
                <VolumeX className="w-3.5 h-3.5" /> Mute Player
              </button>
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('moderation:kick-from-world')); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Kick from World
              </button>
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('moderation:remove-building')); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-red-500/20 text-red-400/70 hover:text-red-400 hover:border-red-500/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove Building
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
