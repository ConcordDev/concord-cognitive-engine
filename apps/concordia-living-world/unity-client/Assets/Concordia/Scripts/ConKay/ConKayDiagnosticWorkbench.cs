using UnityEngine;
using Concordia.GameplayCore;
using Concordia.GameplayCore.WorldFabric;
using Concordia.WorldSystems;

namespace Concordia.ConKay
{
    /// <summary>
    /// Opt-in, read-only in-game ConKay diagnostic surface. It observes a center-screen
    /// raycast or an explicitly selected object and renders a compact IMGUI fallback.
    /// No button invokes gameplay, economy, persistence, or simulation mutations.
    /// </summary>
    [DefaultExecutionOrder(500)]
    [DisallowMultipleComponent]
    public sealed class ConKayDiagnosticWorkbench : MonoBehaviour
    {
        public bool optIn;
        public KeyCode toggleKey = KeyCode.F10;
        public bool centerRaycast = true;
        public float rayDistance = 100f;
        public bool showWhenNoCamera = true;

        enum ViewMode { Target, Capability, WorldField, Economy, Consequences, GoldenSlice }

        IConKayRuntimeSource _source;
        ConKayInspectionSnapshot _snapshot;
        GameObject _selected;
        ViewMode _mode = ViewMode.Target;
        Vector2 _scroll;
        GUIStyle _panel;
        GUIStyle _header;
        GUIStyle _small;
        GUIStyle _why;
        GUIStyle _button;
        bool _stylesReady;

        public bool IsOptedIn => optIn;
        public GameObject SelectedObject => _selected;
        public ConKayInspectionSnapshot CurrentSnapshot => _snapshot;

        void Awake()
        {
            _source = new ConKayRuntimeSource();
        }

        void Update()
        {
            if (Input.GetKeyDown(toggleKey)) SetOptIn(!optIn);
            if (!optIn) return;

            if (centerRaycast && Camera.main != null)
            {
                var ray = Camera.main.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f));
                RaycastHit hit;
                if (Physics.Raycast(ray, out hit, Mathf.Max(0.1f, rayDistance), Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
                {
                    var candidate = hit.collider != null ? hit.collider.gameObject : null;
                    if (candidate != null && candidate != _selected)
                    {
                        _selected = candidate;
                        if (_mode == ViewMode.Target) Refresh();
                    }
                }
            }
        }

        public void SetOptIn(bool enabled)
        {
            optIn = enabled;
            if (optIn) Refresh();
        }

        public void SetSource(IConKayRuntimeSource source)
        {
            if (source != null) _source = source;
            if (optIn) Refresh();
        }

        /// <summary>Explicit selection hook for an existing HUD, editor bridge, or test.</summary>
        public void Select(GameObject target)
        {
            _selected = target;
            _mode = ViewMode.Target;
            if (optIn) Refresh();
        }

        public void InspectTarget(GameObject target)
        {
            Select(target);
        }

        void Refresh()
        {
            if (_source == null) _source = new ConKayRuntimeSource();
            switch (_mode)
            {
                case ViewMode.Capability:
                    _snapshot = _source.InspectCapability(_selected);
                    break;
                case ViewMode.WorldField:
                    _snapshot = _source.InspectWorldField(WorldPoint());
                    break;
                case ViewMode.Economy:
                    _snapshot = _source.InspectEconomy(SelectedRecordId());
                    break;
                case ViewMode.Consequences:
                    _snapshot = _source.InspectConsequences(SelectedRecordId());
                    break;
                case ViewMode.GoldenSlice:
                    _snapshot = _source.InspectGoldenSlice(SelectedRecordId());
                    break;
                default:
                    _snapshot = _source.InspectTarget(_selected, WorldPoint());
                    break;
            }
        }

        Vector3 WorldPoint()
        {
            if (_selected != null) return _selected.transform.position;
            if (ConcordiaPlayer.Live != null) return ConcordiaPlayer.Live.transform.position;
            return Vector3.zero;
        }

        string SelectedRecordId()
        {
            if (_selected != null)
            {
                var identity = _selected.GetComponentInParent<WorldFabricIdentity>();
                if (identity != null && !string.IsNullOrEmpty(identity.objectId)) return identity.objectId;
                var building = _selected.GetComponentInParent<WorldSystemsBuildingAdapter>();
                if (building != null && !string.IsNullOrEmpty(building.buildingId)) return building.buildingId;
                var conKay = _selected.GetComponentInParent<ConKayIdentity>();
                if (conKay != null && !string.IsNullOrEmpty(conKay.recordId)) return conKay.recordId;
                var npc = _selected.GetComponentInParent<GuestNpc>();
                if (npc != null)
                {
                    if (!string.IsNullOrEmpty(npc.personId)) return npc.personId;
                    if (npc.def != null && !string.IsNullOrEmpty(npc.def.id)) return npc.def.id;
                }
            }
            return string.Empty;
        }

