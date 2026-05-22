// server/domains/physics.js
// Domain actions for physics: kinematics simulation, orbital mechanics,
// wave interference, and thermodynamic state computation.

export default function registerPhysicsActions(registerLensAction) {
  /**
   * kinematicsSim
   * Simulate projectile / multi-body kinematics with drag and gravity.
   * artifact.data.bodies = [{ name, mass, position: {x,y,z}, velocity: {x,y,z},
   *   dragCoefficient?, crossSection? }]
   * params.dt (timestep seconds, default 0.01), params.steps (default 1000),
   * params.gravity (m/s², default 9.81), params.airDensity (kg/m³, default 1.225)
   */
  registerLensAction("physics", "kinematicsSim", (ctx, artifact, params) => {
    const bodies = artifact.data?.bodies || [];
    if (bodies.length === 0) return { ok: false, error: "No bodies defined." };

    const dt = params.dt || 0.01;
    const steps = Math.min(params.steps || 1000, 10000);
    const g = params.gravity ?? 9.81;
    const rho = params.airDensity ?? 1.225;

    const trajectories = {};
    const state = bodies.map(b => {
      const name = b.name || `body_${bodies.indexOf(b)}`;
      trajectories[name] = [];
      return {
        name, mass: b.mass || 1,
        x: b.position?.x || 0, y: b.position?.y || 0, z: b.position?.z || 0,
        vx: b.velocity?.x || 0, vy: b.velocity?.y || 0, vz: b.velocity?.z || 0,
        cd: b.dragCoefficient || 0, area: b.crossSection || 0,
        grounded: false,
      };
    });

    const r = v => Math.round(v * 10000) / 10000;

    for (let step = 0; step < steps; step++) {
      for (const s of state) {
        if (s.grounded) continue;

        // Record every 10th point to keep output manageable
        if (step % Math.max(1, Math.floor(steps / 200)) === 0) {
          trajectories[s.name].push({ t: r(step * dt), x: r(s.x), y: r(s.y), z: r(s.z), vx: r(s.vx), vy: r(s.vy), vz: r(s.vz) });
        }

        // Gravity (negative y)
        let ax = 0, ay = -g, az = 0;

        // Aerodynamic drag: F_drag = 0.5 * Cd * A * rho * v² (opposing velocity)
        if (s.cd > 0 && s.area > 0) {
          const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
          if (speed > 1e-10) {
            const dragMag = 0.5 * s.cd * s.area * rho * speed * speed;
            ax -= (dragMag * s.vx / speed) / s.mass;
            ay -= (dragMag * s.vy / speed) / s.mass;
            az -= (dragMag * s.vz / speed) / s.mass;
          }
        }

        // Velocity-Verlet integration
        s.x += s.vx * dt + 0.5 * ax * dt * dt;
        s.y += s.vy * dt + 0.5 * ay * dt * dt;
        s.z += s.vz * dt + 0.5 * az * dt * dt;
        s.vx += ax * dt;
        s.vy += ay * dt;
        s.vz += az * dt;

        // Ground collision (y = 0 plane)
        if (s.y <= 0 && s.vy < 0) {
          s.y = 0;
          s.grounded = true;
          trajectories[s.name].push({ t: r(step * dt), x: r(s.x), y: 0, z: r(s.z), vx: r(s.vx), vy: 0, vz: r(s.vz), event: "impact" });
        }
      }

      // Check if all grounded
      if (state.every(s => s.grounded)) break;
    }

    // Compute summary stats per body
    const results = state.map(s => {
      const traj = trajectories[s.name];
      const maxHeight = Math.max(...traj.map(p => p.y));
      const impactPoint = traj.find(p => p.event === "impact");
      const range = impactPoint ? Math.sqrt(impactPoint.x * impactPoint.x + impactPoint.z * impactPoint.z) : null;
      const flightTime = impactPoint ? impactPoint.t : traj[traj.length - 1]?.t || 0;
      const maxSpeed = Math.max(...traj.map(p => Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz)));

      return {
        name: s.name, mass: s.mass,
        maxHeight: r(maxHeight), range: range != null ? r(range) : null,
        flightTime: r(flightTime), maxSpeed: r(maxSpeed),
        impactVelocity: impactPoint ? r(Math.sqrt(impactPoint.vx * impactPoint.vx + impactPoint.vz * impactPoint.vz)) : null,
        trajectoryPoints: traj.length,
      };
    });

    return {
      ok: true, result: {
        bodies: results, trajectories,
        parameters: { dt, steps, gravity: g, airDensity: rho },
        totalSimTime: r(steps * dt),
      },
    };
  });

  /**
   * orbitalMechanics
   * Compute orbital parameters from state vectors, or propagate Keplerian orbits.
   * artifact.data.orbit = { semiMajorAxis, eccentricity, inclination?, centralBodyMass? }
   * OR artifact.data.stateVector = { position: {x,y,z}, velocity: {x,y,z}, centralBodyMass }
   */
  registerLensAction("physics", "orbitalMechanics", (ctx, artifact, params) => {
    const G = 6.674e-11; // gravitational constant
    const r = v => Math.round(v * 1e6) / 1e6;

    if (artifact.data?.stateVector) {
      const sv = artifact.data.stateVector;
      const M = sv.centralBodyMass || 5.972e24; // Earth default
      const mu = G * M;
      const pos = sv.position || { x: 0, y: 0, z: 0 };
      const vel = sv.velocity || { x: 0, y: 0, z: 0 };

      const rMag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      const vMag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

      // Specific orbital energy
      const energy = vMag * vMag / 2 - mu / rMag;

      // Semi-major axis
      const a = -mu / (2 * energy);

      // Specific angular momentum h = r × v
      const hx = pos.y * vel.z - pos.z * vel.y;
      const hy = pos.z * vel.x - pos.x * vel.z;
      const hz = pos.x * vel.y - pos.y * vel.x;
      const hMag = Math.sqrt(hx * hx + hy * hy + hz * hz);

      // Eccentricity vector e = (v × h)/μ - r̂
      const vxh_x = vel.y * hz - vel.z * hy;
      const vxh_y = vel.z * hx - vel.x * hz;
      const vxh_z = vel.x * hy - vel.y * hx;
      const ex = vxh_x / mu - pos.x / rMag;
      const ey = vxh_y / mu - pos.y / rMag;
      const ez = vxh_z / mu - pos.z / rMag;
      const e = Math.sqrt(ex * ex + ey * ey + ez * ez);

      // Inclination
      const inclination = Math.acos(hz / hMag) * 180 / Math.PI;

      // Period
      const period = a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;

      // Apoapsis / Periapsis
      const periapsis = a * (1 - e);
      const apoapsis = e < 1 ? a * (1 + e) : Infinity;

      // Orbital velocity at periapsis and apoapsis (vis-viva)
      const vPeri = Math.sqrt(mu * (2 / periapsis - 1 / a));
      const vApo = apoapsis < Infinity ? Math.sqrt(mu * (2 / apoapsis - 1 / a)) : 0;

      const orbitType = e < 0.001 ? "circular" : e < 1 ? "elliptical" : e === 1 ? "parabolic" : "hyperbolic";

      return {
        ok: true, result: {
          orbitType,
          elements: {
            semiMajorAxis: r(a), eccentricity: r(e),
            inclination: r(inclination),
            periapsis: r(periapsis), apoapsis: apoapsis < Infinity ? r(apoapsis) : "infinity",
          },
          dynamics: {
            specificEnergy: r(energy),
            angularMomentum: r(hMag),
            period: period < Infinity ? r(period) : "infinity",
            periodHours: period < Infinity ? r(period / 3600) : "infinity",
            velocityAtPeriapsis: r(vPeri),
            velocityAtApoapsis: r(vApo),
            currentVelocity: r(vMag),
            currentAltitude: r(rMag),
          },
          escapeVelocity: r(Math.sqrt(2 * mu / rMag)),
        },
      };
    }

    // Keplerian orbit from elements
    const orbit = artifact.data?.orbit || {};
    const a = orbit.semiMajorAxis || 7000000; // meters
    const e = orbit.eccentricity || 0;
    const M = orbit.centralBodyMass || 5.972e24;
    const mu = G * M;
    const inc = (orbit.inclination || 0) * Math.PI / 180;

    const period = 2 * Math.PI * Math.sqrt(a * a * a / mu);
    const periapsis = a * (1 - e);
    const apoapsis = a * (1 + e);
    const vPeri = Math.sqrt(mu * (2 / periapsis - 1 / a));
    const vApo = Math.sqrt(mu * (2 / apoapsis - 1 / a));

    // Generate orbit points (true anomaly from 0 to 2π)
    const orbitPoints = [];
    const nPoints = params.points || 72;
    for (let i = 0; i < nPoints; i++) {
      const theta = (2 * Math.PI * i) / nPoints;
      const radius = a * (1 - e * e) / (1 + e * Math.cos(theta));
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta) * Math.cos(inc);
      const z = radius * Math.sin(theta) * Math.sin(inc);
      orbitPoints.push({ theta: r(theta * 180 / Math.PI), radius: r(radius), x: r(x), y: r(y), z: r(z) });
    }

    // Delta-V requirements
    const hohmannTarget = params.targetAltitude || apoapsis * 1.5;
    const vCircularCurrent = Math.sqrt(mu / a);
    const vCircularTarget = Math.sqrt(mu / hohmannTarget);
    const aTransfer = (a + hohmannTarget) / 2;
    const vTransfer1 = Math.sqrt(mu * (2 / a - 1 / aTransfer));
    const vTransfer2 = Math.sqrt(mu * (2 / hohmannTarget - 1 / aTransfer));
    const deltaV1 = Math.abs(vTransfer1 - vCircularCurrent);
    const deltaV2 = Math.abs(vCircularTarget - vTransfer2);

    return {
      ok: true, result: {
        elements: { semiMajorAxis: a, eccentricity: e, inclination: orbit.inclination || 0 },
        dynamics: {
          period: r(period), periodMinutes: r(period / 60),
          periapsis: r(periapsis), apoapsis: r(apoapsis),
          velocityAtPeriapsis: r(vPeri), velocityAtApoapsis: r(vApo),
          meanMotion: r(2 * Math.PI / period),
        },
        hohmannTransfer: {
          targetAltitude: hohmannTarget,
          deltaV1: r(deltaV1), deltaV2: r(deltaV2),
          totalDeltaV: r(deltaV1 + deltaV2),
          transferTime: r(Math.PI * Math.sqrt(aTransfer * aTransfer * aTransfer / mu)),
        },
        orbitPoints: orbitPoints.length > 50 ? orbitPoints.filter((_, i) => i % Math.ceil(orbitPoints.length / 50) === 0) : orbitPoints,
      },
    };
  });

  /**
   * waveInterference
   * Compute interference patterns from multiple wave sources.
   * artifact.data.sources = [{ x, y, frequency, amplitude, phase? }]
   * params.gridSize (default 50), params.resolution (default 0.1 m)
   */
  registerLensAction("physics", "waveInterference", (ctx, artifact, params) => {
    const sources = artifact.data?.sources || [];
    if (sources.length === 0) return { ok: false, error: "No wave sources defined." };

    const gridSize = Math.min(params.gridSize || 50, 100);
    const resolution = params.resolution || 0.1;
    const t = params.time || 0; // snapshot time
    const speed = params.waveSpeed || 343; // m/s (speed of sound default)

    const halfGrid = (gridSize * resolution) / 2;
    const amplitudeMap = [];
    let maxAmp = 0, minAmp = 0;
    let constructiveCount = 0, destructiveCount = 0;

    for (let iy = 0; iy < gridSize; iy++) {
      const row = [];
      for (let ix = 0; ix < gridSize; ix++) {
        const px = ix * resolution - halfGrid;
        const py = iy * resolution - halfGrid;
        let totalReal = 0, totalImag = 0;

        for (const src of sources) {
          const dx = px - (src.x || 0);
          const dy = py - (src.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const k = 2 * Math.PI * src.frequency / speed; // wave number
          const omega = 2 * Math.PI * src.frequency;
          const phi = src.phase || 0;
          const amp = (src.amplitude || 1) / Math.max(Math.sqrt(dist), 0.01); // 2D circular wave 1/√r decay
          const phase = k * dist - omega * t + phi;
          totalReal += amp * Math.cos(phase);
          totalImag += amp * Math.sin(phase);
        }

        const amplitude = Math.sqrt(totalReal * totalReal + totalImag * totalImag);
        const signedAmplitude = totalReal; // instantaneous value
        row.push(Math.round(signedAmplitude * 1000) / 1000);
        if (signedAmplitude > maxAmp) maxAmp = signedAmplitude;
        if (signedAmplitude < minAmp) minAmp = signedAmplitude;

        // Classify interference type at this point
        const sumIndividual = sources.reduce((s, src) => {
          const dx = px - (src.x || 0), dy = py - (src.y || 0);
          return s + (src.amplitude || 1) / Math.max(Math.sqrt(Math.sqrt(dx * dx + dy * dy)), 0.01);
        }, 0);
        if (amplitude > sumIndividual * 0.8) constructiveCount++;
        else if (amplitude < sumIndividual * 0.2) destructiveCount++;
      }
      amplitudeMap.push(row);
    }

    const totalPoints = gridSize * gridSize;

    // Find nodal lines (amplitude ≈ 0)
    let nodalCount = 0;
    for (const row of amplitudeMap) {
      for (const v of row) {
        if (Math.abs(v) < maxAmp * 0.05) nodalCount++;
      }
    }

    // Wavelengths
    const wavelengths = sources.map(s => ({
      source: `(${s.x || 0}, ${s.y || 0})`,
      frequency: s.frequency,
      wavelength: Math.round((speed / s.frequency) * 10000) / 10000,
      amplitude: s.amplitude || 1,
    }));

    // Beat frequency (for 2 sources)
    let beatFrequency = null;
    if (sources.length === 2) {
      beatFrequency = Math.abs(sources[0].frequency - sources[1].frequency);
    }

    return {
      ok: true, result: {
        grid: { size: gridSize, resolution, physicalSize: gridSize * resolution },
        amplitudeMap: gridSize <= 30 ? amplitudeMap : "grid too large for inline display",
        statistics: {
          maxAmplitude: Math.round(maxAmp * 1000) / 1000,
          minAmplitude: Math.round(minAmp * 1000) / 1000,
          constructivePercent: Math.round((constructiveCount / totalPoints) * 100),
          destructivePercent: Math.round((destructiveCount / totalPoints) * 100),
          nodalPercent: Math.round((nodalCount / totalPoints) * 100),
        },
        sources: wavelengths,
        beatFrequency,
        waveSpeed: speed, snapshotTime: t,
      },
    };
  });

  /**
   * thermodynamics
   * Compute thermodynamic state changes for ideal gas processes.
   * artifact.data.state = { pressure, volume, temperature, moles?, gasConstant? }
   * params.process: "isothermal" | "adiabatic" | "isobaric" | "isochoric"
   * params.finalState: { pressure?, volume?, temperature? }
   */
  registerLensAction("physics", "thermodynamics", (ctx, artifact, params) => {
    const state = artifact.data?.state || {};
    const R = state.gasConstant || 8.314; // J/(mol·K)
    const n = state.moles || 1;
    const gamma = params.gamma || 1.4; // heat capacity ratio (diatomic default)
    const process = params.process || "isothermal";
    const r = v => Math.round(v * 10000) / 10000;

    let P1 = state.pressure; // Pa
    let V1 = state.volume;   // m³
    let T1 = state.temperature; // K

    // Fill in missing initial state via ideal gas law
    if (!P1 && V1 && T1) P1 = n * R * T1 / V1;
    if (!V1 && P1 && T1) V1 = n * R * T1 / P1;
    if (!T1 && P1 && V1) T1 = P1 * V1 / (n * R);
    if (!P1 || !V1 || !T1) return { ok: false, error: "Need at least 2 of: pressure, volume, temperature." };

    const final = params.finalState || {};
    let P2, V2, T2, work, heat, deltaU;
    const Cv = R * n / (gamma - 1);
    const Cp = gamma * Cv;

    switch (process) {
      case "isothermal": {
        T2 = T1;
        if (final.volume) { V2 = final.volume; P2 = P1 * V1 / V2; }
        else if (final.pressure) { P2 = final.pressure; V2 = P1 * V1 / P2; }
        else { V2 = V1 * 2; P2 = P1 / 2; } // default: double volume
        work = n * R * T1 * Math.log(V2 / V1);
        deltaU = 0; // isothermal: ΔU = 0
        heat = work; // Q = W
        break;
      }
      case "adiabatic": {
        if (final.volume) {
          V2 = final.volume;
          P2 = P1 * Math.pow(V1 / V2, gamma);
          T2 = T1 * Math.pow(V1 / V2, gamma - 1);
        } else if (final.pressure) {
          P2 = final.pressure;
          V2 = V1 * Math.pow(P1 / P2, 1 / gamma);
          T2 = T1 * Math.pow(P1 / P2, (gamma - 1) / gamma);
        } else {
          V2 = V1 * 2; P2 = P1 * Math.pow(V1 / V2, gamma);
          T2 = T1 * Math.pow(V1 / V2, gamma - 1);
        }
        heat = 0;
        deltaU = Cv * (T2 - T1);
        work = -deltaU; // W = -ΔU for adiabatic
        break;
      }
      case "isobaric": {
        P2 = P1;
        if (final.volume) { V2 = final.volume; T2 = T1 * V2 / V1; }
        else if (final.temperature) { T2 = final.temperature; V2 = V1 * T2 / T1; }
        else { T2 = T1 * 2; V2 = V1 * 2; }
        work = P1 * (V2 - V1);
        deltaU = Cv * (T2 - T1);
        heat = Cp * (T2 - T1);
        break;
      }
      case "isochoric": {
        V2 = V1;
        if (final.pressure) { P2 = final.pressure; T2 = T1 * P2 / P1; }
        else if (final.temperature) { T2 = final.temperature; P2 = P1 * T2 / T1; }
        else { T2 = T1 * 2; P2 = P1 * 2; }
        work = 0;
        deltaU = Cv * (T2 - T1);
        heat = deltaU;
        break;
      }
      default:
        return { ok: false, error: `Unknown process "${process}". Use: isothermal, adiabatic, isobaric, isochoric.` };
    }

    // Entropy change: ΔS = Q/T for reversible, or nCv*ln(T2/T1) + nR*ln(V2/V1)
    const deltaS = n * Cv / n * Math.log(T2 / T1) + n * R * Math.log(V2 / V1);

    // Efficiency if this were a heat engine step
    const efficiency = heat > 0 ? work / heat : 0;
    const carnotEfficiency = T1 > 0 ? 1 - Math.min(T1, T2) / Math.max(T1, T2) : 0;

    return {
      ok: true, result: {
        process,
        initialState: { pressure: r(P1), volume: r(V1), temperature: r(T1) },
        finalState: { pressure: r(P2), volume: r(V2), temperature: r(T2) },
        energetics: {
          work: r(work), heat: r(heat), internalEnergyChange: r(deltaU),
          entropyChange: r(deltaS),
          firstLawCheck: r(heat - work - deltaU), // should be ≈ 0
        },
        efficiency: { stepEfficiency: r(efficiency), carnotLimit: r(carnotEfficiency) },
        parameters: { moles: n, gamma, gasConstant: R },
      },
    };
  });

  // ─── 2026 parity — Wolfram Alpha / Symbolab / PhET / MS Math Solver ──
  //
  // Adds 1D + 2D kinematics, unit conversion, projectile motion, and a few
  // canonical physics constants. Pure JS, no external deps.

  // ── Kinematics solver (1D motion) ──

  registerLensAction("physics", "kinematics-1d", (_ctx, _artifact, params = {}) => {
    // Given any 3 of {v0, v, a, t, x}, solve for the missing one(s).
    const v0 = params.v0 != null ? Number(params.v0) : null;
    const v  = params.v  != null ? Number(params.v)  : null;
    const a  = params.a  != null ? Number(params.a)  : null;
    const t  = params.t  != null ? Number(params.t)  : null;
    const x  = params.x  != null ? Number(params.x)  : null;
    const provided = [v0, v, a, t, x].filter((n) => n != null && Number.isFinite(n)).length;
    if (provided < 3) return { ok: false, error: "provide at least 3 of: v0, v, a, t, x" };
    const out = { v0, v, a, t, x };
    // Use the standard 4 equations.
    if (out.v == null && out.v0 != null && out.a != null && out.t != null) out.v = out.v0 + out.a * out.t;
    if (out.x == null && out.v0 != null && out.a != null && out.t != null) out.x = out.v0 * out.t + 0.5 * out.a * out.t * out.t;
    if (out.x == null && out.v0 != null && out.v != null && out.t != null) out.x = 0.5 * (out.v0 + out.v) * out.t;
    if (out.t == null && out.v0 != null && out.v != null && out.a != null && out.a !== 0) out.t = (out.v - out.v0) / out.a;
    if (out.a == null && out.v0 != null && out.v != null && out.t != null && out.t !== 0) out.a = (out.v - out.v0) / out.t;
    if (out.v == null && out.v0 != null && out.a != null && out.x != null) {
      const vsq = out.v0 * out.v0 + 2 * out.a * out.x;
      if (vsq >= 0) out.v = Math.sqrt(vsq);
    }
    if (out.v0 == null && out.v != null && out.a != null && out.t != null) out.v0 = out.v - out.a * out.t;
    // Round
    for (const k of Object.keys(out)) {
      if (out[k] != null && Number.isFinite(out[k])) out[k] = Math.round(out[k] * 10000) / 10000;
    }
    return {
      ok: true,
      result: {
        solved: out,
        equations: ["v = v₀ + at", "x = v₀t + ½at²", "v² = v₀² + 2ax", "x = ½(v₀ + v)t"],
        units: { v0: "m/s", v: "m/s", a: "m/s²", t: "s", x: "m" },
      },
    };
  });

  // ── Projectile motion ──

  registerLensAction("physics", "projectile", (_ctx, _artifact, params = {}) => {
    const v0 = Number(params.v0);
    const angleDeg = Number(params.angleDeg);
    const h0 = Number(params.h0) || 0;
    const g = Number(params.g) || 9.81;
    if (!Number.isFinite(v0) || v0 <= 0) return { ok: false, error: "v0 must be > 0" };
    if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 90) return { ok: false, error: "angleDeg 0..90" };
    const angle = (angleDeg * Math.PI) / 180;
    const v0x = v0 * Math.cos(angle);
    const v0y = v0 * Math.sin(angle);
    // Time of flight: y(t) = h0 + v0y*t - g*t²/2 = 0
    // t = (v0y + √(v0y² + 2g*h0)) / g
    const t = (v0y + Math.sqrt(v0y * v0y + 2 * g * h0)) / g;
    const range = v0x * t;
    const tApex = v0y / g;
    const maxHeight = h0 + (v0y * v0y) / (2 * g);
    const vImpact = Math.sqrt(v0x * v0x + (v0y - g * t) ** 2);
    return {
      ok: true,
      result: {
        timeOfFlight_s: Math.round(t * 1000) / 1000,
        range_m: Math.round(range * 100) / 100,
        maxHeight_m: Math.round(maxHeight * 100) / 100,
        timeToApex_s: Math.round(tApex * 1000) / 1000,
        impactSpeed_mps: Math.round(vImpact * 100) / 100,
        v0x_mps: Math.round(v0x * 100) / 100,
        v0y_mps: Math.round(v0y * 100) / 100,
        inputs: { v0, angleDeg, h0, g },
      },
    };
  });

  // ── Unit conversion ──

  const UNITS = {
    length:      { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
    mass:        { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 },
    time:        { s: 1, ms: 0.001, min: 60, h: 3600, day: 86400 },
    velocity:    { mps: 1, kmh: 0.277778, mph: 0.44704, fps: 0.3048, knot: 0.514444 },
    energy:      { J: 1, kJ: 1000, cal: 4.184, kcal: 4184, eV: 1.602176634e-19, kWh: 3_600_000, BTU: 1055.06 },
    force:       { N: 1, kN: 1000, lbf: 4.44822, dyne: 1e-5 },
    pressure:    { Pa: 1, kPa: 1000, atm: 101325, bar: 100000, psi: 6894.76, mmHg: 133.322 },
    temperature: { K: 1, C: 1, F: 1 }, // special handling
  };

  registerLensAction("physics", "convert-units", (_ctx, _artifact, params = {}) => {
    const value = Number(params.value);
    if (!Number.isFinite(value)) return { ok: false, error: "value required" };
    const from = String(params.from || "");
    const to = String(params.to || "");
    const kind = String(params.kind || "");
    if (!UNITS[kind]) return { ok: false, error: `kind must be one of: ${Object.keys(UNITS).join(", ")}` };
    if (!UNITS[kind][from] && kind !== "temperature") return { ok: false, error: `unknown from unit: ${from}` };
    if (!UNITS[kind][to] && kind !== "temperature") return { ok: false, error: `unknown to unit: ${to}` };
    let result;
    if (kind === "temperature") {
      // C ↔ F ↔ K conversions
      let asK;
      if (from === "K") asK = value;
      else if (from === "C") asK = value + 273.15;
      else if (from === "F") asK = (value - 32) * 5 / 9 + 273.15;
      else return { ok: false, error: `unknown from unit: ${from}` };
      if (to === "K") result = asK;
      else if (to === "C") result = asK - 273.15;
      else if (to === "F") result = (asK - 273.15) * 9 / 5 + 32;
      else return { ok: false, error: `unknown to unit: ${to}` };
    } else {
      const fromSI = UNITS[kind][from];
      const toSI = UNITS[kind][to];
      result = (value * fromSI) / toSI;
    }
    return { ok: true, result: { value, from, to, kind, result: Math.round(result * 1_000_000) / 1_000_000 } };
  });

  // ── Physical constants ──

  registerLensAction("physics", "constants", (_ctx, _artifact, _params = {}) => {
    return {
      ok: true,
      result: {
        constants: {
          c:         { value: 299_792_458,        units: "m/s",       name: "speed of light in vacuum" },
          G:         { value: 6.67430e-11,         units: "m³/kg/s²",  name: "gravitational constant" },
          g_earth:   { value: 9.80665,             units: "m/s²",      name: "standard gravity (Earth)" },
          h:         { value: 6.62607015e-34,      units: "J·s",       name: "Planck's constant" },
          hbar:      { value: 1.054571817e-34,     units: "J·s",       name: "reduced Planck's constant" },
          e:         { value: 1.602176634e-19,     units: "C",         name: "elementary charge" },
          k_B:       { value: 1.380649e-23,        units: "J/K",       name: "Boltzmann constant" },
          N_A:       { value: 6.02214076e23,       units: "1/mol",     name: "Avogadro constant" },
          R:         { value: 8.314462618,         units: "J/mol/K",   name: "ideal gas constant" },
          m_e:       { value: 9.1093837015e-31,    units: "kg",        name: "electron mass" },
          m_p:       { value: 1.67262192369e-27,   units: "kg",        name: "proton mass" },
          eps_0:     { value: 8.8541878128e-12,    units: "F/m",       name: "vacuum permittivity" },
          mu_0:      { value: 1.25663706212e-6,    units: "N/A²",      name: "vacuum permeability" },
          sigma:     { value: 5.670374419e-8,      units: "W/m²/K⁴",   name: "Stefan-Boltzmann constant" },
          R_inf:     { value: 1.097373156e7,       units: "1/m",       name: "Rydberg constant" },
        },
      },
    };
  });

  // ─── 2026 parity — PhET Interactive Simulations / Algodoo ─────────────────
  //
  // Adds a persistent scene editor, an authoritative server-side rigid-body
  // sim engine with extended body types (springs/joints/ramps/pendulums/
  // fluids), per-body time-series graphs, guided curriculum modules, a live
  // parameters panel, shareable scene export/import, and measurement tools.
  // All per-user persistent state lives in globalThis._concordSTATE.

  function getPhysState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.physicsLens) {
      STATE.physicsLens = {
        scenes: new Map(),  // userId -> Map<sceneId, scene>
        shares: new Map(),  // shareCode -> { ownerId, scene, createdAt }
      };
    }
    return STATE.physicsLens;
  }
  function savePhysState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function physActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextPhysId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIsoPhys() { return new Date().toISOString(); }
  const rnd = (v, p = 1000) => Math.round(v * p) / p;

  // Default per-scene physics settings (the live parameters panel mirrors this)
  function defaultSettings() {
    return {
      gravityX: 0, gravityY: 9.81, airDensity: 0,
      timeScale: 1, restitutionGlobal: null,
      wallBounce: true, bounds: { w: 800, h: 600 },
    };
  }

  // Normalise an inbound body so the engine always has a complete record.
  // Supported body.type: circle | box | ramp | fixed (anchor point)
  function normalizeBody(b, idx) {
    const type = ["circle", "box", "ramp", "fixed"].includes(b.type) ? b.type : "circle";
    return {
      id: b.id || `b_${idx}`,
      name: b.name || `Body ${idx + 1}`,
      type,
      x: Number(b.x) || 0, y: Number(b.y) || 0,
      vx: Number(b.vx) || 0, vy: Number(b.vy) || 0,
      mass: b.mass > 0 ? Number(b.mass) : 1,
      radius: b.radius > 0 ? Number(b.radius) : 20,
      w: b.w > 0 ? Number(b.w) : 40,
      h: b.h > 0 ? Number(b.h) : 40,
      angle: Number(b.angle) || 0,          // ramp incline, radians
      restitution: b.restitution != null ? clamp01(b.restitution) : 0.7,
      friction: b.friction != null ? clamp01(b.friction) : 0.1,
      isStatic: !!b.isStatic || type === "fixed" || type === "ramp",
      color: typeof b.color === "string" ? b.color : "#00ffff",
    };
  }
  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  // Supported constraint.type: spring | rod (rigid distance) | rope (max len) | pin
  function normalizeConstraint(c, idx) {
    const type = ["spring", "rod", "rope", "pin"].includes(c.type) ? c.type : "spring";
    return {
      id: c.id || `c_${idx}`,
      type,
      a: String(c.a ?? c.bodyA ?? ""),
      b: String(c.b ?? c.bodyB ?? ""),
      restLength: c.restLength != null ? Number(c.restLength) : 100,
      stiffness: c.stiffness != null ? clamp01(c.stiffness) : 0.5,
      damping: c.damping != null ? clamp01(c.damping) : 0.05,
    };
  }

  // ── Scene CRUD (the simulation editor's persistence layer) ──

  registerLensAction("physics", "scene-list", (ctx, _artifact, _params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.scenes.get(physActor(ctx));
    const scenes = map ? [...map.values()].map(sc => ({
      id: sc.id, name: sc.name, bodyCount: sc.bodies.length,
      constraintCount: sc.constraints.length, fluidCount: sc.fluids.length,
      updatedAt: sc.updatedAt, shareCode: sc.shareCode || null,
    })) : [];
    scenes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { ok: true, result: { scenes } };
  });

  registerLensAction("physics", "scene-save", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = physActor(ctx);
    if (!s.scenes.has(userId)) s.scenes.set(userId, new Map());
    const map = s.scenes.get(userId);
    const id = params.id && map.has(params.id) ? params.id : nextPhysId("scene");
    const bodies = Array.isArray(params.bodies) ? params.bodies.map(normalizeBody) : [];
    const constraints = Array.isArray(params.constraints)
      ? params.constraints.map(normalizeConstraint) : [];
    const fluids = Array.isArray(params.fluids) ? params.fluids.map((f, i) => ({
      id: f.id || `fl_${i}`,
      x: Number(f.x) || 0, y: Number(f.y) || 0,
      w: f.w > 0 ? Number(f.w) : 200, h: f.h > 0 ? Number(f.h) : 150,
      density: f.density > 0 ? Number(f.density) : 1.0,
      drag: f.drag != null ? clamp01(f.drag) : 0.4,
    })) : [];
    const prior = map.get(id);
    const scene = {
      id,
      name: typeof params.name === "string" && params.name.trim()
        ? params.name.trim() : (prior?.name || "Untitled Scene"),
      bodies, constraints, fluids,
      settings: { ...defaultSettings(), ...(params.settings || prior?.settings || {}) },
      createdAt: prior?.createdAt || nowIsoPhys(),
      updatedAt: nowIsoPhys(),
      shareCode: prior?.shareCode || null,
    };
    map.set(id, scene);
    savePhysState();
    return { ok: true, result: { scene } };
  });

  registerLensAction("physics", "scene-get", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.scenes.get(physActor(ctx));
    const scene = map?.get(String(params.id));
    if (!scene) return { ok: false, error: "scene not found" };
    return { ok: true, result: { scene } };
  });

  registerLensAction("physics", "scene-delete", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.scenes.get(physActor(ctx));
    if (!map || !map.has(String(params.id))) return { ok: false, error: "scene not found" };
    const scene = map.get(String(params.id));
    if (scene.shareCode) s.shares.delete(scene.shareCode);
    map.delete(String(params.id));
    savePhysState();
    return { ok: true, result: { deleted: String(params.id) } };
  });

  // ── Share / embed — turn a scene into a portable code others can load ──

  registerLensAction("physics", "scene-share", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = physActor(ctx);
    const map = s.scenes.get(userId);
    const scene = map?.get(String(params.id));
    if (!scene) return { ok: false, error: "scene not found" };
    if (!scene.shareCode) scene.shareCode = nextPhysId("phx").replace("phx_", "phx");
    s.shares.set(scene.shareCode, {
      ownerId: userId,
      scene: JSON.parse(JSON.stringify({
        name: scene.name, bodies: scene.bodies,
        constraints: scene.constraints, fluids: scene.fluids, settings: scene.settings,
      })),
      createdAt: nowIsoPhys(),
    });
    scene.updatedAt = nowIsoPhys();
    savePhysState();
    return {
      ok: true,
      result: {
        shareCode: scene.shareCode,
        embed: `/lenses/physics?scene=${scene.shareCode}`,
        portable: { spec: "concord-physics-scene/v1", ...s.shares.get(scene.shareCode).scene },
      },
    };
  });

  registerLensAction("physics", "scene-load-shared", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const code = String(params.shareCode || "");
    const shared = s.shares.get(code);
    if (!shared) return { ok: false, error: "share code not found" };
    const userId = physActor(ctx);
    if (!s.scenes.has(userId)) s.scenes.set(userId, new Map());
    const map = s.scenes.get(userId);
    const id = nextPhysId("scene");
    const scene = {
      id,
      name: `${shared.scene.name} (imported)`,
      bodies: shared.scene.bodies.map(normalizeBody),
      constraints: shared.scene.constraints.map(normalizeConstraint),
      fluids: Array.isArray(shared.scene.fluids) ? shared.scene.fluids : [],
      settings: { ...defaultSettings(), ...(shared.scene.settings || {}) },
      createdAt: nowIsoPhys(), updatedAt: nowIsoPhys(), shareCode: null,
    };
    map.set(id, scene);
    savePhysState();
    return { ok: true, result: { scene, importedFrom: code } };
  });

  // ── Authoritative rigid-body simulation engine ──
  //
  // Steps a full scene (bodies + constraints + fluids) and returns per-body
  // time-series so the frontend can render graphs over time. Handles every
  // extended body type: circles, boxes, static ramps, anchors, springs/rods/
  // ropes/pins, and fluid (buoyancy + drag) volumes.

  function simulateScene(scene, opts) {
    const settings = { ...defaultSettings(), ...(scene.settings || {}) };
    const dt = Math.max(1e-4, Math.min(opts.dt || 1 / 60, 0.1));
    const steps = Math.max(1, Math.min(opts.steps || 600, 5000));
    const substeps = Math.max(1, Math.min(opts.substeps || 4, 12));
    const sub = dt / substeps;
    const sample = Math.max(1, Math.floor(opts.sampleEvery || Math.ceil(steps / 240)));
    const gx = settings.gravityX, gy = settings.gravityY;
    const bounds = settings.bounds || { w: 800, h: 600 };

    const bodies = scene.bodies.map(b => ({ ...normalizeBody(b, scene.bodies.indexOf(b)) }));
    const byId = new Map(bodies.map(b => [b.id, b]));
    const constraints = (scene.constraints || []).map((c, i) => normalizeConstraint(c, i));
    const fluids = Array.isArray(scene.fluids) ? scene.fluids : [];
    const series = new Map(bodies.map(b => [b.id, []]));
    const energyTrace = [];
    const collisionEvents = [];

    function pointInFluid(b) {
      for (const f of fluids) {
        if (b.x >= f.x && b.x <= f.x + f.w && b.y >= f.y && b.y <= f.y + f.h) return f;
      }
      return null;
    }

    for (let step = 0; step <= steps; step++) {
      for (let ss = 0; ss < substeps; ss++) {
        // Integrate forces
        for (const b of bodies) {
          if (b.isStatic) continue;
          let ax = gx, ay = gy;
          // Fluid buoyancy + drag (Archimedes + quadratic drag)
          const fluid = pointInFluid(b);
          if (fluid) {
            const vol = Math.PI * b.radius * b.radius;       // 2D "area" proxy
            const bodyDensity = b.mass / Math.max(vol, 1e-6);
            ay -= gy * (fluid.density / Math.max(bodyDensity, 1e-6)); // buoyant accel
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > 1e-6) {
              const dragA = fluid.drag * sp;
              ax -= (b.vx / sp) * dragA;
              ay -= (b.vy / sp) * dragA;
            }
          } else if (settings.airDensity > 0) {
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > 1e-6) {
              const dragA = 0.5 * settings.airDensity * b.radius * sp * sp / b.mass;
              ax -= (b.vx / sp) * dragA;
              ay -= (b.vy / sp) * dragA;
            }
          }
          b.vx += ax * sub;
          b.vy += ay * sub;
        }
        // Move
        for (const b of bodies) {
          if (b.isStatic) continue;
          b.x += b.vx * sub;
          b.y += b.vy * sub;
        }
        // Constraints (position-based, iterated for stability)
        for (let it = 0; it < 3; it++) {
          for (const c of constraints) {
            const A = byId.get(c.a), B = byId.get(c.b);
            if (!A || !B) continue;
            const dx = B.x - A.x, dy = B.y - A.y;
            const dist = Math.hypot(dx, dy) || 1e-6;
            let target = c.restLength;
            let active = true;
            if (c.type === "rope") active = dist > c.restLength;       // only pulls
            if (c.type === "pin") target = 0;
            if (!active) continue;
            const stiff = (c.type === "rod" || c.type === "pin") ? 1 : c.stiffness;
            const diff = ((dist - target) / dist) * stiff;
            const invA = A.isStatic ? 0 : 1 / A.mass;
            const invB = B.isStatic ? 0 : 1 / B.mass;
            const wsum = invA + invB || 1;
            const ox = dx * diff, oy = dy * diff;
            if (invA) { A.x += ox * (invA / wsum); A.y += oy * (invA / wsum); }
            if (invB) { B.x -= ox * (invB / wsum); B.y -= oy * (invB / wsum); }
            // Spring damping bleeds relative velocity along the axis
            if (c.type === "spring" && c.damping > 0) {
              const nx = dx / dist, ny = dy / dist;
              const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
              const imp = rv * c.damping;
              if (invA) { A.vx += nx * imp * (invA / wsum); A.vy += ny * imp * (invA / wsum); }
              if (invB) { B.vx -= nx * imp * (invB / wsum); B.vy -= ny * imp * (invB / wsum); }
            }
          }
        }
        // Body-body collisions (circle approximation)
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i], b = bodies[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const min = a.radius + b.radius;
            if (dist >= min || dist < 1e-6) continue;
            const nx = dx / dist, ny = dy / dist;
            const overlap = min - dist;
            const invA = a.isStatic ? 0 : 1 / a.mass;
            const invB = b.isStatic ? 0 : 1 / b.mass;
            const wsum = invA + invB || 1;
            a.x -= nx * overlap * (invA / wsum);
            a.y -= ny * overlap * (invA / wsum);
            b.x += nx * overlap * (invB / wsum);
            b.y += ny * overlap * (invB / wsum);
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn > 0) continue;
            const e = settings.restitutionGlobal != null
              ? clamp01(settings.restitutionGlobal)
              : Math.min(a.restitution, b.restitution);
            const imp = -(1 + e) * rvn / wsum;
            if (invA) { a.vx -= imp * nx * invA; a.vy -= imp * ny * invA; }
            if (invB) { b.vx += imp * nx * invB; b.vy += imp * ny * invB; }
            collisionEvents.push({ step, a: a.id, b: b.id, impulse: rnd(Math.abs(imp)) });
          }
        }
        // Ramp / static incline interaction (project velocity along the slope)
        for (const r of bodies) {
          if (r.type !== "ramp") continue;
          const nx = -Math.sin(r.angle), ny = -Math.cos(r.angle);
          for (const b of bodies) {
            if (b.isStatic) continue;
            const rel = (b.x - r.x) * nx + (b.y - r.y) * ny;
            if (rel < b.radius && rel > -r.h) {
              const pen = b.radius - rel;
              b.x += nx * pen; b.y += ny * pen;
              const vn = b.vx * nx + b.vy * ny;
              if (vn < 0) {
                b.vx -= (1 + b.restitution) * vn * nx;
                b.vy -= (1 + b.restitution) * vn * ny;
              }
            }
          }
        }
        // Walls
        if (settings.wallBounce) {
          for (const b of bodies) {
            if (b.isStatic) continue;
            const r = b.radius;
            if (b.x - r < 0) { b.x = r; b.vx = -b.vx * b.restitution; }
            if (b.x + r > bounds.w) { b.x = bounds.w - r; b.vx = -b.vx * b.restitution; }
            if (b.y - r < 0) { b.y = r; b.vy = -b.vy * b.restitution; }
            if (b.y + r > bounds.h) { b.y = bounds.h - r; b.vy = -b.vy * b.restitution; }
          }
        }
      }
      // Sample time-series for graphs
      if (step % sample === 0 || step === steps) {
        const t = rnd(step * dt, 1e5);
        let ke = 0, pe = 0;
        for (const b of bodies) {
          const speed = Math.hypot(b.vx, b.vy);
          if (!b.isStatic) {
            ke += 0.5 * b.mass * speed * speed;
            pe += b.mass * gy * Math.max(0, bounds.h - b.y);
          }
          series.get(b.id).push({
            t, x: rnd(b.x), y: rnd(b.y),
            vx: rnd(b.vx), vy: rnd(b.vy), speed: rnd(speed),
          });
        }
        energyTrace.push({ t, kinetic: rnd(ke), potential: rnd(pe), total: rnd(ke + pe) });
      }
    }

    const perBody = bodies.map(b => ({
      id: b.id, name: b.name, type: b.type,
      final: { x: rnd(b.x), y: rnd(b.y), vx: rnd(b.vx), vy: rnd(b.vy) },
      maxSpeed: rnd(Math.max(...series.get(b.id).map(p => p.speed), 0)),
      series: series.get(b.id),
    }));
    return {
      duration: rnd(steps * dt, 1e5),
      sampleCount: energyTrace.length,
      bodies: perBody,
      energyTrace,
      collisions: collisionEvents.length,
      energyDrift: energyTrace.length > 1
        ? rnd(energyTrace[energyTrace.length - 1].total - energyTrace[0].total)
        : 0,
    };
  }

  // ── Step a free-form scene (no persistence needed) ──

  registerLensAction("physics", "simulate-scene", (_ctx, _artifact, params = {}) => {
    const bodies = Array.isArray(params.bodies) ? params.bodies : [];
    if (bodies.length === 0) return { ok: false, error: "scene needs at least one body" };
    const scene = {
      bodies,
      constraints: Array.isArray(params.constraints) ? params.constraints : [],
      fluids: Array.isArray(params.fluids) ? params.fluids : [],
      settings: params.settings || {},
    };
    try {
      const result = simulateScene(scene, {
        dt: params.dt, steps: params.steps,
        substeps: params.substeps, sampleEvery: params.sampleEvery,
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Step a persisted scene by id (editor → run) ──

  registerLensAction("physics", "scene-run", (ctx, _artifact, params = {}) => {
    const s = getPhysState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.scenes.get(physActor(ctx));
    const scene = map?.get(String(params.id));
    if (!scene) return { ok: false, error: "scene not found" };
    try {
      const result = simulateScene(scene, {
        dt: params.dt, steps: params.steps,
        substeps: params.substeps, sampleEvery: params.sampleEvery,
      });
      return { ok: true, result: { sceneId: scene.id, name: scene.name, ...result } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Measurement tools — ruler / protractor / force vectors ──
  //
  // Pure geometry helpers the frontend overlay calls when the user drops a
  // ruler endpoint, a protractor vertex, or queries the force on a body.

  registerLensAction("physics", "measure", (_ctx, _artifact, params = {}) => {
    const tool = String(params.tool || "ruler");
    if (tool === "ruler") {
      const a = params.a || {}, b = params.b || {};
      const dx = (Number(b.x) || 0) - (Number(a.x) || 0);
      const dy = (Number(b.y) || 0) - (Number(a.y) || 0);
      const px = Math.hypot(dx, dy);
      const scale = Number(params.pixelsPerMeter) > 0 ? Number(params.pixelsPerMeter) : 50;
      return {
        ok: true,
        result: {
          tool, pixels: rnd(px), meters: rnd(px / scale),
          angleDeg: rnd(Math.atan2(dy, dx) * 180 / Math.PI, 100),
          components: { dx: rnd(dx), dy: rnd(dy) },
        },
      };
    }
    if (tool === "protractor") {
      const v = params.vertex || {}, a = params.a || {}, b = params.b || {};
      const a1 = Math.atan2((Number(a.y) || 0) - (Number(v.y) || 0), (Number(a.x) || 0) - (Number(v.x) || 0));
      const a2 = Math.atan2((Number(b.y) || 0) - (Number(v.y) || 0), (Number(b.x) || 0) - (Number(v.x) || 0));
      let deg = (a2 - a1) * 180 / Math.PI;
      while (deg < 0) deg += 360;
      while (deg > 360) deg -= 360;
      const interior = deg > 180 ? 360 - deg : deg;
      return { ok: true, result: { tool, angleDeg: rnd(deg, 100), interiorDeg: rnd(interior, 100) } };
    }
    if (tool === "force") {
      // Resolve net force on a body given mass, gravity, and applied forces
      const mass = Number(params.mass) > 0 ? Number(params.mass) : 1;
      const g = params.gravity != null ? Number(params.gravity) : 9.81;
      const applied = Array.isArray(params.forces) ? params.forces : [];
      let fx = 0, fy = mass * g;
      const breakdown = [{ label: "weight", fx: 0, fy: rnd(mass * g) }];
      for (const f of applied) {
        const mag = Number(f.magnitude) || 0;
        const ang = (Number(f.angleDeg) || 0) * Math.PI / 180;
        const cx = mag * Math.cos(ang), cy = mag * Math.sin(ang);
        fx += cx; fy += cy;
        breakdown.push({ label: f.label || "applied", fx: rnd(cx), fy: rnd(cy) });
      }
      const net = Math.hypot(fx, fy);
      return {
        ok: true,
        result: {
          tool, netForce: rnd(net),
          components: { fx: rnd(fx), fy: rnd(fy) },
          netAngleDeg: rnd(Math.atan2(fy, fx) * 180 / Math.PI, 100),
          acceleration: rnd(net / mass),
          breakdown,
        },
      };
    }
    return { ok: false, error: `unknown tool "${tool}". use: ruler, protractor, force` };
  });

  // ── Curriculum simulations — guided PhET-style learning modules ──
  //
  // Each module is a real, runnable scene plus a step-by-step learning
  // script. The frontend lists them, loads the scene into the editor, and
  // walks the learner through the steps.

  function curriculumModules() {
    return [
      {
        id: "pendulum-lab",
        title: "Pendulum Lab",
        topic: "Oscillation & Energy",
        difficulty: "intro",
        description: "Discover that a pendulum's period depends on length, not mass.",
        steps: [
          "Observe the swinging pendulum — note the rod constraint holds the bob.",
          "Period T = 2π√(L/g). Change the rod length and re-run.",
          "Increase the bob mass — confirm the period is unchanged.",
          "Watch the energy graph: KE and PE trade off, total stays flat.",
        ],
        scene: {
          name: "Pendulum Lab",
          settings: { gravityY: 9.81, wallBounce: false, bounds: { w: 800, h: 600 } },
          bodies: [
            { id: "anchor", name: "Pivot", type: "fixed", x: 400, y: 80, radius: 6 },
            { id: "bob", name: "Bob", type: "circle", x: 560, y: 80, radius: 24, mass: 4, restitution: 0.4 },
          ],
          constraints: [{ id: "rod", type: "rod", a: "anchor", b: "bob", restLength: 160 }],
          fluids: [],
        },
      },
      {
        id: "ramp-energy",
        title: "Ramp & Energy Conservation",
        topic: "Kinematics & Energy",
        difficulty: "intro",
        description: "Roll a body down an incline and track potential → kinetic energy.",
        steps: [
          "A circle starts at rest above a 30° ramp.",
          "Gravity pulls it down; the ramp redirects motion along the slope.",
          "Read the energy graph — PE falls as KE rises.",
          "Increase ramp angle and observe a faster KE gain.",
        ],
        scene: {
          name: "Ramp & Energy",
          settings: { gravityY: 9.81, wallBounce: true, bounds: { w: 800, h: 600 } },
          bodies: [
            { id: "ramp", name: "Ramp", type: "ramp", x: 250, y: 420, angle: 0.52, w: 360, h: 24 },
            { id: "ball", name: "Roller", type: "circle", x: 180, y: 120, radius: 22, mass: 3, restitution: 0.3 },
          ],
          constraints: [], fluids: [],
        },
      },
      {
        id: "spring-mass",
        title: "Spring-Mass Oscillator",
        topic: "Simple Harmonic Motion",
        difficulty: "core",
        description: "A mass on a spring — explore Hooke's law and SHM.",
        steps: [
          "The spring connects a fixed anchor to a hanging mass.",
          "Displacement from rest length creates a restoring force F = -kx.",
          "Run the sim and read the sinusoidal position graph.",
          "Raise the spring stiffness — the oscillation frequency increases.",
        ],
        scene: {
          name: "Spring-Mass Oscillator",
          settings: { gravityY: 9.81, wallBounce: false, bounds: { w: 800, h: 600 } },
          bodies: [
            { id: "anchor", name: "Anchor", type: "fixed", x: 400, y: 100, radius: 6 },
            { id: "mass", name: "Mass", type: "circle", x: 400, y: 320, radius: 26, mass: 5 },
          ],
          constraints: [{ id: "spr", type: "spring", a: "anchor", b: "mass", restLength: 140, stiffness: 0.4, damping: 0.01 }],
          fluids: [],
        },
      },
      {
        id: "buoyancy-tank",
        title: "Buoyancy Tank",
        topic: "Fluid Statics",
        difficulty: "core",
        description: "Drop dense and light bodies into a fluid — watch Archimedes' principle.",
        steps: [
          "Two bodies fall toward a fluid volume.",
          "The light body floats — buoyant force exceeds its weight.",
          "The dense body sinks — its weight exceeds buoyancy.",
          "Fluid drag damps both bodies' velocity.",
        ],
        scene: {
          name: "Buoyancy Tank",
          settings: { gravityY: 9.81, wallBounce: true, bounds: { w: 800, h: 600 } },
          bodies: [
            { id: "cork", name: "Cork", type: "circle", x: 320, y: 120, radius: 26, mass: 0.4 },
            { id: "stone", name: "Stone", type: "circle", x: 480, y: 120, radius: 26, mass: 12 },
          ],
          constraints: [],
          fluids: [{ id: "water", x: 200, y: 360, w: 400, h: 220, density: 1.0, drag: 0.5 }],
        },
      },
      {
        id: "collision-lab",
        title: "Elastic Collision Lab",
        topic: "Momentum Conservation",
        difficulty: "core",
        description: "Two carts collide — verify momentum is conserved.",
        steps: [
          "A moving cart approaches a stationary one.",
          "On impact, momentum transfers (restitution near 1 = elastic).",
          "Read both speed graphs — total momentum stays constant.",
          "Lower restitution and watch kinetic energy dissipate.",
        ],
        scene: {
          name: "Elastic Collision Lab",
          settings: { gravityY: 0, wallBounce: true, bounds: { w: 800, h: 400 } },
          bodies: [
            { id: "cartA", name: "Cart A", type: "circle", x: 150, y: 200, radius: 30, mass: 2, vx: 120, restitution: 0.98 },
            { id: "cartB", name: "Cart B", type: "circle", x: 500, y: 200, radius: 30, mass: 2, vx: 0, restitution: 0.98 },
          ],
          constraints: [], fluids: [],
        },
      },
    ];
  }

  registerLensAction("physics", "curriculum-list", (_ctx, _artifact, _params = {}) => {
    return {
      ok: true,
      result: {
        modules: curriculumModules().map(m => ({
          id: m.id, title: m.title, topic: m.topic,
          difficulty: m.difficulty, description: m.description, stepCount: m.steps.length,
        })),
      },
    };
  });

  registerLensAction("physics", "curriculum-get", (_ctx, _artifact, params = {}) => {
    const mod = curriculumModules().find(m => m.id === String(params.id));
    if (!mod) return { ok: false, error: "module not found" };
    return { ok: true, result: { module: mod } };
  });

  // Pendulum analytic helper — backs the "predict then verify" curriculum loop
  registerLensAction("physics", "pendulum-period", (_ctx, _artifact, params = {}) => {
    const L = Number(params.length);
    const g = params.gravity != null ? Number(params.gravity) : 9.81;
    const amplitudeDeg = Number(params.amplitudeDeg) || 0;
    if (!Number.isFinite(L) || L <= 0) return { ok: false, error: "length must be > 0" };
    const small = 2 * Math.PI * Math.sqrt(L / g);
    // First-order amplitude correction: T ≈ T₀(1 + θ₀²/16)
    const theta = amplitudeDeg * Math.PI / 180;
    const corrected = small * (1 + (theta * theta) / 16);
    return {
      ok: true,
      result: {
        smallAnglePeriod_s: rnd(small, 1e4),
        correctedPeriod_s: rnd(corrected, 1e4),
        frequency_hz: rnd(1 / small, 1e4),
        angularFrequency: rnd(Math.sqrt(g / L), 1e4),
        inputs: { length: L, gravity: g, amplitudeDeg },
      },
    };
  });
}
