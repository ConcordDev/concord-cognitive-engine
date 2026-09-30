using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using Concordia.GameplayCore.WorldField;

namespace Concordia.GameplayCore.Spellcrafting
{
    /// <summary>Pure spell composition and field-aware resolution. Runtime services own storage and combat dispatch.</summary>
    public static class SpellcraftingComposer
    {
        public static SpellCompositionResult Compose(SpellConfigurationDto configuration, SpellCompositionContext context)
        {
            var issues = Validate(configuration, context);
            if (issues.Count > 0) return SpellCompositionResult.Fail("Spell configuration cannot be composed.", issues);
            var id = SpellcraftingId.Create("spell", configuration.spellTemplateId, context.instanceId,
                ComponentId(configuration.source), ComponentId(configuration.focus), ComponentId(configuration.catalyst),
                ComponentId(configuration.form), ComponentId(configuration.delivery), ComponentId(configuration.cost), AugmentKey(configuration.augments));
            var record = new ComposedSpellRecord
            {
                persistentSpellId = id,
                configuration = configuration,
                composedAtUtc = context.createdAtUtc ?? "",
                provenance = BuildProvenance(configuration, context, id)
            };
            record.lastResolvedEffect = Resolve(record, new SpellWorldContext { query = WorldFieldQuery.At(configuration.originWorld, Vector3.zero) });
            return new SpellCompositionResult { success = true, message = "Spell composed successfully.", spell = record };
        }

        public static SpellResolvedEffectDto Resolve(ComposedSpellRecord spell, SpellWorldContext world)
        {
            if (spell == null || spell.configuration == null) return new SpellResolvedEffectDto();
            var config = spell.configuration;
            var quality = config.quality ?? new SpellQualityDto();
            var effect = new SpellResolvedEffectDto { potency = 10f, range = 8f, area = 1f, duration = 1f, control = 0.25f, recovery = 1f, stability = 0.9f, damageType = "arcane" };
            AddComponent(effect, config.source);
            AddComponent(effect, config.focus);
            AddComponent(effect, config.catalyst);
            AddComponent(effect, config.form);
            AddComponent(effect, config.delivery);
            AddComponent(effect, config.cost);
            var augments = Sorted(config.augments);
            for (var i = 0; i < augments.Count; i++) AddComponent(effect, augments[i]);

            var qualityScore = Clamp01(quality.score);
            var qualityScale = 1f + (qualityScore - 0.5f) * 0.2f;
            effect.potency *= qualityScale + quality.potencyBonus;
            effect.control = Clamp01(effect.control + (qualityScore - 0.5f) * 0.12f + quality.controlBonus);
            effect.stability = Clamp01(effect.stability + (qualityScore - 0.5f) * 0.2f + quality.stabilityBonus);
            Explain(effect, "quality", "potency", qualityScale - 1f, "Quality scales spell potency and improves control and stability.");

            var stability = config.stability ?? new SpellStabilityDto();
            var fatigue = Clamp01(stability.currentFatigue / 100f);
            effect.stability = Clamp01(effect.stability * stability.baseStability - fatigue * stability.fatigueSensitivity + stability.attunementEffect * qualityScore);
            effect.recovery = Mathf.Max(0.05f, effect.recovery * (1f + fatigue * 0.25f));
            Explain(effect, "fatigue", "stability", -fatigue * stability.fatigueSensitivity, "Casting fatigue reduces stability and increases recovery without deleting the spell.");

            var environment = ResolveEnvironment(config, world);
            effect.potency *= environment.potencyMultiplier * environment.resolutionMultiplier;
            effect.stability = Clamp01(effect.stability * environment.stabilityMultiplier);
            effect.range = Mathf.Max(0f, effect.range * environment.rangeMultiplier);
            effect.area = Mathf.Max(0f, effect.area * environment.areaMultiplier);
            effect.recovery = Mathf.Max(0.05f, effect.recovery * environment.recoveryMultiplier);
            Explain(effect, "environment", "potency", environment.potencyMultiplier - 1f, "WorldField magic and resolution conditions modify potency in place.");
            Explain(effect, "environment", "stability", environment.stabilityMultiplier - 1f, "WorldField safety and recovery conditions modify stability in place.");
            spell.lastResolvedEffect = effect;
            spell.lastEnvironment = environment;
            return effect;
        }

