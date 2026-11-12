// Prints the C-03 weapon class table from the server's own combat modules:
// frames (combat-frame-data.js), mass/lever arm/momentum (combat-impact.js),
// heavy peril (combat/telegraph-peril.js), class + handedness (combat/loadout.js).
// Usage: node .Aura/tools/weapon_classes.mjs "<repo>/server"  → paste into Scripts/Aura/Combat/WeaponClassDef.cs
const root = process.argv[2];
const fd = await import(`${root}/lib/combat-frame-data.js`);
const ci = await import(`${root}/lib/combat-impact.js`);
const tp = await import(`${root}/lib/combat/telegraph-peril.js`);
const lo = await import(`${root}/lib/combat/loadout.js`);
const CLASSES = ["sword","greatsword","hammer","dagger","spear","axe","shield","staff","bow","pistol","rifle","unarmed"];
const FRAME_KINDS = new Set(["sword","axe","spear","bow","staff","fist","dagger","hammer"]);
const IMPACT_KINDS = new Set(["fist","dagger","sword","spear","axe","hammer","staff","bow"]);
for (const cls of CLASSES) {
  const kind = cls === "unarmed" ? "fist" : cls;
  const f = fd.getSkillFrameData({ kind, level: 1 }); // falls back to the server default row
  const k = ci.impactKinematics({ kind, tier: 1 });
  const m = ci.momentumFor({ kind, tier: 1 });
  const peril = tp.perilFor({ weapon: cls, heavy: true }).perilKind;
  const inf = cls === "unarmed" ? { weaponClass: null, handedness: "either" } : lo.inferWeaponClass(cls);
  console.log(JSON.stringify({ cls, kind, framesFrom: FRAME_KINDS.has(kind) ? kind : "default", impactFrom: IMPACT_KINDS.has(kind) ? kind : "default",
    startup: f.startup_ms, active: f.active_ms, recovery: f.recovery_ms, parry: f.parry_window_ms, dodge: f.dodge_window_ms,
    mass: k.boneMass, lever: k.leverArmM, momentum: Math.round(m * 1000) / 1000, peril, serverClass: inf.weaponClass, hand: inf.handedness }));
}
