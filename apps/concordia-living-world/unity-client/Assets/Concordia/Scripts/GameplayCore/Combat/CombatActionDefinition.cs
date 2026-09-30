using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.Combat
{
    [CreateAssetMenu(menuName = "Concordia/Gameplay Core/Combat/Action Definition", fileName = "CombatAction")]
    public sealed class CombatActionDefinition : ScriptableObject
    {
        public string actionId = "action";
        public CombatActionKind kind = CombatActionKind.Melee;
        public float anticipation = 0.08f, startup = 0.12f, active = 0.12f, recovery = 0.28f;
        public float damage = 10f, poiseDamage = 10f, impulse = 1f, reach = 2f, radius = 0.65f;
        [Range(0f, 1f)] public float blockDamageMultiplier = 0.25f, blockPoiseMultiplier = 0.5f;
        public float perfectGuardWindow = 0.12f, parryWindow = 0.10f;
        [Range(-1f, 1f)] public float directionalTolerance = 0.35f;
        public string counterActionId, damageType = "physical", presentationTag;
        public CombatActionSpec ToSpec() => new CombatActionSpec { ActionId = actionId, Kind = kind, Window = new CombatPhaseWindow(anticipation, startup, active, recovery), Damage = damage, PoiseDamage = poiseDamage, Impulse = impulse, Reach = reach, Radius = radius, BlockDamageMultiplier = blockDamageMultiplier, BlockPoiseMultiplier = blockPoiseMultiplier, PerfectGuardWindow = perfectGuardWindow, ParryWindow = parryWindow, DirectionalTolerance = directionalTolerance, CounterActionId = counterActionId, DamageType = damageType, PresentationTag = presentationTag };
    }

    [CreateAssetMenu(menuName = "Concordia/Gameplay Core/Combat/Action Catalog", fileName = "CombatActionCatalog")]
    public sealed class CombatActionCatalog : ScriptableObject, ICombatActionSelector
    {
        public List<CombatActionDefinition> actions = new List<CombatActionDefinition>();
        readonly Dictionary<string, CombatActionDefinition> _lookup = new Dictionary<string, CombatActionDefinition>();
        bool _indexed;
        public void RebuildIndex() { _lookup.Clear(); for (var i = 0; i < actions.Count; i++) { var a = actions[i]; if (a != null && !string.IsNullOrEmpty(a.actionId)) _lookup[a.actionId] = a; } _indexed = true; }
        public bool TryGet(string id, out CombatActionDefinition definition) { if (!_indexed) RebuildIndex(); return _lookup.TryGetValue(id ?? string.Empty, out definition); }
        public bool TrySelect(CombatIntent intent, CombatContext context, out CombatActionSpec action, out string reason)
        {
            action = null; reason = string.Empty; CombatActionDefinition definition;
            if (!TryGet(intent.ActionId, out definition)) { reason = "unknown_action"; return false; }
            if (definition.kind != intent.Kind) { reason = "action_kind_mismatch"; return false; }
            action = definition.ToSpec(); return true;
        }
    }
}
