'use client';

import { useState } from 'react';

export function WhiteboardCreateForm({
  onClose,
  onCreate,
  creating,
}: {
  onClose: () => void;
  onCreate: (data: { title: string; linkedDtus: string[] }) => void;
  creating: boolean;
}) {
  const [title, setTitle] = useState('');
  return (
    <>
      <input
        type="text"
        placeholder="Board name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-5 w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-teal-400/40 focus:outline-none"
      />
      <div data-lens-theme="whiteboard" className="flex gap-3 justify-end">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-[14px] text-zinc-400 hover:text-zinc-200">Cancel</button>
        <button
          type="button"
          onClick={() => onCreate({ title, linkedDtus: [] })}
          disabled={creating || !title}
          className="rounded-full bg-teal-400 px-5 py-2 text-[14px] font-medium text-black hover:bg-teal-300 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </>
  );
}
