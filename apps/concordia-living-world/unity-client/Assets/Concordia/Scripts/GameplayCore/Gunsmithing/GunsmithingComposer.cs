using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using Concordia;
using Concordia.GameplayCore.WorldField;

namespace Concordia.GameplayCore.Gunsmithing
{
    /// <summary>
    /// Pure gunsmithing composition plus explainable resolution. It does not own
    /// inventory, persistence services, scene objects, or the live combat path.
    /// </summary>
    public static class GunsmithingComposer
    {
        public static WeaponCompositionResult Compose(WeaponConfigurationDto configuration, WeaponCompositionContext context)
        {
            var issues = Validate(configuration, context);
            if (issues.Count > 0) return WeaponCompositionResult.Fail("Weapon configuration cannot be composed.", issues);

            var persistentId = GunsmithingId.Create("weapon", configuration.weaponTemplateId, context.instanceId, PartId(configuration.receiver), PartId(configuration.barrel), PartId(configuration.chamberCaliber), PartId(configuration.action), PartId(configuration.magazine), PartId(configuration.ammunition), PartId(configuration.optic), PartId(configuration.stock), PartId(configuration.grip), PartId(configuration.muzzleDevice), AttachmentKey(configuration.attachments));
            var record = new ComposedWeaponRecord
            {
                schemaVersion = 1,
                persistentWeaponId = persistentId,
                configuration = configuration,
                composedAtUtc = context.createdAtUtc ?? "",
                provenance = BuildProvenance(configuration, context, persistentId)
            };
            record.lastResolvedStats = Resolve(record, new WeaponWorldContext { query = WorldFieldQuery.At(configuration.originWorld, Vector3.zero) });
            return new WeaponCompositionResult { success = true, message = "Weapon composed successfully.", weapon = record, issues = new List<GunsmithingValidationIssue>() };
        }

        public static WeaponResolvedStatsDto Resolve(ComposedWeaponRecord weapon, WeaponWorldContext world)
        {
            if (weapon == null || weapon.configuration == null) return new WeaponResolvedStatsDto();
            var configuration = weapon.configuration;
            var quality = configuration.quality ?? new WeaponQualityDto();
            var stats = DefaultStats();
            AddPart(stats, configuration.receiver);
            AddPart(stats, configuration.barrel);
            AddPart(stats, configuration.chamberCaliber);
            AddPart(stats, configuration.action);
            AddPart(stats, configuration.magazine);
            AddPart(stats, configuration.ammunition);
            AddPart(stats, configuration.optic);
            AddPart(stats, configuration.stock);
            AddPart(stats, configuration.grip);
            AddPart(stats, configuration.muzzleDevice);
            var attachments = SortedAttachments(configuration.attachments);
            for (var i = 0; i < attachments.Count; i++) AddPart(stats, attachments[i]);

            var qualityScore = EffectiveQuality(configuration);
            var qualityScale = 1f + (qualityScore - 0.5f) * 0.20f;
            stats.damage *= qualityScale;
            stats.muzzleVelocity *= qualityScale;
            stats.penetration *= qualityScale;
            stats.accuracy = Clamp01(stats.accuracy + (qualityScore - 0.5f) * 0.16f + quality.accuracyBonus);
            stats.handling = Clamp01(stats.handling + (qualityScore - 0.5f) * 0.12f + quality.handlingBonus);
            stats.reliability = Clamp01(stats.reliability + (qualityScore - 0.5f) * 0.20f + quality.reliabilityBonus);
            Explain(stats, "quality", "quality", qualityScale - 1f, "Quality grade scales ballistic output and improves precision, handling, and reliability.");

            var wear = configuration.wear ?? new WeaponWearStateDto();
            var reliability = configuration.reliability ?? new WeaponReliabilityDto();
            var maintenance = configuration.maintenance ?? new WeaponMaintenanceDto();
            var wearFraction = wear.WearFraction();
            var fouling = Clamp01(wear.fouling);
            var heatFraction = wear.maximumDurability <= 0f ? 0f : Clamp01(wear.heat / Mathf.Max(1f, wear.maximumDurability));
            stats.reliability = Clamp01(stats.reliability * reliability.baseReliability - wearFraction * reliability.wearSensitivity - fouling * reliability.foulingSensitivity - heatFraction * reliability.heatSensitivity + maintenance.maintenanceQuality * reliability.maintenanceEffect);
            stats.accuracy = Clamp01(stats.accuracy - wearFraction * 0.12f - fouling * 0.06f);
            stats.handling = Clamp01(stats.handling - wearFraction * 0.08f);
            stats.recoil = Mathf.Max(0f, stats.recoil + wearFraction * 0.10f);
            stats.heatPerShot = Mathf.Max(0f, stats.heatPerShot * (1f + wearFraction * 0.15f));
            Explain(stats, "wear", "reliability", -wearFraction, "Wear, fouling, and heat reduce reliability while preserving the weapon record for maintenance.");
            Explain(stats, "maintenance", "reliability", maintenance.maintenanceQuality * reliability.maintenanceEffect, "Maintenance quality offsets a bounded portion of wear and fouling penalties.");

            var environment = ResolveEnvironment(configuration, world);
            stats.damage *= environment.resolutionMultiplier;
            stats.penetration *= environment.resolutionMultiplier * (0.90f + GetTechnology(world) * 0.20f);
            stats.accuracy = Clamp01(stats.accuracy * environment.accuracyMultiplier);
            stats.reliability = Clamp01(stats.reliability * environment.reliabilityMultiplier);
            stats.recoil = Mathf.Max(0f, stats.recoil * environment.recoilMultiplier);
            stats.heatPerShot = Mathf.Max(0f, stats.heatPerShot * environment.heatMultiplier);
            stats.noise = Mathf.Max(0f, stats.noise * environment.noiseMultiplier);
            stats.effectiveRange = Mathf.Max(0f, stats.effectiveRange * environment.rangeMultiplier);
            Explain(stats, "environment", "accuracy", environment.accuracyMultiplier - 1f, "World-field mobility and terrain modify accuracy without disabling foreign-world use.");
            Explain(stats, "environment", "reliability", environment.reliabilityMultiplier - 1f, "World-field technology, safety, and resolution modify reliability in place.");
            Explain(stats, "environment", "range", environment.rangeMultiplier - 1f, "World-field conditions modify effective range without deleting the weapon.");
            return stats;
        }

