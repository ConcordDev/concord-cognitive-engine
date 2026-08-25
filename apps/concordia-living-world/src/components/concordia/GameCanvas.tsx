import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { consume, moveAxes, type InputState } from "@/game/input";
import { HUB_LAYOUT, resolveCollision } from "@/game/layout";
import { addHitstop, addTrauma, shakeOffset, tickJuice } from "@/game/juice";
import {
  sfxDodge,
  sfxFlower,
  sfxFoot,
  sfxHit,
  sfxHurt,
  sfxIframe,
  sfxParry,
  sfxScheme,
  sfxSwing,
  sfxWin,
  tickAmbient,
} from "@/game/audio";
import { useOverlay, type Phase } from "@/game/store";
import { makeSim, type Sim } from "@/game/sim";
import { HubWorld } from "./HubWorld";
import { Figure, type Pose } from "./Figures";
import { WorldScene } from "./WorldScene";
import { BeastMesh } from "./Beasts";
import { worldKit, settlementNpcs } from "@/game/worlds";
import { beastDef } from "@/game/creatures";
import { trySpecial, tryPower, hudArts } from "@/game/abilities";
import { remember, tickKernel } from "@/game/kernel";
import { heightAt } from "@/game/life";
import { nearestSettlement, onRoad } from "@/game/realms";
import { writeSlice } from "@/game/persist";
import { autonomyTarget } from "@/game/npc-life";
import { birthCreature } from "@/game/evo";
import { finishQuest } from "@/game/quests";
import { streamWild, cullWildIds } from "@/game/wild";
import { tickEvents } from "@/game/events";
import { politicsLine, tickPolitics } from "@/game/politics";
import { completeCrossOnTravel, markVisitedWorld, plotLine } from "@/game/cross";

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
  const camDist = 7.4;
  const cfwdX = -Math.sin(sim.camYaw);
  const cfwdZ = -Math.cos(sim.camYaw);
  camera.position.set(
    sim.player.x - cfwdX * camDist,
    2.4 - sim.camPitch * 4,
    sim.player.z - cfwdZ * camDist,
  );
  camera.lookAt(sim.player.x, 1.35, sim.player.z);
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

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      lookAccum.current.x += e.movementX;
      lookAccum.current.y += e.movementY;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const sim = simRef.current;
    const st = overlay.getState();
    const livePhase = phase;
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
      consume(input);
      return;
    }

    if (!camBoot.current || lastWorld.current !== st.worldId) {
      camBoot.current = true;
      lastWorld.current = st.worldId;
      snapCamera(camera, sim);
    }

    sim.now += dt * 1000 * (sim.juice.timeScale === 0 ? 0 : 1);
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

    if (!frozen) {
      const kit = worldKit(st.worldId);
      tickVitals(sim.player, dt, now);
      const moving = Math.hypot(axes.x, axes.y) > 0.12 && canAct(sim.player, now);
      const sprint = input.keys.has("ShiftLeft") || input.keys.has("ShiftRight");
      const wind = kit.weather === "wind" || st.worldId === "concord-link-frontier" ? 1.12 : 1;
      const road = st.worldId !== "concordia-hub" && onRoad(st.worldId, sim.player.x, sim.player.z) ? 1.38 : 1;
      const spd = (sprint ? 7.2 : 4.6) * kit.style.speedMul * wind * road * (sim.player.hp < 25 ? 0.85 : 1);
      if (moving) {
        const mx = fx * axes.y + rx * axes.x;
        const mz = fz * axes.y + rz * axes.x;
        const mag = Math.hypot(mx, mz) || 1;
        sim.player.x += (mx / mag) * spd * dt;
        sim.player.z += (mz / mag) * spd * dt;
        sim.yaw = Math.atan2(-mx / mag, -mz / mag);
        sim.speed = spd;
        sim.foot += dt * spd;
        if (sim.foot > 0.42) {
          sim.foot = 0;
          sfxFoot(sprint ? 1.1 : 0.85);
        }
      } else {
        sim.speed = 0;
      }
      const colliders = st.worldId === "concordia-hub" ? HUB_LAYOUT.colliders : kit.colliders;
      const resolved = resolveCollision(sim.player.x, sim.player.z, 0.42, colliders, kit.bound);
      sim.player.x = resolved.x;
      sim.player.z = resolved.z;
      sim.player.facing = sim.yaw;

      if (st.worldId === "tunya") {
        const grove = dist2(sim.player.x, sim.player.z, 0, 0) < 6 && !sim.player.attackKind;
        if (grove) sim.player.poise = Math.min(12, sim.player.poise + dt * 3.5);
      }
      if (st.worldId === "concord-link-frontier") {
        sim.player.x += Math.sin(sim.t * 0.4) * 0.35 * dt;
      }

      if (input.dodge && beginDodge(sim.player, now, false)) {
        const dx = fx * Math.max(axes.y, 0.35) + rx * axes.x;
        const dz = fz * Math.max(axes.y, 0.35) + rz * axes.x;
        const m = Math.hypot(dx, dz) || 1;
        sim.player.x += (dx / m) * 2.1;
        sim.player.z += (dz / m) * 2.1;
        const after = resolveCollision(sim.player.x, sim.player.z, 0.42, colliders, kit.bound);
        sim.player.x = after.x;
        sim.player.z = after.z;
        sfxDodge();
      }
      if (input.parry) beginParry(sim.player, now);
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
            const after = resolveCollision(sim.player.x, sim.player.z, 0.42, colliders, kit.bound);
            sim.player.x = after.x;
            sim.player.z = after.z;
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
      } else if (input.heavy) {
        if (beginAttack(sim.player, "heavy", now)) sfxSwing(true);
      } else if (input.attack) {
        if (beginAttack(sim.player, "light", now)) sfxSwing(false);
      }

      const inHub = st.worldId === "concordia-hub";
      const inArena = dist2(sim.player.x, sim.player.z, ARENA.x, ARENA.z) < ARENA.r + 0.6;

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
        if (!a.hostile) {
          const ox = Math.sin(sim.t * 0.35 + a.homeX) * a.wander;
          const oz = Math.cos(sim.t * 0.28 + a.homeZ) * a.wander * 0.7;
          let tx = a.homeX + ox;
          let tz = a.homeZ + oz;
          if (a.brain) {
            const tgt = autonomyTarget(a.brain, st.worldId, sim.kernel.hour, sim.kernel.factionHeat);
            tx = tgt.x + ox * 0.25;
            tz = tgt.z + oz * 0.25;
          }
          a.body.x = THREE.MathUtils.damp(a.body.x, tx, 1.6, dt);
          a.body.z = THREE.MathUtils.damp(a.body.z, tz, 1.6, dt);
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
            a.body.x += (dx / m) * spdA * dt + (-dz / m) * side * spdA * dt;
            a.body.z += (dz / m) * spdA * dt + (dx / m) * side * spdA * dt;
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
            const res = applyHit(a.body, sim.player, now, { parried, flanked: false });
            if (res) {
              if (res.iframed || dodging) sfxIframe();
              else if (res.parried) {
                sfxParry();
                addTrauma(sim.juice, 0.2);
              } else if (res.landed) {
                sfxHurt();
                addTrauma(sim.juice, res.feel.trauma);
                addHitstop(sim.juice, res.feel.hitPauseMs);
                sim.juice.flash = 1;
                const kb = res.feel.knockback;
                sim.player.x -= Math.sin(a.yaw) * kb * 0.12;
                sim.player.z -= Math.cos(a.yaw) * kb * 0.12;
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
          } else if (now < a.body.stunUntil) a.pose = "hurt";
          else if (a.body.attackKind && now < a.body.windupUntil) a.pose = "windup";
          else if (a.body.attackKind && now < a.body.activeUntil) a.pose = "strike";
        } else {
          a.pose = a.pose === "down" ? "down" : "idle";
        }
      }

      const lockReach = 2.6;
      const lock = sim.actors.find(
        (a) => a.alive && a.hostile && dist2(sim.player.x, sim.player.z, a.body.x, a.body.z) < lockReach + (a.species === "dragon" ? 1.2 : 0),
      );
      if (sim.player.attackKind && now >= sim.player.windupUntil && now <= sim.player.activeUntil && lock) {
        const res = applyHit(sim.player, lock.body, now, { parried: false, flanked: false });
        if (res && now - sim.lastHitAt > 90) {
          sim.lastHitAt = now;
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
              addTrauma(sim.juice, res.feel.trauma * 0.7);
              addHitstop(sim.juice, res.feel.hitPauseMs * 0.7);
              overlay.getState().set({
                billboard: { text: `${res.feel.damage}`, until: now + 600 },
              });
            }
            const kb = res.feel.knockback;
            lock.body.x -= Math.sin(sim.yaw) * kb * 0.15;
            lock.body.z -= Math.cos(sim.yaw) * kb * 0.15;
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
                sim.quest = finishQuest(sim.quest, sim.kernel, sim.slice, st.worldId, (s) => overlay.getState().pushFeed(s));
              }
            }
          }
          sim.player.activeUntil = now - 1;
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
        sim.wildCd = 5.5;
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
      });

      if (sim.player.hp <= 0) {
        sim.player.hp = 100;
        sim.player.stamina = 100;
        sim.player.x = kit.spawn.x;
        sim.player.z = kit.spawn.z;
        overlay.getState().set({
          toast: { text: inHub ? "The ground caught you. Guests do not die in the Court." : "The world remembered you. Stand. The Refusal holds." },
        });
        sfxFlower();
      }
    }

    if (input.pause) overlay.getState().set({ phase: "pause" });

    const shake = shakeOffset(sim.juice, sim.t, st.shake && !reduced);
    const camDist = 7.4 + sim.juice.punch * 0.4;
    const px = sim.player.x;
    const pz = sim.player.z;
    const groundY = heightAt(st.worldId, px, pz);
    const lookY = 1.35 + groundY;
    const cfwdX = -Math.sin(sim.camYaw);
    const cfwdZ = -Math.cos(sim.camYaw);
    const desiredX = px - cfwdX * camDist + shake.x;
    const desiredY = 2.4 + groundY - sim.camPitch * 4 + shake.y;
    const desiredZ = pz - cfwdZ * camDist;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredX, 8, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredY, 8, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredZ, 8, dt);
    camera.lookAt(px, lookY, pz);

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
    };

    consume(input);
  });

  return null;
}

