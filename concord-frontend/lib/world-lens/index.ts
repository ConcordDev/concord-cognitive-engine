/**
 * World Lens — Public API barrel export
 *
 * Core simulation pipeline, game systems, invisible layer,
 * social connectivity, Concordia city data, and 3D renderer types.
 */

// ── Core Simulation ────────────────────────────────────────────────
export * from './types';
export * from './validation-engine';
export * from './simulation-domains';
export * from './concordia-types';
export { MATERIALS_CATALOG } from './material-seed';
export { DEMO_DISTRICT } from './district-seed';

// ── Game Systems (21 systems) ──────────────────────────────────────
export * from './game-systems-types';

// ── Invisible Layer (15 systems) ───────────────────────────────────
export * from './invisible-layer-types';

// ── Social Connectivity ────────────────────────────────────────────
export * from './social-types';

// ── Concordia City (Poughkeepsie geography) ────────────────────────
export * from './concordia-city';

// ── Snap-Build Templates ───────────────────────────────────────────
export * from './snap-build-templates';

// ── 3D Renderer Types ──────────────────────────────────────────────
export * from './renderer-types';

// ── Premium Features ──────────────────────────────────────────────
export * from './premium-features-types';

// ── Infrastructure ────────────────────────────────────────────────
export * from './infrastructure-types';

// ── Infrastructure Tools (@concord/* packages) ────────────────────
export * from './infra-tools-types';

// ── Frontier Features (16 modules) ────────────────────────────────
export * from './frontier-features-types';

// ── AAA Rendering & Gameplay Systems ──────────────────────────────
export * from './skin-sss-shader';
export * from './pcss-shadows';
export * from './terrain-pom';
export * from './reflection-probes';
export * from './ssgi';
export * from './spatial-audio';
// world-deformation: explicit exports to avoid name collisions with renderer-types
export {
  type DeformationRecord,
  DeformationStore,
  replayDeformations,
  applyDeformationRecord,
  createDeformation,
  type WeatherState,
  type WeatherPhysicsModifiers,
  computeWeatherModifiers,
  WeatherTransitionSystem,
  type SurfaceMaterial,
  surfaceFriction,
} from './world-deformation';
