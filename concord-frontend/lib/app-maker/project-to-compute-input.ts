/**
 * project-to-compute-input — converts a real Studio Builder `Project`
 * (server/domains/appmaker.js project + editor macros) into the three
 * distinct input shapes the Compute macros expect. Each macro reads a
 * different field on the artifact's `data`, so there is no single
 * "spec" that serves all three — see server/domains/appmaker.js's own
 * doc comments above scaffoldApp / uiComplexity / wireframeValidate.
 *
 * Fixes F4 (lens-reviews/app-maker.md): ActionsPanel previously ran these
 * actions against an auto-created, always-empty generic artifact with no
 * connection to any real project, so every action reported "no
 * pages/screens defined" even when a project had real pages. These
 * converters are faithful to what Studio actually lets a user author —
 * they never invent elements, navigation links, or an "auth" flag the
 * project doesn't genuinely have.
 */

export interface ComputeCanvasEl {
  id: string;
  type: string;
  props?: Record<string, unknown>;
}

export interface ComputePage {
  id: string;
  name: string;
  route: string;
  elements: ComputeCanvasEl[];
}

export interface ComputeProject {
  id: string;
  name: string;
  pages: ComputePage[];
}

/** scaffoldApp reads artifact.data.spec = { pages: [{ name, path, components }], auth } */
export function projectToScaffoldSpec(project: ComputeProject) {
  return {
    pages: project.pages.map((p) => ({
      name: p.name,
      path: p.route || `/${p.name.toLowerCase()}`,
      components: p.elements.map((e) => ({
        type: e.type,
        props: e.props || {},
        children: [] as unknown[],
      })),
    })),
    // Studio's Project model has no authored "auth enabled" concept today —
    // reporting `true` here would fabricate an AuthProvider file/state slice
    // the project doesn't actually have. Honest default: false.
    auth: false,
  };
}

/** uiComplexity reads artifact.data.screens = [{ name, widgets: [{ type, children? }] }] */
export function projectToScreens(project: ComputeProject) {
  return project.pages.map((p) => ({
    name: p.name,
    widgets: p.elements.map((e) => ({ type: e.type, children: [] as unknown[] })),
  }));
}

/**
 * wireframeValidate reads artifact.data.wireframe = { screens: [{ name, links, actions }] }.
 * Studio's canvas elements don't currently author inter-page navigation
 * edges (no "this button links to that page" field exists on a CanvasEl
 * or a per-page association on a Workflow), so `links`/`actions` are left
 * empty rather than fabricated. The macro will honestly flag every screen
 * as a dead end / orphan until Studio grows a real navigation-authoring
 * UI — that reflects the project's actual current state.
 */
export function projectToWireframe(project: ComputeProject) {
  return {
    screens: project.pages.map((p) => ({
      name: p.name,
      links: [] as string[],
      actions: [] as Array<{ type: string; target?: string }>,
    })),
  };
}