function playerPose(sim: Sim): Pose {
  const n = sim.now;
  if (n < sim.player.stunUntil) return "hurt";
  if (sim.player.attackKind && n < sim.player.windupUntil) return "windup";
  if (sim.player.attackKind && n < sim.player.activeUntil) return "strike";
  if (n < sim.player.iframeUntil) return "dodge";
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
      ? { color: "#d8c8a4", accent: "#5e6b3a", height: 1.76, lantern: false, x: sim0.player.x, z: sim0.player.z, yaw: sim0.yaw, kind: "npc" as const, species: undefined as undefined, flyH: 0, scale: 1, traits: undefined }
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
          }
        : null;

  useFrame(() => {
    const sim = simRef.current;
    const g = ref.current;
    if (!g) return;
    if (id === "player") {
      const gy = heightAt(sim.worldId, sim.player.x, sim.player.z);
      g.position.set(sim.player.x, gy, sim.player.z);
      g.rotation.y = sim.yaw;
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
    g.rotation.y = a.yaw;
    if (a.pose !== poseRef.current) {
      poseRef.current = a.pose;
      setPose(a.pose);
    }
  });

  if (!meta) return null;
  return (
    <group ref={ref} position={[meta.x, 0, meta.z]} rotation={[0, meta.yaw, 0]}>
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
      ) : (
        <Figure color={meta.color} accent={meta.accent} height={meta.height} pose={pose} lantern={meta.lantern} />
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

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [7.4, 5.6, 2.2], fov: 54, near: 0.2, far: 1400 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", touchAction: "none", background: theme.skyHorizon }}
      onCreated={({ camera }) => {
        camera.lookAt(14, 2.6, 12);
      }}
      onPointerDown={(e) => {
        if (phase !== "play") return;
        const el = e.currentTarget as unknown as HTMLCanvasElement;
        if (el.requestPointerLock && e.button === 2) el.requestPointerLock();
      }}
    >
      <color attach="background" args={[theme.skyHorizon]} />
      {worldId === "concordia-hub" ? (
        <HubWorld theme={theme} pulse={pulse ? 2 : 0.2} />
      ) : (
        <WorldScene worldId={worldId} theme={theme} pulse={pulse ? 2 : simRef.current.t} weather={weather} simRef={simRef} />
      )}
      <LiveActors simRef={simRef} />
      <SimLoop input={input} simRef={simRef} reduced={reduced} phase={phase} />
    </Canvas>
  );
}