        public static WeaponFireEligibilityDto EvaluateFireEligibility(ComposedWeaponRecord weapon, WeaponFireRequest request, WorldFieldAuthority authority = null)
        {
            var result = new WeaponFireEligibilityDto { persistentWeaponId = weapon == null ? "" : weapon.persistentWeaponId, provenanceId = weapon == null || weapon.provenance == null ? "" : weapon.provenance.provenanceId };
            if (request == null) request = new WeaponFireRequest();
            if (weapon == null || weapon.configuration == null)
            {
                Block(result, "missing_weapon", "A composed weapon is required.");
                return result;
            }
            if (request.world == null) request.world = new WeaponWorldContext();
            if (request.world.query == null) request.world.query = WorldFieldQuery.At(weapon.configuration.originWorld, Vector3.zero);
            if (authority == null) authority = new WorldFieldAuthority();
            if (request.world.snapshot == null) request.world.snapshot = authority.Evaluate(request.world.query);
            var stats = Resolve(weapon, request.world);
            result.resolvedStats = stats;
            result.environment = ResolveEnvironment(weapon.configuration, request.world);
            result.foreignWorldUse = result.environment.foreignWorld;
            weapon.lastResolvedStats = stats;
            weapon.lastEnvironment = result.environment;

            if (result.foreignWorldUse) Warn(result, "foreign_world", "Weapon origin is different from the queried world; environmental modifiers were applied and the weapon was retained.");
            if (!request.operatorAuthorized) Block(result, "operator_not_authorized", "The current operator is not authorized to fire this weapon.");
            if (!request.chambered) Block(result, "not_chambered", "The action is not chambered.");
            if (weapon.configuration.ammunition == null || string.IsNullOrEmpty(weapon.configuration.ammunition.partId)) Block(result, "missing_ammunition", "No ammunition component is configured.");
            else if (request.ammunitionAvailable <= 0) Block(result, "empty_ammunition", "No compatible ammunition is available.");
            else if (!string.IsNullOrEmpty(request.ammunitionId) && !string.Equals(request.ammunitionId, weapon.configuration.ammunition.partId, StringComparison.OrdinalIgnoreCase) && !string.Equals(request.ammunitionId, weapon.configuration.ammunition.caliberId, StringComparison.OrdinalIgnoreCase)) Block(result, "ammunition_mismatch", "Requested ammunition does not match the configured ammunition or caliber.");
            if (weapon.configuration.wear != null && weapon.configuration.wear.currentDurability <= 0.0001f) Block(result, "broken", "Weapon durability is exhausted; maintenance is required before firing.");
            var heatLimit = request.heatLimit <= 0f ? 100f : request.heatLimit;
            var persistedHeat = weapon.configuration.wear == null ? 0f : weapon.configuration.wear.heat;
            if (request.currentHeat + persistedHeat + stats.heatPerShot > heatLimit) Block(result, "overheated", "The next shot would exceed the supplied heat limit.");
            var minimumReliability = weapon.configuration.reliability == null ? 0.05f : weapon.configuration.reliability.minimumFireReliability;
            if (stats.reliability < minimumReliability) Block(result, "unreliable", "Resolved reliability is below the configured fire threshold.");
            result.canFire = !HasError(result);
            result.reasonCode = result.canFire ? "eligible" : FirstError(result);
            if (result.canFire) Add(result, "eligible", "info", "All weapon, ammunition, heat, reliability, and authorization checks passed.");
            return result;
        }

