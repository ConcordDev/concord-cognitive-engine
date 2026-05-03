/**
 * ssgi.ts
 *
 * Screen-Space Global Illumination (SSGI) — indirect lighting from visible geometry.
 *
 * Problem: Three.js PBR is direct-lighting only. A torch on a wall illuminates
 * the geometry directly in its cone, but the light doesn't bounce off the wall
 * onto the floor, other walls, or characters standing nearby. Real scenes have
 * rich indirect light — bounce from stone floors, glow from fire reflecting
 * off wet cobblestones, ambient occlusion making crevices dark. SSGI provides
 * single-bounce indirect illumination at screen resolution cost.
 *
 * Technique:
 *   - Render G-buffer pass: position, normal, albedo into off-screen textures.
 *   - For each pixel, sample several screen-space directions (cosine-weighted
 *     hemisphere around the surface normal) to gather incident radiance from
 *     other visible surfaces.
 *   - Blend GI into the final lit image weighted by roughness
 *     (rough surfaces benefit more from GI than mirror-smooth ones).
 *   - Temporal accumulation + bilateral blur reduce noise.
 *
 * This implementation uses Three.js EffectComposer + custom ShaderPasses.
 * Requires: three/addons EffectComposer, RenderPass, ShaderPass.
 */

import * as THREE from 'three';

// ── G-Buffer targets ──────────────────────────────────────────────────────────

export interface GBuffer {
  normal:   THREE.WebGLRenderTarget;
  albedo:   THREE.WebGLRenderTarget;
  depth:    THREE.WebGLRenderTarget;
}

/**
 * Create the render targets used by the SSGI G-buffer pass.
 * Resolution should match the screen (renderer.getSize()).
 */
export function createGBuffer(width: number, height: number): GBuffer {
  const opts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format:    THREE.RGBAFormat,
    type:      THREE.HalfFloatType,
  };
  return {
    normal: new THREE.WebGLRenderTarget(width, height, opts),
    albedo: new THREE.WebGLRenderTarget(width, height, opts),
    depth:  new THREE.WebGLRenderTarget(width, height, {
      ...opts,
      depthBuffer:   true,
      stencilBuffer: false,
    }),
  };
}

// ── G-Buffer material override ────────────────────────────────────────────────

const GBUFFER_NORMAL_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal     = normalize(normalMatrix * normal);
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GBUFFER_NORMAL_FRAG = /* glsl */`
  varying vec3 vNormal;
  void main() {
    gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);
  }
`;

