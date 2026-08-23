// server/lib/test-mistral-worker.js
//
// TEST-ONLY artifact. Used by worker tests to verify Mistral codestral can
// write real files. NOT a production module — never imported by server.js or
// any live code path.
// @drift-ok: stale-code detector flag is expected for test artifacts

export function hello(name) {
  return `Hello from Mistral codestral, ${name}!`;
}
export function ping() {
  return 'pong';
}
