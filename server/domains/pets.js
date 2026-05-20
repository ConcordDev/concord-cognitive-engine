// server/domains/pets.js
// Domain actions for pet management: vaccination schedules, weight tracking,
// feeding plans, vet cost analysis, medication reminders, activity scoring.

export default function registerPetsActions(registerLensAction) {
  /**
   * vaccinationSchedule
   * Calculate upcoming vaccinations based on species, age, and vaccination history.
   * artifact.data: { species, breed, age, vaccinations: [{ type, date, expiry }] }
   */
  registerLensAction("pets", "vaccinationSchedule", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const species = (data.species || "dog").toLowerCase();
    const ageYears = parseFloat(data.age) || 1;
    const vaccinations = data.vaccinations || [];

    // Core vaccination schedules by species
    const schedules = {
      dog: [
        { type: "Rabies", intervalMonths: 12, required: true, startAge: 0.25 },
        { type: "DHPP", intervalMonths: 12, required: true, startAge: 0.17 },
        { type: "Bordetella", intervalMonths: 6, required: false, startAge: 0.17 },
        { type: "Leptospirosis", intervalMonths: 12, required: false, startAge: 0.25 },
        { type: "Canine Influenza", intervalMonths: 12, required: false, startAge: 0.5 },
        { type: "Lyme", intervalMonths: 12, required: false, startAge: 0.25 },
      ],
      cat: [
        { type: "Rabies", intervalMonths: 12, required: true, startAge: 0.25 },
        { type: "FVRCP", intervalMonths: 12, required: true, startAge: 0.17 },
        { type: "FeLV", intervalMonths: 12, required: false, startAge: 0.17 },
      ],
      rabbit: [
        { type: "RHDV2", intervalMonths: 12, required: true, startAge: 0.25 },
        { type: "Myxomatosis", intervalMonths: 6, required: false, startAge: 0.25 },
      ],
    };

    const speciesSchedule = schedules[species] || schedules.dog;
    const now = new Date();

    const results = speciesSchedule.map(vaccine => {
      const lastVax = vaccinations
        .filter(v => v.type === vaccine.type || v.vaccineType === vaccine.type)
        .sort((a, b) => new Date(b.date || b.vaccineDate || 0).getTime() - new Date(a.date || a.vaccineDate || 0).getTime())[0];

      let status;
      let nextDue;
      let daysUntilDue;

      if (lastVax) {
        const lastDate = new Date(lastVax.date || lastVax.vaccineDate);
        const expiryDate = lastVax.expiry || lastVax.vaccineExpiry
          ? new Date(lastVax.expiry || lastVax.vaccineExpiry)
          : new Date(lastDate.getTime() + vaccine.intervalMonths * 30.44 * 86400000);

        if (expiryDate > now) {
          status = "current";
          nextDue = expiryDate.toISOString().split("T")[0];
          daysUntilDue = Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000);
        } else {
          status = "overdue";
          nextDue = "ASAP";
          daysUntilDue = -Math.ceil((now.getTime() - expiryDate.getTime()) / 86400000);
        }
      } else if (ageYears >= vaccine.startAge) {
        status = "overdue";
        nextDue = "ASAP";
        daysUntilDue = 0;
      } else {
        status = "not-yet-eligible";
        const eligibleDate = new Date(now.getTime() + (vaccine.startAge - ageYears) * 365.25 * 86400000);
        nextDue = eligibleDate.toISOString().split("T")[0];
        daysUntilDue = Math.ceil((eligibleDate.getTime() - now.getTime()) / 86400000);
      }

      return {
        vaccine: vaccine.type,
        required: vaccine.required,
        intervalMonths: vaccine.intervalMonths,
        status,
        nextDue,
        daysUntilDue,
        lastGiven: lastVax ? (lastVax.date || lastVax.vaccineDate) : null,
      };
    });

    const overdueCount = results.filter(r => r.status === "overdue").length;
    const currentCount = results.filter(r => r.status === "current").length;

    return {
      ok: true,
      result: {
        species,
        ageYears,
        vaccinations: results,
        summary: {
          total: results.length,
          current: currentCount,
          overdue: overdueCount,
          complianceRate: results.length > 0
            ? Math.round((currentCount / results.filter(r => r.status !== "not-yet-eligible").length) * 100) || 0
            : 100,
        },
        urgentAction: overdueCount > 0
          ? `${overdueCount} vaccination(s) overdue — schedule vet visit immediately`
          : "All vaccinations current",
      },
    };
  });

  /**
   * weightTracker
   * Analyze weight history, calculate BMI-equivalent, flag concerning trends.
   * artifact.data: { species, breed, weight, weightHistory: [{ date, weight }] }
   */
  registerLensAction("pets", "weightTracker", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const species = (data.species || "dog").toLowerCase();
    const currentWeight = parseFloat(data.weight) || 0;
    const history = (data.weightHistory || []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Ideal weight ranges by species (lbs)
    const idealRanges = {
      dog: { min: 5, max: 100, note: "Varies greatly by breed" },
      cat: { min: 6, max: 14, note: "Most adult cats 8-11 lbs" },
      rabbit: { min: 2, max: 11, note: "Varies by breed" },
      bird: { min: 0.01, max: 3, note: "Varies by species" },
      fish: { min: 0, max: 0, note: "N/A" },
      hamster: { min: 0.06, max: 0.15, note: "Syrian hamsters 5-7 oz" },
    };

    const range = idealRanges[species] || idealRanges.dog;

    // Weight trend analysis
    let trend = "stable";
    let weeklyChange = 0;
    if (history.length >= 2) {
      const recent = history.slice(-5);
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const daysDiff = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / 86400000;
      if (daysDiff > 0) {
        const totalChange = parseFloat(newest.weight) - parseFloat(oldest.weight);
        weeklyChange = Math.round((totalChange / daysDiff) * 7 * 100) / 100;
        if (weeklyChange > 0.5) trend = "gaining";
        else if (weeklyChange < -0.5) trend = "losing";
      }
    }

    // Body condition assessment
    let condition = "normal";
    if (species === "cat" && currentWeight > 14) condition = "overweight";
    else if (species === "cat" && currentWeight < 6) condition = "underweight";
    else if (species === "dog" && currentWeight > range.max * 1.2) condition = "overweight";

    const alerts = [];
    if (condition === "overweight") alerts.push("Weight above ideal range — consult vet about diet plan");
    if (condition === "underweight") alerts.push("Weight below ideal range — monitor food intake and health");
    if (Math.abs(weeklyChange) > 2) alerts.push(`Rapid weight change detected: ${weeklyChange > 0 ? "+" : ""}${weeklyChange} lbs/week`);

    return {
      ok: true,
      result: {
        currentWeight,
        species,
        idealRange: range,
        trend,
        weeklyChange,
        condition,
        historyCount: history.length,
        alerts,
        recommendation: alerts.length > 0
          ? "Schedule a vet check-up to discuss weight concerns"
          : "Weight appears healthy — continue current care routine",
      },
    };
  });

  /**
   * feedingPlan
   * Generate a feeding plan based on species, weight, age, and activity level.
   * artifact.data: { species, weight, age, activityLevel, food, currentPortions }
   */
  registerLensAction("pets", "feedingPlan", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const species = (data.species || "dog").toLowerCase();
    const weight = parseFloat(data.weight) || 10;
    const age = parseFloat(data.age) || 1;
    const activity = (data.activityLevel || data.intensity || "moderate").toLowerCase();

    // Caloric needs calculation (simplified RER * activity factor)
    let rer = 0; // Resting Energy Requirement
    if (species === "dog" || species === "cat") {
      rer = 70 * Math.pow(weight / 2.205, 0.75); // weight in kg
    }

    const activityMultipliers = {
      low: 1.2, moderate: 1.4, high: 1.8, puppy: 2.0, senior: 1.1, pregnant: 1.8, nursing: 2.5,
    };

    let lifeStage = activity;
    if (age < 1) lifeStage = "puppy";
    else if ((species === "dog" && age > 7) || (species === "cat" && age > 10)) lifeStage = "senior";

    const multiplier = activityMultipliers[lifeStage] || activityMultipliers[activity] || 1.4;
    const dailyCalories = Math.round(rer * multiplier);

    // Portion sizing (assuming ~350 cal per cup for dry food)
    const calPerCup = 350;
    const cupsPerDay = Math.round((dailyCalories / calPerCup) * 10) / 10;
    const mealsPerDay = age < 0.5 ? 4 : age < 1 ? 3 : 2;
    const cupsPerMeal = Math.round((cupsPerDay / mealsPerDay) * 10) / 10;

    // Water needs (roughly 1 oz per lb body weight per day)
    const waterOzPerDay = Math.round(weight);

    return {
      ok: true,
      result: {
        species,
        weight,
        ageYears: age,
        lifeStage,
        activityLevel: activity,
        dailyCalories,
        portions: {
          cupsPerDay,
          mealsPerDay,
          cupsPerMeal,
          note: `Based on ~${calPerCup} cal/cup dry food. Adjust for wet food or treats.`,
        },
        hydration: {
          waterOzPerDay,
          waterMlPerDay: Math.round(waterOzPerDay * 29.574),
        },
        tips: [
          lifeStage === "puppy" ? "Puppies need more frequent, smaller meals" : null,
          lifeStage === "senior" ? "Seniors may benefit from joint-support supplements" : null,
          activity === "high" ? "Active pets need 20-40% more calories" : null,
          "Always provide fresh water throughout the day",
          "Adjust portions based on body condition — ribs should be easily felt",
        ].filter(Boolean),
      },
    };
  });

  /**
   * vetCostAnalysis
   * Analyze veterinary expenses, project annual costs, identify savings.
   * artifact.data: { expenses: [{ date, category, amount, vendor, description }] }
   */
  registerLensAction("pets", "vetCostAnalysis", (ctx, artifact, _params) => {
    const expenses = artifact.data?.expenses || [];
    if (expenses.length === 0) {
      return { ok: true, result: { message: "No expense data — add vet visits and purchases to analyze costs." } };
    }

    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365.25 * 86400000);

    const annual = expenses.filter(e => new Date(e.date || e.receiptDate) >= oneYearAgo);
    const byCategory = {};
    let totalAnnual = 0;

    for (const exp of annual) {
      const cat = exp.category || "Other";
      const amt = parseFloat(exp.amount) || 0;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
      byCategory[cat].total += amt;
      byCategory[cat].count++;
      totalAnnual += amt;
    }

    // Sort categories by spend
    const ranked = Object.entries(byCategory)
      .map(([category, data]) => ({
        category,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        percentage: Math.round((data.total / totalAnnual) * 100),
      }))
      .sort((a, b) => b.total - a.total);

    // Monthly burn rate
    const months = Math.max(1, Math.ceil((now.getTime() - new Date(annual[0]?.date || annual[0]?.receiptDate || now).getTime()) / (30.44 * 86400000)));
    const monthlyAvg = Math.round((totalAnnual / months) * 100) / 100;

    return {
      ok: true,
      result: {
        annualTotal: Math.round(totalAnnual * 100) / 100,
        monthlyAverage: monthlyAvg,
        projectedAnnual: Math.round(monthlyAvg * 12 * 100) / 100,
        expenseCount: annual.length,
        byCategory: ranked,
        topCategory: ranked[0]?.category || "N/A",
        savings: [
          ranked.find(r => r.category === "Food") && ranked.find(r => r.category === "Food").total > 500
            ? "Consider bulk buying food to reduce per-unit cost" : null,
          ranked.find(r => r.category === "Grooming") && ranked.find(r => r.category === "Grooming").total > 300
            ? "Learning basic grooming could save $200+/year" : null,
          "Pet insurance can cap unexpected vet bills — compare plans",
          "Preventive care (vaccines, dental) prevents expensive emergencies",
        ].filter(Boolean),
      },
    };
  });

  /**
   * medicationReminder
   * Analyze medication schedule and flag missed/upcoming doses.
   * artifact.data: { medications: string (comma-separated), schedules: [{ med, frequency, lastDose }] }
   */
  registerLensAction("pets", "medicationReminder", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const medList = (data.medications || "").split(",").map(m => m.trim()).filter(Boolean);
    const schedules = data.schedules || [];

    if (medList.length === 0 && schedules.length === 0) {
      return { ok: true, result: { message: "No medications tracked. Add medications to get reminders." } };
    }

    const now = new Date();
    const reminders = medList.map(med => {
      const schedule = schedules.find(s => s.med === med);
      if (!schedule) return { medication: med, status: "unscheduled", action: "Set up dosing schedule" };

      const lastDose = schedule.lastDose ? new Date(schedule.lastDose) : null;
      const freq = (schedule.frequency || "daily").toLowerCase();
      const intervalHours = freq === "daily" ? 24 : freq === "twice-daily" ? 12 : freq === "weekly" ? 168 : 24;

      if (!lastDose) return { medication: med, status: "no-record", action: "Record first dose" };

      const nextDue = new Date(lastDose.getTime() + intervalHours * 3600000);
      const hoursUntil = (nextDue.getTime() - now.getTime()) / 3600000;

      return {
        medication: med,
        frequency: freq,
        lastDose: lastDose.toISOString(),
        nextDue: nextDue.toISOString(),
        hoursUntilDue: Math.round(hoursUntil * 10) / 10,
        status: hoursUntil < -2 ? "overdue" : hoursUntil < 2 ? "due-now" : "on-track",
        action: hoursUntil < -2 ? "OVERDUE — administer immediately" : hoursUntil < 2 ? "Due now" : `Next dose in ${Math.round(hoursUntil)} hours`,
      };
    });

    return {
      ok: true,
      result: {
        medications: reminders,
        overdue: reminders.filter(r => r.status === "overdue").length,
        dueNow: reminders.filter(r => r.status === "due-now").length,
        onTrack: reminders.filter(r => r.status === "on-track").length,
      },
    };
  });

  /**
   * activityScore
   * Score pet's activity level and recommend exercise adjustments.
   * artifact.data: { species, age, weight, activities: [{ type, duration, date }] }
   */
  registerLensAction("pets", "activityScore", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const species = (data.species || "dog").toLowerCase();
    const age = parseFloat(data.age) || 3;
    const weight = parseFloat(data.weight) || 20;
    const activities = data.activities || [];

    // Recommended daily exercise by species (minutes)
    const dailyTargets = {
      dog: age < 1 ? 30 : age > 7 ? 30 : 60,
      cat: 15,
      rabbit: 20,
      bird: 10,
      hamster: 15,
    };
    const target = dailyTargets[species] || 30;

    // Analyze last 7 days
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const recentActivities = activities.filter(a => new Date(a.date) >= weekAgo);
    const totalMinutes = recentActivities.reduce((s, a) => s + (parseFloat(a.duration) || 0), 0);
    const dailyAvg = Math.round(totalMinutes / 7);
    const score = Math.min(100, Math.round((dailyAvg / target) * 100));

    const typeBreakdown = {};
    for (const a of recentActivities) {
      const t = a.type || a.activityType || "Other";
      typeBreakdown[t] = (typeBreakdown[t] || 0) + (parseFloat(a.duration) || 0);
    }

    return {
      ok: true,
      result: {
        score,
        rating: score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Needs Improvement" : "Insufficient",
        dailyAverage: dailyAvg,
        dailyTarget: target,
        weeklyTotal: totalMinutes,
        activitiesThisWeek: recentActivities.length,
        typeBreakdown,
        recommendations: [
          score < 60 ? `Increase daily activity by ${target - dailyAvg} minutes` : null,
          species === "dog" && !typeBreakdown["Walk"] ? "Add daily walks — most important exercise for dogs" : null,
          species === "cat" && score < 50 ? "Interactive toys and laser pointers boost cat exercise" : null,
          age > 7 ? "Gentler exercises like slow walks and swimming for seniors" : null,
          "Consistency matters more than intensity",
        ].filter(Boolean),
      },
    };
  });

  // ── Real breed APIs (The Dog API + The Cat API) ──
  // Both run by TheCatAPI/TheDogAPI; no API key needed for breed
  // metadata. Set THE_DOG_API_KEY / THE_CAT_API_KEY env to raise the
  // free-tier rate limit (currently 10k req/month anonymous).

  /**
   * breed-info — Lookup breed metadata for dogs or cats.
   * Returns name, temperament, life span, weight, origin, hypoallergenic,
   * Wikipedia URL, and a reference image when available.
   * params: { species: "dog"|"cat", name: string }
   */
  registerLensAction("pets", "breed-info", async (_ctx, _artifact, params = {}) => {
    const species = String(params.species || "").toLowerCase();
    const name = String(params.name || "").trim();
    if (!["dog", "cat"].includes(species)) return { ok: false, error: "species must be 'dog' or 'cat'" };
    if (!name) return { ok: false, error: "name required" };
    const base = species === "dog" ? "https://api.thedogapi.com/v1" : "https://api.thecatapi.com/v1";
    try {
      const r = await fetch(`${base}/breeds/search?q=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`${species}api ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: false, error: `breed not found: ${name}` };
      }
      const breeds = data.map((b) => ({
        id: b.id, name: b.name,
        bredFor: b.bred_for, breedGroup: b.breed_group,
        lifeSpan: b.life_span, temperament: b.temperament,
        origin: b.origin, countryCode: b.country_code,
        weightImperial: b.weight?.imperial, weightMetric: b.weight?.metric,
        heightImperial: b.height?.imperial, heightMetric: b.height?.metric,
        description: b.description,
        hypoallergenic: b.hypoallergenic === 1 || b.hypoallergenic === true,
        wikipediaUrl: b.wikipedia_url,
        referenceImageId: b.reference_image_id,
        referenceImageUrl: b.reference_image_id
          ? `https://cdn2.${species === "dog" ? "thedogapi" : "thecatapi"}.com/images/${b.reference_image_id}.jpg`
          : null,
      }));
      return {
        ok: true,
        result: { species, query: name, breeds, count: breeds.length, source: `the-${species}-api` },
      };
    } catch (e) {
      return { ok: false, error: `${species}api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * breeds-all — Full breed catalog. Useful for UI breed-picker dropdowns.
   * params: { species: "dog"|"cat", limit?: 1-200 }
   */
  registerLensAction("pets", "breeds-all", async (_ctx, _artifact, params = {}) => {
    const species = String(params.species || "").toLowerCase();
    if (!["dog", "cat"].includes(species)) return { ok: false, error: "species must be 'dog' or 'cat'" };
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 100));
    const base = species === "dog" ? "https://api.thedogapi.com/v1" : "https://api.thecatapi.com/v1";
    try {
      const r = await fetch(`${base}/breeds?limit=${limit}`);
      if (!r.ok) throw new Error(`${species}api ${r.status}`);
      const data = await r.json();
      const breeds = (Array.isArray(data) ? data : []).map((b) => ({
        id: b.id, name: b.name, origin: b.origin,
        breedGroup: b.breed_group, temperament: b.temperament,
      }));
      return {
        ok: true,
        result: { species, breeds, count: breeds.length, source: `the-${species}-api` },
      };
    } catch (e) {
      return { ok: false, error: `${species}api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Pet-care 2026 parity — health records + Rover-shape services ────
  // PetNoter / Petfetti / VitusVet-shape health management + Rover-shape
  // caregiver booking. All STATE-backed, per-user scoped, real math.

  function getPetState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.petsLens) STATE.petsLens = {};
    const s = STATE.petsLens;
    for (const k of [
      "pets", "vaccines", "medications", "vetVisits", "weights",
      "careActivities", "symptoms", "reminders", "documents", "expenses",
      "caregivers", "bookings",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePetState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pnow = () => new Date().toISOString();
  const paid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const plistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const pday = (v) => pclean(v, 10).slice(0, 10);
  const findPet = (s, userId, petId) => (s.pets.get(userId) || []).find((p) => p.id === petId) || null;
  const DAY_MS = 86400000;

  function petAge(birthdate) {
    if (!birthdate) return null;
    const b = new Date(birthdate + "T00:00:00Z");
    if (isNaN(b)) return null;
    const months = Math.max(0, Math.floor((Date.now() - b.getTime()) / (DAY_MS * 30.44)));
    return { years: Math.floor(months / 12), months: months % 12, totalMonths: months };
  }
  function dueState(dateStr) {
    if (!dateStr) return "none";
    const t = new Date(dateStr + "T00:00:00Z").getTime();
    if (isNaN(t)) return "none";
    const days = Math.floor((t - Date.now()) / DAY_MS);
    if (days < 0) return "overdue";
    if (days <= 30) return "due_soon";
    return "scheduled";
  }

  // ── Pets ────────────────────────────────────────────────────────────
  registerLensAction("pets", "pet-add", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pclean(params.name, 80);
    if (!name) return { ok: false, error: "name required" };
    const species = pclean(params.species, 40).toLowerCase() || "dog";
    const pet = {
      id: pid("pet"),
      name, species,
      breed: pclean(params.breed, 80) || null,
      sex: ["male", "female", "unknown"].includes(String(params.sex).toLowerCase())
        ? String(params.sex).toLowerCase() : "unknown",
      birthdate: pday(params.birthdate) || null,
      weightKg: Math.max(0, pnum(params.weightKg)),
      microchipId: pclean(params.microchipId, 40) || null,
      photo: pclean(params.photo, 500) || null,
      neutered: params.neutered === true,
      createdAt: pnow(),
    };
    plistB(s.pets, paid(ctx)).push(pet);
    savePetState();
    return { ok: true, result: { pet } };
  });

  registerLensAction("pets", "pet-list", (ctx, _a, _params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pets = (s.pets.get(paid(ctx)) || []).map((p) => ({ ...p, age: petAge(p.birthdate) }));
    return { ok: true, result: { pets, count: pets.length } };
  });

  registerLensAction("pets", "pet-update", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pet = findPet(s, paid(ctx), params.id);
    if (!pet) return { ok: false, error: "pet not found" };
    if (params.name != null) { const n = pclean(params.name, 80); if (n) pet.name = n; }
    if (params.breed != null) pet.breed = pclean(params.breed, 80) || null;
    if (params.weightKg != null) pet.weightKg = Math.max(0, pnum(params.weightKg));
    if (params.birthdate != null) pet.birthdate = pday(params.birthdate) || null;
    if (params.microchipId != null) pet.microchipId = pclean(params.microchipId, 40) || null;
    if (params.photo != null) pet.photo = pclean(params.photo, 500) || null;
    if (params.neutered != null) pet.neutered = params.neutered === true;
    savePetState();
    return { ok: true, result: { pet } };
  });

  registerLensAction("pets", "pet-delete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.pets.get(paid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "pet not found" };
    arr.splice(i, 1);
    for (const m of [s.vaccines, s.medications, s.vetVisits, s.weights, s.careActivities, s.symptoms, s.reminders, s.documents, s.expenses]) {
      m.delete(params.id);
    }
    savePetState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("pets", "pet-detail", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pet = findPet(s, paid(ctx), params.id);
    if (!pet) return { ok: false, error: "pet not found" };
    const reminders = s.reminders.get(pet.id) || [];
    const vaccines = s.vaccines.get(pet.id) || [];
    return {
      ok: true,
      result: {
        pet: { ...pet, age: petAge(pet.birthdate) },
        counts: {
          vaccines: vaccines.length,
          medications: (s.medications.get(pet.id) || []).filter((m) => m.active).length,
          vetVisits: (s.vetVisits.get(pet.id) || []).length,
          weightLogs: (s.weights.get(pet.id) || []).length,
        },
        overdueVaccines: vaccines.filter((v) => dueState(v.nextDueDate) === "overdue").length,
        openReminders: reminders.filter((r) => !r.done).length,
      },
    };
  });

  // ── Vaccinations ────────────────────────────────────────────────────
  registerLensAction("pets", "vaccine-record", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const name = pclean(params.name, 80);
    if (!name) return { ok: false, error: "vaccine name required" };
    const vac = {
      id: pid("vac"), petId: String(params.petId), name,
      date: pday(params.date) || pday(pnow()),
      nextDueDate: pday(params.nextDueDate) || null,
      vet: pclean(params.vet, 120) || null,
      createdAt: pnow(),
    };
    plistB(s.vaccines, vac.petId).push(vac);
    savePetState();
    return { ok: true, result: { vaccine: vac } };
  });

  registerLensAction("pets", "vaccine-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const vaccines = (s.vaccines.get(String(params.petId)) || [])
      .map((v) => ({ ...v, status: dueState(v.nextDueDate) }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ok: true,
      result: {
        vaccines,
        overdue: vaccines.filter((v) => v.status === "overdue").length,
        dueSoon: vaccines.filter((v) => v.status === "due_soon").length,
      },
    };
  });

  registerLensAction("pets", "vaccine-delete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const arr = s.vaccines.get(String(params.petId)) || [];
    const i = arr.findIndex((v) => v.id === params.id);
    if (i < 0) return { ok: false, error: "vaccine record not found" };
    arr.splice(i, 1);
    savePetState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Medications ─────────────────────────────────────────────────────
  registerLensAction("pets", "medication-add", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const name = pclean(params.name, 80);
    if (!name) return { ok: false, error: "medication name required" };
    const med = {
      id: pid("med"), petId: String(params.petId), name,
      dosage: pclean(params.dosage, 80) || null,
      frequency: pclean(params.frequency, 80) || null,
      startDate: pday(params.startDate) || pday(pnow()),
      endDate: pday(params.endDate) || null,
      active: true, createdAt: pnow(),
    };
    plistB(s.medications, med.petId).push(med);
    savePetState();
    return { ok: true, result: { medication: med } };
  });

  registerLensAction("pets", "medication-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const medications = (s.medications.get(String(params.petId)) || []);
    return {
      ok: true,
      result: { medications, active: medications.filter((m) => m.active).length },
    };
  });

  registerLensAction("pets", "medication-delete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const arr = s.medications.get(String(params.petId)) || [];
    const med = arr.find((m) => m.id === params.id);
    if (!med) return { ok: false, error: "medication not found" };
    if (params.stop === true) { med.active = false; }
    else { arr.splice(arr.indexOf(med), 1); }
    savePetState();
    return { ok: true, result: { id: params.id, stopped: params.stop === true } };
  });

  // ── Vet visits ──────────────────────────────────────────────────────
  registerLensAction("pets", "vet-visit-log", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const reason = pclean(params.reason, 200);
    if (!reason) return { ok: false, error: "reason required" };
    const visit = {
      id: pid("vis"), petId: String(params.petId), reason,
      date: pday(params.date) || pday(pnow()),
      diagnosis: pclean(params.diagnosis, 500) || null,
      vet: pclean(params.vet, 120) || null,
      cost: Math.max(0, pnum(params.cost)),
      createdAt: pnow(),
    };
    plistB(s.vetVisits, visit.petId).push(visit);
    if (visit.cost > 0) {
      plistB(s.expenses, visit.petId).push({
        id: pid("exp"), petId: visit.petId, category: "vet",
        amount: visit.cost, date: visit.date, note: `Vet visit: ${reason}`, createdAt: pnow(),
      });
    }
    savePetState();
    return { ok: true, result: { visit } };
  });

  registerLensAction("pets", "vet-visit-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const visits = (s.vetVisits.get(String(params.petId)) || [])
      .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ok: true,
      result: { visits, totalCost: visits.reduce((x, v) => x + pnum(v.cost), 0) },
    };
  });

  // ── Weight tracking ─────────────────────────────────────────────────
  registerLensAction("pets", "weight-log", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pet = findPet(s, paid(ctx), params.petId);
    if (!pet) return { ok: false, error: "pet not found" };
    const weightKg = pnum(params.weightKg);
    if (weightKg <= 0) return { ok: false, error: "weightKg must be > 0" };
    const entry = {
      id: pid("wt"), petId: pet.id,
      weightKg: Math.round(weightKg * 100) / 100,
      date: pday(params.date) || pday(pnow()), createdAt: pnow(),
    };
    plistB(s.weights, pet.id).push(entry);
    pet.weightKg = entry.weightKg;
    savePetState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("pets", "weight-history", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const series = (s.weights.get(String(params.petId)) || [])
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let trend = "no_data", changeKg = 0;
    if (series.length >= 2) {
      changeKg = Math.round((series[series.length - 1].weightKg - series[0].weightKg) * 100) / 100;
      const recent = series[series.length - 1].weightKg - series[series.length - 2].weightKg;
      trend = recent > 0.1 ? "gaining" : recent < -0.1 ? "losing" : "stable";
    } else if (series.length === 1) {
      trend = "stable";
    }
    return {
      ok: true,
      result: {
        series, trend, changeKg,
        latest: series.length ? series[series.length - 1].weightKg : null,
      },
    };
  });

  // ── Care activity log ───────────────────────────────────────────────
  const ACTIVITY_KINDS = ["feeding", "walk", "grooming", "nail_trim", "play", "potty", "bath", "training"];
  registerLensAction("pets", "activity-log", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const kind = String(params.kind || "").toLowerCase();
    if (!ACTIVITY_KINDS.includes(kind)) return { ok: false, error: `kind must be one of ${ACTIVITY_KINDS.join("/")}` };
    const entry = {
      id: pid("act"), petId: String(params.petId), kind,
      note: pclean(params.note, 200) || null,
      durationMin: Math.max(0, Math.round(pnum(params.durationMin))),
      date: pday(params.date) || pday(pnow()),
      at: pnow(),
    };
    plistB(s.careActivities, entry.petId).push(entry);
    savePetState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("pets", "activity-history", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    let acts = (s.careActivities.get(String(params.petId)) || []).slice();
    if (params.kind) acts = acts.filter((a) => a.kind === String(params.kind).toLowerCase());
    acts.sort((a, b) => b.at.localeCompare(a.at));
    const today = pday(pnow());
    return {
      ok: true,
      result: {
        activities: acts.slice(0, 100),
        count: acts.length,
        todayCount: acts.filter((a) => a.date === today).length,
      },
    };
  });

  registerLensAction("pets", "activity-delete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const arr = s.careActivities.get(String(params.petId)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "activity not found" };
    arr.splice(i, 1);
    savePetState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Symptoms ────────────────────────────────────────────────────────
  registerLensAction("pets", "symptom-log", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const symptom = pclean(params.symptom, 120);
    if (!symptom) return { ok: false, error: "symptom required" };
    const entry = {
      id: pid("sym"), petId: String(params.petId), symptom,
      severity: ["mild", "moderate", "severe"].includes(String(params.severity).toLowerCase())
        ? String(params.severity).toLowerCase() : "mild",
      note: pclean(params.note, 300) || null,
      date: pday(params.date) || pday(pnow()), createdAt: pnow(),
    };
    plistB(s.symptoms, entry.petId).push(entry);
    savePetState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("pets", "symptom-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const symptoms = (s.symptoms.get(String(params.petId)) || [])
      .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ok: true,
      result: { symptoms, severeCount: symptoms.filter((x) => x.severity === "severe").length },
    };
  });

  // ── Reminders ───────────────────────────────────────────────────────
  registerLensAction("pets", "reminder-create", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const title = pclean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const rem = {
      id: pid("rem"), petId: String(params.petId), title,
      kind: pclean(params.kind, 40).toLowerCase() || "general",
      dueDate: pday(params.dueDate) || null,
      done: false, createdAt: pnow(),
    };
    plistB(s.reminders, rem.petId).push(rem);
    savePetState();
    return { ok: true, result: { reminder: rem } };
  });

  registerLensAction("pets", "reminder-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const pets = s.pets.get(userId) || [];
    const petIds = params.petId
      ? (findPet(s, userId, params.petId) ? [String(params.petId)] : [])
      : pets.map((p) => p.id);
    const petName = new Map(pets.map((p) => [p.id, p.name]));
    const reminders = [];
    for (const id of petIds) {
      for (const r of s.reminders.get(id) || []) {
        reminders.push({ ...r, petName: petName.get(id) || null, status: r.done ? "done" : dueState(r.dueDate) });
      }
    }
    reminders.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return {
      ok: true,
      result: {
        reminders,
        overdue: reminders.filter((r) => r.status === "overdue").length,
        dueSoon: reminders.filter((r) => r.status === "due_soon").length,
      },
    };
  });

  registerLensAction("pets", "reminder-complete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const rem = (s.reminders.get(String(params.petId)) || []).find((r) => r.id === params.id);
    if (!rem) return { ok: false, error: "reminder not found" };
    rem.done = !(params.reopen === true);
    savePetState();
    return { ok: true, result: { reminder: rem } };
  });

  registerLensAction("pets", "reminder-delete", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const arr = s.reminders.get(String(params.petId)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reminder not found" };
    arr.splice(i, 1);
    savePetState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Documents ───────────────────────────────────────────────────────
  registerLensAction("pets", "document-add", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const title = pclean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const doc = {
      id: pid("doc"), petId: String(params.petId), title,
      kind: pclean(params.kind, 40).toLowerCase() || "other",
      url: pclean(params.url, 500) || null,
      createdAt: pnow(),
    };
    plistB(s.documents, doc.petId).push(doc);
    savePetState();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("pets", "document-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    return { ok: true, result: { documents: (s.documents.get(String(params.petId)) || []).slice().reverse() } };
  });

  // ── Expenses ────────────────────────────────────────────────────────
  registerLensAction("pets", "expense-log", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findPet(s, paid(ctx), params.petId)) return { ok: false, error: "pet not found" };
    const amount = pnum(params.amount);
    if (amount <= 0) return { ok: false, error: "amount must be > 0" };
    const exp = {
      id: pid("exp"), petId: String(params.petId),
      category: pclean(params.category, 40).toLowerCase() || "other",
      amount: Math.round(amount * 100) / 100,
      date: pday(params.date) || pday(pnow()),
      note: pclean(params.note, 200) || null,
      createdAt: pnow(),
    };
    plistB(s.expenses, exp.petId).push(exp);
    savePetState();
    return { ok: true, result: { expense: exp } };
  });

  registerLensAction("pets", "expense-summary", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const pets = s.pets.get(userId) || [];
    const petIds = params.petId
      ? (findPet(s, userId, params.petId) ? [String(params.petId)] : [])
      : pets.map((p) => p.id);
    const all = [];
    for (const id of petIds) all.push(...(s.expenses.get(id) || []));
    const byCategory = {};
    for (const e of all) byCategory[e.category] = Math.round(((byCategory[e.category] || 0) + e.amount) * 100) / 100;
    const month = pday(pnow()).slice(0, 7);
    const thisMonth = Math.round(all.filter((e) => String(e.date).startsWith(month))
      .reduce((x, e) => x + e.amount, 0) * 100) / 100;
    return {
      ok: true,
      result: {
        total: Math.round(all.reduce((x, e) => x + e.amount, 0) * 100) / 100,
        thisMonth, byCategory, entries: all.length,
      },
    };
  });

  // ── Rover-shape caregiver booking ───────────────────────────────────
  const SERVICES = ["boarding", "walking", "daycare", "dropin", "house_sitting", "training"];
  registerLensAction("pets", "caregiver-register", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const name = pclean(params.name, 80);
    if (!name) return { ok: false, error: "name required" };
    const services = Array.isArray(params.services)
      ? params.services.map((x) => String(x).toLowerCase()).filter((x) => SERVICES.includes(x))
      : [];
    if (!services.length) return { ok: false, error: `services required (${SERVICES.join("/")})` };
    const existing = [...s.caregivers.values()].find((c) => c.userId === userId);
    const caregiver = existing || { id: pid("cg"), userId, ratings: [], createdAt: pnow() };
    caregiver.name = name;
    caregiver.bio = pclean(params.bio, 500) || null;
    caregiver.services = services;
    caregiver.rates = {};
    for (const sv of services) caregiver.rates[sv] = Math.max(0, pnum(params.rates?.[sv]));
    caregiver.area = pclean(params.area, 80) || null;
    s.caregivers.set(caregiver.id, caregiver);
    savePetState();
    return { ok: true, result: { caregiver } };
  });

  registerLensAction("pets", "caregiver-list", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let caregivers = [...s.caregivers.values()];
    if (params.service) caregivers = caregivers.filter((c) => c.services.includes(String(params.service).toLowerCase()));
    caregivers = caregivers.map((c) => ({
      ...c,
      rating: c.ratings.length ? Math.round((c.ratings.reduce((a, b) => a + b, 0) / c.ratings.length) * 10) / 10 : null,
      reviewCount: c.ratings.length,
    }));
    return { ok: true, result: { caregivers, count: caregivers.length } };
  });

  registerLensAction("pets", "booking-create", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const caregiver = s.caregivers.get(String(params.caregiverId));
    if (!caregiver) return { ok: false, error: "caregiver not found" };
    const pet = findPet(s, userId, params.petId);
    if (!pet) return { ok: false, error: "pet not found" };
    const service = String(params.service || "").toLowerCase();
    if (!caregiver.services.includes(service)) return { ok: false, error: "caregiver does not offer that service" };
    const startDate = pday(params.startDate);
    if (!startDate) return { ok: false, error: "startDate required" };
    const endDate = pday(params.endDate) || startDate;
    const nights = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / DAY_MS) || 1);
    const rate = pnum(caregiver.rates[service]);
    const booking = {
      id: pid("bkg"), ownerUserId: userId, caregiverId: caregiver.id,
      caregiverName: caregiver.name, petId: pet.id, petName: pet.name,
      service, startDate, endDate, nights,
      estimatedCost: Math.round(rate * (service === "boarding" || service === "house_sitting" ? nights : 1) * 100) / 100,
      status: "requested", updates: [], createdAt: pnow(),
    };
    plistB(s.bookings, userId).push(booking);
    savePetState();
    return { ok: true, result: { booking } };
  });

  registerLensAction("pets", "booking-list", (ctx, _a, _params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const mine = [...(s.bookings.get(userId) || [])];
    const asCaregiver = [];
    const myCgIds = new Set([...s.caregivers.values()].filter((c) => c.userId === userId).map((c) => c.id));
    for (const list of s.bookings.values()) {
      for (const b of list) if (myCgIds.has(b.caregiverId)) asCaregiver.push(b);
    }
    return {
      ok: true,
      result: {
        bookings: mine.sort((a, b) => String(b.createdAt).localeCompare(a.createdAt)),
        asCaregiver: asCaregiver.sort((a, b) => String(b.createdAt).localeCompare(a.createdAt)),
      },
    };
  });

  registerLensAction("pets", "booking-update", (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    let booking = null;
    for (const list of s.bookings.values()) {
      const b = list.find((x) => x.id === params.id);
      if (b) { booking = b; break; }
    }
    if (!booking) return { ok: false, error: "booking not found" };
    const isOwner = booking.ownerUserId === userId;
    const cg = s.caregivers.get(booking.caregiverId);
    const isCaregiver = cg && cg.userId === userId;
    if (!isOwner && !isCaregiver) return { ok: false, error: "not your booking" };
    const status = params.status ? String(params.status).toLowerCase() : null;
    if (status && ["requested", "confirmed", "in_progress", "completed", "cancelled"].includes(status)) {
      booking.status = status;
    }
    if (params.update) {
      booking.updates.push({ by: isCaregiver ? "caregiver" : "owner", note: pclean(params.update, 300), at: pnow() });
    }
    if (params.rating != null && isOwner && booking.status === "completed" && cg) {
      const r = Math.round(pnum(params.rating));
      if (r >= 1 && r <= 5 && !booking.rated) { cg.ratings.push(r); booking.rated = true; }
    }
    savePetState();
    return { ok: true, result: { booking } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("pets", "pets-dashboard", (ctx, _a, _params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = paid(ctx);
    const pets = s.pets.get(userId) || [];
    let overdueVaccines = 0, openReminders = 0, overdueReminders = 0;
    for (const p of pets) {
      overdueVaccines += (s.vaccines.get(p.id) || []).filter((v) => dueState(v.nextDueDate) === "overdue").length;
      for (const r of s.reminders.get(p.id) || []) {
        if (!r.done) { openReminders++; if (dueState(r.dueDate) === "overdue") overdueReminders++; }
      }
    }
    let spend = 0;
    const month = pday(pnow()).slice(0, 7);
    for (const p of pets) {
      for (const e of s.expenses.get(p.id) || []) if (String(e.date).startsWith(month)) spend += e.amount;
    }
    return {
      ok: true,
      result: {
        pets: pets.length,
        overdueVaccines, openReminders, overdueReminders,
        monthSpend: Math.round(spend * 100) / 100,
        activeBookings: (s.bookings.get(userId) || []).filter((b) => ["requested", "confirmed", "in_progress"].includes(b.status)).length,
      },
    };
  });

  // feed — ingest real dog-breed reference profiles from The Dog API as
  // visible DTUs. Free public API, no key required for the breeds list.
  registerLensAction("pets", "feed", async (ctx, _a, params = {}) => {
    const s = getPetState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const page = new Date().getDate() % 8;
    try {
      const r = await fetch(`https://api.thedogapi.com/v1/breeds?limit=${limit}&page=${page}`);
      if (!r.ok) return { ok: false, error: `thedogapi ${r.status}` };
      const data = await r.json();
      const breeds = (Array.isArray(data) ? data : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const b of breeds) {
        const id = `dogbreed_${b.id}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const title = `Dog breed: ${b.name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nTemperament: ${b.temperament || "?"}\nLife span: ${b.life_span || "?"}\nWeight: ${b.weight?.imperial || "?"} lbs\nHeight: ${b.height?.imperial || "?"} in\nBred for: ${b.bred_for || "?"}\nGroup: ${b.breed_group || "?"}`,
          tags: ["pets", "feed", "dog-breed", "thedogapi"],
          source: "thedogapi-feed",
          meta: { breedId: b.id, name: b.name, temperament: b.temperament, lifeSpan: b.life_span },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      savePetState();
      return { ok: true, result: { ingested, skipped, source: "thedogapi-breeds", dtuIds } };
    } catch (e) {
      return { ok: false, error: `thedogapi unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
