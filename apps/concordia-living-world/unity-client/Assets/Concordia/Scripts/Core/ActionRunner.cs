// Concordia gameplay core — Action.
//
// Implements the directive's §1 combat loop as an explicit, deterministic phase machine:
//
//   intent -> input buffer -> selection -> startup -> active -> [collision/defense/hit]
//          -> recovery -> next available action
//
// One runner drives every weapon family (§3), magic (§13) and firearms (§14) — they differ by
// DATA (frame windows, costs, reach), not by having separate bespoke state machines. That is the
// §33 requirement that systems share one vocabulary instead of being isolated mini-games.
//
// Time is integer milliseconds, not float seconds: frame windows are the contract between feel
// and resolution, and float drift across a long session would quietly change parry timing.

using System;
using System.Collections.Generic;

namespace Concordia.Core
{
    public enum ActionKind
    {
        LightAttack,
        HeavyAttack,
        Thrust,
        Block,
        Parry,
        Dodge,
        Cast,
        Shoot
    }

    public enum ActionPhase
    {
        Idle,
        Startup,
        Active,
        Recovery
    }

    /// Pure frame data. Authoring a new move means adding one of these, not new control flow.
    public sealed class ActionDef
    {
        public string Id = "unnamed";
        public ActionKind Kind = ActionKind.LightAttack;

        public int StartupMs = 120;
        public int ActiveMs = 60;
        public int RecoveryMs = 240;

        public float StaminaCost;
        public float Damage;
        public float PoiseDamage;
        public float ReachMeters = 2.0f;

        /// Invulnerability window, relative to action start. Used by Dodge (§2).
        public int IFrameStartMs;
        public int IFrameEndMs;

        /// Parry window, relative to action start. A hit arriving inside it is deflected (§2).
        public int ParryStartMs;
        public int ParryEndMs;

        /// Attacks may be cancelled into another action during recovery after this point —
        /// what makes combos feel responsive instead of locked (§1, §29).
        public int CancelAfterMs = int.MaxValue;

        public int TotalMs => StartupMs + ActiveMs + RecoveryMs;
    }

    public sealed class ActionRunner
    {
        public ActionPhase Phase { get; private set; } = ActionPhase.Idle;
        public ActionDef Current { get; private set; }

        /// Elapsed ms since the current action began.
        public int ElapsedMs { get; private set; }

        /// True on the tick the action first entered Active — the frame a hit may be emitted.
        public bool JustBecameActive { get; private set; }

        ActionDef _buffered;
        int _bufferAgeMs;

        /// How long a queued input stays valid. Without this, players who press slightly early
        /// get nothing and the game feels unresponsive (§1 input buffer, §31 fluidity).
        public int BufferWindowMs = 220;

        public bool IsIdle => Phase == ActionPhase.Idle;

        public bool IsInvulnerable =>
            Current != null && Current.IFrameEndMs > Current.IFrameStartMs &&
            ElapsedMs >= Current.IFrameStartMs && ElapsedMs < Current.IFrameEndMs;

        public bool IsParrying =>
            Current != null && Current.ParryEndMs > Current.ParryStartMs &&
            ElapsedMs >= Current.ParryStartMs && ElapsedMs < Current.ParryEndMs;

        public bool IsGuarding =>
            Current != null && Current.Kind == ActionKind.Block && Phase != ActionPhase.Recovery;

        /// Can a new action start right now — either idle, or far enough into recovery to cancel.
        public bool CanAct =>
            Phase == ActionPhase.Idle ||
            (Phase == ActionPhase.Recovery && Current != null && ElapsedMs >= Current.CancelAfterMs);

        /// Starts an action if allowed and affordable. Returns false when it was not started —
        /// callers must not assume success (an honest failure, never a silent no-op that looks fine).
        public bool TryBegin(ActionDef def, ActorState actor)
        {
            if (def == null || actor == null || !actor.IsAlive) return false;
            if (!CanAct) return false;
            if (def.StaminaCost > 0f && !actor.TrySpendStamina(def.StaminaCost)) return false;

            Current = def;
            Phase = def.StartupMs > 0 ? ActionPhase.Startup : ActionPhase.Active;
            ElapsedMs = 0;
            JustBecameActive = Phase == ActionPhase.Active;
            return true;
        }

        /// Queues an action to fire as soon as the current one allows. Returns false if it was
        /// started immediately instead of buffered.
        public bool Buffer(ActionDef def, ActorState actor)
        {
            if (def == null) return false;
            if (CanAct && TryBegin(def, actor)) return false;
            _buffered = def;
            _bufferAgeMs = 0;
            return true;
        }

        public void Tick(int deltaMs, ActorState actor)
        {
            if (deltaMs <= 0) return;
            JustBecameActive = false;

            if (_buffered != null)
            {
                _bufferAgeMs += deltaMs;
                if (_bufferAgeMs > BufferWindowMs) _buffered = null;
            }

            if (Current != null)
            {
                var prevPhase = Phase;
                ElapsedMs += deltaMs;

                var startupEnd = Current.StartupMs;
                var activeEnd = startupEnd + Current.ActiveMs;
                var total = Current.TotalMs;

                if (ElapsedMs >= total)
                {
                    Current = null;
                    Phase = ActionPhase.Idle;
                    ElapsedMs = 0;
                }
                else if (ElapsedMs >= activeEnd) Phase = ActionPhase.Recovery;
                else if (ElapsedMs >= startupEnd) Phase = ActionPhase.Active;
                else Phase = ActionPhase.Startup;

                if (Phase == ActionPhase.Active && prevPhase != ActionPhase.Active)
                    JustBecameActive = true;
            }

            if (_buffered != null && CanAct)
            {
                var next = _buffered;
                _buffered = null;
                TryBegin(next, actor);
            }
        }

        public void Cancel()
        {
            Current = null;
            Phase = ActionPhase.Idle;
            ElapsedMs = 0;
            _buffered = null;
        }
    }
}
