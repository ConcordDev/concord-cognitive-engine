'use client';

import React, { useState } from 'react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

type MobileTab = 'dashboard' | 'notifications' | 'remote' | 'chat';

interface OvernightChange {
  id: string;
  icon: string;
  description: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

interface PushPref {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface MobileNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  category: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isOwn: boolean;
}

// ── Seed Data ──────────────────────────────────────────────────────

const SEED_OVERNIGHT: OvernightChange[] = [
  { id: 'oc-1', icon: '🏗️', description: 'Bridge DTU in Riverside District completed validation — all checks passed', timestamp: '03:42 AM', severity: 'info' },
  { id: 'oc-2', icon: '📜', description: 'Your Foundation-Alpha DTU was cited 3 times by new builders overnight', timestamp: '01:15 AM', severity: 'info' },
  { id: 'oc-3', icon: '⚠️', description: 'Windstorm event in Northern Highlands — 2 structures flagged for re-validation', timestamp: '05:08 AM', severity: 'warning' },
  { id: 'oc-4', icon: '💰', description: 'Royalty payout of 240 credits processed from citation earnings', timestamp: '02:00 AM', severity: 'info' },
  { id: 'oc-5', icon: '🔴', description: 'Seismic activity detected near Quarry District — evacuation drill triggered', timestamp: '04:33 AM', severity: 'critical' },
  { id: 'oc-6', icon: '👥', description: 'Firm member Kai_Struct joined and started a new residential project', timestamp: '06:12 AM', severity: 'info' },
];

const SEED_QUICK_ACTIONS: QuickAction[] = [
  { id: 'qa-1', label: 'Check Builds', icon: '🏗️', badge: 2 },
  { id: 'qa-2', label: 'View Citations', icon: '📜', badge: 7 },
  { id: 'qa-3', label: 'Manage Inventory', icon: '🎒' },
  { id: 'qa-4', label: 'Firm Board', icon: '📋', badge: 1 },
  { id: 'qa-5', label: 'Marketplace', icon: '🛒' },
  { id: 'qa-6', label: 'Royalties', icon: '💰' },
];

const SEED_PUSH_PREFS: PushPref[] = [
  { id: 'pp-1', label: 'Build Complete', description: 'When a build or validation finishes', enabled: true },
  { id: 'pp-2', label: 'Citation Received', description: 'When someone cites your DTU', enabled: true },
  { id: 'pp-3', label: 'Disaster Alert', description: 'Seismic, storm, or hazard events', enabled: true },
  { id: 'pp-4', label: 'Friend Online', description: 'When a firm member comes online', enabled: false },
  { id: 'pp-5', label: 'Market Update', description: 'Price changes on watched materials', enabled: false },
];

const SEED_NOTIFICATIONS: MobileNotification[] = [
  { id: 'mn-1', title: 'Build Complete', body: 'Riverside Bridge passed all 14 validation checks.', timestamp: '3 min ago', read: false, category: 'build' },
  { id: 'mn-2', title: 'New Citation', body: 'Lena_Arc cited your Foundation-Alpha in a residential tower.', timestamp: '12 min ago', read: false, category: 'citation' },
  { id: 'mn-3', title: 'Disaster Alert', body: 'Windstorm warning issued for Northern Highlands sector.', timestamp: '28 min ago', read: true, category: 'disaster' },
  { id: 'mn-4', title: 'Royalty Payout', body: '240 credits deposited from 12 citations this week.', timestamp: '1 hr ago', read: true, category: 'market' },
  { id: 'mn-5', title: 'Friend Online', body: 'Kai_Struct is now online and building in Quarry District.', timestamp: '2 hr ago', read: true, category: 'social' },
  { id: 'mn-6', title: 'Market Update', body: 'Reinforced concrete price dropped 8% in global market.', timestamp: '3 hr ago', read: true, category: 'market' },
  { id: 'mn-7', title: 'New Citation', body: 'Marco_CE referenced your Beam-Gamma in a pedestrian bridge.', timestamp: '5 hr ago', read: true, category: 'citation' },
  { id: 'mn-8', title: 'Seismic Alert', body: 'Minor tremor recorded near Quarry District — no damage reported.', timestamp: '6 hr ago', read: true, category: 'disaster' },
];

const SEED_CHAT: ChatMessage[] = [
  { id: 'cm-1', sender: 'Kai_Struct', text: 'Hey, I started on the residential wing — mind reviewing my column layout?', timestamp: '10:42 AM', isOwn: false },
  { id: 'cm-2', sender: 'You', text: 'Sure, pulling up the inspector now. Which floor?', timestamp: '10:43 AM', isOwn: true },
  { id: 'cm-3', sender: 'Kai_Struct', text: 'Ground floor, section B. I used your Foundation-Alpha as the base.', timestamp: '10:44 AM', isOwn: false },
  { id: 'cm-4', sender: 'You', text: 'Nice! I see the citation came through. Looks solid, but check the load path on the east corner.', timestamp: '10:46 AM', isOwn: true },
  { id: 'cm-5', sender: 'Lena_Arc', text: 'Just joined the channel — the bridge validation passed! 🎉', timestamp: '10:50 AM', isOwn: false },
];

// ── Helpers ────────────────────────────────────────────────────────

const severityColor: Record<string, string> = {
  info: 'text-blue-400',
  warning: 'text-yellow-400',
  critical: 'text-red-400',
};

const categoryColor: Record<string, string> = {
  build: 'bg-green-500/20 text-green-400',
  citation: 'bg-purple-500/20 text-purple-400',
  disaster: 'bg-red-500/20 text-red-400',
  market: 'bg-yellow-500/20 text-yellow-400',
  social: 'bg-blue-500/20 text-blue-400',
};

// ── Component ──────────────────────────────────────────────────────

export default function MobileCompanion() {
  const [activeTab, setActiveTab] = useState<MobileTab>('dashboard');
  const [pushPrefs, setPushPrefs] = useState<PushPref[]>(SEED_PUSH_PREFS);
  const [notifications, setNotifications] = useState<MobileNotification[]>(SEED_NOTIFICATIONS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(SEED_CHAT);
  const [chatInput, setChatInput] = useState('');
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraAngle, setCameraAngle] = useState(0);
  const [showQuietHours, setShowQuietHours] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const togglePush = (id: string) => {
    setPushPrefs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const msg: ChatMessage = {
      id: `cm-${Date.now()}`,
      sender: 'You',
      text: chatInput.trim(),
      timestamp: 'Just now',
      isOwn: true,
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatInput('');
  };

  const tabs: { key: MobileTab; label: string; icon: string; badge?: number }[] = [
    { key: 'dashboard', label: 'Home', icon: '🏠' },
    { key: 'notifications', label: 'Alerts', icon: '🔔', badge: unreadCount || undefined },
    { key: 'remote', label: 'Remote', icon: '📷' },
    { key: 'chat', label: 'Chat', icon: '💬' },
  ];

  // ── Dashboard Tab ────────────────────────────────────────────────

  const renderDashboard = () => (
    <div className="flex flex-col gap-4 p-4">
      {/* World Status Header */}
      <div className={`${panel} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold text-lg">World Status</h2>
          <span className="text-xs text-white/40">Last sync: 2 min ago</span>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm font-bold">
            OK
          </div>
          <div>
            <p className="text-white text-sm font-medium">Concordia Prime — Online</p>
            <p className="text-white/50 text-xs">142 active builders · 3 events running</p>
          </div>
        </div>
      </div>

      {/* Overnight Changes */}
      <div className={`${panel} p-4`}>
        <h3 className="text-white/70 text-xs uppercase tracking-wider mb-3">
          Overnight Changes
        </h3>
        <div className="flex flex-col gap-2">
          {SEED_OVERNIGHT.map((change) => (
            <div
              key={change.id}
              className="flex items-start gap-3 p-2 rounded-md bg-white/5 active:bg-white/10 transition-colors"
            >
              <span className="text-lg flex-shrink-0 mt-0.5">{change.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${severityColor[change.severity]}`}>
                  {change.description}
                </p>
                <p className="text-white/30 text-xs mt-1">{change.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className={`${panel} p-4`}>
        <h3 className="text-white/70 text-xs uppercase tracking-wider mb-3">
          Quick Actions
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {SEED_QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white/5 active:bg-white/15 transition-colors relative"
            >
              <span className="text-2xl">{action.icon}</span>
              <span className="text-white/70 text-xs text-center leading-tight">
                {action.label}
              </span>
              {action.badge !== undefined && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500 text-black text-[10px] font-bold flex items-center justify-center">
                  {action.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Push Notification Preferences */}
      <div className={`${panel} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white/70 text-xs uppercase tracking-wider">
            Push Notifications
          </h3>
          <button
            onClick={() => setShowQuietHours(!showQuietHours)}
            className="text-xs text-cyan-400 active:text-cyan-300"
          >
            {showQuietHours ? 'Hide' : 'Quiet Hours'}
          </button>
        </div>
        {showQuietHours && (
          <div className="mb-3 p-3 rounded-md bg-white/5 text-white/50 text-xs">
            Quiet Hours active from <span className="text-white">10:00 PM</span> to{' '}
            <span className="text-white">7:00 AM</span>. Only disaster alerts will break
            through.
          </div>
        )}
        <div className="flex flex-col gap-2">
          {pushPrefs.map((pref) => (
            <button
              key={pref.id}
              onClick={() => togglePush(pref.id)}
              className="flex items-center justify-between p-3 rounded-md bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex-1 text-left">
                <p className="text-white text-sm">{pref.label}</p>
                <p className="text-white/40 text-xs">{pref.description}</p>
              </div>
              <div
                className={`w-10 h-6 rounded-full flex items-center transition-colors ${
                  pref.enabled ? 'bg-cyan-500 justify-end' : 'bg-white/20 justify-start'
                }`}
              >
                <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow-sm" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Notifications Tab ────────────────────────────────────────────

  const renderNotifications = () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-lg">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full">
              {unreadCount} new
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-cyan-400 active:text-cyan-300 px-3 py-1.5 rounded-md bg-white/5"
          >
            Mark all read
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {notifications.map((notif) => (
          <button
            key={notif.id}
            onClick={() => markRead(notif.id)}
            className={`${panel} p-3 text-left w-full active:bg-white/10 transition-colors ${
              !notif.read ? 'border-cyan-500/30' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              {!notif.read && (
                <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white text-sm font-medium">{notif.title}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      categoryColor[notif.category] || 'bg-white/10 text-white/50'
                    }`}
                  >
                    {notif.category}
                  </span>
                </div>
                <p className="text-white/60 text-xs">{notif.body}</p>
                <p className="text-white/30 text-[10px] mt-1">{notif.timestamp}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Remote View Tab ──────────────────────────────────────────────

  const renderRemoteView = () => (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-white font-semibold text-lg">Remote Camera</h2>

      {/* Simulated camera feed */}
      <div className={`${panel} overflow-hidden`}>
        <div className="relative aspect-video bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center">
          {/* Grid overlay */}
          <div className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: `${40 / cameraZoom}px ${40 / cameraZoom}px`,
            }}
          />
          {/* Simulated structures */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-end gap-3"
            style={{ transform: `translateX(-50%) rotate(${cameraAngle}deg) scale(${cameraZoom})` }}
          >
            <div className="w-8 h-16 bg-cyan-500/30 border border-cyan-500/50 rounded-sm" />
            <div className="w-12 h-24 bg-blue-500/30 border border-blue-500/50 rounded-sm" />
            <div className="w-6 h-10 bg-purple-500/30 border border-purple-500/50 rounded-sm" />
            <div className="w-10 h-20 bg-green-500/30 border border-green-500/50 rounded-sm" />
            <div className="w-7 h-14 bg-yellow-500/30 border border-yellow-500/50 rounded-sm" />
          </div>
          {/* HUD overlay */}
          <div className="absolute top-3 left-3 text-[10px] text-white/40 font-mono space-y-1">
            <p>CAM: Riverside District</p>
            <p>ZOOM: {cameraZoom.toFixed(1)}x</p>
            <p>ANGLE: {cameraAngle}°</p>
          </div>
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] text-green-400 font-mono">LIVE</span>
          </div>
          <div className="absolute bottom-3 right-3 text-[10px] text-white/30 font-mono">
            {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Camera controls */}
      <div className={`${panel} p-4`}>
        <h3 className="text-white/70 text-xs uppercase tracking-wider mb-3">
          Camera Controls
        </h3>
        <div className="flex flex-col gap-4">
          {/* Zoom */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/50 text-xs">Zoom</span>
              <span className="text-white/70 text-xs font-mono">{cameraZoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={cameraZoom}
              onChange={(e) => setCameraZoom(parseFloat(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
            />
          </div>
          {/* Rotation */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/50 text-xs">Rotation</span>
              <span className="text-white/70 text-xs font-mono">{cameraAngle}°</span>
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              step="5"
              value={cameraAngle}
              onChange={(e) => setCameraAngle(parseInt(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
            />
          </div>
        </div>
        {/* Location presets */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          {['Riverside District', 'Quarry Sector', 'Northern Highlands', 'Market Plaza'].map(
            (loc) => (
              <button
                key={loc}
                className="text-xs text-white/60 p-2.5 rounded-md bg-white/5 active:bg-white/15 transition-colors text-center"
              >
                {loc}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );

  // ── Chat Tab ─────────────────────────────────────────────────────

  const renderChat = () => (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold text-lg">Firm Chat</h2>
        <span className="text-xs text-white/40">3 online</span>
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto mb-4 min-h-0">
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col max-w-[80%] ${
              msg.isOwn ? 'self-end items-end' : 'self-start items-start'
            }`}
          >
            {!msg.isOwn && (
              <span className="text-[10px] text-cyan-400 mb-0.5 px-1">{msg.sender}</span>
            )}
            <div
              className={`px-3 py-2 rounded-2xl text-sm ${
                msg.isOwn
                  ? 'bg-cyan-600/30 text-white rounded-br-md'
                  : 'bg-white/10 text-white/80 rounded-bl-md'
              }`}
            >
              {msg.text}
            </div>
            <span className="text-[10px] text-white/30 mt-0.5 px-1">{msg.timestamp}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendChat()}
          placeholder="Type a message..."
          className="flex-1 bg-white/10 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-500/50 transition-colors"
        />
        <button
          onClick={sendChat}
          disabled={!chatInput.trim()}
          className="w-10 h-10 rounded-full bg-cyan-600 active:bg-cyan-500 disabled:bg-white/10 disabled:text-white/20 flex items-center justify-center text-white transition-colors flex-shrink-0"
        >
          <span className="text-lg">↑</span>
        </button>
      </div>
    </div>
  );

  // ── Main Render ──────────────────────────────────────────────────

  const tabContent: Record<MobileTab, () => React.ReactNode> = {
    dashboard: renderDashboard,
    notifications: renderNotifications,
    remote: renderRemoteView,
    chat: renderChat,
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto bg-black/90 text-white">
      {/* Status bar mock */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-b border-white/5">
        <span className="text-xs font-semibold text-white/60">World Lens Companion</span>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-[10px] text-white/40">Synced</span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">{tabContent[activeTab]()}</div>

      {/* Bottom tab bar */}
      <div className="flex items-center justify-around border-t border-white/10 bg-black/80 backdrop-blur-sm py-2 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors relative ${
              activeTab === tab.key
                ? 'text-cyan-400'
                : 'text-white/40 active:text-white/60'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="text-[10px]">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute -top-0.5 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
