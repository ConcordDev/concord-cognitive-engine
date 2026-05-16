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
}