        public static SpellCastEligibilityDto EvaluateCastEligibility(ComposedSpellRecord spell, SpellCastRequest request, WorldFieldAuthority authority = null)
        {
            var result = new SpellCastEligibilityDto
            {
                persistentSpellId = spell == null ? "" : spell.persistentSpellId,
                provenanceId = spell == null || spell.provenance == null ? "" : spell.provenance.provenanceId
            };
            if (request == null) request = new SpellCastRequest();
            if (spell == null || spell.configuration == null) { Block(result, "missing_spell", "A composed spell is required."); return result; }
            if (request.world == null) request.world = new SpellWorldContext();
            if (request.world.query == null) request.world.query = WorldFieldQuery.At(spell.configuration.originWorld, Vector3.zero);
            if (authority == null) authority = new WorldFieldAuthority();
            if (request.world.snapshot == null) request.world.snapshot = authority.Evaluate(request.world.query);
            result.resolvedEffect = Resolve(spell, request.world);
            result.environment = ResolveEnvironment(spell.configuration, request.world);
            result.foreignWorldUse = result.environment.foreignWorld;
            if (result.foreignWorldUse) Warn(result, "foreign_world", "Foreign-world casting is preserved; local WorldField modifiers were applied.");
            if (!request.operatorAuthorized) Block(result, "operator_not_authorized", "The current operator is not authorized to cast this spell.");
            var limit = request.fatigueLimit <= 0f ? 100f : request.fatigueLimit;
            if (request.currentFatigue + result.resolvedEffect.recovery > limit) Block(result, "fatigued", "The next cast would exceed the supplied fatigue limit.");
            var minimum = spell.configuration.stability == null ? 0.05f : spell.configuration.stability.minimumCastStability;
            if (result.resolvedEffect.stability < minimum) Block(result, "unstable", "Resolved spell stability is below the configured cast threshold.");
            result.canCast = !HasError(result);
            result.reasonCode = result.canCast ? "eligible" : FirstError(result);
            if (result.canCast) Add(result, "eligible", "info", "All spell, fatigue, stability, authorization, and field checks passed.");
            return result;
        }

        public static List<SpellcraftingValidationIssue> Validate(SpellConfigurationDto config, SpellCompositionContext context)
        {
            var issues = new List<SpellcraftingValidationIssue>();
            if (config == null) { issues.Add(Issue("error", "missing_configuration", "configuration", "Spell configuration is required.")); return issues; }
            Require(issues, config.spellTemplateId, "spellTemplateId");
            RequireComponent(issues, config.source, "source");
            RequireComponent(issues, config.focus, "focus");
            RequireComponent(issues, config.form, "form");
            RequireComponent(issues, config.delivery, "delivery");
            OptionalComponent(issues, config.catalyst, "catalyst");
            OptionalComponent(issues, config.cost, "cost");
            if (config.augments == null) issues.Add(Issue("error", "missing_augments", "augments", "Augments list cannot be null."));
            else
            {
                var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < config.augments.Count; i++)
                {
                    RequireComponent(issues, config.augments[i], "augments[" + i + "]");
                    if (config.augments[i] != null && !string.IsNullOrEmpty(config.augments[i].componentId) && !ids.Add(config.augments[i].componentId))
                        issues.Add(Issue("error", "duplicate_augment", "augments[" + i + "]", "Augment IDs must be unique."));
                }
            }
            if (config.quality == null) issues.Add(Issue("error", "missing_quality", "quality", "Quality data is required."));
            else Range(issues, config.quality.score, 0f, 1f, "quality.score");
            if (config.stability == null) issues.Add(Issue("error", "missing_stability", "stability", "Stability data is required."));
            if (context == null) issues.Add(Issue("error", "missing_context", "context", "Composition context is required."));
            else Require(issues, context.instanceId, "context.instanceId");
            return issues;
        }

