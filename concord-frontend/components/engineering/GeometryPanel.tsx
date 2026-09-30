'use client';

import { GeometryEditor } from './GeometryEditor';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** Parametric 3-D part editor — extracts Geometry tab from the welded page. */
export function GeometryPanel() {
  const { libMaterials } = useEngineeringFea();
  return (
    <GeometryEditor
      materials={
        libMaterials.length > 0
          ? libMaterials.map((m) => ({ id: m.id, label: m.label, density: m.density }))
          : [{ id: 'steel-a36', label: 'ASTM A36 Steel', density: 7850 }]
      }
    />
  );
}
