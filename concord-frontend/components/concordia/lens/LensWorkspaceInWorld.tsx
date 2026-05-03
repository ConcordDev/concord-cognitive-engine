'use client';

import React, { useState, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { modeManager } from '@/lib/concordia/mode-manager';

const LENS_BLUEPRINT_LABEL: Record<string, string> = {
  architecture: 'Send building design to Concordia',
  code:         'Send engineering spec to Concordia',
  materials:    'Send material design to Concordia',
  studio:       'Send creation to Concordia',
  research:     'Send research blueprint to Concordia',
};

// Renders as a floating panel anchored in 3D space via @react-three/drei Html.
// When not inside a Three.js canvas (e.g. tests, stories), falls back to a
// fixed-position overlay so it still renders correctly.

interface LensMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  dtuRefs?: string[];
}

interface LensWorkspaceInWorldProps {
  lensId: string;
  lensName?: string;
  playerPosition: { x: number; y: number; z: number };
  onClose?: () => void;
  /** When set, overrides lensId — used by the GameModeOrchestrator lens cycler */
  lensIdOverride?: string;
  /** When true renders as a canvas Html element (needs @react-three/drei Html wrapper in parent) */
  inCanvas?: boolean;
}

export function LensWorkspaceInWorld({
  lensId: lensIdProp,
  lensIdOverride,
  lensName,
  onClose,
}: LensWorkspaceInWorldProps) {
  const lensId = lensIdOverride ?? lensIdProp;
  const [messages, setMessages] = useState<LensMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentDTUs, setRecentDTUs] = useState<Array<{ id: string; title: string }>>([]);
  const [blueprintToast, setBlueprintToast] = useState<string | null>(null);

  const send = useCallback(async () => {
    if (!input.trim()) return;
    const userMsg: LensMessage = { id: `${Date.now()}-u`, role: 'user', text: input };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/api/chat', {
        message: input,
        lensContext: { lens: lensId, intent: 'lens-work-in-world' },
        brainOverride: 'conscious',
      });
      const text: string = res.data?.response ?? res.data?.text ?? '';
      const dtuRefs: string[] = res.data?.dtuContributors?.map((d: { dtuId: string }) => d.dtuId) ?? [];
      setMessages(m => [...m, { id: `${Date.now()}-a`, role: 'assistant', text, dtuRefs }]);
    } catch (err) {
      setMessages(m => [...m, { id: `${Date.now()}-e`, role: 'assistant', text: `Error: ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, lensId]);

  const loadDTUs = useCallback(async () => {
    try {
      // Multi-avatar (Workstream 6a): scope by active avatar so each avatar
      // sees its own DTUs.
      const avatarId = typeof window !== 'undefined' ? window.localStorage.getItem('concordia:activeAvatarId') : null;
      const qs = new URLSearchParams({ lens: lensId });
      if (avatarId) qs.set('avatarId', avatarId);
      const res = await api.get(`/api/personal-locker/dtus?${qs.toString()}`);
      const dtus = res.data?.dtus ?? [];
      setRecentDTUs(dtus.slice(0, 5).map((d: { id: string; title?: string }) => ({ id: d.id, title: d.title ?? d.id })));
    } catch { /* silent */ }
  }, [lensId]);

  React.useEffect(() => { loadDTUs(); }, [loadDTUs]);

  const handleClose = useCallback(() => {
    modeManager.pop();
    onClose?.();
  }, [onClose]);

  const handleSendBlueprint = useCallback(async (dtuId: string, dtuTitle: string) => {
    try {
      await api.post('/api/blueprints/from-dtu', { dtuId });
      setBlueprintToast(`"${dtuTitle}" sent to Concordia as a blueprint`);
      setTimeout(() => setBlueprintToast(null), 3000);
    } catch {
      setBlueprintToast('Failed to create blueprint');
      setTimeout(() => setBlueprintToast(null), 3000);
    }
  }, []);

  return (
    <div
      className="bg-black/90 border border-white/20 rounded-xl shadow-2xl flex flex-col"
      style={{ width: 340, maxHeight: 480 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-sm font-semibold text-white capitalize">{lensName ?? lensId} Lens</span>
        <button onClick={handleClose} className="text-white/40 hover:text-white text-xs">✕ Exit</button>
      </div>

      {/* Recent DTUs */}
      {recentDTUs.length > 0 && (
        <div className="px-3 pt-2 pb-1 border-b border-white/5">
          <div className="text-[10px] text-white/30 font-mono mb-1">RECENT DTUS</div>
          <div className="flex flex-col gap-1">
            {recentDTUs.map(d => (
              <div key={d.id} className="flex items-center gap-1">
                <button
                  onClick={() => setInput(s => s + ` @${d.id}`)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 hover:bg-white/20 font-mono truncate max-w-[90px] flex-1"
                  title={d.title}
                >
                  {d.title.slice(0, 12)}…
                </button>
                {LENS_BLUEPRINT_LABEL[lensId] && (
                  <button
                    onClick={() => handleSendBlueprint(d.id, d.title)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-green-700/40 text-green-400 hover:bg-green-700/60 whitespace-nowrap flex-shrink-0"
                    title={LENS_BLUEPRINT_LABEL[lensId]}
                  >
                    → Concordia
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blueprint toast */}
      {blueprintToast && (
        <div className="mx-3 mb-1 px-2 py-1.5 rounded-lg bg-green-700/20 border border-green-500/20 text-[10px] text-green-400">
          {blueprintToast}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0 text-sm">
        {messages.length === 0 && (
          <p className="text-white/30 text-xs">Ask anything about {lensName ?? lensId}…</p>
        )}
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span className={`inline-block px-2 py-1 rounded-lg max-w-[90%] text-xs
              ${m.role === 'user' ? 'bg-blue-600/40 text-white' : 'bg-white/10 text-white/90'}`}>
              {m.text}
            </span>
            {m.dtuRefs && m.dtuRefs.length > 0 && (
              <div className="text-[9px] text-white/20 font-mono mt-0.5">
                refs: {m.dtuRefs.slice(0, 3).join(', ')}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="text-white/30 text-xs animate-pulse">Thinking…</div>}
      </div>

      {/* Input */}
      <div className="flex gap-1 px-3 pb-3">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask or create a DTU…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white
            placeholder-white/20 focus:outline-none focus:border-white/30"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-white text-xs font-semibold"
        >
          →
        </button>
      </div>
    </div>
  );
}