        static SpellEnvironmentalModifierDto ResolveEnvironment(SpellConfigurationDto config, SpellWorldContext world)
        {
            var query = world == null || world.query == null ? new WorldFieldQuery { world = config.originWorld } : world.query;
            var snapshot = world == null ? null : world.snapshot;
            var target = snapshot == null ? query.world : snapshot.queriedWorld;
            var foreign = target != config.originWorld;
            var magic = snapshot == null ? 0.5f : snapshot.magic;
            var safety = snapshot == null ? 0.5f : snapshot.safety;
            var recovery = snapshot == null ? 0.5f : snapshot.recovery;
            var resolution = snapshot == null ? 1f : Mathf.Clamp(snapshot.resolutionMultiplier, 0.7f, 1.15f);
            var result = new SpellEnvironmentalModifierDto
            {
                targetWorld = target,
                foreignWorld = foreign,
                resolutionMultiplier = resolution,
                potencyMultiplier = Mathf.Clamp(0.75f + magic * 0.45f, 0.55f, 1.25f),
                stabilityMultiplier = Mathf.Clamp(0.8f + safety * 0.2f + magic * 0.1f, 0.6f, 1.15f),
                rangeMultiplier = Mathf.Clamp(0.85f + magic * 0.2f, 0.7f, 1.15f),
                areaMultiplier = Mathf.Clamp(0.85f + magic * 0.2f, 0.7f, 1.15f),
                recoveryMultiplier = Mathf.Clamp(1.15f - recovery * 0.2f, 0.8f, 1.2f),
                dominantInfluence = snapshot == null ? "neutral" : snapshot.dominantInfluence
            };
            result.explanations.Add(foreign ? "Foreign-world casting is retained; only local field modifiers are applied." : "Native-world casting uses the same deterministic field resolution.");
            result.explanations.Add("Magic=" + magic.ToString("0.000", CultureInfo.InvariantCulture) + ", safety=" + safety.ToString("0.000", CultureInfo.InvariantCulture) + ", recovery=" + recovery.ToString("0.000", CultureInfo.InvariantCulture) + ".");
            return result;
        }

        static void AddComponent(SpellResolvedEffectDto effect, SpellComponentDto component)
        {
            if (component == null || string.IsNullOrEmpty(component.componentId)) return;
            var delta = component.contribution ?? new SpellEffectContributionDto();
            var scale = Clamp01(component.condition);
            effect.potency += delta.potency * scale;
            effect.range += delta.range * scale;
            effect.area += delta.area * scale;
            effect.duration += delta.duration * scale;
            effect.control = Clamp01(effect.control + delta.control * scale);
            effect.recovery += delta.recovery * scale;
            if (!string.IsNullOrEmpty(delta.damageType)) effect.damageType = delta.damageType;
            var reason = string.IsNullOrEmpty(delta.reason) ? "Component contributes to the composed spell." : delta.reason;
            Explain(effect, component.componentId, "potency", delta.potency * scale, reason);
            Explain(effect, component.componentId, "range", delta.range * scale, reason);
            Explain(effect, component.componentId, "area", delta.area * scale, reason);
            Explain(effect, component.componentId, "control", delta.control * scale, reason);
            Explain(effect, component.componentId, "recovery", delta.recovery * scale, reason);
        }

        static SpellProvenanceChainDto BuildProvenance(SpellConfigurationDto config, SpellCompositionContext context, string spellId)
        {
            var root = string.IsNullOrEmpty(config.sourceFabricationObjectId) ? ComponentFabricationId(config.source) : config.sourceFabricationObjectId;
            var chain = new SpellProvenanceChainDto { provenanceId = SpellcraftingId.Create("spell-provenance", spellId), rootFabricationObjectId = root ?? "" };
            var components = new List<SpellComponentDto> { config.source, config.focus, config.catalyst, config.form, config.delivery, config.cost };
            components.AddRange(Sorted(config.augments));
            for (var i = 0; i < components.Count; i++)
            {
                var component = components[i];
                if (component == null || string.IsNullOrEmpty(component.componentId)) continue;
                AddLink(chain, component.slot.ToString(), component.componentId, component.fabricationObjectId, context, "Spell component incorporated.");
            }
            AddLink(chain, "quality", config.quality == null ? "default" : config.quality.grade.ToString(), "", context, "Quality state assigned.");
            AddLink(chain, "assembly", spellId, root, context, "Canonical spell assembly completed.");
            return chain;
        }

        static void AddLink(SpellProvenanceChainDto chain, string stage, string sourceId, string fabricationId, SpellCompositionContext context, string detail)
        {
            var parent = chain.links.Count == 0 ? "" : chain.links[chain.links.Count - 1].linkId;
            var id = SpellcraftingId.Create("spell-link", chain.provenanceId, stage, sourceId, chain.links.Count.ToString(CultureInfo.InvariantCulture));
            chain.links.Add(new SpellProvenanceLinkDto { linkId = id, parentLinkId = parent, stage = stage ?? "", sourceId = sourceId ?? "", fabricationObjectId = fabricationId ?? "", actorId = context == null ? "" : context.actorId ?? "", worldId = context == null ? "" : context.sourceWorldId ?? "", locationId = context == null ? "" : context.locationId ?? "", occurredAtUtc = context == null ? "" : context.createdAtUtc ?? "", detail = detail ?? "" });
        }

