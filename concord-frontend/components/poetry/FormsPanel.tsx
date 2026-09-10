'use client';

/**
 * FormsPanel — poetic forms guide; "Try this form" seeds Compose.
 */

import { AlignLeft } from 'lucide-react';
import { POEM_FORMS, type PoemForm } from '@/components/poetry/poetry-craft';

export interface FormsPanelProps {
  onTryForm: (form: PoemForm) => void;
}

export function FormsPanel({ onTryForm }: FormsPanelProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <AlignLeft className="w-5 h-5 text-rose-400" /> Poetic Forms
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {POEM_FORMS.map((form) => (
          <div
            key={form.id}
            className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-rose-500/30 transition-colors"
          >
            <h3 className="font-medium text-sm">{form.label}</h3>
            <p className="text-xs text-gray-400 mt-1">{form.description}</p>
            <button
              type="button"
              onClick={() => onTryForm(form.id)}
              className="mt-2 text-xs text-rose-400 hover:text-rose-300"
            >
              Try this form
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
