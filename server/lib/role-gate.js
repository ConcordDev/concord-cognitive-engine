// Authz gate shared by route registration and tests.
//
// requireAuth is polymorphic: factory (`requireAuth()`) and direct middleware
// (`requireAuth(req, res, next)`). requireRole is factory-only. AUTH_MODE is
// read at request time so a process that booted in public mode still skips,
// and hybrid/jwt/apikey still 401 anonymous callers and 403 a role miss.

export function createRoleGate(getAuthMode) {
  const authMode = () => getAuthMode();

  function requireAuth(...args) {
    const handle = (req, res, next) => {
      if (authMode() === "public") return next();
      if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
      return next();
    };
    if (args.length >= 3 && typeof args[2] === "function" && args[0] && typeof args[0] === "object" && "headers" in args[0]) {
      return handle(args[0], args[1], args[2]);
    }
    return handle;
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (req.ctx?.internal === true) return next();
      if (authMode() === "public") return next();
      if (!req.user) return res.status(401).json({ ok: false, error: "Authentication required" });
      if (req.user.role === "sovereign") return next();
      if (roles.length === 0 || roles.includes(req.user.role) || req.user.scopes?.includes("*")) {
        return next();
      }
      return res.status(403).json({ ok: false, error: "Insufficient permissions", requiredRoles: roles });
    };
  }

  return { requireAuth, requireRole };
}