        public static bool TryApplyWear(ComposedWeaponRecord weapon, float durabilityLoss, float foulingIncrease, string reason, string actorId, string occurredAtUtc, out string error)
        {
            error = null;
            if (weapon == null || weapon.configuration == null || weapon.configuration.wear == null) { error = "A composed weapon with wear state is required."; return false; }
            if (durabilityLoss < 0f || foulingIncrease < 0f) { error = "Wear and fouling values cannot be negative."; return false; }
            var wear = weapon.configuration.wear;
            if (wear.events == null) wear.events = new List<WeaponWearEventDto>();
            wear.currentDurability = Mathf.Max(0f, wear.currentDurability - durabilityLoss);
            wear.fouling = Clamp01(wear.fouling + foulingIncrease);
            wear.heat += weapon.lastResolvedStats == null ? 0f : weapon.lastResolvedStats.heatPerShot;
            wear.shotsFired++;
            wear.lastWearReason = reason ?? "firing";
            wear.events.Add(new WeaponWearEventDto { eventId = GunsmithingId.Create("wear", weapon.persistentWeaponId, wear.events.Count.ToString(CultureInfo.InvariantCulture), reason), reason = reason ?? "firing", durabilityDelta = durabilityLoss, foulingDelta = foulingIncrease, resultingDurability = wear.currentDurability, actorId = actorId ?? "", occurredAtUtc = occurredAtUtc ?? "" });
            return true;
        }

        public static bool TryMaintain(ComposedWeaponRecord weapon, float repairAmount, float cleanAmount, string actorId, string occurredAtUtc, out string error)
        {
            error = null;
            if (weapon == null || weapon.configuration == null || weapon.configuration.wear == null) { error = "A composed weapon with wear state is required."; return false; }
            if (repairAmount < 0f || cleanAmount < 0f) { error = "Maintenance values cannot be negative."; return false; }
            var wear = weapon.configuration.wear;
            var maintenance = weapon.configuration.maintenance ?? new WeaponMaintenanceDto();
            wear.currentDurability = Mathf.Min(wear.maximumDurability, wear.currentDurability + repairAmount * Clamp01(maintenance.repairability));
            wear.fouling = Clamp01(wear.fouling - cleanAmount);
            wear.heat = Mathf.Max(0f, wear.heat - cleanAmount * 10f);
            wear.repairCount++;
            wear.lastMaintenanceAtUtc = occurredAtUtc ?? "";
            wear.lastWearReason = "maintenance";
            return true;
        }

