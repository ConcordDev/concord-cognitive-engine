using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Utilities;
#endif

namespace Concordia
{
    /// <summary>
    /// Aura: the one place gameplay reads input (roadmap B-06) and rebinds it (roadmap B-07).
    /// Backed by <c>Resources/Concordia/ConcordiaControls.inputactions</c>; binding overrides are
    /// saved to PlayerPrefs so a remap survives a restart. The legacy Input Manager path keeps a
    /// KeyCode per action, so the client still plays with the Input System compiled out.
    /// </summary>
    public static class ConcordiaInput
    {
        public const string ResourcePath = "Concordia/ConcordiaControls";
        public const string OverridePref = "concordia.input.overrides";

        /// <summary>Log every action press in the editor / development builds (B-06 evidence).</summary>
        public static bool Trace = true;

        // ---- action names (keep in step with ConcordiaControls.inputactions) --------------
        public const string Move = "move", Look = "look", Sprint = "sprint", Jump = "jump",
            Light = "light", Heavy = "heavy", Special = "special", Dodge = "dodge",
            Guard = "guard", Interact = "interact", CycleKit = "cycleKit", Menu = "menu",
            Skills = "skills", Slot1 = "slot1", Slot2 = "slot2", Slot3 = "slot3",
            GroupPrev = "groupPrev", GroupNext = "groupNext", Horde = "horde",
            Extraction = "extraction", Cancel = "cancel";

        /// <summary>The verbs the controls panel lists, in reading order.</summary>
        public static readonly string[] Panel =
        {
            Sprint, Jump, Light, Heavy, Special, Dodge, Guard, Interact, CycleKit,
            Menu, Skills, Slot1, Slot2, Slot3, GroupPrev, GroupNext, Horde, Extraction, Cancel
        };

#if ENABLE_INPUT_SYSTEM
        static InputActionAsset _asset;
        static InputActionMap _map;
        static bool _tried;

        /// <summary>Set while an interactive rebind is listening for a key.</summary>
        public static bool Rebinding { get; private set; }
        public static string RebindingAction { get; private set; }

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

            // Remaps are stored as the Input System's own override JSON (B-07).
            string json = PlayerPrefs.GetString(OverridePref, "");
            if (!string.IsNullOrEmpty(json))
            {
                try { _asset.LoadBindingOverridesFromJson(json); }
                catch (System.Exception e) { Debug.LogWarning("[ConcordiaInput] override load failed: " + e.Message); }
            }

            _map = _asset.FindActionMap("Player", false);
            if (_map == null)
            {
                Debug.LogWarning("[ConcordiaInput] action map 'Player' missing");
                return;
            }

            _map.Enable();
            if (Trace) _map.actionTriggered += OnActionTriggered;
            Debug.Log("[ConcordiaInput] bound " + ResourcePath + " actions=" + _map.actions.Count +
                      (string.IsNullOrEmpty(json) ? "" : " (remaps restored)"));
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

        // ---- live binding text (the controls strip and help read this) --------------------

        /// <summary>Human text for an action's current bindings, e.g. <c>X · B</c>.</summary>
        public static string BindingLine(string action)
        {
            Ensure();
            var a = _map != null ? _map.FindAction(action, false) : null;
            if (a == null) return "—";

            string text = "";
            var bindings = a.bindings;
            for (int i = 0; i < bindings.Count; i++)
            {
                var b = bindings[i];
                if (b.isComposite || b.isPartOfComposite) continue;
                var path = b.effectivePath;
                if (string.IsNullOrEmpty(path)) continue;

                string human;
                try { human = InputControlPath.ToHumanReadableString(path, InputControlPath.HumanReadableStringOptions.OmitDevice); }
                catch { human = path; }
                if (string.IsNullOrEmpty(human)) continue;
                text += (text.Length == 0 ? "" : " · ") + human;
            }
            return text.Length == 0 ? "unbound" : text;
        }

        // ---- rebinding (B-07) ------------------------------------------------------------

        /// <summary>Index of the first plain keyboard binding, or -1 when there is none.</summary>
        static int KeyboardBindingIndex(InputAction a)
        {
            var bindings = a.bindings;
            for (int i = 0; i < bindings.Count; i++)
            {
                var b = bindings[i];
                if (b.isComposite || b.isPartOfComposite) continue;
                if (b.path != null && b.path.StartsWith("<Keyboard>/")) return i;
            }
            return -1;
        }

