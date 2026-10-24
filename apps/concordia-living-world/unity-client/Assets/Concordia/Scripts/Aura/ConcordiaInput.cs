using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Concordia
{
    /// <summary>
    /// Aura: the one place gameplay reads input (roadmap B-06).
    /// Backed by <c>Resources/Concordia/ConcordiaControls.inputactions</c>, so every verb has a
    /// keyboard binding and a gamepad binding. The raw key path stays authoritative for the
    /// keyboard (identical feel to the pre-B-06 client) and the action supplies the pad plus the
    /// logged press. Falls back to the legacy Input API when the Input System is compiled out.
    /// </summary>
    public static class ConcordiaInput
    {
        public const string ResourcePath = "Concordia/ConcordiaControls";

        /// <summary>Log every action press in the editor / development builds (B-06 evidence).</summary>
        public static bool Trace = true;

        // ---- action names (keep in step with ConcordiaControls.inputactions) --------------
        public const string Move = "move", Look = "look", Sprint = "sprint", Jump = "jump",
            Light = "light", Heavy = "heavy", Special = "special", Dodge = "dodge",
            Guard = "guard", Interact = "interact", CycleKit = "cycleKit", Menu = "menu",
            Skills = "skills", Slot1 = "slot1", Slot2 = "slot2", Slot3 = "slot3",
            GroupPrev = "groupPrev", GroupNext = "groupNext", Horde = "horde",
            Extraction = "extraction", Cancel = "cancel";

#if ENABLE_INPUT_SYSTEM
        static InputActionAsset _asset;
        static InputActionMap _map;
        static bool _tried;

        static void Ensure()
        {
            if (_tried) return;
            _tried = true;

            _asset = Resources.Load<InputActionAsset>(ResourcePath);
            if (_asset == null)
            {
                Debug.LogWarning("[ConcordiaInput] no asset at Resources/" + ResourcePath + " — keyboard only");
                return;
            }

            _map = _asset.FindActionMap("Player", false);
            if (_map == null)
            {
                Debug.LogWarning("[ConcordiaInput] action map 'Player' missing");
                return;
            }

            _map.Enable();
            if (Trace) _map.actionTriggered += OnActionTriggered;
            Debug.Log("[ConcordiaInput] bound " + ResourcePath + " actions=" + _map.actions.Count);
        }

        static void OnActionTriggered(InputAction.CallbackContext ctx)
        {
            if (!ctx.performed) return;
            Debug.Log("[ConcordiaInput] action=" + ctx.action.name);
        }

        /// <summary>True when the action asset loaded and the Player map is enabled.</summary>
        public static bool Ready { get { Ensure(); return _map != null; } }

        public static bool Down(string action)
        {
            Ensure();
            var a = _map != null ? _map.FindAction(action, false) : null;
            return a != null && a.WasPressedThisFrame();
        }

        public static bool Held(string action)
        {
            Ensure();
            var a = _map != null ? _map.FindAction(action, false) : null;
            return a != null && a.IsPressed();
        }

        public static Vector2 Axis(string action)
        {
            Ensure();
            var a = _map != null ? _map.FindAction(action, false) : null;
            return a != null ? a.ReadValue<Vector2>() : Vector2.zero;
        }

        // ---- KeyCode API used by the rest of the client ----------------------------------

        public static bool Down(KeyCode key)
        {
            if (KeyDownRaw(key)) return true;
            var action = ActionFor(key);
            return action != null && Down(action);
        }

        public static bool Held(KeyCode key)
        {
            if (KeyHeldRaw(key)) return true;
            var action = ActionFor(key);
            return action != null && Held(action);
        }

        public static bool MouseDown(int button)
        {
            var mouse = Mouse.current;
            if (mouse != null)
            {
                bool raw = button == 0 ? mouse.leftButton.wasPressedThisFrame : mouse.rightButton.wasPressedThisFrame;
                if (raw) return true;
            }
            return button == 0 && Down(Light);
        }

        static bool KeyDownRaw(KeyCode k)
        {
            var kb = Keyboard.current;
            if (kb == null) return false;
            var key = ToKey(k);
            return key.HasValue && kb[key.Value].wasPressedThisFrame;
        }

        static bool KeyHeldRaw(KeyCode k)
        {
            var kb = Keyboard.current;
            if (kb == null) return false;
            var key = ToKey(k);
            return key.HasValue && kb[key.Value].isPressed;
        }

        /// <summary>KeyCode to physical key. Superset of what gameplay asks for.</summary>
        static Key? ToKey(KeyCode k) => k switch
        {
            KeyCode.LeftShift => Key.LeftShift,
            KeyCode.LeftControl => Key.LeftCtrl,
            KeyCode.Space => Key.Space,
            KeyCode.W => Key.W,
            KeyCode.A => Key.A,
            KeyCode.S => Key.S,
            KeyCode.D => Key.D,
            KeyCode.X => Key.X,
            KeyCode.C => Key.C,
            KeyCode.F => Key.F,
            KeyCode.G => Key.G,
            KeyCode.Q => Key.Q,
            KeyCode.E => Key.E,
            KeyCode.I => Key.I,
            KeyCode.K => Key.K,
            KeyCode.H => Key.H,
            KeyCode.J => Key.J,
            KeyCode.Return => Key.Enter,
            KeyCode.Alpha1 => Key.Digit1,
            KeyCode.Alpha2 => Key.Digit2,
            KeyCode.Alpha3 => Key.Digit3,
            KeyCode.LeftBracket => Key.LeftBracket,
            KeyCode.RightBracket => Key.RightBracket,
            KeyCode.Escape => Key.Escape,
            KeyCode.Tab => Key.Tab,
            _ => null
        };

        /// <summary>Which action carries the same verb as this key.</summary>
        static string ActionFor(KeyCode k) => k switch
        {
            KeyCode.LeftShift => Sprint,
            KeyCode.Space => Jump,
            KeyCode.F => Heavy,
            KeyCode.G => Special,
            KeyCode.X => Dodge,
            KeyCode.C => Guard,
            KeyCode.E => Interact,
            KeyCode.Q => CycleKit,
            KeyCode.I => Menu,
            KeyCode.K => Skills,
            KeyCode.Alpha1 => Slot1,
            KeyCode.Alpha2 => Slot2,
            KeyCode.Alpha3 => Slot3,
            KeyCode.LeftBracket => GroupPrev,
            KeyCode.RightBracket => GroupNext,
            KeyCode.H => Horde,
            KeyCode.J => Extraction,
            KeyCode.Escape => Cancel,
            KeyCode.Tab => Cancel,
            _ => null
        };

#else // legacy Input Manager fallback, unchanged behaviour

        public static bool Ready => false;

        public static bool Down(string action) => false;
        public static bool Held(string action) => false;
        public static Vector2 Axis(string action) => Vector2.zero;

        public static bool Down(KeyCode key) => Input.GetKeyDown(key);
        public static bool Held(KeyCode key) => Input.GetKey(key);

        public static bool MouseDown(int button) => Input.GetMouseButtonDown(button);

#endif
    }
}
