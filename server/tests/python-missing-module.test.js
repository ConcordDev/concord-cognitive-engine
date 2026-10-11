/**
 * `import numpy` / `import sympy` on a box without the vendored wheels used
 * to come back as a Pyodide micropip essay. The failure should name the
 * missing module and should not boot a worker.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectScientificImports, runPython } from "../lib/python-sandbox.js";
import { executeToolCall, formatToolResults } from "../lib/chat-agent.js";

describe("detectScientificImports", () => {
  it("sees numpy and sympy import forms", () => {
    assert.deepEqual(detectScientificImports("import numpy as np"), ["numpy"]);
    assert.deepEqual(detectScientificImports("from sympy import symbols"), ["sympy"]);
    assert.deepEqual(
      detectScientificImports("import numpy, sympy\nfrom numpy.linalg import norm"),
      ["numpy", "sympy"],
    );
  });

  it("ignores imports that appear only in strings or comments", () => {
    assert.deepEqual(detectScientificImports("print('import numpy')\n# import sympy\nx = 1"), []);
    assert.deepEqual(detectScientificImports('s = """\\nimport numpy\\n"""\nprint(s)'), []);
  });

  it("ignores modules other than numpy and sympy", () => {
    assert.deepEqual(detectScientificImports("import json\nimport math"), []);
  });

  it("finishes a pathological unclosed string quickly", () => {
    // A quote plus a long run of backslashes is the ReDoS shape of the old
    // `(?:\\.|[^'\\n])*` stripper. Linear scan must still see a real import
    // on the next line and must not hang.
    const started = Date.now();
    const slash = "\\".repeat(100_000);
    assert.deepEqual(detectScientificImports("'" + slash + "\nimport numpy"), ["numpy"]);
    assert.deepEqual(detectScientificImports('"' + slash + "\nimport sympy"), ["sympy"]);
    assert.deepEqual(detectScientificImports("'''" + "x".repeat(100_000)), []);
    assert.deepEqual(detectScientificImports('"""' + "y".repeat(100_000)), []);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `pathological import scan took ${elapsed}ms`);
  });
});

describe("runPython missing numpy/sympy", () => {
  it("names numpy when the import is present and the wheel is not vendored", async () => {
    const started = Date.now();
    const r = await runPython("import numpy as np\nprint(np.array([1]))");
    assert.equal(r.ok, false);
    assert.equal(r.error, "python_package_not_vendored");
    assert.ok(r.missing.includes("numpy"), `missing list was ${JSON.stringify(r.missing)}`);
    assert.match(r.stderr, /Missing Python module:.*numpy/);
    assert.doesNotMatch(`${r.error}\n${r.stderr}`, /micropip|loadPackage/i);
    assert.ok(Date.now() - started < 5000, "must fail before a Pyodide worker boots");
  });

  it("names sympy for a from-import, including when packages was omitted", async () => {
    const r = await runPython("from sympy import symbols\nx = symbols('x')");
    assert.equal(r.ok, false);
    assert.equal(r.error, "python_package_not_vendored");
    assert.ok(r.missing.includes("sympy"), `missing list was ${JSON.stringify(r.missing)}`);
    assert.match(r.stderr, /sympy/);
    assert.doesNotMatch(r.stderr, /micropip/);
  });

  it("still names numpy when the caller also passed packages", async () => {
    const r = await runPython("import numpy", { packages: ["numpy"] });
    assert.equal(r.error, "python_package_not_vendored");
    assert.deepEqual(r.missing, ["numpy"]);
  });
});

describe("run_python tool error", () => {
  it("puts the missing module name in the error the brain reads", () => {
    const rendered = formatToolResults([{
      tool: "run_python",
      ok: false,
      error: "python_package_not_vendored: missing module sympy",
      missing: ["sympy"],
    }]);
    assert.match(rendered, /missing module sympy/);
    assert.doesNotMatch(rendered, /micropip/);
  });

  it("executeToolCall names the module from a not-vendored macro result", async () => {
    const result = await executeToolCall({}, async () => ({
      ok: false,
      error: "python_package_not_vendored",
      result: { missing: ["sympy"], stderr: "Missing Python module: sympy.", stdout: "", exitCode: -1 },
    }), new Map(), {
      tool: "run_python",
      params: { code: "import sympy" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /python_package_not_vendored/);
    assert.match(result.error, /missing module sympy/);
    assert.deepEqual(result.missing, ["sympy"]);
  });
});
