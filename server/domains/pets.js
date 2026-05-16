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
}
