// server/domains/usb.js — Unified Skill Bus macro surface
import * as usb from "../lib/usb-framework.js";

function bootstrap() {
  if (!usb.has("usb.ping")) {
    usb.register("usb.ping", async () => ({ pong: true, ts: new Date().toISOString() }), {
      description: "USB health ping",
      risk: "read",
    });
  }
  if (!usb.has("usb.list")) {
    usb.register("usb.list", async () => ({ skills: usb.list() }), {
      description: "List USB skills",
      risk: "read",
    });
  }
}

export default function registerUsbMacros(register) {
  bootstrap();

  register("usb", "status", async () => {
    bootstrap();
    const skills = usb.list();
    return {
      ok: true,
      name: "USB Frameworks (Unified Skill Bus)",
      module: "server/lib/usb-framework.js",
      skills: skills.length,
      status: skills.length > 0 ? "LIVE" : "WIRED_IDLE",
      skills_sample: skills.slice(0, 20),
    };
  }, { note: "USB Framework status" });

  register("usb", "list", async () => {
    bootstrap();
    return { ok: true, skills: usb.list() };
  }, { note: "list skills on Unified Skill Bus" });

  register("usb", "invoke", async (ctx, input = {}) => {
    bootstrap();
    const id = input.id || input.skill;
    if (!id) return { ok: false, reason: "id_required" };
    return usb.invoke(id, input.args || input.input || {}, {
      who: ctx?.actor,
      observe_only: true,
    });
  }, { note: "invoke a named USB skill (F0 observe)" });

  register("usb", "register_probe", async (ctx, input = {}) => {
    bootstrap();
    const id = input.id || input.name;
    if (!id) return { ok: false, reason: "id_required" };
    if (!(String(id).startsWith("usb.") || String(id).startsWith("probe."))) {
      return { ok: false, reason: "probe_prefix_required" };
    }
    return usb.register(id, async (args) => ({ ok: true, echo: args || {}, id }), {
      description: input.description || "probe skill",
      risk: "read",
      meta: { source: "usb.macro" },
    });
  }, { note: "register usb.*/probe.* echo skill" });
}
