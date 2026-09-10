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
        placeholder="Whiteboard Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded mb-4"
      />
      <div data-lens-theme="whiteboard" className="flex gap-3 justify-end">
        <button type="button" onClick={onClose} className="px-4 py-2 bg-lattice-surface rounded-lg">Cancel</button>
        <button
          type="button"
          onClick={() => onCreate({ title, linkedDtus: [] })}
          disabled={creating || !title}
          className="px-4 py-2 bg-neon-pink text-black rounded-lg disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </>
  );
}
