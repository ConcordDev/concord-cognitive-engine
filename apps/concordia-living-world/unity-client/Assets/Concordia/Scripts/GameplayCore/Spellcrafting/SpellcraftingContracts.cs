using System;
using System.Collections.Generic;
using Concordia;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.WorldField;

namespace Concordia.GameplayCore.Spellcrafting
{
    public enum SpellComponentSlot { Source, Focus, Catalyst, Form, Delivery, Cost, Augment }

    [Serializable]
    public sealed class SpellEffectContributionDto
    {
        public float potency;
        public float range;
        public float area;
        public float duration;
        public float control;
        public float recovery;
        public string damageType = "arcane";
        public string reason;
    }

    [Serializable]
    public sealed class SpellComponentDto
    {
        public string componentId;
        public string displayName;
        public SpellComponentSlot slot;
        public string fabricationObjectId;
        public FabricationMaterialClass materialClass = FabricationMaterialClass.Arcane;
        public List<string> compatibilityTags = new List<string>();
        public SpellEffectContributionDto contribution = new SpellEffectContributionDto();
        public float quality = 0.5f;
        public float condition = 1f;

        public bool IsUsable() { return !string.IsNullOrEmpty(componentId) && condition > 0f; }
    }

    [Serializable]
    public sealed class SpellQualityDto
    {
        public float score = 0.5f;
        public FabricationQualityGrade grade = FabricationQualityGrade.Standard;
        public float potencyBonus;
        public float controlBonus;
        public float stabilityBonus;
        public string inspectionId;
    }

    [Serializable]
    public sealed class SpellStabilityDto
    {
        public float baseStability = 0.9f;
        public float fieldSensitivity = 0.5f;
        public float materialSensitivity = 0.25f;
        public float fatigueSensitivity = 0.15f;
        public float attunementEffect = 0.2f;
        public float minimumCastStability = 0.05f;
        public float currentFatigue;
        public int casts;
    }

    [Serializable]
    public sealed class SpellConfigurationDto
    {
        public int schemaVersion = 1;
        public string spellTemplateId;
        public string displayName;
        public string recipeId;
        public string sourceFabricationObjectId;
        public FabricationDomain fabricationDomain = FabricationDomain.MagicalArtifact;
        public string ownerId;
        public WorldId originWorld = WorldId.Hub;
        public SpellComponentDto source = new SpellComponentDto { slot = SpellComponentSlot.Source };
        public SpellComponentDto focus = new SpellComponentDto { slot = SpellComponentSlot.Focus };
        public SpellComponentDto catalyst = new SpellComponentDto { slot = SpellComponentSlot.Catalyst };
        public SpellComponentDto form = new SpellComponentDto { slot = SpellComponentSlot.Form };
        public SpellComponentDto delivery = new SpellComponentDto { slot = SpellComponentSlot.Delivery };
        public SpellComponentDto cost = new SpellComponentDto { slot = SpellComponentSlot.Cost };
        public List<SpellComponentDto> augments = new List<SpellComponentDto>();
        public SpellQualityDto quality = new SpellQualityDto();
        public SpellStabilityDto stability = new SpellStabilityDto();
        public List<string> tags = new List<string>();
    }

    [Serializable]
    public sealed class SpellProvenanceLinkDto
    {
        public string linkId;
        public string parentLinkId;
        public string stage;
        public string sourceId;
        public string fabricationObjectId;
        public string actorId;
        public string worldId;
        public string locationId;
        public string occurredAtUtc;
        public string detail;
    }

    [Serializable]
    public sealed class SpellProvenanceChainDto
    {
        public string provenanceId;
        public string rootFabricationObjectId;
        public List<SpellProvenanceLinkDto> links = new List<SpellProvenanceLinkDto>();
    }

    [Serializable]
    public sealed class SpellResolvedEffectDto
    {
        public float potency;
        public float range;
        public float area;
        public float duration;
        public float control;
        public float recovery;
        public float stability;
        public string damageType = "arcane";
        public List<SpellResolutionContributionDto> explanations = new List<SpellResolutionContributionDto>();
    }

    [Serializable]
    public sealed class SpellResolutionContributionDto
    {
        public string statId;
        public float value;
        public string sourceId;
        public string stage;
        public string reason;
    }

    [Serializable]
    public sealed class SpellEnvironmentalModifierDto
    {
        public WorldId targetWorld;
        public bool foreignWorld;
        public float resolutionMultiplier = 1f;
        public float potencyMultiplier = 1f;
        public float stabilityMultiplier = 1f;
        public float rangeMultiplier = 1f;
        public float areaMultiplier = 1f;
        public float recoveryMultiplier = 1f;
        public string dominantInfluence;
        public List<string> explanations = new List<string>();
    }

    [Serializable]
    public sealed class ComposedSpellRecord
    {
        public int schemaVersion = 1;
        public string persistentSpellId;
        public SpellConfigurationDto configuration = new SpellConfigurationDto();
        public SpellProvenanceChainDto provenance = new SpellProvenanceChainDto();
        public SpellResolvedEffectDto lastResolvedEffect = new SpellResolvedEffectDto();
        public SpellEnvironmentalModifierDto lastEnvironment = new SpellEnvironmentalModifierDto();
        public string composedAtUtc;
    }

    [Serializable]
    public sealed class SpellCompositionContext
    {
        public string instanceId;
        public string actorId;
        public string locationId;
        public string createdAtUtc;
        public string sourceWorldId;
    }

    [Serializable]
    public sealed class SpellWorldContext
    {
        public WorldFieldQuery query;
        public WorldFieldSnapshot snapshot;
    }

    [Serializable]
    public sealed class SpellCastRequest
    {
        public string actorId;
        public bool operatorAuthorized = true;
        public float currentFatigue;
        public float fatigueLimit = 100f;
        public SpellWorldContext world = new SpellWorldContext();
    }

    [Serializable]
    public sealed class SpellCastReason
    {
        public string code;
        public string severity;
        public string detail;
        public override string ToString() { return severity + " " + code + ": " + detail; }
    }

    [Serializable]
    public sealed class SpellCastEligibilityDto
    {
        public bool canCast;
        public bool foreignWorldUse;
        public string persistentSpellId;
        public string reasonCode;
        public string provenanceId;
        public SpellEnvironmentalModifierDto environment = new SpellEnvironmentalModifierDto();
        public SpellResolvedEffectDto resolvedEffect = new SpellResolvedEffectDto();
        public List<SpellCastReason> reasons = new List<SpellCastReason>();
    }

    [Serializable]
    public sealed class SpellcraftingValidationIssue
    {
        public string severity;
        public string code;
        public string path;
        public string detail;
        public override string ToString() { return severity + " " + code + " " + path + ": " + detail; }
    }

    [Serializable]
    public sealed class SpellCompositionResult
    {
        public bool success;
        public string message;
        public ComposedSpellRecord spell;
        public List<SpellcraftingValidationIssue> issues = new List<SpellcraftingValidationIssue>();

        public static SpellCompositionResult Fail(string message, List<SpellcraftingValidationIssue> issues)
        {
            return new SpellCompositionResult { success = false, message = message ?? "Spell composition failed.", issues = issues ?? new List<SpellcraftingValidationIssue>() };
        }
    }
}