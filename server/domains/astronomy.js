// server/domains/astronomy.js
// Domain actions for astronomy: celestial position calculation, magnitude estimation,
// observation planning, light travel time, orbital mechanics.

export default function registerAstronomyActions(registerLensAction) {
  registerLensAction("astronomy", "celestialPosition", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const ra = parseFloat(data.rightAscension) || 0; // hours
    const dec = parseFloat(data.declination) || 0; // degrees
    const lat = parseFloat(data.latitude) || 40.7; // observer latitude
    const lon = parseFloat(data.longitude) || -74.0;
    const now = new Date();
    // Simplified altitude calculation
    const lst = (now.getUTCHours() + now.getUTCMinutes() / 60 + lon / 15) % 24; // Local Sidereal Time approx
    const hourAngle = (lst - ra) * 15; // degrees
    const latRad = lat * Math.PI / 180, decRad = dec * Math.PI / 180, haRad = hourAngle * Math.PI / 180;
    const altitude = Math.asin(Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)) * 180 / Math.PI;
    const azimuth = Math.atan2(-Math.sin(haRad), Math.cos(latRad) * Math.tan(decRad) - Math.sin(latRad) * Math.cos(haRad)) * 180 / Math.PI;
    return { ok: true, result: { object: data.name || artifact.title, ra: `${ra}h`, dec: `${dec}°`, altitude: Math.round(altitude * 10) / 10, azimuth: Math.round(((azimuth + 360) % 360) * 10) / 10, visible: altitude > 0, bestViewing: altitude > 30 ? "excellent" : altitude > 15 ? "good" : altitude > 0 ? "low-on-horizon" : "below-horizon", observerLocation: { lat, lon } } };
  });

  registerLensAction("astronomy", "planObservation", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const targets = data.targets || [];
    if (targets.length === 0) return { ok: true, result: { message: "Add observation targets with RA/Dec coordinates." } };
    const moonPhase = ((new Date().getTime() / 86400000 - 10) % 29.53) / 29.53; // approximate
    const moonIllumination = Math.round(Math.abs(Math.cos(moonPhase * 2 * Math.PI)) * 100);
    const darknessFactor = moonIllumination < 25 ? "excellent" : moonIllumination < 50 ? "good" : moonIllumination < 75 ? "fair" : "poor";
    const planned = targets.map(t => ({ name: t.name, type: t.type || "star", magnitude: parseFloat(t.magnitude) || 0, difficulty: parseFloat(t.magnitude) > 6 ? "telescope-only" : parseFloat(t.magnitude) > 4 ? "binoculars" : "naked-eye", priority: parseFloat(t.magnitude) <= 2 ? "high" : "medium" }));
    return { ok: true, result: { moonIllumination: `${moonIllumination}%`, darknessFactor, targets: planned, bestTargets: planned.filter(t => t.difficulty === "naked-eye"), equipmentNeeded: planned.some(t => t.difficulty === "telescope-only") ? "Telescope recommended" : "Binoculars sufficient" } };
  });

  registerLensAction("astronomy", "lightTravelTime", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const distanceLY = parseFloat(data.distanceLightYears) || 0;
    const distancePC = parseFloat(data.distanceParsecs) || 0;
    const distanceAU = parseFloat(data.distanceAU) || 0;
    const lyFinal = distanceLY || distancePC * 3.2616 || distanceAU * 0.0000158;
    if (lyFinal === 0) return { ok: true, result: { message: "Provide distance in light-years, parsecs, or AU." } };
    const lightSpeed = 299792.458; // km/s
    const seconds = lyFinal * 365.25 * 86400;
    const km = lyFinal * 9.461e12;
    return { ok: true, result: { object: data.name || artifact.title, distanceLightYears: Math.round(lyFinal * 1000) / 1000, distanceParsecs: Math.round(lyFinal / 3.2616 * 1000) / 1000, distanceKm: km.toExponential(3), travelTimeLight: lyFinal < 0.001 ? `${Math.round(seconds)} seconds` : lyFinal < 1 ? `${Math.round(lyFinal * 365.25)} days` : `${Math.round(lyFinal * 100) / 100} years`, lookbackTime: `We see this object as it was ${Math.round(lyFinal * 100) / 100} years ago` } };
  });

  registerLensAction("astronomy", "orbitalMechanics", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const semiMajorAU = parseFloat(data.semiMajorAxis) || 1; // AU
    const eccentricity = parseFloat(data.eccentricity) || 0;
    const massSolar = parseFloat(data.centralMass) || 1; // solar masses
    // Kepler's third law: T² = a³/M (years, AU, solar masses)
    const periodYears = Math.sqrt(Math.pow(semiMajorAU, 3) / massSolar);
    const perihelion = semiMajorAU * (1 - eccentricity);
    const aphelion = semiMajorAU * (1 + eccentricity);
    const orbitalVelocity = 29.78 / Math.sqrt(semiMajorAU); // km/s, simplified
    return { ok: true, result: { object: data.name || artifact.title, semiMajorAxisAU: semiMajorAU, eccentricity, periodYears: Math.round(periodYears * 1000) / 1000, periodDays: Math.round(periodYears * 365.25 * 10) / 10, perihelionAU: Math.round(perihelion * 1000) / 1000, aphelionAU: Math.round(aphelion * 1000) / 1000, avgOrbitalVelocityKmS: Math.round(orbitalVelocity * 10) / 10, orbitType: eccentricity < 0.05 ? "nearly-circular" : eccentricity < 0.5 ? "elliptical" : "highly-eccentric" } };
  });
}
