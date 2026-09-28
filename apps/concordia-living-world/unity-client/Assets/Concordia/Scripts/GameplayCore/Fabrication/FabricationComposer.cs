using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Concordia.GameplayCore.Fabrication
{
    /// <summary>
    /// Pure composition and wear operations. It never mutates an inventory, economy
    /// service, scene object, mesh, or external authority.
    /// </summary>
    public static class FabricationComposer
    {
        public static FabricationCompositionResult Compose(FabricationRecipeContract recipe, FabricationCompositionContext context)
        {
            var issues = ValidateRecipe(recipe);
            if (context == null) issues.Add(Issue("error", "missing_context", "context", "A composition context is required."));
            else if (string.IsNullOrEmpty(context.instanceId)) issues.Add(Issue("error", "missing_instance_id", "context.instanceId", "A stable instanceId is required."));
            if (issues.Count > 0) return FabricationCompositionResult.Fail("Recipe cannot be composed.", issues);

            var createdAt = string.IsNullOrEmpty(context.createdAtUtc) ? DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) : context.createdAtUtc;
            var result = new FabricatedObjectRecord
            {
                schemaVersion = 1,
                objectId = FabricationId.Create("fabricated", recipe.recipeId, context.instanceId),
                recipeId = recipe.recipeId,
                displayName = string.IsNullOrEmpty(recipe.displayName) ? recipe.recipeId : recipe.displayName,
                domain = recipe.domain,
                materialId = recipe.material.materialId,
                materialClass = recipe.material.materialClass,
                shapeId = recipe.shape.shapeId,
                shapeKind = recipe.shape.kind,
                methodId = recipe.method.methodId,
                methodKind = recipe.method.kind,
                tags = CopyStrings(recipe.tags),
                components = CopyComponents(recipe.components),
                properties = new List<FabricationPropertyRecord>(),
                contributions = new List<FabricationStatContribution>(),
                ownership = new FabricationOwnershipContract
                {
                    ownerId = context.ownerId ?? "",
                    factionId = context.factionId ?? "",
                    flags = string.IsNullOrEmpty(context.ownerId) ? FabricationOwnershipFlags.None : FabricationOwnershipFlags.Owned,
                    transferable = true,
                    acquisitionReason = "fabricated"
                },
                container = new FabricationContainerContract
                {
                    containerId = context.containerId ?? "",
                    ownerId = context.ownerId ?? "",
                    capacity = 1
                },
                provenance = new FabricationProvenanceChain
                {
                    provenanceId = FabricationId.Create("provenance", recipe.recipeId, context.instanceId),
                    rootSourceId = recipe.material.materialId
                }
            };

            AddProperties(result.properties, recipe.properties, "recipe", recipe.recipeId);
            AddProperties(result.properties, recipe.material.properties, "material", recipe.material.materialId);
            AddProperties(result.properties, recipe.shape.properties, "shape", recipe.shape.shapeId);
            AddProperties(result.properties, recipe.method.properties, "method", recipe.method.methodId);

            AddContributions(result.contributions, recipe.material.contributions, "material", recipe.material.materialId);
            AddContributions(result.contributions, recipe.shape.contributions, "shape", recipe.shape.shapeId);
            AddContributions(result.contributions, recipe.method.contributions, "method", recipe.method.methodId);
            for (var i = 0; i < result.components.Count; i++)
            {
                var component = result.components[i];
                AddProperties(result.properties, component.properties, "component", component.componentId);
                AddContributions(result.contributions, component.contributions, "component", component.componentId);
            }

            AddProvenance(result.provenance, "material", recipe.material.materialId, context, createdAt, "Material selected for fabrication.");
            AddProvenance(result.provenance, "shape", recipe.shape.shapeId, context, createdAt, "Shape specification applied.");
            AddProvenance(result.provenance, "method", recipe.method.methodId, context, createdAt, "Construction method applied.");
            for (var i = 0; i < result.components.Count; i++)
                AddProvenance(result.provenance, "component", result.components[i].componentId, context, createdAt, "Component incorporated.");

            var qualityScore = ComputeQuality(recipe, context);
            result.quality = new FabricationQualityState
            {
                score = qualityScore,
                grade = GradeFor(qualityScore),
                contributions = CopyContributions(recipe.quality.contributions)
            };
            AddContribution(result.contributions, "quality", "quality-score", qualityScore - 0.5f, "Computed from material, method, shape complexity, and inspection.");
            AddContribution(result.quality.contributions, "quality", "quality-score", qualityScore - 0.5f, "Final normalized quality score.");
            AddProvenance(result.provenance, "quality", result.quality.grade.ToString(), context, createdAt, "Quality grade assigned.");

            var maximum = Math.Max(0.01f, recipe.durability.maximum * (0.75f + qualityScore * 0.5f) * Math.Max(0.01f, recipe.method.durabilityModifier));
            result.durability = new FabricationDurabilityState
            {
                maximum = maximum,
                current = maximum * Clamp01(recipe.durability.initialPercent),
                wearRate = Math.Max(0f, recipe.durability.wearRate),
                repairability = Clamp01(recipe.durability.repairability)
            };
            result.durability.broken = result.durability.current <= 0.0001f;
            AddContribution(result.contributions, "durability", "maximum", maximum, "Derived from base durability, quality, and construction method.");
            AddProvenance(result.provenance, "durability", "initial", context, createdAt, "Initial durability assigned.");
            return new FabricationCompositionResult
            {
                success = true,
                message = "Fabrication composed successfully.",
                fabricatedObject = result,
                issues = new List<FabricationValidationIssue>()
            };
        }

        public static List<FabricationValidationIssue> ValidateRecipe(FabricationRecipeContract recipe)
        {
            var issues = new List<FabricationValidationIssue>();
            if (recipe == null)
            {
                issues.Add(Issue("error", "missing_recipe", "recipe", "A recipe is required."));
                return issues;
            }
            Require(issues, recipe.recipeId, "recipeId");
            if (recipe.material == null) issues.Add(Issue("error", "missing_stage", "material", "Material stage is required."));
            else
            {
                Require(issues, recipe.material.materialId, "material.materialId");
                Range(issues, recipe.material.purity, 0f, 1f, "material.purity");
                Range(issues, recipe.material.baseQuality, 0f, 1f, "material.baseQuality");
            }
            if (recipe.shape == null) issues.Add(Issue("error", "missing_stage", "shape", "Shape stage is required."));
            else
            {
                Require(issues, recipe.shape.shapeId, "shape.shapeId");
                if (recipe.shape.scale <= 0f) issues.Add(Issue("error", "invalid_scale", "shape.scale", "Shape scale must be positive."));
            }
            if (recipe.method == null) issues.Add(Issue("error", "missing_stage", "method", "Construction method stage is required."));
            else Require(issues, recipe.method.methodId, "method.methodId");
            if (recipe.components == null) issues.Add(Issue("error", "missing_components", "components", "Components list cannot be null."));
            else
            {
                var componentIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < recipe.components.Count; i++)
                {
                    var component = recipe.components[i];
                    if (component == null) { issues.Add(Issue("error", "null_component", "components[" + i + "]", "Component cannot be null.")); continue; }
                    Require(issues, component.componentId, "components[" + i + "].componentId");
                    if (!string.IsNullOrEmpty(component.componentId) && !componentIds.Add(component.componentId))
                        issues.Add(Issue("error", "duplicate_component", "components[" + i + "].componentId", "Component IDs must be unique within a recipe."));
                    if (component.quantity <= 0) issues.Add(Issue("error", "invalid_quantity", "components[" + i + "].quantity", "Component quantity must be positive."));
                }
            }
            if (recipe.quality == null) issues.Add(Issue("error", "missing_quality", "quality", "Quality specification is required."));
            if (recipe.durability == null) issues.Add(Issue("error", "missing_durability", "durability", "Durability specification is required."));
            else
            {
                if (recipe.durability.maximum <= 0f) issues.Add(Issue("error", "invalid_durability", "durability.maximum", "Maximum durability must be positive."));
                Range(issues, recipe.durability.initialPercent, 0f, 1f, "durability.initialPercent");
                if (recipe.durability.wearRate < 0f) issues.Add(Issue("error", "invalid_wear_rate", "durability.wearRate", "Wear rate cannot be negative."));
                Range(issues, recipe.durability.repairability, 0f, 1f, "durability.repairability");
            }
            return issues;
        }

        public static bool TryApplyWear(FabricatedObjectRecord target, float amount, string reason, string actorId, string occurredAtUtc, out string error)
        {
            error = null;
            if (target == null || target.durability == null) { error = "A fabricated object with durability is required."; return false; }
            if (amount < 0f) { error = "Wear amount cannot be negative."; return false; }
            var scaledAmount = amount * Math.Max(0f, target.durability.wearRate);
            target.durability.current = Math.Max(0f, target.durability.current - scaledAmount);
            target.durability.broken = target.durability.current <= 0.0001f;
            target.durability.lastWearReason = reason ?? "wear";
            var timestamp = string.IsNullOrEmpty(occurredAtUtc) ? DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) : occurredAtUtc;
            target.durability.wearEvents.Add(new FabricationWearEvent
            {
                eventId = FabricationId.Create("wear", target.objectId, target.durability.wearEvents.Count.ToString(CultureInfo.InvariantCulture), reason ?? "wear"),
                reason = reason ?? "wear",
                amount = scaledAmount,
                resultingDurability = target.durability.current,
                actorId = actorId ?? "",
                occurredAtUtc = timestamp
            });
            return true;
        }

        public static bool TryRepair(FabricatedObjectRecord target, float amount, string actorId, string occurredAtUtc, out string error)
        {
            error = null;
            if (target == null || target.durability == null) { error = "A fabricated object with durability is required."; return false; }
            if (amount < 0f) { error = "Repair amount cannot be negative."; return false; }
            var repair = amount * target.durability.repairability;
            target.durability.current = Math.Min(target.durability.maximum, target.durability.current + repair);
            target.durability.broken = target.durability.current <= 0.0001f;
            target.durability.repairCount++;
            target.durability.lastWearReason = "repair";
            return true;
        }

        static float ComputeQuality(FabricationRecipeContract recipe, FabricationCompositionContext context)
        {
            var score = recipe.quality.baseScore;
            score += (recipe.material.baseQuality - 0.5f) * recipe.quality.materialWeight;
            score += recipe.method.qualityModifier;
            score -= Math.Max(0f, recipe.shape.complexity) * 0.1f;
            score += recipe.quality.inspectionBonus + (context == null ? 0f : context.inspectionBonus);
            return Clamp01(score);
        }

        static FabricationQualityGrade GradeFor(float score)
        {
            if (score < 0.15f) return FabricationQualityGrade.Damaged;
            if (score < 0.3f) return FabricationQualityGrade.Poor;
            if (score < 0.5f) return FabricationQualityGrade.Standard;
            if (score < 0.7f) return FabricationQualityGrade.Fine;
            if (score < 0.85f) return FabricationQualityGrade.Superior;
            if (score < 0.95f) return FabricationQualityGrade.Masterwork;
            return FabricationQualityGrade.Exceptional;
        }

        static void AddProvenance(FabricationProvenanceChain chain, string stage, string sourceId, FabricationCompositionContext context, string timestamp, string detail)
        {
            var parent = chain.links.Count == 0 ? "" : chain.links[chain.links.Count - 1].linkId;
            var linkId = FabricationId.Create("provenance-link", chain.provenanceId, stage, sourceId, chain.links.Count.ToString(CultureInfo.InvariantCulture));
            chain.links.Add(new FabricationProvenanceLink
            {
                linkId = linkId,
                parentLinkId = parent,
                stage = stage ?? "",
                sourceId = sourceId ?? "",
                actorId = context == null ? "" : context.actorId ?? "",
                locationId = context == null ? "" : context.sourceLocationId ?? "",
                occurredAtUtc = timestamp,
                detail = detail ?? ""
            });
        }

        static List<FabricationComponentSpec> CopyComponents(List<FabricationComponentSpec> source)
        {
            var result = new List<FabricationComponentSpec>();
            if (source == null) return result;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item == null) continue;
                result.Add(new FabricationComponentSpec
                {
                    componentId = item.componentId,
                    displayName = item.displayName,
                    role = item.role,
                    sourceMaterialId = item.sourceMaterialId,
                    quantity = item.quantity,
                    properties = CopyProperties(item.properties),
                    contributions = CopyContributions(item.contributions)
                });
            }
            return result;
        }

        static List<string> CopyStrings(List<string> source)
        {
            var result = new List<string>();
            if (source == null) return result;
            for (var i = 0; i < source.Count; i++) if (!string.IsNullOrEmpty(source[i]) && !result.Contains(source[i])) result.Add(source[i]);
            return result;
        }

        static List<FabricationPropertyRecord> CopyProperties(List<FabricationPropertyRecord> source)
        {
            var result = new List<FabricationPropertyRecord>();
            if (source == null) return result;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item == null) continue;
                result.Add(new FabricationPropertyRecord
                {
                    propertyId = item.propertyId,
                    displayName = item.displayName,
                    unit = item.unit,
                    sourceStage = item.sourceStage,
                    sourceId = item.sourceId,
                    value = item.value == null ? new FabricationPropertyValue() : new FabricationPropertyValue { kind = item.value.kind, number = item.value.number, integer = item.value.integer, boolean = item.value.boolean, text = item.value.text ?? "" }
                });
            }
            return result;
        }

        static List<FabricationStatContribution> CopyContributions(List<FabricationStatContribution> source)
        {
            var result = new List<FabricationStatContribution>();
            if (source == null) return result;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item == null) continue;
                result.Add(new FabricationStatContribution { contributionId = item.contributionId, statId = item.statId, value = item.value, sourceStage = item.sourceStage, sourceId = item.sourceId, reason = item.reason });
            }
            return result;
        }

        static void AddProperties(List<FabricationPropertyRecord> target, List<FabricationPropertyRecord> source, string stage, string sourceId)
        {
            if (source == null) return;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item == null) continue;
                var copy = CopyProperties(new List<FabricationPropertyRecord> { item })[0];
                copy.sourceStage = string.IsNullOrEmpty(copy.sourceStage) ? stage : copy.sourceStage;
                copy.sourceId = string.IsNullOrEmpty(copy.sourceId) ? sourceId : copy.sourceId;
                target.Add(copy);
            }
        }

        static void AddContributions(List<FabricationStatContribution> target, List<FabricationStatContribution> source, string stage, string sourceId)
        {
            if (source == null) return;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item == null) continue;
                var copy = new FabricationStatContribution { contributionId = item.contributionId, statId = item.statId, value = item.value, sourceStage = string.IsNullOrEmpty(item.sourceStage) ? stage : item.sourceStage, sourceId = string.IsNullOrEmpty(item.sourceId) ? sourceId : item.sourceId, reason = item.reason };
                if (string.IsNullOrEmpty(copy.contributionId)) copy.contributionId = FabricationId.Create("contribution", stage, sourceId, item.statId, i.ToString(CultureInfo.InvariantCulture));
                target.Add(copy);
            }
        }

        static void AddContribution(List<FabricationStatContribution> target, string stage, string statId, float value, string reason)
        {
            target.Add(new FabricationStatContribution { contributionId = FabricationId.Create("contribution", stage, statId, target.Count.ToString(CultureInfo.InvariantCulture)), statId = statId, value = value, sourceStage = stage, sourceId = statId, reason = reason });
        }

        static FabricationValidationIssue Issue(string severity, string code, string path, string detail)
        {
            return new FabricationValidationIssue { severity = severity, code = code, path = path, detail = detail };
        }

        static void Require(List<FabricationValidationIssue> issues, string value, string path)
        {
            if (string.IsNullOrEmpty(value)) issues.Add(Issue("error", "missing_id", path, "A stable ID is required."));
        }

        static void Range(List<FabricationValidationIssue> issues, float value, float minimum, float maximum, string path)
        {
            if (value < minimum || value > maximum) issues.Add(Issue("error", "out_of_range", path, "Value must be between " + minimum.ToString(CultureInfo.InvariantCulture) + " and " + maximum.ToString(CultureInfo.InvariantCulture) + "."));
        }

        static float Clamp01(float value) { return value < 0f ? 0f : value > 1f ? 1f : value; }
    }

    public static class FabricationId
    {
        public static string Create(string prefix, params string[] parts)
        {
            var canonical = new StringBuilder(prefix ?? "id");
            if (parts != null)
                for (var i = 0; i < parts.Length; i++) canonical.Append('|').Append(Normalize(parts[i]));
            unchecked
            {
                ulong hash = 14695981039346656037UL;
                for (var i = 0; i < canonical.Length; i++)
                {
                    hash ^= canonical[i];
                    hash *= 1099511628211UL;
                }
                return Normalize(prefix ?? "id") + "-" + hash.ToString("x16", CultureInfo.InvariantCulture);
            }
        }

        static string Normalize(string value) { return (value ?? "").Trim().ToLowerInvariant(); }
    }
}
