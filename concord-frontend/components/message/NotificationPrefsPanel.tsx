'use client';

/**
 * NotificationPrefsPanel — global + per-channel notification preferences,
 * keyword alerts and a do-not-disturb schedule. Wires message.notif-prefs-
 * {get,set}, notif-channel-set and notif-check.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Moon, Loader2, Plus, X, FlaskConical, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface NotifPrefs {
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  keywords: string[];
  globalLevel: 'all' | 'mentions' | 'nothing';
  perChannel: Record<string, 'all' | 'mentions' | 'muted'>;
}
interface ChannelLite { id: string; name: string }
interface NotifCheckResult { willNotify: boolean; reason: string; matchedKeywords: string[]; channelLevel: string }

export function NotificationPrefsPanel({ channels }: { channels: ChannelLite[] }) {
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [dndActive, setDndActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [testChannelId, setTestChannelId] = useState('');
  const [testText, setTestText] = useState('');
  const [testIsMention, setTestIsMention] = useState(false);
  const [testResult, setTestResult] = useState<NotifCheckResult | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('message', 'notif-prefs-get', {});
      if (r.data?.ok) {
        setPrefs(r.data.result?.prefs as NotifPrefs);
        setDndActive(Boolean(r.data.result?.dndActive));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function persist(patch: Partial<NotifPrefs>) {
    setSaving(true);
    setError(null);
    try {
      const r = await lensRun('message', 'notif-prefs-set', patch as Record<string, unknown>);
      if (!r.data?.ok) { setError(r.data?.error ?? 'save failed'); return; }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function setChannelLevel(channelId: string, level: 'all' | 'mentions' | 'muted') {
    const r = await lensRun('message', 'notif-channel-set', { channelId, level });
    if (!r.data?.ok) { setError(r.data?.error ?? 'save failed'); return; }
    await load();
  }

  async function runTest() {
    const channelId = testChannelId || channels[0]?.id;
    if (!channelId || !testText.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await lensRun('message', 'notif-check', { channelId, text: testText, isMention: testIsMention });
      if (r.data?.ok) setTestResult(r.data.result as NotifCheckResult);
      else setError(r.data?.error ?? 'test failed');
    } finally {
      setTesting(false);
    }
  }

  function addKeyword() {
    const kw = keywordDraft.trim().toLowerCase();
    if (!kw || !prefs) return;
    if (prefs.keywords.includes(kw)) { setKeywordDraft(''); return; }
    void persist({ keywords: [...prefs.keywords, kw] });
    setKeywordDraft('');
  }
  function removeKeyword(kw: string) {
    if (!prefs) return;
    void persist({ keywords: prefs.keywords.filter((k) => k !== kw) });
  }

  if (loading || !prefs) {
    return <div className="p-4 text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading preferences…</div>;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-gray-200">Notification preferences</h2>
        {dndActive && <span className="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Moon className="w-3 h-3" /> DND active</span>}
        {saving && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
      </div>

      {error && <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1">{error}</div>}

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-300">Global level</div>
        <div className="flex gap-1.5">
          {(['all', 'mentions', 'nothing'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => persist({ globalLevel: lvl })}
              className={`px-2.5 py-1 text-[11px] rounded border capitalize ${prefs.globalLevel === lvl ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'border-white/10 text-gray-400 hover:text-white'}`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Moon className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-gray-300">Do not disturb schedule</span>
          <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400">
            <input type="checkbox" checked={prefs.dndEnabled} onChange={(e) => persist({ dndEnabled: e.target.checked })} />
            Enabled
          </label>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span>From</span>
          <input
            type="time"
            value={prefs.dndStart}
            onChange={(e) => persist({ dndStart: e.target.value })}
            className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white"
          />
          <span>to</span>
          <input
            type="time"
            value={prefs.dndEnd}
            onChange={(e) => persist({ dndEnd: e.target.value })}
            className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white"
          />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-300">Keyword alerts</div>
        <div className="flex items-center gap-1.5">
          <input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(); }}
            placeholder="Add a keyword…"
            className="flex-1 px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white"
          />
          <button onClick={addKeyword} className="px-2 py-1 text-[10px] rounded bg-amber-600 hover:bg-amber-500 text-white inline-flex items-center gap-0.5">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {prefs.keywords.length === 0 ? (
          <p className="text-[11px] text-gray-400">No keyword alerts yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {prefs.keywords.map((kw) => (
              <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-amber-500/10 border border-amber-500/20 text-amber-200">
                {kw}
                <button aria-label="Remove" onClick={() => removeKeyword(kw)} className="text-rose-300"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-300">Per-channel mute</div>
        {channels.length === 0 ? (
          <p className="text-[11px] text-gray-400">No channels yet.</p>
        ) : (
          <div className="space-y-1">
            {channels.map((c) => {
              const level = prefs.perChannel[c.id] ?? prefs.globalLevel;
              return (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-300 flex-1 truncate">#{c.name}</span>
                  {(['all', 'mentions', 'muted'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setChannelLevel(c.id, lvl)}
                      className={`px-1.5 py-0.5 text-[10px] rounded border capitalize ${level === lvl ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'border-white/10 text-gray-400 hover:text-white'}`}
                    >
                      {lvl === 'muted' ? <BellOff className="w-3 h-3" /> : lvl}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-xs font-semibold text-gray-300">Test your settings</span>
        </div>
        <p className="text-[10px] text-gray-400">See whether a hypothetical message would notify you under the rules above — useful for debugging "why didn't I get pinged."</p>
        {channels.length === 0 ? (
          <p className="text-[11px] text-gray-400">No channels yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <select
                value={testChannelId || channels[0]?.id || ''}
                onChange={(e) => setTestChannelId(e.target.value)}
                className="px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white"
              >
                {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
              <input
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runTest(); }}
                placeholder="Sample message text…"
                className="flex-1 px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white"
              />
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400 whitespace-nowrap">
                <input type="checkbox" checked={testIsMention} onChange={(e) => setTestIsMention(e.target.checked)} />
                @mention
              </label>
              <button
                onClick={runTest}
                disabled={testing || !testText.trim()}
                className="px-2 py-1 text-[10px] rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 inline-flex items-center gap-1"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}
              </button>
            </div>
            {testResult && (
              <div className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border ${testResult.willNotify ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-gray-500/10 border-white/10 text-gray-300'}`}>
                {testResult.willNotify ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
                {testResult.willNotify ? (
                  <span>Would notify you — reason: <strong>{testResult.reason}</strong>{testResult.matchedKeywords.length > 0 && <> (matched: {testResult.matchedKeywords.join(', ')})</>}</span>
                ) : (
                  <span>Would NOT notify you — channel level is <strong>{testResult.channelLevel}</strong></span>
                )}
                <Check className="w-3 h-3 ml-auto opacity-40" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default NotificationPrefsPanel;