        public static List<GunsmithingValidationIssue> Validate(WeaponConfigurationDto configuration, WeaponCompositionContext context)
        {
            var issues = new List<GunsmithingValidationIssue>();
            if (configuration == null) { issues.Add(Issue("error", "missing_configuration", "configuration", "Weapon configuration is required.")); return issues; }
            Require(issues, configuration.weaponTemplateId, "weaponTemplateId");
            RequirePart(issues, configuration.receiver, "receiver");
            RequirePart(issues, configuration.barrel, "barrel");
            RequirePart(issues, configuration.chamberCaliber, "chamberCaliber");
            RequirePart(issues, configuration.action, "action");
            RequirePart(issues, configuration.magazine, "magazine");
            RequirePart(issues, configuration.ammunition, "ammunition");
            RequireOptionalPart(issues, configuration.optic, "optic");
            RequireOptionalPart(issues, configuration.stock, "stock");
            RequireOptionalPart(issues, configuration.grip, "grip");
            RequireOptionalPart(issues, configuration.muzzleDevice, "muzzleDevice");
            if (configuration.attachments == null) issues.Add(Issue("error", "missing_attachments", "attachments", "Attachments list cannot be null."));
            else
            {
                var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < configuration.attachments.Count; i++)
                {
                    var part = configuration.attachments[i];
                    RequirePart(issues, part, "attachments[" + i + "]");
                    if (part != null && !string.IsNullOrEmpty(part.partId) && !ids.Add(part.partId)) issues.Add(Issue("error", "duplicate_attachment", "attachments[" + i + "]", "Attachment IDs must be unique."));
                }
            }
            if (configuration.quality == null) issues.Add(Issue("error", "missing_quality", "quality", "Quality data is required."));
            else Range(issues, configuration.quality.score, 0f, 1f, "quality.score");
            if (configuration.wear == null) issues.Add(Issue("error", "missing_wear", "wear", "Wear state is required."));
            else { if (configuration.wear.maximumDurability <= 0f) issues.Add(Issue("error", "invalid_durability", "wear.maximumDurability", "Maximum durability must be positive.")); Range(issues, configuration.wear.currentDurability, 0f, configuration.wear.maximumDurability, "wear.currentDurability"); }
            if (configuration.reliability == null) issues.Add(Issue("error", "missing_reliability", "reliability", "Reliability data is required."));
            if (context == null) issues.Add(Issue("error", "missing_context", "context", "Composition context is required."));
            else Require(issues, context.instanceId, "context.instanceId");
            return issues;
        }

        static WeaponResolvedStatsDto DefaultStats()
        {
            return new WeaponResolvedStatsDto { damage = 25f, muzzleVelocity = 350f, penetration = 1f, effectiveRange = 100f, accuracy = 0.65f, recoil = 0.5f, handling = 0.5f, heatPerShot = 1f, noise = 0.7f, reliability = 0.9f, magazineCapacity = 1f, rateOfFire = 1f, reloadTime = 2f, maintenance = 0.5f };
        }

        static void AddPart(WeaponResolvedStatsDto stats, WeaponPartDto part)
        {
            if (part == null || string.IsNullOrEmpty(part.partId)) return;
            var delta = part.contribution ?? new WeaponStatContributionDto();
            var scale = Clamp01(part.condition);
            stats.damage += delta.damage * scale; stats.muzzleVelocity += delta.muzzleVelocity * scale; stats.penetration += delta.penetration * scale; stats.effectiveRange += delta.effectiveRange * scale; stats.accuracy += delta.accuracy * scale; stats.recoil += delta.recoil * scale; stats.handling += delta.handling * scale; stats.heatPerShot += delta.heatPerShot * scale; stats.noise += delta.noise * scale; stats.reliability += delta.reliability * scale; stats.magazineCapacity += delta.magazineCapacity * scale; stats.rateOfFire += delta.rateOfFire * scale; stats.reloadTime += delta.reloadTime * scale; stats.maintenance += delta.maintenance * scale;
            var reason = string.IsNullOrEmpty(delta.reason) ? "Component contributes to the composed weapon." : delta.reason;
            Explain(stats, part.partId, "damage", delta.damage * scale, reason);
            Explain(stats, part.partId, "muzzleVelocity", delta.muzzleVelocity * scale, reason);
            Explain(stats, part.partId, "penetration", delta.penetration * scale, reason);
            Explain(stats, part.partId, "range", delta.effectiveRange * scale, reason);
            Explain(stats, part.partId, "accuracy", delta.accuracy * scale, reason);
            Explain(stats, part.partId, "recoil", delta.recoil * scale, reason);
            Explain(stats, part.partId, "handling", delta.handling * scale, reason);
            Explain(stats, part.partId, "heat", delta.heatPerShot * scale, reason);
            Explain(stats, part.partId, "noise", delta.noise * scale, reason);
            Explain(stats, part.partId, "reliability", delta.reliability * scale, reason);
            Explain(stats, part.partId, "magazineCapacity", delta.magazineCapacity * scale, reason);
            Explain(stats, part.partId, "rateOfFire", delta.rateOfFire * scale, reason);
            Explain(stats, part.partId, "reloadTime", delta.reloadTime * scale, reason);
            Explain(stats, part.partId, "maintenance", delta.maintenance * scale, reason);
        }


