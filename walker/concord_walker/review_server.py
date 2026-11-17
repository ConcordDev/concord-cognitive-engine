"""WALK-05 (GB-1544): the local review server. Stdlib only, binds localhost,
serves one generated review page and appends each keypress decision to
records/human.jsonl (union schema, crash-safe) via results.human_row.

Run: python3 -m concord_walker.review_server --page runs/<id>/review/<cat>.html \
     --human-out records/human.jsonl --live-sha <sha> --run-id <id>
Nothing here talks to prod; the page and the rows stay on the run host.
"""
import argparse, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from .ledger import WalkerLedger  # noqa: F401  (schema kinship; appends use _append_line)
from .runstate import _append_line
from .results import human_row


def make_handler(page_html, human_out, live_sha, run_id):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(page_html.encode())

        def do_POST(self):
            if self.path != "/decision":
                self.send_response(404)
                self.end_headers()
                return
            try:
                n = int(self.headers.get("Content-Length") or 0)
                decision = json.loads(self.rfile.read(n) or b"{}")
                row = human_row(decision, live_sha=live_sha, run_id=run_id)
                _append_line(human_out, row)
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode())
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

    return H


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--page", required=True)
    ap.add_argument("--human-out", required=True)
    ap.add_argument("--live-sha", required=True, help="hex git sha of the gate-confirmed live build")
    ap.add_argument("--run-id", default="review")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    from .sha_gate import is_hex_sha
    if not is_hex_sha(args.live_sha):
        raise SystemExit("--live-sha must be a hex git sha (>=7 chars)")
    with open(args.page) as f:
        page = f.read()
    srv = HTTPServer(("127.0.0.1", args.port), make_handler(page, args.human_out, args.live_sha, args.run_id))
    print("review server on http://127.0.0.1:%d (decisions -> %s)" % (args.port, args.human_out))
    srv.serve_forever()


if __name__ == "__main__":
    main()
