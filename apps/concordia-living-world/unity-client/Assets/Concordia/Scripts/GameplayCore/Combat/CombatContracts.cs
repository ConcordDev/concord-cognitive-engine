using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.Combat
{
    public enum CombatActionKind { Melee, Ranged, Magic, Creature, Mounted, Aerial, Vehicle }
    public enum CombatPhase { Anticipation, Startup, Active, Collision, Recovery, Stagger }
    public enum CombatDefenseMode { None, Block, DirectionalBlock, PerfectGuard, Parry, DodgeIFrames }
    public enum CombatDefenseOutcome { Hit, Blocked, PerfectGuarded, Parried, Dodged }
    public enum CombatEventType { IntentQueued, PhaseChanged, CollisionTested, Hit, Blocked, PerfectGuarded, Parried, Dodged, Staggered }

    [Serializable]
    public struct CombatPhaseWindow
    {
        public float Anticipation;
        public float Startup;
        public float Active;
        public float Recovery;

        public CombatPhaseWindow(float anticipation, float startup, float active, float recovery)
        {
            Anticipation = Mathf.Max(0f, anticipation);
            Startup = Mathf.Max(0f, startup);
            Active = Mathf.Max(0f, active);
            Recovery = Mathf.Max(0f, recovery);
        }

        public float Total => Anticipation + Startup + Active + Recovery;
    }

    [Serializable]
    public sealed class CombatActionSpec
    {
        public string ActionId;
        public CombatActionKind Kind;
        public CombatPhaseWindow Window;
        public float Damage;
        public float PoiseDamage;
        public float Impulse;
        public float Reach;
        public float Radius;
        public float BlockDamageMultiplier = 0.25f;
        public float BlockPoiseMultiplier = 0.5f;
        public float PerfectGuardWindow = 0.12f;
        public float ParryWindow = 0.1f;
        public float DirectionalTolerance = 0.35f;
        public string CounterActionId;
        public string DamageType;
        public string PresentationTag;
    }

    [Serializable]
    public struct CombatIntent
    {
        public string ActionId;
        public CombatActionKind Kind;
        public float IssuedAt;
        public string SourceId;
    }

    [Serializable]
    public struct CombatContext
    {
        public string ActorId;
        public Vector3 Position;
        public Vector3 Forward;
        public bool Authoritative;
    }

    [Serializable]
    public struct CombatDefenseState
    {
        public CombatDefenseMode Mode;
        public Vector3 Facing;
        public float StartedAt;
        public float EndsAt;
        public float PerfectGuardUntil;
        public float ParryUntil;
        public float DodgeIFramesUntil;
        public string CounterActionId;
    }

    [Serializable]
    public struct CombatDamagePacket
    {
        public string SourceId;
        public string TargetId;
        public float Amount;
        public float PoiseDamage;
        public float Impulse;
        public Vector3 Direction;
        public string DamageType;
        public CombatActionKind Kind;
    }

    [Serializable]
    public struct CombatEvent
    {
        public CombatEventType Type;
        public CombatPhase Phase;
        public float Time;
        public string SourceId;
        public string TargetId;
        public string ActionId;
        public string Detail;
        public float Value;

        public CombatEvent(CombatEventType type, CombatPhase phase, float time, string sourceId, string targetId, string actionId, string detail, float value)
        {
            Type = type;
            Phase = phase;
            Time = time;
            SourceId = sourceId;
            TargetId = targetId;
            ActionId = actionId;
            Detail = detail;
            Value = value;
        }
    }

    public interface ICombatActionSelector
    {
        bool TrySelect(CombatIntent intent, CombatContext context, out CombatActionSpec action, out string reason);
    }

    public interface ICombatant
    {
        string CombatId { get; }
        bool IsAlive { get; }
        Vector3 Position { get; }
        Vector3 Forward { get; }
        float Vitality { get; }
        float Poise { get; }
        float MaxPoise { get; }
        CombatDefenseState Defense { get; }
        void ApplyDamage(CombatDamagePacket packet);
        void ApplyPoiseDamage(float amount, string sourceId);
        void ApplyImpulse(Vector3 impulse);
        void React(CombatDamagePacket packet);
        void Stagger(float duration, string sourceId);
        void EnqueueCounter(CombatIntent intent);
    }

    public interface ICombatantRegistry
    {
        IEnumerable<ICombatant> All { get; }
        void Clear();
        void Register(ICombatant combatant);
        bool TryGet(string combatId, out ICombatant combatant);
    }

    /// DISCONNECTED from the live incoming path. Hostile and ConcordiaPlayer.TakeHit
    /// resolve through Concordia.Core.HitResolver. Do not wire a third evaluator here.
    public static class CombatDefenseEvaluator
    {
        public static CombatDefenseOutcome Evaluate(CombatDefenseState defense, CombatActionSpec action, Vector3 defenderForward, Vector3 attackDirection, float time)
        {
            if (defense.Mode == CombatDefenseMode.DodgeIFrames && time <= defense.DodgeIFramesUntil)
                return CombatDefenseOutcome.Dodged;

            var active = defense.Mode != CombatDefenseMode.None && time <= defense.EndsAt;
            if (!active) return CombatDefenseOutcome.Hit;

            var facing = defense.Facing.sqrMagnitude > 0.001f ? defense.Facing.normalized : defenderForward.normalized;
            var incoming = attackDirection.sqrMagnitude > 0.001f ? attackDirection.normalized : -facing;
            var directional = Vector3.Dot(facing, -incoming) >= Mathf.Clamp(action.DirectionalTolerance, -1f, 1f);

            if (defense.Mode == CombatDefenseMode.PerfectGuard && time <= defense.PerfectGuardUntil && directional)
                return CombatDefenseOutcome.PerfectGuarded;
            if (defense.Mode == CombatDefenseMode.Parry && time <= defense.ParryUntil && directional)
                return CombatDefenseOutcome.Parried;
            if ((defense.Mode == CombatDefenseMode.Block || defense.Mode == CombatDefenseMode.DirectionalBlock) && (defense.Mode == CombatDefenseMode.Block || directional))
                return CombatDefenseOutcome.Blocked;
            return CombatDefenseOutcome.Hit;
        }
    }

    public sealed class CombatEventRecorder
    {
        readonly List<CombatEvent> _events = new List<CombatEvent>();
        public IReadOnlyList<CombatEvent> Events => _events;
        public void Record(CombatEvent combatEvent) => _events.Add(combatEvent);
        public void Clear() => _events.Clear();
    }
}
