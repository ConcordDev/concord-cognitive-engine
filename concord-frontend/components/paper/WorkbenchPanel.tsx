'use client';

/**
 * WorkbenchPanel — Zotero librarian tools: PDF reader, annotation, DOI
 * capture, Semantic Scholar enrich, dedupe, group libraries, cited-by alerts.
 */

import { PaperWorkbench } from '@/components/paper/PaperWorkbench';
import { ds } from '@/lib/design-system';

export function WorkbenchPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Librarian workbench</h2>
        <p className={ds.textMuted}>
          PDF attach + in-app reader, highlights, DOI/URL capture, Semantic Scholar, duplicates, groups, alerts.
        </p>
      </div>
      <PaperWorkbench />
    </div>
  );
}
