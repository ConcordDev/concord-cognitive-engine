// The Reading Room's public reads (Education), for visitors who aren't
// signed in: the catalogue, a course page, a preview lesson, and certificate
// verification. /api/lens/run doesn't serve lens actions to the anonymous,
// so these call the very same handlers (domains/reading-room.js) with the
// caller's identity — a signed-in visitor gets their own view.
import { Router } from "express";

export function createReadingRoomRouter({ db }) {
  const router = Router();
  const run = async (req, res, action, params) => {
    const h = globalThis.__concordLensActions?.get?.(`education.${action}`);
    if (typeof h !== "function") return res.status(503).json({ ok: false, error: "the reading room isn't loaded" });
    try {
      const uid = req.user?.id || req.user?.userId || "anon";
      const r = await h({ db, actor: { userId: uid }, userId: uid }, { id: null, data: params }, params);
      if (!r?.ok) return res.status(/not found|no certificate/.test(String(r?.error)) ? 404 : 400).json({ ok: false, error: r?.error || "failed" });
      res.json({ ok: true, ...r.result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 200) });
    }
  };
  router.get("/catalog", (req, res) => run(req, res, "rr-catalog", { q: req.query.q, category: req.query.category, level: req.query.level, price: req.query.price, sort: req.query.sort }));
  router.get("/courses/:id", (req, res) => run(req, res, "rr-course", { id: req.params.id }));
  router.get("/courses/:id/lessons/:lessonId", (req, res) => run(req, res, "rr-lesson", { courseId: req.params.id, lessonId: req.params.lessonId }));
  router.get("/certificates/:code", (req, res) => run(req, res, "rr-verify", { code: req.params.code }));
  return router;
}
