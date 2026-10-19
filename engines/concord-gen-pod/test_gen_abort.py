#!/usr/bin/env python3
"""POST /abort stops an in-flight concept hold without waiting for it."""
import json
import os
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["CONCORD_GEN_ALLOW_TEST_HOLD"] = "1"

import concord_gen_server as gen  # noqa: E402


def post(port, path, body, timeout=10):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def get(port, path, timeout=2):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as res:
        return json.loads(res.read().decode())


def wait_job(port, job_id, timeout=2):
    deadline = time.time() + timeout
    health = None
    while time.time() < deadline:
        health = get(port, "/health")
        if health.get("busy") and health.get("job_id") == job_id:
            return health
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never became busy: {health}")


def main():
    httpd = gen.ThreadingHTTPServer(("127.0.0.1", 0), gen.Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    os.environ["CONCORD_GEN_ALLOW_TEST_HOLD"] = "0"
    t0 = time.time()
    ignored = post(port, "/concept", {"prompt": "x", "test_hold_s": 5, "job_id": "ignored"}, timeout=3)
    assert time.time() - t0 < 2, "test_hold ran with the flag off"
    assert ignored.get("reason") == "weights_missing", ignored

    os.environ["CONCORD_GEN_ALLOW_TEST_HOLD"] = "1"
    box = {}

    def run_hold():
        started = time.time()
        box["res"] = post(port, "/concept", {"prompt": "x", "test_hold_s": 5, "job_id": "job-a"}, timeout=8)
        box["elapsed"] = time.time() - started

    th = threading.Thread(target=run_hold)
    th.start()
    wait_job(port, "job-a")
    aborted = post(port, "/abort", {"job_id": "job-a"}, timeout=2)
    assert aborted.get("ok") is True and aborted.get("aborted") is True, aborted
    th.join(timeout=2)
    assert not th.is_alive(), "concept hold did not stop after /abort"
    assert box["res"].get("reason") == "aborted", box
    assert box["elapsed"] < 2, box["elapsed"]

    box2 = {}

    def run_hold2():
        box2["res"] = post(port, "/concept", {"prompt": "x", "test_hold_s": 0.4, "job_id": "job-b"}, timeout=3)

    th2 = threading.Thread(target=run_hold2)
    th2.start()
    wait_job(port, "job-b")
    wrong = post(port, "/abort", {"job_id": "someone-else"}, timeout=2)
    assert wrong.get("reason") == "no_such_job", wrong
    th2.join(timeout=2)
    assert not th2.is_alive(), "held job did not finish"
    assert box2["res"].get("reason") == "held", box2

    httpd.shutdown()
    print("ok")


if __name__ == "__main__":
    main()
