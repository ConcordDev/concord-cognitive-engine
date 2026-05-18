'use client';

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { X, Globe, Lock, Users, Copy, Check, Loader2, Trash2 } from 'lucide-react';

interface Collaborator {
  user_id: string;
  role: string;
  invited_at: number;
}

interface Doc {
  id: string;
  visibility: string;
  slug?: string | null;
}

interface Props { documentId: string; onClose: () => void; }

const ROLES = ['viewer', 'commenter', 'editor', 'admin'] as const;

export function DocSharePanel({ documentId, onClose }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [collabs, setCollabs] = useState<Collaborator[]>([]);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<typeof ROLES[number]>('editor');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [docR, collabR] = await Promise.all([
        callDocsMacro<{ document?: Doc }>('get', { id: documentId }),
        callDocsMacro<{ collaborators?: Collaborator[] }>('collaborators', { documentId }),
      ]);
      if (docR?.document) setDoc(docR.document);
      if (collabR?.collaborators) setCollabs(collabR.collaborators);
    } catch (e) { console.error('share load', e); }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const publish = useCallback(async () => {
    setBusy(true);
    try {
      await callDocsMacro('publish', { id: documentId });
      load();
    } finally { setBusy(false); }
  }, [documentId, load]);

  const unpublish = useCallback(async () => {
    setBusy(true);
    try {
      await callDocsMacro('unpublish', { id: documentId });
      load();
    } finally { setBusy(false); }
  }, [documentId, load]);

  const invite = useCallback(async () => {
    if (!inviteUserId.trim()) return;
    setBusy(true);
    try {
      await callDocsMacro('invite', { documentId, userId: inviteUserId.trim(), role: inviteRole });
      setInviteUserId('');
      load();
    } finally { setBusy(false); }
  }, [documentId, inviteUserId, inviteRole, load]);

  const revoke = useCallback(async (userId: string) => {
    setBusy(true);
    try {
      await callDocsMacro('revoke', { documentId, userId });
      load();
    } finally { setBusy(false); }
  }, [documentId, load]);

  const publishUrl = doc?.slug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/d/${doc.slug}` : '';

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Share</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Public publish */}
      <div className="bg-white/5 rounded p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {doc?.visibility === 'public' ? <Globe className="w-4 h-4 text-green-400" /> : <Lock className="w-4 h-4" />}
          {doc?.visibility === 'public' ? 'Published' : 'Private'}
        </div>
        {doc?.visibility === 'public' ? (
          <>
            <div className="flex items-center gap-1 text-xs">
              <input
                readOnly
                value={publishUrl}
                className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-white/80"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(publishUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="p-1.5 rounded hover:bg-white/10 text-white/70"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              onClick={unpublish}
              disabled={busy}
              className="w-full py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm"
            >
              Unpublish
            </button>
          </>
        ) : (
          <button
            onClick={publish}
            disabled={busy}
            className="w-full py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium"
          >
            Publish to public URL
          </button>
        )}
      </div>

      {/* Collaborators */}
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/40 mb-2">
          <Users className="w-3.5 h-3.5" /> Collaborators ({collabs.length})
        </div>
        <div className="space-y-1 mb-3">
          {collabs.map((c) => (
            <div key={c.user_id} className="flex items-center gap-2 text-sm bg-white/5 rounded px-2 py-1">
              <span className="flex-1 truncate text-white/80">{c.user_id}</span>
              <span className="text-xs text-cyan-300">{c.role}</span>
              {c.role !== 'owner' && (
                <button
                  onClick={() => revoke(c.user_id)}
                  className="p-1 rounded hover:bg-red-500/20 text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
            placeholder="user id…"
            className="flex-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as typeof ROLES[number])}
            className="px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white"
          >
            {ROLES.map((r) => <option key={r} value={r} className="bg-black">{r}</option>)}
          </select>
          <button
            onClick={invite}
            disabled={busy || !inviteUserId.trim()}
            className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