        /// <summary>Listen for the next key press and bind it to <paramref name="action"/>.</summary>
        public static bool StartRebind(string action)
        {
            Ensure();
            if (_map == null) return false;
            if (Rebinding) return false;

            var a = _map.FindAction(action, false);
            if (a == null) return false;

            int index = KeyboardBindingIndex(a);
            if (index < 0) return false;

            // PerformInteractiveRebinding refuses to run while the action is enabled.
            a.Disable();
            Rebinding = true;
            RebindingAction = action;

            a.PerformInteractiveRebinding(index)
                .WithCancelingThrough("<Keyboard>/escape")
                .OnComplete(op =>
                {
                    op.Dispose();
                    a.Enable();
                    Rebinding = false;
                    RebindingAction = null;
                    SaveOverrides();
                    Debug.Log("[ConcordiaInput] rebound " + action + " -> " + BindingLine(action));
                })
                .OnCancel(op =>
                {
                    op.Dispose();
                    a.Enable();
                    Rebinding = false;
                    RebindingAction = null;
                    Debug.Log("[ConcordiaInput] rebind cancelled for " + action);
                })
                .Start();

            Debug.Log("[ConcordiaInput] listening for a key: " + action);
            return true;
        }

        public static void SaveOverrides()
        {
            Ensure();
            if (_asset == null) return;
            PlayerPrefs.SetString(OverridePref, _asset.SaveBindingOverridesAsJson());
            PlayerPrefs.Save();
        }

        /// <summary>Forget every remap and fall back to the shipped bindings.</summary>
        public static void ResetOverrides()
        {
            Ensure();
            if (_asset == null) return;
            _asset.RemoveAllBindingOverrides();
            PlayerPrefs.DeleteKey(OverridePref);
            PlayerPrefs.Save();
            Debug.Log("[ConcordiaInput] remaps cleared");
        }

        public static bool HasOverrides
        {
            get
            {
                Ensure();
                if (_asset == null) return false;
                string json = _asset.SaveBindingOverridesAsJson();
                return !string.IsNullOrEmpty(json) && json != "{}";
            }
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

#else // legacy Input Manager fallback — one KeyCode per action, no remapping

        public static bool Rebinding => false;
        public static string RebindingAction => null;
        public static bool Ready => true;
        public static bool HasOverrides => false;

        public static bool StartRebind(string action) => false;
        public static void SaveOverrides() { }
        public static void ResetOverrides() { }

        public static string BindingLine(string action)
        {
            var key = KeyFor(action);
            return key.HasValue ? key.Value.ToString() : "—";
        }

        public static bool Down(string action)
        {
            var key = KeyFor(action);
            return key.HasValue && Input.GetKeyDown(key.Value);
        }

        public static bool Held(string action)
        {
            var key = KeyFor(action);
            return key.HasValue && Input.GetKey(key.Value);
        }

        public static Vector2 Axis(string action)
        {
            if (action == Move) return new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
            return Vector2.zero;
        }

        public static bool Down(KeyCode key) => Input.GetKeyDown(key);
        public static bool Held(KeyCode key) => Input.GetKey(key);
        public static bool MouseDown(int button) => Input.GetMouseButtonDown(button);

        static KeyCode? KeyFor(string action) => action switch
        {
            Sprint => KeyCode.LeftShift,
            Jump => KeyCode.Space,
            Heavy => KeyCode.F,
            Special => KeyCode.G,
            Dodge => KeyCode.X,
            Guard => KeyCode.C,
            Interact => KeyCode.E,
            CycleKit => KeyCode.Q,
            Menu => KeyCode.I,
            Skills => KeyCode.K,
            Slot1 => KeyCode.Alpha1,
            Slot2 => KeyCode.Alpha2,
            Slot3 => KeyCode.Alpha3,
            GroupPrev => KeyCode.LeftBracket,
            GroupNext => KeyCode.RightBracket,
            Horde => KeyCode.H,
            Extraction => KeyCode.J,
            Cancel => KeyCode.Escape,
            _ => null
        };

#endif
    }
}
