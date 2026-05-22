'use client';

/**
 * FmCommunitiesPanel — user-created communities (subforums) with
 * per-community rules and mod teams. All data via the `forum` domain
 * subforum-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Users, ShieldCheck, ScrollText, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Subforum {
  id: string; slug: string; name: string; description: string | null;
  icon: string; rules: string[]; moderators: string[];
  topicCount: number; memberCount: number;
}

export function FmCommunitiesPanel({ onChange }: { onChange: () => void }) {
  const [subforums, setSubforums] = useState<Subforum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', icon: '💬', rules: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState('');
  const [modDraft, setModDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('forum', 'subforum-list', {});
    setSubforums(r.data?.result?.subforums || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.name.trim()) { setError('Community name is required.'); return; }
    const r = await lensRun('forum', 'subforum-create', {
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim() || '💬',
      rules: form.rules.split('\n').map((x) => x.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', description: '', icon: '💬', rules: '' });
    setError(null);
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('forum', 'subforum-delete', { id });
    if (expanded === id) setExpanded(null);
    await refresh();
  };

  const addRule = async (sf: Subforum) => {
    if (!ruleDraft.trim()) return;
    const r = await lensRun('forum', 'subforum-update-rules', {
      id: sf.id, rules: [...sf.rules, ruleDraft.trim()],
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRuleDraft('');
    await refresh();
  };

  const removeRule = async (sf: Subforum, idx: number) => {
    const next = sf.rules.filter((_, i) => i !== idx);
    await lensRun('forum', 'subforum-update-rules', { id: sf.id, rules: next });
    await refresh();
  };

  const addMod = async (sf: Subforum) => {
    if (!modDraft.trim()) return;
    const r = await lensRun('forum', 'subforum-add-mod', { id: sf.id, moderator: modDraft.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setModDraft('');
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex gap-2">
          <input placeholder="Icon" value={form.icon} maxLength={4}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            className="w-14 text-center bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Community name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <input placeholder="Description" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <textarea placeholder="Rules — one per line" value={form.rules} rows={2}
          onChange={(e) => setForm({ ...form, rules: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
        <button type="button" onClick={create}
          className="flex items-center justify-center gap-1 w-full bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg py-1.5">
          <Plus className="w-3.5 h-3.5" /> Create community
        </button>
      </section>

      {subforums.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No communities yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {subforums.map((sf) => (
            <li key={sf.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="text-lg">{sf.icon}</span>
                <button type="button" onClick={() => setExpanded(expanded === sf.id ? null : sf.id)}
                  className="flex-1 text-left min-w-0">
                  <p className="text-xs font-semibold text-zinc-100">{sf.name}</p>
                  {sf.description && <p className="text-[10px] text-zinc-500 truncate">{sf.description}</p>}
                </button>
                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <Users className="w-3 h-3" />{sf.memberCount}
                </span>
                <span className="text-[10px] text-zinc-400">{sf.topicCount} topics</span>
                <button type="button" onClick={() => del(sf.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete community">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {expanded === sf.id && (
                <div className="border-t border-zinc-800 px-3 py-3 space-y-3">
                  <div>
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 mb-1.5">
                      <ScrollText className="w-3.5 h-3.5 text-orange-400" /> Community rules
                    </p>
                    {sf.rules.length === 0 ? (
                      <p className="text-[10px] text-zinc-600 italic">No rules set.</p>
                    ) : (
                      <ol className="list-decimal list-inside space-y-1">
                        {sf.rules.map((r, i) => (
                          <li key={i} className="text-[11px] text-zinc-300 flex items-start gap-1.5">
                            <span className="flex-1">{r}</span>
                            <button type="button" onClick={() => removeRule(sf, i)}
                              className="text-zinc-600 hover:text-rose-400" aria-label="Remove rule">
                              <X className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="flex gap-2 mt-1.5">
                      <input placeholder="Add a rule" value={ruleDraft}
                        onChange={(e) => setRuleDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void addRule(sf); }}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <button type="button" onClick={() => addRule(sf)}
                        className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Add</button>
                    </div>
                  </div>

                  <div>
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 mb-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-orange-400" /> Mod team
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sf.moderators.map((m) => (
                        <span key={m} className="text-[10px] text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">{m}</span>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <input placeholder="Add moderator" value={modDraft}
                        onChange={(e) => setModDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void addMod(sf); }}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <button type="button" onClick={() => addMod(sf)}
                        className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Add</button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
