// @vitest-environment jsdom
/**
 * FIX-sandbox-010: the arena canvas went blank after a resize that
 * cost it the WebGL context (DevTools docking is the classic trigger)
 * and never recovered. Pins: the canvas opts into context restoration
 * (preventDefault on webglcontextlost) and redraws on
 * webglcontextrestored. THREE is stubbed — the contract under test is
 * the component's event wiring, not WebGL itself.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const renderCalls: unknown[] = [];
let canvasEl: HTMLCanvasElement | null = null;

vi.mock("three", () => {
  class Obj {
    children: unknown[] = [];
    position = { set: () => {}, x: 0, y: 0 };
    rotation = { x: 0, y: 0 };
    scale = { x: 1 };
    quaternion = { copy: () => {} };
    material = { color: { set: () => {} }, emissive: { set: () => {} }, emissiveIntensity: 0 };
    visible = true;
    userData: Record<string, unknown> = {};
    add(...o: unknown[]) { this.children.push(...o); }
    remove(..._o: unknown[]) {}
    traverse(fn: (o: unknown) => void) { fn(this); }
    dispose() {}
  }
  class WebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor() { this.domElement = document.createElement("canvas"); canvasEl = this.domElement; }
    setPixelRatio() {}
    setSize() {}
    render(...args: unknown[]) { renderCalls.push(args); }
    dispose() {}
  }
  return {
    Scene: class extends Obj { background = null; fog = null; },
    Color: class {}, Fog: class {},
    PerspectiveCamera: class extends Obj { aspect = 1; updateProjectionMatrix() {}; lookAt() {} },
    WebGLRenderer,
    AmbientLight: class extends Obj {}, DirectionalLight: class extends Obj {},
    PlaneGeometry: class extends Obj {}, MeshStandardMaterial: class extends Obj {},
    MeshBasicMaterial: class extends Obj {}, Mesh: class extends Obj {},
    GridHelper: class extends Obj {}, CapsuleGeometry: class extends Obj {},
    Group: class extends Obj {},
    Raycaster: class { setFromCamera() {}; intersectObjects() { return []; } },
    Vector2: class { x = 0; y = 0; },
  };
});

import { SandboxArena3D } from "@/components/sandbox/SandboxArena3D";

describe("arena WebGL context recovery", () => {
  it("context loss is preventDefaulted and restore redraws", () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
    render(<SandboxArena3D dummies={[]} timeScale={1} flashId={null} onHitDummy={() => {}} />);
    expect(canvasEl).toBeTruthy();
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvasEl!.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    const before = renderCalls.length;
    canvasEl!.dispatchEvent(new Event("webglcontextrestored"));
    expect(renderCalls.length).toBeGreaterThan(before);
  });
});