        static List<SpellComponentDto> Sorted(List<SpellComponentDto> source)
        {
            var result = new List<SpellComponentDto>();
            if (source != null) for (var i = 0; i < source.Count; i++) if (source[i] != null) result.Add(source[i]);
            result.Sort((a, b) => string.CompareOrdinal(a.componentId ?? "", b.componentId ?? ""));
            return result;
        }
        static string ComponentId(SpellComponentDto component) { return component == null ? "" : component.componentId ?? ""; }
        static string ComponentFabricationId(SpellComponentDto component) { return component == null ? "" : component.fabricationObjectId ?? ""; }
        static string AugmentKey(List<SpellComponentDto> source) { var value = new StringBuilder(); var list = Sorted(source); for (var i = 0; i < list.Count; i++) value.Append(list[i].componentId).Append('|'); return value.ToString(); }
        static void Explain(SpellResolvedEffectDto effect, string sourceId, string stage, float value, string reason) { effect.explanations.Add(new SpellResolutionContributionDto { sourceId = sourceId ?? "", stage = stage ?? "", statId = stage ?? "", value = value, reason = reason ?? "" }); }
        static void Add(SpellCastEligibilityDto result, string code, string severity, string detail) { result.reasons.Add(new SpellCastReason { code = code, severity = severity, detail = detail }); }
        static void Warn(SpellCastEligibilityDto result, string code, string detail) { Add(result, code, "warning", detail); }
        static void Block(SpellCastEligibilityDto result, string code, string detail) { Add(result, code, "error", detail); }
        static bool HasError(SpellCastEligibilityDto result) { for (var i = 0; i < result.reasons.Count; i++) if (result.reasons[i].severity == "error") return true; return false; }
        static string FirstError(SpellCastEligibilityDto result) { for (var i = 0; i < result.reasons.Count; i++) if (result.reasons[i].severity == "error") return result.reasons[i].code; return "ineligible"; }
        static void Require(List<SpellcraftingValidationIssue> issues, string value, string path) { if (string.IsNullOrEmpty(value)) issues.Add(Issue("error", "missing_id", path, "A stable ID is required.")); }
        static void RequireComponent(List<SpellcraftingValidationIssue> issues, SpellComponentDto component, string path) { if (component == null) issues.Add(Issue("error", "missing_component", path, "Required spell component is missing.")); else { Require(issues, component.componentId, path + ".componentId"); Range(issues, component.condition, 0f, 1f, path + ".condition"); Range(issues, component.quality, 0f, 1f, path + ".quality"); } }
        static void OptionalComponent(List<SpellcraftingValidationIssue> issues, SpellComponentDto component, string path) { if (component != null) { Range(issues, component.condition, 0f, 1f, path + ".condition"); Range(issues, component.quality, 0f, 1f, path + ".quality"); } }
        static void Range(List<SpellcraftingValidationIssue> issues, float value, float min, float max, string path) { if (value < min || value > max) issues.Add(Issue("error", "out_of_range", path, "Value must be between " + min.ToString(CultureInfo.InvariantCulture) + " and " + max.ToString(CultureInfo.InvariantCulture) + ".")); }
        static SpellcraftingValidationIssue Issue(string severity, string code, string path, string detail) { return new SpellcraftingValidationIssue { severity = severity, code = code, path = path, detail = detail }; }
        static float Clamp01(float value) { return value < 0f ? 0f : value > 1f ? 1f : value; }
    }

    public static class SpellcraftingId
    {
        public static string Create(string prefix, params string[] parts)
        {
            var canonical = new StringBuilder((prefix ?? "id").Trim().ToLowerInvariant());
            if (parts != null) for (var i = 0; i < parts.Length; i++) canonical.Append('|').Append(Normalize(parts[i]));
            unchecked { ulong hash = 14695981039346656037UL; for (var i = 0; i < canonical.Length; i++) { hash ^= canonical[i]; hash *= 1099511628211UL; } return Normalize(prefix) + "-" + hash.ToString("x16", CultureInfo.InvariantCulture); }
        }
        static string Normalize(string value) { return (value ?? "").Trim().ToLowerInvariant(); }
    }
}