        void OnGUI()
        {
            if (!optIn) return;
            if (Camera.main == null && !showWhenNoCamera) return;
            EnsureStyles();
            var width = Mathf.Clamp(Screen.width * 0.32f, 330f, 520f);
            var height = Mathf.Clamp(Screen.height * 0.62f, 320f, 650f);
            var rect = new Rect(12f, 12f, width, height);
            GUI.Box(rect, GUIContent.none, _panel);
            GUILayout.BeginArea(new Rect(rect.x + 10f, rect.y + 8f, rect.width - 20f, rect.height - 16f));
            GUILayout.BeginHorizontal();
            GUILayout.Label("CONKAY  /  DIAGNOSTIC WORKBENCH", _header);
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("OFF", _button, GUILayout.Width(48f))) SetOptIn(false);
            GUILayout.EndHorizontal();
            GUILayout.Label("Read-only · F10 toggles · raycast=" + (centerRaycast ? "on" : "off"), _small);
            GUILayout.BeginHorizontal();
            DrawModeButton("TARGET", ViewMode.Target);
            DrawModeButton("FIELD", ViewMode.WorldField);
            DrawModeButton("CAP", ViewMode.Capability);
            DrawModeButton("ECON", ViewMode.Economy);
            DrawModeButton("CHAIN", ViewMode.Consequences);
            DrawModeButton("SLICE", ViewMode.GoldenSlice);
            GUILayout.EndHorizontal();
            if (GUILayout.Button(_selected == null ? "Select target: center ray" : "Selected: " + _selected.name, _button))
            {
                _mode = ViewMode.Target;
                Refresh();
            }

            _scroll = GUILayout.BeginScrollView(_scroll);
            if (_snapshot == null)
            {
                GUILayout.Label("No inspection yet.", _small);
            }
            else
            {
                GUILayout.Label(_snapshot.kind + "  ·  " + _snapshot.title, _header);
                GUILayout.Label("WHY  " + _snapshot.why, _why);
                GUILayout.Label("Authority: " + _snapshot.authority + "  ·  record=" + (_snapshot.authoritativeRecordFound ? "confirmed" : "not confirmed"), _small);
                if (!string.IsNullOrEmpty(_snapshot.stableId)) GUILayout.Label("ID  " + _snapshot.stableId, _small);
                GUILayout.Space(4f);
                for (var i = 0; i < _snapshot.facts.Count; i++)
                {
                    var fact = _snapshot.facts[i];
                    if (fact == null) continue;
                    GUILayout.Label(fact.key + " = " + fact.value, _small);
                    GUILayout.Label("    source: " + fact.source, _small);
                }
                if (_snapshot.chain.Count > 0)
                {
                    GUILayout.Space(6f);
                    GUILayout.Label("RECORDED CHAIN", _header);
                    for (var i = 0; i < _snapshot.chain.Count; i++)
                    {
                        var link = _snapshot.chain[i];
                        if (link == null) continue;
                        GUILayout.Label(link.kind + "  " + link.id, _small);
                        GUILayout.Label("    " + link.summary, _small);
                        GUILayout.Label("    source: " + link.source, _small);
                    }
                }
            }
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        void DrawModeButton(string label, ViewMode mode)
        {
            var text = _mode == mode ? "> " + label : label;
            if (GUILayout.Button(text, _button))
            {
                _mode = mode;
                Refresh();
            }
        }

        void EnsureStyles()
        {
            if (_stylesReady) return;
            _panel = new GUIStyle(GUI.skin.window);
            _panel.normal.background = Texture2D.grayTexture;
            _panel.padding = new RectOffset(8, 8, 8, 8);
            _header = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, fontSize = 13 };
            _small = new GUIStyle(GUI.skin.label) { fontSize = 11, wordWrap = true };
            _why = new GUIStyle(_small) { fontStyle = FontStyle.Bold, normal = { textColor = new Color(1f, 0.85f, 0.48f) } };
            _button = new GUIStyle(GUI.skin.button) { fontSize = 10, padding = new RectOffset(4, 4, 3, 3) };
            _stylesReady = true;
        }
    }
}
