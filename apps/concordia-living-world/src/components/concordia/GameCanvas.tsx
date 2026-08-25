import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  ARENA,
  GATES,
  NPCS,
  RING_RADIUS,
  SCHEMES,
  THEMES,
  FACTION_TICKER,
} from "@/game/content";
import {
  applyHit,
  beginAttack,
  beginDodge,
  beginParry,
  canAct,
  telegraphKind,
  tickVitals,
  freshCombatant,
} from "@/game/combat";
import { consume, moveAxes, createBuffer, latchBuffer, takeBuffered, type InputState } from "@/game/input";
import { ATTACK_BUFFER_MS, lungeToward, pickMagnetTarget, pickStrikeTargets } from "@/game/melee-feel";
import { HUB_LAYOUT, resolveBoxes, resolveCollision } from "@/game/layout";
import { addTrauma, shakeOffset, tickJuice } from "@/game/juice";
import {
  sfxDodge,
  sfxFlower,
  sfxFoot,
  sfxHit,
  sfxHurt,
  sfxIframe,
  sfxLand,
  sfxParry,
  sfxScheme,
  sfxStagger,
  sfxSwing,
  sfxWin,
  tickAmbient,
} from "@/game/audio";
import { applyImpulse, dodgeImpulse, groundKind, stepLocomotion } from "@/game/locomotion";
import { visualYaw } from "@/game/humanoid";
import { chaseCamera } from "@/game/camera-rig";
import { qualityOpts } from "@/game/quality";
import { useOverlay, type Phase } from "@/game/store";
import { makeSim, type Pose, type Sim } from "@/game/sim";
import { Atmosphere } from "./Atmosphere";
import { HubWorld } from "./HubWorld";
import { WorldScene } from "./WorldScene";
import { ActorMesh } from "./RiggedFigure";
import { Figure } from "./Figures";
import { BeastMesh } from "./Beasts";
import { worldKit, settlementNpcs } from "@/game/worlds";
import { beastDef } from "@/game/creatures";
import { trySpecial, tryPower, hudArts } from "@/game/abilities";
import { remember, tickKernel } from "@/game/kernel";
import { heightAt } from "@/game/life";
import { nearestSettlement } from "@/game/realms";
import { writeSlice } from "@/game/persist";
import { autonomyTarget } from "@/game/npc-life";
import { birthCreature } from "@/game/evo";
import { finishQuest } from "@/game/quests";
import { enterCopy, isSignatureKill, nearestStone } from "@/game/lore-play";
import { bible } from "@/game/bible";
import { streamWild, cullWildIds } from "@/game/wild";
import { tickEvents } from "@/game/events";
import { politicsLine, tickPolitics } from "@/game/politics";
import { completeCrossOnTravel, markVisitedWorld, plotLine } from "@/game/cross";
import { presentHit } from "@/game/feel";
import { ImpactFx } from "./ImpactFx";