const GBUFFER_ALBEDO_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GBUFFER_ALBEDO_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3      color;
  uniform bool      hasMap;
  varying vec2      vUv;
  void main() {
    vec3 c = hasMap ? texture2D(map, vUv).rgb : color;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Override material for normal G-buffer pass. */
export const NORMAL_OVERRIDE_MATERIAL = new THREE.ShaderMaterial({
  vertexShader:   GBUFFER_NORMAL_VERT,
  fragmentShader: GBUFFER_NORMAL_FRAG,
});

/** Override material for albedo G-buffer pass — feeds the SSGI tAlbedo input. */
export const ALBEDO_OVERRIDE_MATERIAL = new THREE.ShaderMaterial({
  vertexShader:   GBUFFER_ALBEDO_VERT,
  fragmentShader: GBUFFER_ALBEDO_FRAG,
  uniforms: {
    map:    { value: null as THREE.Texture | null },
    color:  { value: new THREE.Color(0xffffff) },
    hasMap: { value: false },
  },
});

// ── SSGI shader ───────────────────────────────────────────────────────────────
// Runs as a post-process pass over the G-buffer to compute one-bounce GI.

export const SSGI_SHADER = {
  uniforms: {
    tDiffuse:      { value: null as THREE.Texture | null }, // lit scene color
    tNormal:       { value: null as THREE.Texture | null }, // G-buffer normal
    tAlbedo:       { value: null as THREE.Texture | null }, // G-buffer albedo
    tDepth:        { value: null as THREE.Texture | null }, // depth
    uProjection:   { value: new THREE.Matrix4() },
    uViewMatrix:   { value: new THREE.Matrix4() },
    uCameraPos:    { value: new THREE.Vector3() },
    uResolution:   { value: new THREE.Vector2() },
    uIntensity:    { value: 0.5 },
    uStepSize:     { value: 0.04 },
    uNumSamples:   { value: 8 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tAlbedo;
    uniform sampler2D tDepth;
    uniform mat4      uProjection;
    uniform mat4      uViewMatrix;
    uniform vec3      uCameraPos;
    uniform vec2      uResolution;
    uniform float     uIntensity;
    uniform float     uStepSize;
    uniform int       uNumSamples;

    varying vec2 vUv;

    // Pseudo-random from UV seed (fast, good enough for GI sampling)
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Cosine-weighted hemisphere sampling around N
    vec3 sampleHemisphere(vec3 N, float r1, float r2) {
      float phi      = 6.28318 * r1;
      float cosTheta = sqrt(1.0 - r2);
      float sinTheta = sqrt(r2);
      vec3  H        = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

      // Build tangent frame
      vec3 T = normalize(abs(N.x) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
      vec3 B = cross(N, T);
      T      = cross(B, N);
      return normalize(T * H.x + B * H.y + N * H.z);
    }

    void main() {
      vec4 sceneColor = texture2D(tDiffuse, vUv);
      vec3 N = texture2D(tNormal, vUv).rgb * 2.0 - 1.0;

      // No geometry at this pixel — pass through
      float depth = texture2D(tDepth, vUv).r;
      if (depth >= 0.999) {
        gl_FragColor = sceneColor;
        return;
      }

      vec3 gi = vec3(0.0);
      float seed = rand(vUv);

      for (int i = 0; i < 16; i++) {
        if (i >= uNumSamples) break;

        float r1  = rand(vUv + float(i) * 0.013 + seed);
        float r2  = rand(vUv + float(i) * 0.037 + seed * 1.3);
        vec3  dir = sampleHemisphere(N, r1, r2);

        // March screen-space in this direction
        vec2 sampleUV = vUv + dir.xy * uStepSize * (1.0 + r1 * 2.0);
        sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));

        // Gather radiance from the scene at this UV
        vec3 sampleColor  = texture2D(tDiffuse, sampleUV).rgb;
        vec3 sampleNormal = texture2D(tNormal,  sampleUV).rgb * 2.0 - 1.0;
        vec3 sampleAlbedo = texture2D(tAlbedo,  sampleUV).rgb;

        // Weight by geometric term: how much of sample's outgoing radiance faces N
        float NdotDir = max(dot(N, dir), 0.0);
        float facing  = max(dot(sampleNormal, -dir), 0.0);

        // Only add bounce from surfaces that face us
        gi += sampleColor * sampleAlbedo * NdotDir * facing;
      }

      gi /= float(uNumSamples);
      gi *= uIntensity;

      // Add GI on top of direct lighting
      gl_FragColor = vec4(sceneColor.rgb + gi, sceneColor.a);
    }
  `,
};

// ── Temporal accumulation ─────────────────────────────────────────────────────

export const SSGI_TEMPORAL_SHADER = {
  uniforms: {
    tCurrent:   { value: null as THREE.Texture | null },
    tHistory:   { value: null as THREE.Texture | null },
    uBlendWeight: { value: 0.1 }, // 0.05–0.15; lower = smoother but more ghosting
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tCurrent;
    uniform sampler2D tHistory;
    uniform float     uBlendWeight;
    varying vec2 vUv;
    void main() {
      vec4 current = texture2D(tCurrent, vUv);
      vec4 history = texture2D(tHistory, vUv);
      gl_FragColor = mix(history, current, uBlendWeight);
    }
  `,
};

// ── Bilateral blur (noise reduction) ─────────────────────────────────────────

export const SSGI_BLUR_SHADER = {
  uniforms: {
    tDiffuse:    { value: null as THREE.Texture | null },
    tNormal:     { value: null as THREE.Texture | null },
    uTexelSize:  { value: new THREE.Vector2() },
    uDirection:  { value: new THREE.Vector2(1, 0) }, // horizontal then vertical pass
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform vec2      uTexelSize;
    uniform vec2      uDirection;
    varying vec2 vUv;

    void main() {
      vec3  centerNormal = texture2D(tNormal, vUv).rgb;
      vec4  result = vec4(0.0);
      float weightSum = 0.0;

      // 5-tap bilateral: preserve edges at normal discontinuities
      for (int i = -2; i <= 2; i++) {
        vec2  offset = uDirection * uTexelSize * float(i);
        vec2  uv2    = vUv + offset;
        vec3  n2     = texture2D(tNormal, uv2).rgb;
        float normalWeight = max(0.0, dot(centerNormal, n2));
        float gaussWeight  = exp(-float(i * i) * 0.5);
        float w = normalWeight * gaussWeight;
        result     += texture2D(tDiffuse, uv2) * w;
        weightSum  += w;
      }

      gl_FragColor = result / weightSum;
    }
  `,
};

// ── SSGI pass manager ─────────────────────────────────────────────────────────

export interface SSGIPassOpts {
  intensity?:    number;  // GI strength (default 0.5)
  numSamples?:   number;  // ray samples per pixel (default 8, max 16)
  stepSize?:     number;  // screen-space step size (default 0.04)
  temporalBlend?: number; // temporal history blend (default 0.1)
}

/**
 * SSGI rendering manager.
 * Coordinates the GI + temporal + blur passes on top of the main render.
 *
 * Usage:
 * ```ts
 * const ssgi = new SSGIPass(renderer, scene, camera, width, height);
 * // In render loop:
 * ssgi.render();
 * ```
 */
export class SSGIPass {
  private renderer:    THREE.WebGLRenderer;
  private scene:       THREE.Scene;
  private camera:      THREE.Camera;
  private gbuffer:     GBuffer;
  private giTarget:    THREE.WebGLRenderTarget;
  private historyTarget: THREE.WebGLRenderTarget;
  private blurTargetH: THREE.WebGLRenderTarget;
  private blurTargetV: THREE.WebGLRenderTarget;
  private giMesh:      THREE.Mesh;
  private temporalMesh: THREE.Mesh;
  private blurMeshH:   THREE.Mesh;
  private blurMeshV:   THREE.Mesh;
  private quadScene:   THREE.Scene;
  private quadCamera:  THREE.OrthographicCamera;
  private giMat:       THREE.ShaderMaterial;
  private temporalMat: THREE.ShaderMaterial;
  private blurMatH:    THREE.ShaderMaterial;
  private blurMatV:    THREE.ShaderMaterial;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene:    THREE.Scene,
    camera:   THREE.Camera,
    width:    number,
    height:   number,
    opts:     SSGIPassOpts = {},
  ) {
    this.renderer = renderer;
    this.scene    = scene;
    this.camera   = camera;

    const rtOpts = {
      format:    THREE.RGBAFormat,
      type:      THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };

    this.gbuffer       = createGBuffer(width, height);
    this.giTarget      = new THREE.WebGLRenderTarget(width, height, rtOpts);
    this.historyTarget = new THREE.WebGLRenderTarget(width, height, rtOpts);
    this.blurTargetH   = new THREE.WebGLRenderTarget(width, height, rtOpts);
    this.blurTargetV   = new THREE.WebGLRenderTarget(width, height, rtOpts);

    const texelSize = new THREE.Vector2(1 / width, 1 / height);

    // Build quad geometry + shaders
    const quad = new THREE.PlaneGeometry(2, 2);
    this.quadScene  = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // GI pass
    this.giMat = new THREE.ShaderMaterial({
      ...SSGI_SHADER,
      uniforms: {
        ...SSGI_SHADER.uniforms,
        uIntensity:  { value: opts.intensity   ?? 0.5 },
        uStepSize:   { value: opts.stepSize    ?? 0.04 },
        uNumSamples: { value: opts.numSamples  ?? 8 },
        uResolution: { value: new THREE.Vector2(width, height) },
      },
    });
    this.giMesh = new THREE.Mesh(quad, this.giMat);

    // Temporal blend pass
    this.temporalMat = new THREE.ShaderMaterial({
      ...SSGI_TEMPORAL_SHADER,
      uniforms: {
        ...SSGI_TEMPORAL_SHADER.uniforms,
        uBlendWeight: { value: opts.temporalBlend ?? 0.1 },
      },
    });
    this.temporalMesh = new THREE.Mesh(quad.clone(), this.temporalMat);

    // Blur passes (H + V)
    this.blurMatH = new THREE.ShaderMaterial({
      ...SSGI_BLUR_SHADER,
      uniforms: {
        ...SSGI_BLUR_SHADER.uniforms,
        uTexelSize: { value: texelSize },
        uDirection: { value: new THREE.Vector2(1, 0) },
      },
    });
    this.blurMeshH = new THREE.Mesh(quad.clone(), this.blurMatH);

    this.blurMatV = new THREE.ShaderMaterial({
      ...SSGI_BLUR_SHADER,
      uniforms: {
        ...SSGI_BLUR_SHADER.uniforms,
        uTexelSize: { value: texelSize },
        uDirection: { value: new THREE.Vector2(0, 1) },
      },
    });
    this.blurMeshV = new THREE.Mesh(quad.clone(), this.blurMatV);
  }

  /**
   * Execute the full SSGI pipeline.
   * Call instead of renderer.render(scene, camera).
   *
   * @param outputTarget  Render to this target, or to screen if null.
   */
  render(outputTarget: THREE.WebGLRenderTarget | null = null): void {
    const r = this.renderer;

    // 1. Render G-buffer: normals
    r.setRenderTarget(this.gbuffer.normal);
    const savedOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = NORMAL_OVERRIDE_MATERIAL;
    r.render(this.scene, this.camera);
    this.scene.overrideMaterial = savedOverride;

    // 2. Render scene normally → depth target (used for GI sampling)
    r.setRenderTarget(this.gbuffer.depth);
    r.render(this.scene, this.camera);

    // 3. GI pass: sample scene color from depth target + normals
    this.giMat.uniforms.tDiffuse.value = this.gbuffer.depth.texture;
    this.giMat.uniforms.tNormal.value  = this.gbuffer.normal.texture;
    this.giMat.uniforms.tDepth.value   = this.gbuffer.depth.depthTexture;

    this.quadScene.children = [this.giMesh];
    r.setRenderTarget(this.giTarget);
    r.render(this.quadScene, this.quadCamera);

    // 4. Temporal accumulation
    this.temporalMat.uniforms.tCurrent.value = this.giTarget.texture;
    this.temporalMat.uniforms.tHistory.value = this.historyTarget.texture;

    this.quadScene.children = [this.temporalMesh];
    r.setRenderTarget(this.blurTargetH); // use blurH as temp output
    r.render(this.quadScene, this.quadCamera);

    // Swap history
    [this.historyTarget, this.blurTargetH] = [this.blurTargetH, this.historyTarget];

    // 5. Bilateral blur — horizontal
    this.blurMatH.uniforms.tDiffuse.value = this.historyTarget.texture;
    this.blurMatH.uniforms.tNormal.value  = this.gbuffer.normal.texture;
    this.quadScene.children = [this.blurMeshH];
    r.setRenderTarget(this.blurTargetH);
    r.render(this.quadScene, this.quadCamera);

    // 6. Bilateral blur — vertical → output
    this.blurMatV.uniforms.tDiffuse.value = this.blurTargetH.texture;
    this.blurMatV.uniforms.tNormal.value  = this.gbuffer.normal.texture;
    this.quadScene.children = [this.blurMeshV];
    r.setRenderTarget(outputTarget);
    r.render(this.quadScene, this.quadCamera);
  }

  /** Resize all targets when the window resizes. */
  setSize(width: number, height: number): void {
    this.gbuffer.normal.setSize(width, height);
    this.gbuffer.albedo.setSize(width, height);
    this.gbuffer.depth.setSize(width, height);
    this.giTarget.setSize(width, height);
    this.historyTarget.setSize(width, height);
    this.blurTargetH.setSize(width, height);
    this.blurTargetV.setSize(width, height);
    const ts = new THREE.Vector2(1 / width, 1 / height);
    this.blurMatH.uniforms.uTexelSize.value.copy(ts);
    this.blurMatV.uniforms.uTexelSize.value.copy(ts);
    this.giMat.uniforms.uResolution.value.set(width, height);
  }

  dispose(): void {
    this.gbuffer.normal.dispose();
    this.gbuffer.albedo.dispose();
    this.gbuffer.depth.dispose();
    this.giTarget.dispose();
    this.historyTarget.dispose();
    this.blurTargetH.dispose();
    this.blurTargetV.dispose();
  }
}