        static WeaponEnvironmentalModifierDto ResolveEnvironment(WeaponConfigurationDto configuration, WeaponWorldContext world)
        {
            var query = world == null || world.query == null ? new WorldFieldQuery { world = configuration.originWorld } : world.query;
            var snapshot = world == null ? null : world.snapshot;
            var target = snapshot == null ? query.world : snapshot.queriedWorld;
            var foreign = target != configuration.originWorld;
            var combat = snapshot == null ? 0.5f : snapshot.combat;
            var mobility = snapshot == null ? 0.5f : snapshot.mobility;
            var technology = snapshot == null ? 0.5f : snapshot.technology;
            var safety = snapshot == null ? 0.5f : snapshot.safety;
            var terrain = snapshot == null ? 0.5f : snapshot.terrainConnectivity;
            var resolution = snapshot == null ? 1f : Mathf.Clamp(snapshot.resolutionMultiplier, 0.70f, 1.15f);
            var result = new WeaponEnvironmentalModifierDto { targetWorld = target, foreignWorld = foreign, resolutionMultiplier = resolution, accuracyMultiplier = Mathf.Clamp(0.85f + mobility * 0.30f + terrain * 0.10f, 0.70f, 1.20f), reliabilityMultiplier = Mathf.Clamp(0.82f + technology * 0.18f + safety * 0.12f, 0.65f, 1.15f), recoilMultiplier = Mathf.Clamp(1.10f - combat * 0.15f, 0.85f, 1.15f), heatMultiplier = Mathf.Clamp(1.10f - safety * 0.15f, 0.85f, 1.20f), noiseMultiplier = Mathf.Clamp(1.10f - safety * 0.10f, 0.85f, 1.20f), rangeMultiplier = Mathf.Clamp(0.85f + technology * 0.15f + mobility * 0.05f, 0.75f, 1.10f), dominantInfluence = snapshot == null ? "neutral" : snapshot.dominantInfluence };
            result.explanations.Add(foreign ? "Foreign-world operation is preserved; only local field modifiers are applied." : "Native-world operation uses the same deterministic field resolution.");
            result.explanations.Add("Combat=" + combat.ToString("0.000", CultureInfo.InvariantCulture) + ", technology=" + technology.ToString("0.000", CultureInfo.InvariantCulture) + ", mobility=" + mobility.ToString("0.000", CultureInfo.InvariantCulture) + ", safety=" + safety.ToString("0.000", CultureInfo.InvariantCulture) + ".");
            return result;
        }

        static float GetTechnology(WeaponWorldContext world) { return world == null || world.snapshot == null ? 0.5f : world.snapshot.technology; }
        static float EffectiveQuality(WeaponConfigurationDto configuration) { return configuration.quality == null ? 0.5f : Clamp01(configuration.quality.score); }

        static WeaponProvenanceChainDto BuildProvenance(WeaponConfigurationDto configuration, WeaponCompositionContext context, string weaponId)
        {
            var root = string.IsNullOrEmpty(configuration.sourceFabricationObjectId) ? configuration.receiver.fabricationObjectId : configuration.sourceFabricationObjectId;
            var chain = new WeaponProvenanceChainDto { provenanceId = GunsmithingId.Create("weapon-provenance", weaponId), rootFabricationObjectId = root ?? "" };
            var parts = new List<WeaponPartDto> { configuration.receiver, configuration.barrel, configuration.chamberCaliber, configuration.action, configuration.magazine, configuration.ammunition, configuration.optic, configuration.stock, configuration.grip, configuration.muzzleDevice };
            parts.AddRange(SortedAttachments(configuration.attachments));
            for (var i = 0; i < parts.Count; i++)
            {
                var part = parts[i];
                if (part == null || string.IsNullOrEmpty(part.partId)) continue;
                AddLink(chain, part.slot.ToString(), part.partId, part.fabricationObjectId, context, "Weapon part incorporated.");
            }
            AddLink(chain, "quality", configuration.quality == null ? "default" : configuration.quality.grade.ToString(), "", context, "Quality state assigned.");
            AddLink(chain, "assembly", weaponId, root, context, "Canonical weapon assembly completed.");
            return chain;
        }

        static void AddLink(WeaponProvenanceChainDto chain, string stage, string sourceId, string fabricationId, WeaponCompositionContext context, string detail)
        {
            var parent = chain.links.Count == 0 ? "" : chain.links[chain.links.Count - 1].linkId;
            var id = GunsmithingId.Create("weapon-link", chain.provenanceId, stage, sourceId, chain.links.Count.ToString(CultureInfo.InvariantCulture));
            chain.links.Add(new WeaponProvenanceLinkDto { linkId = id, parentLinkId = parent, stage = stage ?? "", sourceId = sourceId ?? "", fabricationObjectId = fabricationId ?? "", actorId = context == null ? "" : context.actorId ?? "", worldId = context == null ? "" : context.sourceWorldId ?? "", locationId = context == null ? "" : context.locationId ?? "", occurredAtUtc = context == null ? "" : context.createdAtUtc ?? "", detail = detail ?? "" });
        }