function dist2(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

function persistSim(sim: Sim) {
  sim.slice.ecology = sim.kernel.ecology;
  sim.slice.factionHeat = sim.kernel.factionHeat;
  sim.slice.prices = sim.kernel.prices;
  sim.slice.day = sim.kernel.day;
  sim.slice.hour = sim.kernel.hour;
  sim.slice.quest = sim.quest;
  sim.slice.event = sim.kernel.lastEvent;
  sim.slice.dead = sim.actors.filter((a) => a.kind === "beast" && !a.alive).map((a) => a.id);
  writeSlice(sim.worldId, sim.slice);
}

function snapCamera(camera: THREE.Camera, sim: Sim) {
  const camDist = 4.05;
  const shoulder = 0.78;
  const cfwdX = -Math.sin(sim.camYaw);
  const cfwdZ = -Math.cos(sim.camYaw);
  const rx = Math.cos(sim.camYaw);
  const rz = -Math.sin(sim.camYaw);
  const gy = heightAt(sim.worldId, sim.player.x, sim.player.z);
  camera.position.set(
    sim.player.x - cfwdX * camDist + rx * shoulder,
    1.7 + gy - sim.camPitch * 2.55,
    sim.player.z - cfwdZ * camDist + rz * shoulder,
  );
  camera.lookAt(sim.player.x + rx * 0.12, 1.48 + gy, sim.player.z + rz * 0.12);
}

function SimLoop({
  input,
  simRef,
  reduced,
  phase,
}: {
  input: InputState;
  simRef: React.MutableRefObject<Sim>;
  reduced: boolean;
  phase: Phase;
}) {
  const { camera, gl } = useThree();
  const overlay = useOverlay;
  const lookAccum = useRef({ x: 0, y: 0 });
  const titleYaw = useRef(0.35);
  const camBoot = useRef(false);
  const lastWorld = useRef(overlay.getState().worldId);
  const buf = useRef(createBuffer());

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el || e.buttons) {
        lookAccum.current.x += e.movementX;
        lookAccum.current.y += e.movementY;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (overlay.getState().phase !== "play") return;
      if (e.button === 0 && document.pointerLockElement !== el) {
        try {
          el.requestPointerLock();
        } catch {
          /* iframe may deny lock; click-drag still looks */
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    el.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const sim = simRef.current;
    const st = overlay.getState();
    const livePhase = phase;
    if (!sim.impacts) sim.impacts = [];
    if (sim.playerStaggerUntil == null) sim.playerStaggerUntil = 0;
    tickJuice(sim.juice, dt, reduced || !st.shake);
    tickAmbient(dt);
    sim.t += dt;

    if (livePhase === "title") {
      camBoot.current = false;
      titleYaw.current += dt * 0.05;
      const a = titleYaw.current;
      const r = 7.4;
      camera.position.set(Math.cos(a) * r, 5.6, Math.sin(a) * r);
      const la = a + 0.72;
      camera.lookAt(Math.cos(la) * 18, 2.6, Math.sin(la) * 18);
      consume(input);
      return;
    }
    if (livePhase === "pause" || livePhase === "dialogue") {
      window.__controlsTest = {
        getYaw: () => sim.yaw,
        getSpeed: () => sim.speed,
        getPos: () => ({ x: sim.player.x, z: sim.player.z }),
        getCamYaw: () => sim.camYaw,
        getKeys: () => [...input.keys],
        setKeys: (codes: string[]) => {
          input.keys.clear();
          for (const c of codes) input.keys.add(c);
        },
        setSteer: (v: number) => {
          input.joyX = -v;
        },
        setPos: (x: number, z: number) => {
          sim.player.x = x;
          sim.player.z = z;
        },
        attack: () => {
          input.attack = true;
        },
        jump: () => {
          input.jump = true;
        },
        getHop: () => sim.motion?.hop ?? 0,
        getAttack: () => sim.player.attackKind,
      };
      consume(input);
      return;
    }

    if (!camBoot.current || lastWorld.current !== st.worldId) {
      camBoot.current = true;
      lastWorld.current = st.worldId;
      snapCamera(camera, sim);
    }

    sim.now += dt * 1000;
    const now = sim.now;
    const frozen = sim.juice.timeScale === 0;

    sim.camYaw -= (lookAccum.current.x + input.lookX * 14) * 0.0035;
    sim.camPitch = THREE.MathUtils.clamp(
      sim.camPitch - (lookAccum.current.y + input.lookY * 10) * 0.0025,
      -0.85,
      0.35,
    );
    lookAccum.current.x = 0;
    lookAccum.current.y = 0;
    if (input.keys.has("KeyQ")) sim.camYaw += dt * 1.4;
    if (input.keys.has("KeyR")) sim.camYaw -= dt * 1.4;

    const axes = moveAxes(input);
    const fx = -Math.sin(sim.camYaw);
    const fz = -Math.cos(sim.camYaw);
    const rx = Math.cos(sim.camYaw);
    const rz = -Math.sin(sim.camYaw);
    if (!sim.motion) sim.motion = { vx: 0, vz: 0, hop: 0, vy: 0, grounded: true, gait: "idle", coyote: 0, landUntil: 0, dodgeT: 0 };

    latchBuffer(input, buf.current, now);

    if (!frozen) {
      const kit = worldKit(st.worldId);
      tickVitals(sim.player, dt, now);
      const sprint = input.keys.has("ShiftLeft") || input.keys.has("ShiftRight");
      const crouch = input.keys.has("ControlLeft") || input.keys.has("ControlRight");
      const colliders = st.worldId === "concordia-hub" ? HUB_LAYOUT.colliders : kit.colliders;

      if (input.lockon) {
        if (sim.lockId) sim.lockId = null;
        else {
          let best: { id: string; d: number } | null = null;
          for (const a of sim.actors) {
            if (!a.alive || !a.hostile) continue;
            const d = dist2(sim.player.x, sim.player.z, a.body.x, a.body.z);
            if (d < 18 && (!best || d < best.d)) best = { id: a.id, d };
          }
          sim.lockId = best?.id ?? null;
        }
      }
      const lockActor = sim.lockId ? sim.actors.find((a) => a.id === sim.lockId && a.alive) : null;
      if (sim.lockId && !lockActor) sim.lockId = null;
      const lockYaw = lockActor
        ? Math.atan2(-(lockActor.body.x - sim.player.x), -(lockActor.body.z - sim.player.z))
        : null;

      if (takeBuffered(buf.current, "dodge", now) && beginDodge(sim.player, now, false)) {
        dodgeImpulse(sim.motion, sim.camYaw, axes);
        sfxDodge();
        sim.juice.punch = Math.min(1, sim.juice.punch + 0.22);
      }

      const loc = stepLocomotion({
        body: sim.player,
        motion: sim.motion,
        yaw: sim.yaw,
        dt,
        now,
        axes,
        camYaw: sim.camYaw,
        sprint,
        crouch,
        jump: takeBuffered(buf.current, "jump", now),
        lockYaw,
        speedMul: kit.style.speedMul,
        massMul: kit.style.massMul,
        world: st.worldId,
        weather: sim.kernel.weather,
        colliders,
        boxes: st.worldId === "concordia-hub" ? HUB_LAYOUT.buildings : undefined,
        bound: kit.bound,
        attacking: !!sim.player.attackKind && now < sim.player.recoverUntil,
        dodging: now < sim.player.iframeUntil,
      });
      sim.yaw = loc.yaw;
      sim.speed = loc.speed;
      sim.gait = sim.motion.gait;
      sim.player.facing = sim.yaw;
      if (loc.landed) {
        sfxLand(sim.motion.vy < -8);
        sim.juice.punch = Math.min(1, sim.juice.punch + 0.28);
        addTrauma(sim.juice, 0.08);
        const gy = heightAt(st.worldId, sim.player.x, sim.player.z);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          sim.impacts.push({
            x: sim.player.x,
            y: gy + 0.12,
            z: sim.player.z,
            dx: Math.cos(a),
            dz: Math.sin(a),
            mag: 0.45,
            born: now,
            life: 380,
            hot: false,
          });
        }
      }
      if (sim.motion.grounded && loc.speed > 0.45) {
        sim.foot += dt * loc.speed;
        const stride = sim.gait === "sprint" ? 0.34 : sim.gait === "walk" || sim.gait === "crouch" ? 0.52 : 0.42;
        if (sim.foot > stride) {
          sim.foot = 0;
          sfxFoot(sprint ? 1.1 : 0.85, groundKind(st.worldId, sim.kernel.weather));
        }
      }

      if (st.worldId === "tunya") {
        const grove = dist2(sim.player.x, sim.player.z, 0, 0) < 6 && !sim.player.attackKind;
        if (grove) sim.player.poise = Math.min(12, sim.player.poise + dt * 3.5);
      }

      if (takeBuffered(buf.current, "parry", now)) beginParry(sim.player, now);
      if (input.special) {
        if (trySpecial(sim.player, kit.style, now)) {
          sfxSwing(true);
          if (kit.style.id === "dawn") {
            for (const a of sim.actors) {
              if (a.kind === "beast" && !a.alive) {
                a.alive = true;
                a.body.hp = Math.max(8, a.body.hp);
                a.pose = "idle";
              }
            }
            overlay.getState().set({ toast: { text: "You refuse the win. They stand. The dawn does not end." } });
            window.setTimeout(() => overlay.getState().set({ toast: null }), 2800);
          }
          if (kit.style.id === "veil") {
            sim.player.hp = Math.min(100, sim.player.hp + 8);
            sim.player.poise = Math.min(12, sim.player.poise + 4);
          }
          if (kit.style.id === "zero") {
            if (sim.kernel.uncounted > 0) {
              overlay.getState().set({
                billboard: { text: `${Math.round(sim.kernel.uncounted)}`, until: now + 700 },
              });
              sim.kernel.uncounted = 0;
            }
          }
          if (kit.style.id === "keepers") {
            sim.player.hp = Math.min(100, sim.player.hp + 6);
            overlay.getState().set({ billboard: { text: "unended", until: now + 500 } });
          }
          if (kit.style.id === "drift") {
            for (const a of sim.actors) {
              if (!a.alive) continue;
              const d = dist2(sim.player.x, sim.player.z, a.body.x, a.body.z);
              if (d < 6 && a.hostile) {
                a.body.hp = Math.max(1, a.body.hp - 10);
                a.body.stunUntil = now + 280;
              }
            }
          }
        }
      } else if (input.power) {
        if (tryPower(sim.player, kit.style, now)) {
          sfxSwing(true);
          const sid = kit.style.id;
          if (sid === "road" || sid === "court") {
            const dx = fx * 2.8 + rx * axes.x;
            const dz = fz * 2.8 + rz * axes.x;
            const m = Math.hypot(dx, dz) || 1;
            sim.player.x += (dx / m) * 3.2;
            sim.player.z += (dz / m) * 3.2;
            const after = resolveCollision(sim.player.x, sim.player.z, 0.48, colliders, kit.bound);
            const boxed =
              st.worldId === "concordia-hub" ? resolveBoxes(after.x, after.z, 0.48, HUB_LAYOUT.buildings) : after;
            sim.player.x = boxed.x;
            sim.player.z = boxed.z;
          }
          if (sid === "veil") {
            sim.kernel.hostility = Math.max(0, sim.kernel.hostility - 4);
            sim.player.poise = Math.min(12, sim.player.poise + 6);
            sim.player.hp = Math.min(100, sim.player.hp + 4);
          }
          if (sid === "sundering") {
            sim.kernel.hostility = Math.max(0, sim.kernel.hostility * 0.4);
            sim.player.poise = Math.min(12, sim.player.poise + 5);
          }
          if (sid === "ghost") {
            let billed = 0;
            for (const hit of sim.kernel.delayed) {
              const tgt = sim.actors.find((a) => a.id === hit.id);
              if (tgt && tgt.alive) {
                tgt.body.hp = Math.max(0, tgt.body.hp - hit.dmg);
                billed += hit.dmg;
              }
            }
            sim.kernel.delayed.length = 0;
            if (billed) overlay.getState().set({ billboard: { text: `${billed}`, until: now + 700 } });
          }
          if (sid === "zero") {
            const dump = sim.kernel.uncounted;
            sim.kernel.uncounted = 0;
            if (dump > 0) {
              for (const a of sim.actors) {
                if (!a.alive || !a.hostile) continue;
                if (dist2(sim.player.x, sim.player.z, a.body.x, a.body.z) < 7) {
                  a.body.hp = Math.max(0, a.body.hp - dump * 0.45);
                }
              }
              overlay.getState().set({ billboard: { text: `${Math.round(dump)}`, until: now + 700 } });
            }
          }
          if (sid === "dawn") {
            for (const a of sim.actors) {
              if (!a.alive || !a.hostile) continue;
              const d = dist2(sim.player.x, sim.player.z, a.body.x, a.body.z);
              if (d < 7) {
                a.body.stunUntil = now + 520;
                a.body.hp = Math.max(1, a.body.hp - 8);
              }
            }
          }
          if (sid === "keepers") {
            for (const a of sim.actors) {
              if (a.kind === "beast" && !a.alive && a.reviveAt) a.reviveAt = Math.min(a.reviveAt, now + 400);
            }
            sim.player.poise = Math.min(12, sim.player.poise + 4);
          }
          if (sid === "drift") {
            sim.kernel.rumble = 1.2;
            addTrauma(sim.juice, 0.35);
          }
        }
      }

      const inHub = st.worldId === "concordia-hub";
      const inArena = dist2(sim.player.x, sim.player.z, ARENA.x, ARENA.z) < ARENA.r + 0.6;

      if (takeBuffered(buf.current, "heavy", now, ATTACK_BUFFER_MS)) {
        if (beginAttack(sim.player, "heavy", now)) {
          sfxSwing(true);
          const mag = pickMagnetTarget(sim.player.x, sim.player.z, sim.yaw, sim.actors, sim.lockId);
          if (mag && (!inHub || inArena)) {
            sim.yaw = lungeToward(sim.motion, sim.player.x, sim.player.z, mag);
            sim.player.facing = sim.yaw;
            sim.lockId = mag.id;
          }
        }
      } else if (takeBuffered(buf.current, "attack", now, ATTACK_BUFFER_MS)) {
        if (beginAttack(sim.player, "light", now)) {
          sfxSwing(false);
          const mag = pickMagnetTarget(sim.player.x, sim.player.z, sim.yaw, sim.actors, sim.lockId);
          if (mag && (!inHub || inArena)) {
            sim.yaw = lungeToward(sim.motion, sim.player.x, sim.player.z, mag);
            sim.player.facing = sim.yaw;
            sim.lockId = mag.id;
          }
        }
      }

      if (inHub && sim.player.attackKind && !inArena && now < sim.player.activeUntil && now >= sim.player.windupUntil) {
        sim.player.attackKind = null;
        sim.player.windupUntil = 0;
        sim.player.activeUntil = 0;
        sim.player.recoverUntil = now + 400;
        overlay.getState().set({
          flowerWarn: true,
          toast: { text: "The Court made itself impossible to stand on. You cannot own the heart." },
        });
        sfxFlower();
        addTrauma(sim.juice, 0.25);
        window.setTimeout(() => overlay.getState().set({ flowerWarn: false, toast: null }), 3200);
      }

      for (const a of sim.actors) {
        if (!a.alive) {
          if (a.reviveAt && now >= a.reviveAt) {
            const d = a.species ? beastDef(a.species) : null;
            a.alive = true;
            a.body.hp = d ? d.hp * 0.7 : 60;
            a.body.poise = d ? d.poise : 8;
            a.pose = "idle";
            a.reviveAt = 0;
            overlay.getState().pushFeed(`${a.evoName ?? a.id} refused to stay ended.`);
            if (sim.quest?.kind === "mercy" && !sim.quest.done) {
              sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
            }
          }
          continue;
        }
        tickVitals(a.body, dt, now);
        if (a.vx || a.vz) {
          a.body.x += (a.vx ?? 0) * dt;
          a.body.z += (a.vz ?? 0) * dt;
          const damp = Math.exp(-6.2 * dt);
          a.vx = (a.vx ?? 0) * damp;
          a.vz = (a.vz ?? 0) * damp;
        }
        if (!a.hostile) {
          const ox = Math.sin(sim.t * 0.35 + a.homeX) * a.wander;
          const oz = Math.cos(sim.t * 0.28 + a.homeZ) * a.wander * 0.7;
          let tx = a.homeX + ox;
          let tz = a.homeZ + oz;
          if (a.brain) {
            const tgt = autonomyTarget(a.brain, st.worldId, sim.kernel.hour, sim.kernel.factionHeat);
            tx = tgt.x + ox * 0.25;
            tz = tgt.z + oz * 0.25;
            a.act = tgt.act;
            if (tgt.act === "sleep" || tgt.act === "hide") {
              tx = tgt.x;
              tz = tgt.z;
            }
          }
          a.body.x = THREE.MathUtils.damp(a.body.x, tx, 1.6, dt);
          a.body.z = THREE.MathUtils.damp(a.body.z, tz, 1.6, dt);
          const mdx = tx - a.body.x;
          const mdz = tz - a.body.z;
          if (Math.hypot(mdx, mdz) > 0.2) a.yaw = Math.atan2(-mdx, -mdz);
          a.pose = Math.hypot(a.body.x - tx, a.body.z - tz) > 0.55 ? "walk" : "idle";
          continue;
        }

        const def = a.species ? beastDef(a.species) : null;
        a.morale = a.body.hp / (def?.hp ?? 100);
        const reach = def?.reach ?? 1.85;
        const spdA = def?.speed ?? 2.6;
        const aggroR = a.species === "dragon" || a.species === "wyrm" || a.species === "griffin" ? 22 : 14;
        const d = dist2(sim.player.x, sim.player.z, a.body.x, a.body.z);
        const aggro = !inHub || (a.id === "warden" && inArena);
        if (a.packId && d >= aggroR) {
          const mates = sim.actors.filter((m) => m.packId === a.packId && m.alive);
          if (mates.length > 1) {
            let cx = 0;
            let cz = 0;
            for (const m of mates) {
              cx += m.body.x;
              cz += m.body.z;
            }
            cx /= mates.length;
            cz /= mates.length;
            a.body.x = THREE.MathUtils.damp(a.body.x, cx + Math.cos(sim.t + a.homeX) * 3.2, 1.1, dt);
            a.body.z = THREE.MathUtils.damp(a.body.z, cz + Math.sin(sim.t + a.homeZ) * 3.2, 1.1, dt);
            a.pose = "walk";
          }
        }
        if (def?.flyHeight) {
          const orbit = sim.t * 0.35 + a.homeX;
          const wantX = a.homeX + Math.cos(orbit) * 6;
          const wantZ = a.homeZ + Math.sin(orbit) * 6;
          if (d > reach + 0.4) {
            a.body.x = THREE.MathUtils.damp(a.body.x, wantX, 1.4, dt);
            a.body.z = THREE.MathUtils.damp(a.body.z, wantZ, 1.4, dt);
          }
          a.flyH = THREE.MathUtils.damp(a.flyH, d < 8 ? def.flyHeight * 0.28 : def.flyHeight, 2, dt);
        }
        if (aggro && d < aggroR) {
          const dx = sim.player.x - a.body.x;
          const dz = sim.player.z - a.body.z;
          a.yaw = Math.atan2(-dx, -dz);
          a.body.facing = a.yaw;
          const fleeing = a.morale < 0.35 && (a.body.hp / (def?.hp ?? 100) < 0.28);
          if (fleeing && canAct(a.body, now)) {
            const m = d || 1;
            a.body.x -= (dx / m) * spdA * 1.15 * dt;
            a.body.z -= (dz / m) * spdA * 1.15 * dt;
            a.pose = "walk";
          } else if (d > reach * 0.85 && canAct(a.body, now) && !def?.flyHeight) {
            const flank = def?.role === "flanker";
            const side = flank ? 0.7 : 0;
            const m = d || 1;
            const heavy = 1 / Math.max(0.7, def?.mass ?? 1);
            a.body.x += (dx / m) * spdA * dt * heavy + (-dz / m) * side * spdA * dt;
            a.body.z += (dz / m) * spdA * dt * heavy + (dx / m) * side * spdA * dt;
            a.pose = "walk";
          }
          if (now > a.aiCd && d < reach + 0.4 && canAct(a.body, now)) {
            let kind = telegraphKind(Math.floor(now / 400) + a.id.length);
            if (a.species === "basilisk" || a.species === "sentinel") kind = "grab";
            if (a.species === "dragon" || a.species === "wyrm" || a.species === "golem") kind = "sweep";
            if (a.species === "drone" || a.species === "wolf") kind = "thrust";
            a.telegraph = kind;
            a.telegraphUntil = now + (a.species === "basilisk" ? 780 : 620);
            a.aiCd = now + (def?.kind === "dragon" || def?.kind === "golem" ? 2200 : 1500);
            a.pose = "windup";
            beginAttack(a.body, kind === "grab" || def?.kind === "dragon" || def?.kind === "golem" ? "heavy" : "light", now);
            if (a.species === "spider") {
              sim.player.stamina = Math.max(0, sim.player.stamina - 14);
            }
          }
          if (a.telegraph && now > a.telegraphUntil) a.telegraph = null;
          if (a.body.attackKind && now >= a.body.windupUntil && now <= a.body.activeUntil && d < reach) {
            const parried = now < sim.player.parryUntil && a.telegraph === "thrust";
            const dodging = now < sim.player.iframeUntil;
            const res = applyHit(a.body, sim.player, now, {
              parried,
              flanked: false,
              midStride: sim.speed > 3.2,
              massMul: 0.55 + 0.2 * Math.min(def?.mass ?? 1, 1.5),
              poiseMul: kit.style.poiseMul,
            });
            if (res) {
              if (res.iframed || dodging) sfxIframe();
              else if (res.parried) {
                sfxParry();
                presentHit({
                  juice: sim.juice,
                  impacts: sim.impacts,
                  now,
                  x: sim.player.x,
                  y: 1.2 + heightAt(st.worldId, sim.player.x, sim.player.z),
                  z: sim.player.z,
                  dirX: -Math.sin(a.yaw),
                  dirZ: -Math.cos(a.yaw),
                  stagger: res.stagger,
                  trauma: 0.16,
                  hitPauseMs: 40,
                  landed: false,
                  parried: true,
                  iframed: false,
                });
              } else if (res.landed) {
                sfxHurt();
                if (res.stagger !== "graze") sfxStagger(res.stagger);
                sim.playerStagger = res.stagger;
                sim.playerStaggerUntil = now + (res.stagger === "knockdown" ? 900 : res.stagger === "rocked" ? 520 : 220);
                sim.playerHitDirX = -Math.sin(a.yaw);
                sim.playerHitDirZ = -Math.cos(a.yaw);
                presentHit({
                  juice: sim.juice,
                  impacts: sim.impacts,
                  now,
                  x: sim.player.x,
                  y: 1.15 + heightAt(st.worldId, sim.player.x, sim.player.z),
                  z: sim.player.z,
                  dirX: sim.playerHitDirX,
                  dirZ: sim.playerHitDirZ,
                  stagger: res.stagger,
                  trauma: res.feel.trauma,
                  hitPauseMs: res.feel.hitPauseMs,
                  landed: true,
                  parried: false,
                  iframed: false,
                });
                const kb = res.feel.knockback;
                applyImpulse(sim.motion, -Math.sin(a.yaw) * kb * 2.15, -Math.cos(a.yaw) * kb * 2.15);
              }
              a.body.activeUntil = now - 1;
            }
          }
          if (a.body.hp <= 0) {
            a.alive = false;
            a.pose = "down";
            const revive = def?.reviveMs ?? 0;
            if (revive > 0 || kit.style.id === "keepers" || kit.style.id === "dawn" || kit.style.id === "drift") {
              a.reviveAt = now + (revive || 6000);
            }
            remember(sim.kernel, {
              kind: "combat",
              text: `You put down ${a.species ?? a.id} in ${kit.title}.`,
              worldId: st.worldId,
              importance: 0.7,
            });
            sim.kernel.ecology = Math.max(0.12, sim.kernel.ecology - 0.08);
            sim.kernel.factionHeat = Math.min(1, sim.kernel.factionHeat + 0.12);
          } else if (now < a.body.stunUntil) a.pose = a.stagger === "knockdown" ? "down" : "hurt";
          else if (a.body.attackKind && now < a.body.windupUntil) a.pose = "windup";
          else if (a.body.attackKind && now < a.body.activeUntil) a.pose = "strike";
        } else {
          a.pose = a.pose === "down" ? "down" : "idle";
        }
      }

      const marks = pickStrikeTargets(sim.player.x, sim.player.z, sim.yaw, sim.actors, sim.lockId);
      if (sim.player.attackKind && now >= sim.player.windupUntil && now <= sim.player.activeUntil) {
        for (const lock of marks) {
          if (lock.struckAt === sim.player.windupUntil) continue;
          const res = applyHit(sim.player, lock.body, now, {
            parried: false,
            flanked: false,
            midStride: sim.speed > 3.2,
            massMul: kit.style.massMul * (sim.player.attackKind === "heavy" ? 1.22 : 1.08),
          });
          if (!res) continue;
          lock.struckAt = sim.player.windupUntil;
          if (res.iframed) sfxIframe();
          else if (res.landed) {
            sim.kernel.hostility += 1.1;
            if (kit.style.id === "sundering" && sim.kernel.hostility > 8) {
              sim.player.hp = Math.max(1, sim.player.hp - 4);
              overlay.getState().set({ toast: { text: "The held curse turns inward. You are becoming the thing." } });
            }
            if (kit.style.id === "zero") {
              sim.kernel.uncounted += res.feel.damage;
              overlay.getState().set({ billboard: { text: "—", until: now + 400 } });
            } else if (kit.style.id === "ghost") {
              sim.kernel.delayed.push({ at: now + 1200, dmg: res.feel.damage, id: lock.id });
              overlay.getState().set({ billboard: { text: "pending", until: now + 500 } });
            } else {
              sfxHit(res.momentum);
              if (res.stagger !== "graze") sfxStagger(res.stagger);
              lock.stagger = res.stagger;
              lock.staggerUntil = now + (res.stagger === "knockdown" ? 900 : res.stagger === "rocked" ? 520 : 220);
              lock.hitDirX = -Math.sin(sim.yaw);
              lock.hitDirZ = -Math.cos(sim.yaw);
              lock.pose = res.stagger === "knockdown" ? "down" : "hurt";
              presentHit({
                juice: sim.juice,
                impacts: sim.impacts,
                now,
                x: (sim.player.x + lock.body.x) * 0.5,
                y: 1.15 + heightAt(st.worldId, lock.body.x, lock.body.z),
                z: (sim.player.z + lock.body.z) * 0.5,
                dirX: lock.hitDirX,
                dirZ: lock.hitDirZ,
                stagger: res.stagger,
                trauma: res.feel.trauma * 0.7,
                hitPauseMs: res.feel.hitPauseMs * 0.7,
                landed: true,
                parried: false,
                iframed: false,
              });
              overlay.getState().set({
                billboard: { text: `${res.feel.damage}`, until: now + 600 },
              });
            }
            const kb = res.feel.knockback;
            const mass = (lock.species ? beastDef(lock.species)?.mass : 1) ?? 1;
            lock.vx = (lock.vx ?? 0) - Math.sin(sim.yaw) * kb * (2.4 / mass);
            lock.vz = (lock.vz ?? 0) - Math.cos(sim.yaw) * kb * (2.4 / mass);
            if (lock.pose !== "down" && now < (lock.staggerUntil ?? 0)) {
              lock.pose = res.stagger === "knockdown" ? "down" : "hurt";
            }
            if (kit.style.id === "dawn" && lock.body.hp <= 1) {
              lock.body.hp = 1;
            }
            if (lock.body.hp <= 0) {
              lock.alive = false;
              lock.pose = "down";
              sfxWin();
              overlay.getState().pushFeed(`A ${lock.evoName ?? lock.species ?? "fighter"} falls in ${kit.title}.`);
              sim.kernel.ecology = Math.max(0.1, sim.kernel.ecology - 0.06);
              if (sim.quest?.kind === "hunt" && !sim.quest.done) {
                if (isSignatureKill(st.worldId, lock.species)) {
                  overlay.getState().pushFeed(`The ${bible(st.worldId).signatureCreature} was the point of this door.`);
                }
                sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
              }
            }
          }
        }
      }

      for (let i = sim.kernel.delayed.length - 1; i >= 0; i--) {
        const hit = sim.kernel.delayed[i]!;
        if (now >= hit.at) {
          const tgt = sim.actors.find((a) => a.id === hit.id);
          if (tgt && tgt.alive) {
            tgt.body.hp = Math.max(0, tgt.body.hp - hit.dmg);
            sfxHit(8);
            overlay.getState().set({ billboard: { text: `${hit.dmg}`, until: now + 500 } });
            if (tgt.body.hp <= 0) {
              tgt.alive = false;
              tgt.pose = "down";
            }
          }
          sim.kernel.delayed.splice(i, 1);
        }
      }

      let prompt: string | null = null;
      let nearNpc: string | null = null;
      const talkList = inHub ? NPCS : [...kit.npcs, ...settlementNpcs(st.worldId)];
      let best = 2.8;
      for (const n of talkList) {
        const a = sim.actors.find((x) => x.id === n.id);
        if (!a) continue;
        const d = dist2(sim.player.x, sim.player.z, a.body.x, a.body.z);
        if (d < best) {
          best = d;
          nearNpc = n.id;
          prompt = `Talk · ${n.name}`;
        }
      }
      if (inHub) {
        for (const g of GATES) {
          const gx = Math.cos(g.angle) * RING_RADIUS;
          const gz = Math.sin(g.angle) * RING_RADIUS;
          const d = dist2(sim.player.x, sim.player.z, gx, gz);
          if (d < 2.4) {
            prompt = `Cross · ${g.name}`;
            if (input.interact) {
              sim.visited.add(g.id);
              if (sim.visited.size >= 3) overlay.getState().mark("ring");
              if (sim.quest?.kind === "cross" && !sim.quest.done && (sim.quest.targetId === g.worldId || sim.quest.targetId === "concordia-hub")) {
                sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
              }
              persistSim(sim);
              const rumor = completeCrossOnTravel(st.worldId, g.worldId);
              markVisitedWorld(g.worldId);
              const next = makeSim(g.worldId);
              next.camYaw = sim.camYaw;
              next.visited = sim.visited;
              next.kernel.memories = sim.kernel.memories;
              if (rumor) next.kernel.lastEvent = rumor;
              Object.assign(sim, next);
              overlay.getState().set({
                gatesWalked: sim.visited.size,
                worldId: g.worldId,
                feed: [rumor ?? `The Link opens on ${g.name}. ${g.theNo}`, ...st.feed].slice(0, 8),
                toast: { text: enterCopy(g.worldId) },
                refusal: bible(g.worldId).refusal,
                lawText: bible(g.worldId).laws[0]?.text ?? "",
              });
              overlay.getState().mark("gate");
              consume(input);
              return;
            }
          }
        }
        if (nearNpc && input.interact) {
          overlay.getState().set({ phase: "dialogue", dialogue: { npcId: nearNpc, index: 0 } });
          if (nearNpc === "lamplighter") overlay.getState().mark("lamp");
          if (document.pointerLockElement) document.exitPointerLock();
        }
      } else {
        const pd = dist2(sim.player.x, sim.player.z, kit.portal.x, kit.portal.z);
        if (pd < 2.6) {
          prompt = "Return · Unburned Court";
          if (input.interact) {
            if (sim.quest?.kind === "cross" && !sim.quest.done && sim.quest.targetId === "concordia-hub") {
              sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
            }
            persistSim(sim);
            const rumor = completeCrossOnTravel(st.worldId, "concordia-hub");
            markVisitedWorld("concordia-hub");
            const next = makeSim("concordia-hub");
            next.visited = sim.visited;
            next.camYaw = sim.camYaw;
            next.kernel.memories = sim.kernel.memories;
            if (rumor) next.kernel.lastEvent = rumor;
            Object.assign(sim, next);
            overlay.getState().set({ worldId: "concordia-hub" });
            overlay.getState().pushFeed(rumor ?? "The Link holds. The Court is still yours to walk.");
            consume(input);
            return;
          }
        }
        if (nearNpc && input.interact) {
          overlay.getState().set({ phase: "dialogue", dialogue: { npcId: nearNpc, index: 0 } });
          if (document.pointerLockElement) document.exitPointerLock();
          const speaker = sim.actors.find((x) => x.id === nearNpc);
          if (speaker?.brain) speaker.brain.trust = Math.min(1, speaker.brain.trust + 0.12);
          if (sim.quest?.kind === "talk" && sim.quest.targetId === nearNpc && !sim.quest.done) {
            sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
          }
        }
        const stone = nearestStone(st.worldId, sim.player.x, sim.player.z);
        if (stone) {
          if (!prompt) prompt = `Read · ${stone.s.title}`;
          if (input.interact) {
            overlay.getState().set({ toast: { text: stone.s.text } });
            overlay.getState().pushFeed(stone.s.text);
            window.setTimeout(() => overlay.getState().set({ toast: null }), 4200);
            consume(input);
          }
        }
        const poi = nearestSettlement(st.worldId, sim.player.x, sim.player.z);
        if (poi) {
          const known = sim.slice.discovered.includes(poi.s.id);
          if (poi.d < 42) {
            if (!known) {
              sim.slice.discovered.push(poi.s.id);
              overlay.getState().pushFeed(`You found ${poi.s.name}. The road will remember.`);
              if (sim.quest?.kind === "road" && sim.quest.targetId === poi.s.id && !sim.quest.done) {
                sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
              }
            }
            if (!prompt) prompt = `Enter · ${poi.s.name}`;
          } else if (poi.d < 900 && known) {
            if (!prompt) prompt = `Road · ${poi.s.name} (${Math.round(poi.d)}m)`;
            if (input.interact && poi.d > 55) {
              sim.player.x = poi.s.x + 8;
              sim.player.z = poi.s.z + 6;
              overlay.getState().set({ toast: { text: `The road to ${poi.s.name} remembers your feet.` } });
              window.setTimeout(() => overlay.getState().set({ toast: null }), 2400);
              consume(input);
              return;
            }
          } else if (!prompt && poi.d < 280) {
            prompt = `Unmarked smoke · ${Math.round(poi.d)}m`;
          }
        }
        const nearBeast = sim.actors.find(
          (a) => a.kind === "beast" && a.alive && dist2(sim.player.x, sim.player.z, a.body.x, a.body.z) < 5,
        );
        if (nearBeast && !prompt) prompt = `${nearBeast.species} · ${kit.style.special}`;
      }

      if (inArena && inHub) {
        const w = sim.actors.find((a) => a.id === "warden");
        if (w && w.alive) prompt = prompt ?? "Train · poise vs momentum";
        if (w && !w.alive) overlay.getState().mark("arena");
      }

      sim.schemeAt -= dt;
      if (sim.schemeAt <= 0 && inHub) {
        sim.schemeAt = 16 + Math.random() * 8;
        const sch = SCHEMES[Math.floor(Math.random() * SCHEMES.length)]!;
        overlay.getState().set({ toast: { text: sch.text, action: "Barge in", schemeId: sch.id } });
        overlay.getState().mark("scheme");
        overlay.getState().pushFeed(sch.text);
        sfxScheme();
      }
      const kEvt = tickKernel(sim.kernel, dt, st.worldId);
      if (kEvt) overlay.getState().pushFeed(kEvt);
      const worldEvt = tickEvents(sim.kernel, st.worldId, dt);
      if (worldEvt) {
        overlay.getState().pushFeed(worldEvt.text);
        if (worldEvt.births) sim.slice.births += worldEvt.births;
      }
      const pol = tickPolitics(sim.kernel, st.worldId, sim.slice.owners ?? (sim.slice.owners = {}), dt);
      if (pol) overlay.getState().pushFeed(pol);
      sim.tickerAt -= dt;
      if (sim.tickerAt <= 0) {
        sim.tickerAt = 14;
        overlay.getState().pushFeed(FACTION_TICKER[Math.floor(sim.t) % FACTION_TICKER.length]!);
        persistSim(sim);
      }
      sim.birthCd -= dt;
      if (!inHub && sim.birthCd <= 0 && sim.kernel.ecology > 0.35) {
        sim.birthCd = 28 + Math.random() * 18;
        const liveBeasts = sim.actors.filter((a) => a.kind === "beast" && a.alive).length;
        if (liveBeasts < 12) {
          const spec = birthCreature(st.worldId, sim.kernel.day, sim.slice.births, {
            x: sim.player.x,
            z: sim.player.z,
          });
          if (spec) {
            const d = beastDef(spec.kind);
            const body = freshCombatant(spec.x, spec.z, 0);
            body.hp = d.hp * spec.scale;
            body.poise = d.poise;
            sim.actors.push({
              id: spec.id,
              body,
              yaw: 0,
              homeX: spec.x,
              homeZ: spec.z,
              wander: 3,
              pose: "idle",
              color: spec.color,
              accent: spec.accent,
              height: d.height * spec.scale,
              hostile: true,
              telegraph: null,
              telegraphUntil: 0,
              aiCd: 0.5,
              alive: true,
              kind: "beast",
              species: spec.kind,
              flyH: spec.fly ? Math.max(d.flyHeight, 3.2) : 0,
              reviveAt: 0,
              morale: 1,
              evoName: spec.name,
              traits: spec.traits,
              scale: d.scale * spec.scale,
            });
            sim.slice.births += 1;
            overlay.getState().pushFeed(`A ${spec.name} was born of ${spec.parentA} and ${spec.parentB}.`);
            const born = sim.actors[sim.actors.length - 1];
            if (born && spec.traits) born.traits = spec.traits;
          }
        }
      }

      sim.wildCd -= dt;
      if (!inHub && sim.wildCd <= 0) {
        sim.wildCd = 2.2;
        const liveWild = sim.actors.filter((a) => a.id.startsWith("wild-") && a.alive).length;
        const spawned = streamWild(
          st.worldId,
          sim.kernel.day,
          sim.player.x,
          sim.player.z,
          liveWild,
          sim.wildSeen,
          sim.kernel.ecology,
        );
        for (const w of spawned) {
          const spec = w.evo;
          const d = beastDef(w.kind);
          const body = freshCombatant(w.x, w.z, 0);
          body.hp = d.hp * (spec?.scale ?? 1);
          body.poise = d.poise;
          sim.actors.push({
            id: w.id,
            body,
            yaw: 0,
            homeX: w.x,
            homeZ: w.z,
            wander: 3.4,
            pose: "idle",
            color: spec?.color ?? d.color,
            accent: spec?.accent ?? d.accent,
            height: d.height * (spec?.scale ?? 1),
            hostile: true,
            telegraph: null,
            telegraphUntil: 0,
            aiCd: 0.4,
            alive: true,
            kind: "beast",
            species: w.kind,
            flyH: (spec?.fly || d.flyHeight > 0) ? Math.max(d.flyHeight, 3.2) : 0,
            reviveAt: 0,
            morale: 1,
            evoName: spec?.name,
            traits: spec?.traits,
            packId: w.packId,
            scale: d.scale * (spec?.scale ?? 1),
          });
        }
        if (spawned.length) overlay.getState().pushFeed(`A pack moved through the ${kit.title.toLowerCase()} rim.`);
        const drop = cullWildIds(
          sim.actors.map((a) => ({ id: a.id, x: a.body.x, z: a.body.z })),
          sim.player.x,
          sim.player.z,
        );
        if (drop.size) sim.actors = sim.actors.filter((a) => !drop.has(a.id));
      }

      const tel = sim.actors.find((a) => a.hostile && a.alive && a.telegraph)?.telegraph ?? null;
      const inCombat = sim.actors.some(
        (a) => a.hostile && a.alive && dist2(sim.player.x, sim.player.z, a.body.x, a.body.z) < 10,
      );
      const nearestBeast = sim.actors.find((a) => a.kind === "beast" && a.alive && a.hostile);

      const poi = nearestSettlement(st.worldId, sim.player.x, sim.player.z);
      overlay.getState().set({
        hp: sim.player.hp,
        stamina: sim.player.stamina,
        poise: sim.player.poise,
        inCombat,
        telegraph: tel,
        prompt,
        heading: sim.camYaw,
        px: sim.player.x,
        pz: sim.player.z,
        hour: sim.kernel.hour,
        weather: sim.kernel.weather,
        styleName: kit.style.name,
        worldTitle: kit.title,
        uncounted: sim.kernel.uncounted,
        hostility: sim.kernel.hostility,
        lastEvent: sim.kernel.lastEvent,
        beastName: nearestBeast?.evoName ?? nearestBeast?.species ?? null,
        arts: hudArts(kit.style, sim.kernel.weather).map((a) => ({ key: a.key, name: a.name })),
        actorN: sim.actors.length,
        questTitle: sim.quest && !sim.quest.done ? sim.quest.title : "",
        questDetail: sim.quest && !sim.quest.done ? sim.quest.detail : "",
        poi: poi ? `${poi.s.name} · ${Math.round(poi.d)}m` : "",
        ecology: sim.kernel.ecology,
        km: inHub ? "" : `${(Math.hypot(sim.player.x, sim.player.z) / 1000).toFixed(2)} km from the door`,
        plotLine: plotLine(),
        politics: politicsLine(st.worldId, sim.slice.owners, sim.kernel.factionHeat),
        flash: sim.juice.flash,
        refusal: bible(st.worldId).refusal,
        lawText: bible(st.worldId).laws[0]?.text ?? "",
      });

      if (sim.player.hp <= 0) {
        sim.player.hp = 100;
        sim.player.stamina = 100;
        sim.player.x = kit.spawn.x;
        sim.player.z = kit.spawn.z;
        if (sim.motion) {
          sim.motion.vx = 0;
          sim.motion.vz = 0;
          sim.motion.vy = 0;
          sim.motion.hop = 0;
          sim.motion.grounded = true;
        }
        sim.speed = 0;
        overlay.getState().set({
          toast: { text: inHub ? "The ground caught you. Guests do not die in the Court." : "The world remembered you. Stand. The Refusal holds." },
        });
        sfxFlower();
      }
    }

    if (input.pause) overlay.getState().set({ phase: "pause" });

    const shake = shakeOffset(sim.juice, sim.t, st.shake && !reduced);
    const sprinting = (input.keys.has("ShiftLeft") || input.keys.has("ShiftRight")) && sim.speed > 4.2;
    const lockA = sim.lockId ? sim.actors.find((a) => a.id === sim.lockId && a.alive) : null;
    const fighting = sim.actors.some(
      (a) => a.hostile && a.alive && dist2(sim.player.x, sim.player.z, a.body.x, a.body.z) < 10,
    );
    chaseCamera({
      px: sim.player.x,
      pz: sim.player.z,
      hop: sim.motion?.hop ?? 0,
      camYaw: sim.camYaw,
      camPitch: sim.camPitch,
      motion: sim.motion,
      world: st.worldId,
      dt,
      punch: sim.juice.punch,
      shake,
      sprinting,
      locked: lockA ? { x: lockA.body.x, z: lockA.body.z } : null,
      cam: camera,
      colliders: st.worldId === "concordia-hub" ? HUB_LAYOUT.colliders : worldKit(st.worldId).colliders,
      inCombat: fighting,
    });

    window.__controlsTest = {
      getYaw: () => sim.yaw,
      getSpeed: () => sim.speed,
      getPos: () => ({ x: sim.player.x, z: sim.player.z }),
      getCamYaw: () => sim.camYaw,
      getKeys: () => [...input.keys],
      setKeys: (codes: string[]) => {
        input.keys.clear();
        for (const c of codes) input.keys.add(c);
      },
      setSteer: (v: number) => {
        input.joyX = -v;
      },
      setPos: (x: number, z: number) => {
        sim.player.x = x;
        sim.player.z = z;
      },
      attack: () => {
        input.attack = true;
      },
      getAttack: () => sim.player.attackKind,
      setCamYaw: (yaw: number) => {
        sim.camYaw = yaw;
        sim.yaw = yaw;
      },
      freeze: () => {
        sim.juice.hitstop = 20;
      },
    };

    consume(input);
  });

  return null;
}

