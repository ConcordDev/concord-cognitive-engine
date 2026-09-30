'use client';

import ChemStructureLab from '@/components/chem/ChemStructureLab';

export function StructureLabPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Structure lab (editor, 3D viewer, SMILES/InChI, spectroscopy)</h3>
      <ChemStructureLab />
    </div>
  );
}
