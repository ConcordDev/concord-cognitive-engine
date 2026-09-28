using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.Spellcrafting
{
    [Serializable]
    public sealed class SpellcraftingPersistenceEnvelopeDto
    {
        public int schemaVersion = 1;
        public string savedAtUtc;
        public List<SpellPersistenceDto> spells = new List<SpellPersistenceDto>();
    }

    [Serializable]
    public sealed class SpellPersistenceDto
    {
        public int schemaVersion = 1;
        public string persistentSpellId;
        public SpellConfigurationDto configuration = new SpellConfigurationDto();
        public SpellProvenanceChainDto provenance = new SpellProvenanceChainDto();
        public SpellResolvedEffectDto lastResolvedEffect = new SpellResolvedEffectDto();
        public SpellEnvironmentalModifierDto lastEnvironment = new SpellEnvironmentalModifierDto();
        public string composedAtUtc;
    }

    public static class SpellcraftingPersistence
    {
        public const int CurrentSchemaVersion = 1;

        public static SpellPersistenceDto ToDto(ComposedSpellRecord source)
        {
            if (source == null) return null;
            return new SpellPersistenceDto { schemaVersion = source.schemaVersion <= 0 ? CurrentSchemaVersion : source.schemaVersion, persistentSpellId = source.persistentSpellId ?? "", configuration = source.configuration ?? new SpellConfigurationDto(), provenance = source.provenance ?? new SpellProvenanceChainDto(), lastResolvedEffect = source.lastResolvedEffect ?? new SpellResolvedEffectDto(), lastEnvironment = source.lastEnvironment ?? new SpellEnvironmentalModifierDto(), composedAtUtc = source.composedAtUtc ?? "" };
        }

        public static ComposedSpellRecord FromDto(SpellPersistenceDto source)
        {
            if (source == null || source.schemaVersion <= 0 || source.schemaVersion > CurrentSchemaVersion) return null;
            var result = new ComposedSpellRecord { schemaVersion = source.schemaVersion, persistentSpellId = source.persistentSpellId ?? "", configuration = source.configuration ?? new SpellConfigurationDto(), provenance = source.provenance ?? new SpellProvenanceChainDto(), lastResolvedEffect = source.lastResolvedEffect ?? new SpellResolvedEffectDto(), lastEnvironment = source.lastEnvironment ?? new SpellEnvironmentalModifierDto(), composedAtUtc = source.composedAtUtc ?? "" };
            if (result.configuration.augments == null) result.configuration.augments = new List<SpellComponentDto>();
            if (result.configuration.tags == null) result.configuration.tags = new List<string>();
            if (result.provenance.links == null) result.provenance.links = new List<SpellProvenanceLinkDto>();
            if (result.lastResolvedEffect.explanations == null) result.lastResolvedEffect.explanations = new List<SpellResolutionContributionDto>();
            if (result.lastEnvironment.explanations == null) result.lastEnvironment.explanations = new List<string>();
            return result;
        }

        public static string ToJson(SpellcraftingPersistenceEnvelopeDto source, bool prettyPrint = false) { return JsonUtility.ToJson(source ?? new SpellcraftingPersistenceEnvelopeDto(), prettyPrint); }
        public static SpellcraftingPersistenceEnvelopeDto FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var result = JsonUtility.FromJson<SpellcraftingPersistenceEnvelopeDto>(json);
            if (result == null || result.schemaVersion <= 0 || result.schemaVersion > CurrentSchemaVersion) return null;
            if (result.spells == null) result.spells = new List<SpellPersistenceDto>();
            return result;
        }
    }
}