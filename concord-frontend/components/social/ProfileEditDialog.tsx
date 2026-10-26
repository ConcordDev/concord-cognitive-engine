'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ACCENT_MIN_CONTRAST, checkAccent, normalizeHex } from '@/lib/social/contrast';

export interface ProfileEditValues {
  displayName: string;
  bio: string;
  avatar: string;
  website: string;
  isPublic: boolean;
  /** User-picked accent (#rrggbb) for the avatar ring + Aura; null = none. */
  accent?: string | null;
}

interface ProfileEditDialogProps {
  userId: string;
  initial: ProfileEditValues;
  onClose: () => void;
}

async function uploadAvatar(file: File): Promise<string> {
  const res = await fetch('/api/artifact/upload', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': file.name,
      'X-Domain': 'social',
      'X-Title': file.name,
    },
    body: file,
  });
  const body = await res.json() as { ok?: boolean; dtuId?: string; error?: string };
  if (!res.ok || !body.dtuId) throw new Error(body.error || 'Avatar upload failed');
  return `/api/artifact/${body.dtuId}/stream`;
}

export function ProfileEditDialog({ userId, initial, onClose }: ProfileEditDialogProps) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [avatar, setAvatar] = useState(initial.avatar);
  const [website, setWebsite] = useState(initial.website);
  const [isPublic, setIsPublic] = useState(initial.isPublic);
  const [accentInput, setAccentInput] = useState(initial.accent || '');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Accent validation is computed live from the shared pure module — the
  // same math the server enforces. An empty field clears the accent.
  const accentCheck = accentInput.trim() === '' ? { valid: true, contrast: null, error: null } : checkAccent(accentInput);
  const accentReady = accentCheck.valid;

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/social/profile', {
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatar,
        website: website.trim(),
        isPublic,
        accent: accentInput.trim() === '' ? null : normalizeHex(accentInput),
      });
      return res.data as { ok?: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (data && data.ok === false) return;
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      queryClient.invalidateQueries({ queryKey: ['social-profiles'] });
      // The welcome checklist's avatar/bio steps read the profile record —
      // a real save checks them off (oc-social-3b).
      queryClient.invalidateQueries({ queryKey: ['social-welcome-state'] });
      onClose();
    },
  });

  const error = uploadError
    || (save.data && save.data.ok === false ? save.data.error : null)
    || (save.error instanceof Error ? save.error.message : null);

  return (
    <form
      role="dialog"
      aria-label="Edit profile"
      className="space-y-3 p-4"
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
    >
      <h3 className="text-sm font-medium text-zinc-100">Edit profile</h3>
      <label className="block text-xs text-zinc-400">
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100"
          required
        />
      </label>
      <label className="block text-xs text-zinc-400">
        Bio
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 280))}
          rows={3}
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100"
        />
      </label>
      <label className="block text-xs text-zinc-400">
        Website
        <input
          value={website}
          onChange={(e) => setWebsite(e.target.value.slice(0, 200))}
          placeholder="https://"
          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100"
        />
      </label>
      <label className="block text-xs text-zinc-400">
        Avatar
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-xs text-zinc-300"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploadError(null);
            try { setAvatar(await uploadAvatar(file)); }
            catch (err) { setUploadError(err instanceof Error ? err.message : 'Avatar upload failed'); }
          }}
        />
      </label>
      {avatar ? <p className="truncate text-[11px] text-zinc-500">Avatar: {avatar}</p> : null}
      <fieldset className="block text-xs text-zinc-400">
        <legend>Accent colour</legend>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick accent colour"
            value={normalizeHex(accentInput) || '#12121a'}
            onChange={(e) => setAccentInput(e.target.value)}
            className="h-11 w-14 cursor-pointer rounded border border-white/10 bg-black/40 p-1"
          />
          <input
            value={accentInput}
            onChange={(e) => setAccentInput(e.target.value.trim().slice(0, 7))}
            placeholder="#14b8a6"
            aria-label="Accent colour hex"
            className="min-h-[44px] w-28 rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-sm text-zinc-100"
          />
          {accentInput.trim() !== '' ? (
            <button
              type="button"
              onClick={() => setAccentInput('')}
              className="min-h-[44px] rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              aria-label="Clear accent colour"
            >
              Clear
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Colours the ring around your avatar and one tone of your Aura. Needs at least{' '}
          {ACCENT_MIN_CONTRAST}:1 contrast against the dark profile surface.
          {accentCheck.contrast !== null
            ? ` Currently ${accentCheck.contrast.toFixed(2)}:1 — ${accentCheck.valid ? 'passes' : 'too low'}.`
            : ''}
        </p>
        {accentInput.trim() !== '' && accentCheck.error ? (
          <p className="mt-1 text-xs text-rose-400" role="alert">
            {accentCheck.error}
          </p>
        ) : null}
      </fieldset>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public profile
      </label>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-zinc-400">Cancel</button>
        <button
          type="submit"
          disabled={save.isPending || !displayName.trim() || !accentReady}
          className="rounded bg-teal-400 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