        static List<WeaponPartDto> SortedAttachments(List<WeaponPartDto> source)
        {
            var result = new List<WeaponPartDto>();
            if (source != null) for (var i = 0; i < source.Count; i++) if (source[i] != null) result.Add(source[i]);
            result.Sort((a, b) => string.CompareOrdinal(a.partId ?? "", b.partId ?? ""));
            return result;
        }

        static string PartId(WeaponPartDto part) { return part == null ? "" : part.partId ?? ""; }

        static string AttachmentKey(List<WeaponPartDto> source)
        {
            var list = SortedAttachments(source); var builder = new StringBuilder();
            for (var i = 0; i < list.Count; i++) builder.Append(list[i].partId).Append('|');
            return builder.ToString();
        }

        static void Explain(WeaponResolvedStatsDto stats, string sourceId, string stage, float value, string reason)
        {
            stats.explanations.Add(new WeaponResolutionContributionDto { sourceId = sourceId ?? "", stage = stage ?? "", statId = stage ?? "", value = value, reason = reason ?? "" });
        }

        static void Add(WeaponFireEligibilityDto result, string code, string severity, string detail) { result.reasons.Add(new WeaponEligibilityReason { code = code, severity = severity, detail = detail }); }
        static void Warn(WeaponFireEligibilityDto result, string code, string detail) { Add(result, code, "warning", detail); }
        static void Block(WeaponFireEligibilityDto result, string code, string detail) { Add(result, code, "error", detail); }
        static bool HasError(WeaponFireEligibilityDto result) { for (var i = 0; i < result.reasons.Count; i++) if (result.reasons[i].severity == "error") return true; return false; }
        static string FirstError(WeaponFireEligibilityDto result) { for (var i = 0; i < result.reasons.Count; i++) if (result.reasons[i].severity == "error") return result.reasons[i].code; return "ineligible"; }
        static void Require(List<GunsmithingValidationIssue> issues, string value, string path) { if (string.IsNullOrEmpty(value)) issues.Add(Issue("error", "missing_id", path, "A stable ID is required.")); }
        static void RequirePart(List<GunsmithingValidationIssue> issues, WeaponPartDto part, string path) { if (part == null) issues.Add(Issue("error", "missing_part", path, "Required weapon part is missing.")); else { Require(issues, part.partId, path + ".partId"); Range(issues, part.condition, 0f, 1f, path + ".condition"); Range(issues, part.quality, 0f, 1f, path + ".quality"); } }
        static void RequireOptionalPart(List<GunsmithingValidationIssue> issues, WeaponPartDto part, string path) { if (part != null) { Range(issues, part.condition, 0f, 1f, path + ".condition"); Range(issues, part.quality, 0f, 1f, path + ".quality"); } }
        static void Range(List<GunsmithingValidationIssue> issues, float value, float min, float max, string path) { if (value < min || value > max) issues.Add(Issue("error", "out_of_range", path, "Value must be between " + min.ToString(CultureInfo.InvariantCulture) + " and " + max.ToString(CultureInfo.InvariantCulture) + ".")); }
        static GunsmithingValidationIssue Issue(string severity, string code, string path, string detail) { return new GunsmithingValidationIssue { severity = severity, code = code, path = path, detail = detail }; }
        static float Clamp01(float value) { return value < 0f ? 0f : value > 1f ? 1f : value; }
    }

    public static class GunsmithingId
    {
        public static string Create(string prefix, params string[] parts)
        {
            var canonical = new StringBuilder(Normalize(prefix));
            if (parts != null) for (var i = 0; i < parts.Length; i++) canonical.Append('|').Append(Normalize(parts[i]));
            unchecked
            {
                ulong hash = 14695981039346656037UL;
                for (var i = 0; i < canonical.Length; i++) { hash ^= canonical[i]; hash *= 1099511628211UL; }
                return Normalize(prefix) + "-" + hash.ToString("x16", CultureInfo.InvariantCulture);
            }
        }

        public static string Normalize(string value) { return (value ?? "").Trim().ToLowerInvariant(); }
    }
}