function playerPose(sim: Sim): Pose {
  const n = sim.now;
  if (n < sim.playerStaggerUntil && sim.playerStagger === "knockdown") return "down";
  if (n < sim.player.stunUntil || n < sim.playerStaggerUntil) return "hurt";
  if (sim.player.attackKind && n < sim.player.windupUntil) return "windup";
  if (sim.player.attackKind && n < sim.player.activeUntil) return "strike";
  if (n < sim.player.iframeUntil) return "dodge";
  if (sim.gait === "air" || sim.gait === "land") return sim.speed > 0.4 ? "walk" : "idle";
  if (sim.speed > 0.4) return "walk";
  return "idle";
}

function TrackedFigure({
  simRef,
  id,
}: {
  simRef: React.MutableRefObject<Sim>;
  id: string | "player";
}) {
  const ref = useRef<THREE.Group>(null);
  const poseRef = useRef<Pose>("idle");
  const [pose, setPose] = useState<Pose>("idle");
  const sim0 = simRef.current;
  const actor0 = id === "player" ? null : sim0.actors.find((a) => a.id === id);
  const meta =
    id === "player"
      ? { color: "#d8c8a4", accent: "#5e6b3a", height: 1.82, lantern: false, x: sim0.player.x, z: sim0.player.z, yaw: sim0.yaw, kind: "npc" as const, species: undefined as undefined, flyH: 0, scale: 1, traits: undefined, hostile: true }
      : actor0
        ? {
            color: actor0.color,
            accent: actor0.accent,
            height: actor0.height,
            lantern: !!actor0.lantern,
            x: actor0.body.x,
            z: actor0.body.z,
            yaw: actor0.yaw,
            kind: actor0.kind,
            species: actor0.species,
            flyH: actor0.flyH,
            scale: actor0.scale,
            traits: actor0.traits,
            hostile: actor0.hostile,
          }
        : null;

  useFrame(() => {
    const sim = simRef.current;
    const g = ref.current;
    if (!g) return;
    if (id === "player") {
      const gy = heightAt(sim.worldId, sim.player.x, sim.player.z) + (sim.motion?.hop ?? 0);
      g.position.set(sim.player.x, gy, sim.player.z);
      const heading = sim.speed < 0.35 && !sim.lockId ? sim.camYaw : sim.yaw;
      g.rotation.y = visualYaw(heading);
      g.userData.speed = sim.speed;
      const cad =
        sim.gait === "sprint" ? 2.65 : sim.gait === "jog" ? 2.15 : sim.gait === "walk" || sim.gait === "crouch" ? 1.55 : 0;
      g.userData.gait = sim.gait ?? sim.motion?.gait ?? "idle";
      g.userData.hop = sim.motion?.hop ?? 0;
      g.userData.grounded = sim.motion?.grounded ?? true;
      g.userData.foot = cad ? sim.t * cad : 0;
      g.userData.worldId = sim.worldId;
      g.userData.stagger = sim.now < sim.playerStaggerUntil ? sim.playerStagger : null;
      g.userData.hitDirX = sim.playerHitDirX;
      g.userData.hitDirZ = sim.playerHitDirZ;
      g.userData.act = "idle";
      g.userData.now = sim.now;
      g.userData.attackKind = sim.player.attackKind;
      g.userData.windupUntil = sim.player.windupUntil;
      g.userData.activeUntil = sim.player.activeUntil;
      g.userData.recoverUntil = sim.player.recoverUntil;
      g.userData.lookYaw = Math.atan2(Math.sin(sim.camYaw - heading), Math.cos(sim.camYaw - heading));
      g.userData.hitstop = sim.juice.hitstop;
      const p = playerPose(sim);
      if (p !== poseRef.current) {
        poseRef.current = p;
        setPose(p);
      }
      return;
    }
    const a = sim.actors.find((x) => x.id === id);
    if (!a) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const gy = heightAt(sim.worldId, a.body.x, a.body.z);
    g.position.set(a.body.x, gy + a.flyH, a.body.z);
    g.rotation.y = visualYaw(a.yaw);
    const moving = a.pose === "walk";
    g.userData.speed = moving ? 2.4 : 0;
    g.userData.gait = moving ? "walk" : a.act === "hide" || a.act === "sleep" ? "crouch" : "idle";
    g.userData.foot = sim.t * (moving ? 2.2 : 0);
    g.userData.worldId = sim.worldId;
    g.userData.act = a.act ?? "idle";
    g.userData.stagger = sim.now < (a.staggerUntil ?? 0) ? a.stagger : null;
    g.userData.hitDirX = a.hitDirX ?? 0;
    g.userData.hitDirZ = a.hitDirZ ?? 1;
    g.userData.now = sim.now;
    g.userData.attackKind = a.body.attackKind;
    g.userData.windupUntil = a.body.windupUntil;
    g.userData.activeUntil = a.body.activeUntil;
    g.userData.recoverUntil = a.body.recoverUntil;
    g.userData.lookYaw = 0;
    if (a.pose !== poseRef.current) {
      poseRef.current = a.pose;
      setPose(a.pose);
    }
  });

  if (!meta) return null;
  return (
    <group ref={ref} position={[meta.x, 0, meta.z]}>
      {meta.kind === "beast" && meta.species ? (
        <BeastMesh
          kind={meta.species}
          pose={pose}
          flyH={meta.flyH}
          color={meta.color}
          accent={meta.accent}
          scale={meta.scale}
          traits={meta.traits}
        />
      ) : id === "player" ? (
        <ActorMesh
          color={meta.color}
          accent={meta.accent}
          height={meta.height}
          pose={pose}
          lantern={meta.lantern}
          live
          outfit="street"
        />
      ) : (
        <Figure
          color={meta.color}
          accent={meta.accent}
          height={meta.height}
          pose={pose}
          lantern={meta.lantern}
          live
          outfit="robe"
        />
      )}
    </group>
  );
}

