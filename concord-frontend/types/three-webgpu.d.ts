// Minimal type stub for the `three/webgpu` subpath — three.js r0.185 folded
// WebGPU support into a dedicated build target (`build/three.webgpu.js`)
// with no matching @types/three declaration yet (DefinitelyTyped hasn't
// caught up). We only need the WebGPURenderer constructor, dynamically
// imported behind an opt-in flag in ConcordiaScene.tsx — narrow on purpose.

declare module 'three/webgpu' {
  export class WebGPURenderer {
    constructor(parameters?: {
      canvas?: HTMLCanvasElement;
      antialias?: boolean;
      powerPreference?: string;
    });
    init(): Promise<void>;
  }
}
