using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.GameplayCore.GoldenSlice;

namespace Concordia.ConKay
{
    public enum ConKayInspectionKind
    {
        None,
        Object,
        Npc,
        Building,
        Capability,
        WorldField,
        Economy,
        Consequence,
        Spell,
        Weapon,
        Container,
        GoldenSlice
    }

    [Serializable]
    public sealed class ConKayFact
    {
        public string key;
        public string value;
        public string source;

        public ConKayFact() { }

        public ConKayFact(string key, string value, string source)
        {
            this.key = key ?? string.Empty;
            this.value = value ?? string.Empty;
            this.source = source ?? string.Empty;
        }
    }

    [Serializable]
    public sealed class ConKayChainLink
    {
        public string id;
        public string kind;
        public string summary;
        public string source;

        public ConKayChainLink() { }

        public ConKayChainLink(string id, string kind, string summary, string source)
        {
            this.id = id ?? string.Empty;
            this.kind = kind ?? string.Empty;
            this.summary = summary ?? string.Empty;
            this.source = source ?? string.Empty;
        }
    }

    [Serializable]
    public sealed class ConKayInspectionSnapshot
    {
        public ConKayInspectionKind kind;
        public string stableId;
        public string title;
        public string why;
        public string authority;
        public bool authoritativeRecordFound;
        public Vector3 worldPosition;
        public readonly List<ConKayFact> facts = new List<ConKayFact>();
        public readonly List<ConKayChainLink> chain = new List<ConKayChainLink>();

        public static ConKayInspectionSnapshot Empty(ConKayInspectionKind kind, string title, string why, string authority)
        {
            return new ConKayInspectionSnapshot
            {
                kind = kind,
                title = title ?? string.Empty,
                why = why ?? string.Empty,
                authority = authority ?? string.Empty,
                authoritativeRecordFound = false
            };
        }

        public void Fact(string key, string value, string source)
        {
            facts.Add(new ConKayFact(key, value, source));
        }

        public void Link(string id, string linkKind, string summary, string source)
        {
            chain.Add(new ConKayChainLink(id, linkKind, summary, source));
        }
    }

    /// <summary>
    /// Read-only diagnostic port. Implementations may observe live records but must not
    /// create, update, save, or otherwise author gameplay state.
    /// </summary>
    public interface IConKayRuntimeSource
    {
        ConKayInspectionSnapshot InspectTarget(GameObject target, Vector3 worldPoint);
        ConKayInspectionSnapshot InspectCapability(GameObject target);
        ConKayInspectionSnapshot InspectWorldField(Vector3 worldPoint);
        ConKayInspectionSnapshot InspectEconomy(string recordId);
        ConKayInspectionSnapshot InspectConsequences(string subjectId);
        ConKayInspectionSnapshot InspectSpell(string persistentSpellId);
        ConKayInspectionSnapshot InspectWeapon(string persistentWeaponId);
        ConKayInspectionSnapshot InspectContainer(string containerId);
        ConKayInspectionSnapshot InspectGoldenSlice(string recordId);
    }

    /// <summary>
    /// Future composition seam for GameplayCoreBridge. The workbench only consumes the
    /// port; it never owns or mutates the gameplay bridge.
    /// </summary>
    public interface IConKayBridgeAdapter
    {
        void Bind(object bridge);
        IConKayRuntimeSource Source { get; }
    }

    /// <summary>
    /// Optional stable identity for scene objects that have a WorldFabric record but are
    /// not yet linked by the renderer. This component contains metadata only.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ConKayIdentity : MonoBehaviour
    {
        public string recordId;
        public ConKayInspectionKind recordKind = ConKayInspectionKind.Object;
        public string authority = "scene identity";
    }
}
