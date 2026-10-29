// Email engagement beacons. Mounted at /api/marketing/track.
// Public by necessity — email clients fetch the open pixel and click
// redirects without any session. Safety shape:
//   - the open beacon ALWAYS returns the same 1×1 GIF, whether or not
//     the send id exists, so ids can't be probed through it;
//   - the click beacon redirects only to a URL recorded in that
//     send's own link set at send time (lib/marketing-tracking.js),
//     so it cannot be used as an open redirector; anything else 404s.
// Recording mutates the marketing lens state (STATE.marketingLens)
// and persists through the same debounced save the domain uses.

import { Router } from "express";
import { recordEmailOpen, recordEmailClick } from "../lib/marketing-tracking.js";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function saveState() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
  }
}

export function createMarketingTrackRouter() {
  const router = Router();

  router.get("/open/:sendId", (req, res) => {
    try {
      const rec = recordEmailOpen(globalThis._concordSTATE, req.params.sendId, new Date().toISOString());
      if (rec) saveState();
    } catch { /* a beacon must never error visibly */ }
    res.set({
      "Content-Type": "image/gif",
      "Content-Length": PIXEL.length,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(PIXEL);
  });

  router.get("/click/:sendId", (req, res) => {
    let target = null;
    try {
      target = recordEmailClick(globalThis._concordSTATE, req.params.sendId, req.query.u, new Date().toISOString());
      if (target) saveState();
    } catch { target = null; }
    if (!target) { res.status(404).type("text/plain").send("not found"); return; }
    res.redirect(302, target);
  });

  return router;
}

export default createMarketingTrackRouter;