function LiveActors({ simRef }: { simRef: React.MutableRefObject<Sim> }) {
  const worldId = useOverlay((s) => s.worldId);
  const actorN = useOverlay((s) => s.actorN);
  const actors = simRef.current.actors;
  return (
    <>
      <TrackedFigure key={`${worldId}-player`} simRef={simRef} id="player" />
      {actors.map((a) => (
        <TrackedFigure key={`${worldId}-${a.id}`} simRef={simRef} id={a.id} />
      ))}
    </>
  );
}

export function GameCanvas({
  input,
  simRef,
  phase,
}: {
  input: InputState;
  simRef: React.MutableRefObject<Sim>;
  phase: Phase;
}) {
  const worldId = useOverlay((s) => s.worldId);
  const weather = useOverlay((s) => s.weather);
  const theme = THEMES[worldId];
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const pulse = useOverlay((s) => s.flowerWarn);
  const quality = useOverlay((s) => s.quality);
  const q = qualityOpts(quality);

  return (
    <Canvas
      shadows={q.shadows ? "soft" : false}
      dpr={q.dpr}
      camera={{ position: [4.2, 1.8, 1.4], fov: 56, near: 0.12, far: q.far }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        outputColorSpace: THREE.SRGBColorSpace,
        preserveDrawingBuffer: true,
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        touchAction: "none",
        background: theme.skyHorizon,
        zIndex: 0,
      }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(2.2, 1.4, 0.4);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <color attach="background" args={[theme.skyHorizon]} />
      <Atmosphere theme={theme} simRef={simRef} />
      {worldId === "concordia-hub" ? (
        <HubWorld theme={theme} pulse={pulse ? 2 : 0.2} />
      ) : (
        <Suspense fallback={null}>
          <WorldScene worldId={worldId} theme={theme} pulse={pulse ? 2 : simRef.current.t} weather={weather} simRef={simRef} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        {phase !== "title" ? <LiveActors simRef={simRef} /> : null}
      </Suspense>
      <ImpactFx simRef={simRef} />
      <SimLoop input={input} simRef={simRef} reduced={reduced} phase={phase} />
    </Canvas>
  );
}
