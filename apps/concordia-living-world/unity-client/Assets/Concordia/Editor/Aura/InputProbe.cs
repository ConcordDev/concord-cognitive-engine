using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: Play-mode proof for B-06. Drives the real Keyboard/Mouse devices through the Input
    /// System (the OS cannot be scripted on this Mac), then reads each action's
    /// <c>WasPressedThisFrame</c> — so a passing run means the asset, the bindings and the
    /// enable path all work, not just that a file exists.
    /// </summary>
    public static class InputProbe
    {
        static readonly (string action, Key key)[] KeyTable =
        {
            ("sprint", Key.LeftShift),
            ("jump", Key.Space),
            ("heavy", Key.F),
            ("special", Key.G),
            ("dodge", Key.X),
            ("guard", Key.C),
            ("interact", Key.E),
            ("cycleKit", Key.Q),
            ("menu", Key.I),
            ("skills", Key.K),
            ("slot1", Key.Digit1),
            ("slot2", Key.Digit2),
            ("slot3", Key.Digit3),
            ("groupPrev", Key.LeftBracket),
            ("groupNext", Key.RightBracket),
            ("horde", Key.H),
            ("extraction", Key.J),
            ("cancel", Key.Escape),
        };

        /// <summary>Asset + map loaded, and how many bindings each action carries.</summary>
        public static string Status()
        {
            var sb = new StringBuilder();
            sb.Append("playing=").Append(Application.isPlaying);
            sb.Append(" ready=").Append(ConcordiaInput.Ready);
            sb.Append(" map=");
            var map = ConcordiaInput_Map();
            if (map == null)
            {
                sb.Append("absent");
                return sb.ToString();
            }
            sb.Append("Player actions=").Append(map.actions.Count).Append(" bindings=").Append(map.bindings.Count);
            return sb.ToString();
        }

        /// <summary>Press every bound keyboard key in turn and report which actions fired.</summary>
        public static string PressAll()
        {
            if (!Application.isPlaying) return "not-playing";
            var kb = Keyboard.current;
            if (kb == null) return "no-keyboard";

            var map = ConcordiaInput_Map();
            if (map == null) return "no-map";

            var ok = new List<string>();
            var miss = new List<string>();

            foreach (var (action, key) in KeyTable)
            {
                var act = map.FindAction(action, false);
                if (act == null) { miss.Add(action + "(absent)"); continue; }

                InputSystem.QueueStateEvent(kb, new KeyboardState(key));
                InputSystem.Update();
                bool fired = act.WasPressedThisFrame();

                InputSystem.QueueStateEvent(kb, new KeyboardState());
                InputSystem.Update();

                if (fired) ok.Add(action);
                else
                {
                    // A miss names the resolved control so an invalid binding path is obvious.
                    string why = act.controls.Count == 0
                        ? "no-control"
                        : "path=" + act.controls[0].path;
                    miss.Add(action + "(" + why + ")");
                }
            }

            // Mouse left button carries the light attack.
            var mouse = Mouse.current;
            if (mouse != null)
            {
                var light = map.FindAction("light", false);
                InputSystem.QueueStateEvent(mouse, new MouseState { buttons = 1 });
                InputSystem.Update();
                bool fired = light != null && light.WasPressedThisFrame();
                InputSystem.QueueStateEvent(mouse, new MouseState());
                InputSystem.Update();
                if (fired) ok.Add("light"); else miss.Add("light");
            }

            // Move is a 1D read of the WASD composite.
            var move = map.FindAction("move", false);
            InputSystem.QueueStateEvent(kb, new KeyboardState(Key.W));
            InputSystem.Update();
            float y = move != null ? move.ReadValue<Vector2>().y : 0f;
            InputSystem.QueueStateEvent(kb, new KeyboardState());
            InputSystem.Update();
            if (y > 0.5f) ok.Add("move"); else miss.Add("move(y=" + y.ToString("F2") + ")");

            bool all = miss.Count == 0;
            string line = "pressed=" + ok.Count + "/" + (ok.Count + miss.Count) +
                          " ok=[" + string.Join(",", ok) + "]" +
                          (miss.Count > 0 ? " miss=[" + string.Join(",", miss) + "]" : "");
            if (all) AuraVerify.Pass("B-06", line); else AuraVerify.Fail("B-06", line);
            return line;
        }

        static InputActionMap ConcordiaInput_Map()
        {
            var asset = Resources.Load<InputActionAsset>(ConcordiaInput.ResourcePath);
            return asset != null ? asset.FindActionMap("Player", false) : null;
        }
    }
}
