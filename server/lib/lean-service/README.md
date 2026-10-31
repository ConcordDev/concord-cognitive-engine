# Lean check service (runs on the pod)

`POST /check {lean_source, timeout_s}` -> `{ok, errors, warnings, axioms, elapsed_ms}`; `GET /health`.

- Lives on the A40 pod next to Lean 4 + Mathlib (`/root/lean`, project `/root/lean/concord_verify`). **Not installed on the Mac.**
- Binds `127.0.0.1:11437`; the backend reaches it through the SSH tunnel (`CONCORD_LEAN_URL`, default `http://127.0.0.1:11437`; optional `CONCORD_LEAN_TOKEN` matches `LEAN_SERVICE_TOKEN` on the pod).
- One job at a time, queue of 8 (429 when full), hard timeout (max 120 s) that kills the whole process group, 32 GB address-space cap (`LEAN_MEM_KB`; 8 GB breaks Mathlib imports), temp dir per job.
- `policy.js` (shared with the backend client): a proof that uses `sorry`/`admit`, declares an `axiom`, or runs code at elaboration (`#eval`, `run_cmd`, macros/elab, IO) is **not verified**. After compiling, `#print axioms` is run for every theorem and only `propext`, `Classical.choice`, `Quot.sound` are accepted.
- Not an OS sandbox. Run as an unprivileged user on the pod only.

Deploy (from a machine that can SSH to the pod): `POD=root@194.68.245.147 PORT=22004 ./deploy.sh [--systemd]`. The tunnel and any launchd change are done by the deploy lane.
