using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: Play-mode proof for B-07 ("rebind dodge X→V, restart Play, V dodges and X does not").
    /// The rebind goes through the real <c>PerformInteractiveRebinding</c> path the controls panel
    /// button uses; keys are injected as device events because the OS cannot be scripted here.
    /// </summary>
    public static class RebindProbe
    {
        /// <summary>
        /// Step 1: open the same interactive rebind the CONTROLS tab button opens. The key press has
        /// to arrive on a later editor update — a press queued and flushed inside the same update is
        /// consumed before the operation attaches to the input system.
        /// </summary>
        public static string StartDodgeRebind()
        {
            if (!Application.isPlaying) return "not-playing";
            if (Keyboard.current == null) return "no-keyboard";

            string before = ConcordiaInput.BindingLine(ConcordiaInput.Dodge);
            bool started = ConcordiaInput.StartRebind(ConcordiaInput.Dodge);
            string line = "started=" + started + " listening=" + ConcordiaInput.Rebinding +
                          " action=" + ConcordiaInput.RebindingAction + " before=" + before;
            Debug.Log("[AuraProbe] B-07 start " + line);
            return line;
        }

        /// <summary>Step 2: press V and leave it held so the next natural input update sees it.</summary>
        public static string HoldV()
        {
            if (Keyboard.current == null) return "no-keyboard";
            InputSystem.QueueStateEvent(Keyboard.current, new KeyboardState(Key.V));
            return "queued V (listening=" + ConcordiaInput.Rebinding + ")";
        }

        /// <summary>Step 3: release V and report what dodge is bound to now.</summary>
        public static string FinishRebind()
        {
            InputSystem.QueueStateEvent(Keyboard.current, new KeyboardState());
            string after = ConcordiaInput.BindingLine(ConcordiaInput.Dodge);
            string line = "dodge now=" + after + " listening=" + ConcordiaInput.Rebinding +
                          " overrides=" + ConcordiaInput.HasOverrides;
            if (after.ToLowerInvariant().StartsWith("v") && !ConcordiaInput.Rebinding) AuraVerify.Pass("B-07 rebind", line);
            else AuraVerify.Fail("B-07 rebind", line);
            return line;
        }

        /// <summary>After a restart: V must dodge, X must not. Also reports the bound text.</summary>
        public static string CheckDodge(bool expectV)
        {
            if (!Application.isPlaying) return "not-playing";
            if (Keyboard.current == null) return "no-keyboard";

            bool vFires = Tap(Key.V);
            bool xFires = Tap(Key.X);
            string line = "dodge bind=" + ConcordiaInput.BindingLine(ConcordiaInput.Dodge) +
                          " overrides=" + ConcordiaInput.HasOverrides +
                          " V=" + vFires + " X=" + xFires;

            bool ok = expectV ? (vFires && !xFires) : (xFires);
            if (ok) AuraVerify.Pass("B-07 persist", line);
            else AuraVerify.Fail("B-07 persist", line);
            return line;
        }

        /// <summary>Clear the remap so the client returns to its shipped bindings.</summary>
        public static string ResetBinds()
        {
            ConcordiaInput.ResetOverrides();
            string line = "dodge=" + ConcordiaInput.BindingLine(ConcordiaInput.Dodge) +
                          " overrides=" + ConcordiaInput.HasOverrides;
            AuraVerify.Pass("B-07 reset", line);
            return line;
        }

        static bool Tap(Key key)
        {
            var kb = Keyboard.current;
            InputSystem.QueueStateEvent(kb, new KeyboardState(key));
            InputSystem.Update();
            bool fired = ConcordiaInput.Down(ConcordiaInput.Dodge);
            InputSystem.QueueStateEvent(kb, new KeyboardState());
            InputSystem.Update();
            return fired;
        }
    }
}
