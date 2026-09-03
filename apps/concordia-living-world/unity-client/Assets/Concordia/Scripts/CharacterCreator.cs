using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem.UI;
#endif

namespace Concordia
{
    /// <summary>
    /// Fallout-depth + SR2 attitude. First boot only. Live preview on ModularPerson.
    /// </summary>
    public class CharacterCreator : MonoBehaviour
    {
        public static bool IsOpen { get; private set; }

        ModularPerson _person;
        Appearance _look;
        Action _onDone;
        ConcordiaPlayer _player;
        ChaseCamera _cam;
        Canvas _canvas;
        Slider[] _sliders;
        Text _summary;
        bool _previewWalk;

        public static CharacterCreator Open(ModularPerson person, ConcordiaPlayer player, ChaseCamera cam, Action onDone)
        {
            var go = new GameObject("CharacterCreator");
            var cc = go.AddComponent<CharacterCreator>();
            cc._person = person;
            cc._player = player;
            cc._cam = cam;
            cc._onDone = onDone;
            cc._look = person.look != null ? person.look : new Appearance();
            cc.BuildUi();
            IsOpen = true;
            if (player) player.creatorLocked = true;
            if (cam) cam.creatorFraming = true;
            if (cam && cam.GetComponent<Camera>() is Camera eye)
            {
                eye.clearFlags = CameraClearFlags.Skybox;
                eye.backgroundColor = new Color(0.10f, 0.05f, 0.02f);
            }
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            return cc;
        }

        void BuildUi()
        {
            EnsureEventSystem();
            var canvasGo = new GameObject("CreatorCanvas");
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 80;
            canvasGo.AddComponent<GraphicRaycaster>();
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);

            Panel(canvasGo.transform, new Vector2(0, 0), new Vector2(0.27f, 1f), new Color(0.07f, 0.04f, 0.02f, 0.82f));
            Panel(canvasGo.transform, new Vector2(0.73f, 0), new Vector2(1f, 1f), new Color(0.07f, 0.04f, 0.02f, 0.82f));
            Panel(canvasGo.transform, new Vector2(0.27f, 0), new Vector2(0.73f, 0.13f), new Color(0.05f, 0.03f, 0.02f, 0.7f));

            Label(canvasGo.transform, "THE UNBURNED COURT", 28, TextAnchor.UpperCenter,
                new Vector2(0.27f, 0.90f), new Vector2(0.73f, 1f), new Color(1f, 0.86f, 0.55f));
            Label(canvasGo.transform, "Who walks. The hub will not wait.", 16, TextAnchor.UpperCenter,
                new Vector2(0.27f, 0.86f), new Vector2(0.73f, 0.92f), new Color(0.85f, 0.72f, 0.5f));

            var left = canvasGo.transform;
            float y = 0.90f;
            Head(left, "BODY", 0.02f, y); y -= 0.05f;
            Slide(left, "Height", 0.02f, y, 0.22f, 0.86f, 1.14f, _look.height, v => _look.height = v); y -= 0.055f;
            Slide(left, "Width", 0.02f, y, 0.22f, 0.82f, 1.24f, _look.width, v => _look.width = v); y -= 0.055f;
            Slide(left, "Shoulders", 0.02f, y, 0.22f, 0.84f, 1.26f, _look.shoulders, v => _look.shoulders = v); y -= 0.055f;
            Slide(left, "Chest", 0.02f, y, 0.22f, 0.86f, 1.22f, _look.chest, v => _look.chest = v); y -= 0.055f;
            Slide(left, "Hips", 0.02f, y, 0.22f, 0.84f, 1.2f, _look.hips, v => _look.hips = v); y -= 0.07f;
            Head(left, "SKIN  ·  EYES", 0.02f, y); y -= 0.05f;
            Slide(left, "Skin", 0.02f, y, 0.22f, 0f, 1f, _look.skin, v => _look.skin = v); y -= 0.055f;
            Slide(left, "Eye hue", 0.02f, y, 0.22f, 0f, 1f, _look.eyeHue, v => _look.eyeHue = v); y -= 0.055f;
            Slide(left, "Eye depth", 0.02f, y, 0.22f, 0f, 1f, _look.eyeVal, v => _look.eyeVal = v); y -= 0.07f;
            Head(left, "FACE", 0.02f, y); y -= 0.05f;
            Slide(left, "Head", 0.02f, y, 0.22f, 0.88f, 1.14f, _look.head, v => _look.head = v); y -= 0.055f;
            Slide(left, "Jaw", 0.02f, y, 0.22f, 0.8f, 1.28f, _look.jaw, v => _look.jaw = v); y -= 0.055f;
            Slide(left, "Brow", 0.02f, y, 0.22f, 0f, 1f, _look.brow, v => _look.brow = v); y -= 0.055f;
            Slide(left, "Nose", 0.02f, y, 0.22f, 0f, 1f, _look.nose, v => _look.nose = v);

            float rx = 0.76f;
            y = 0.90f;
            Head(left, "HAIR", rx, y); y -= 0.05f;
            Grid(left, Appearance.HairNames, rx, y, 0.22f, _look.hairStyle, i => { _look.hairStyle = i; Apply(); }); y -= 0.16f;
            Slide(left, "Hair hue", rx, y, 0.22f, 0f, 1f, _look.hairHue, v => _look.hairHue = v); y -= 0.055f;
            Slide(left, "Hair sat", rx, y, 0.22f, 0f, 1f, _look.hairSat, v => _look.hairSat = v); y -= 0.055f;
            Slide(left, "Hair val", rx, y, 0.22f, 0.05f, 0.6f, _look.hairVal, v => _look.hairVal = v); y -= 0.07f;
            Head(left, "OUTFIT", rx, y); y -= 0.05f;
            Grid(left, Appearance.OutfitNames, rx, y, 0.22f, _look.outfit, i => { _look.outfit = i; Apply(); }); y -= 0.20f;
            Head(left, "WALK  ·  ATTITUDE", rx, y); y -= 0.05f;
            Grid(left, Appearance.WalkNames, rx, y, 0.22f, _look.walkStyle, i => { _look.walkStyle = i; Apply(); }); y -= 0.12f;
            Grid(left, Appearance.AttitudeNames, rx, y, 0.22f, _look.attitude, i => { _look.attitude = i; Apply(); }); y -= 0.12f;
            Slide(left, "Voice", rx, y, 0.22f, 0f, 1f, _look.voice, v => _look.voice = v);

            _summary = Label(canvasGo.transform, "", 15, TextAnchor.MiddleLeft,
                new Vector2(0.29f, 0.015f), new Vector2(0.55f, 0.12f), new Color(0.9f, 0.8f, 0.6f));

            var walkBtn = Button(canvasGo.transform, "PREVIEW WALK", new Vector2(0.56f, 0.03f), new Vector2(0.68f, 0.10f), () =>
            {
                _previewWalk = !_previewWalk;
            });
            var enter = Button(canvasGo.transform, "ENTER THE COURT", new Vector2(0.69f, 0.03f), new Vector2(0.97f, 0.10f), Confirm);
            enter.GetComponent<Image>().color = new Color(0.72f, 0.48f, 0.16f, 0.95f);
            Label(canvasGo.transform, "Enter / Space  ·  Esc skips", 13, TextAnchor.MiddleRight,
                new Vector2(0.69f, 0.105f), new Vector2(0.97f, 0.135f), new Color(0.78f, 0.66f, 0.42f));

            Apply();
        }

        void Update()
        {
            if (!IsOpen || _person == null) return;
            _person.SetGait(_previewWalk ? 2.6f : 0f, true);
            if (_player)
            {
                _player.transform.rotation = Quaternion.identity;
                _player.transform.position = new Vector3(Canon.Spawn.x, _player.transform.position.y, Canon.Spawn.z);
            }
            if (ConfirmKey()) Confirm();
            else if (SkipKey()) Confirm();
        }

        static bool ConfirmKey()
        {
#if ENABLE_INPUT_SYSTEM
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb == null) return false;
            return kb.enterKey.wasPressedThisFrame || kb.numpadEnterKey.wasPressedThisFrame || kb.spaceKey.wasPressedThisFrame;
#else
            return Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter) || Input.GetKeyDown(KeyCode.Space);
#endif
        }

        static bool SkipKey()
        {
#if ENABLE_INPUT_SYSTEM
            var kb = UnityEngine.InputSystem.Keyboard.current;
            return kb != null && kb.escapeKey.wasPressedThisFrame;
#else
            return Input.GetKeyDown(KeyCode.Escape);
#endif
        }

        void Apply()
        {
            _person.Apply(_look);
            if (_summary)
            {
                _summary.text = (_look.displayName ?? "Walker") + "  ·  " +
                                Appearance.OutfitNames[Mathf.Clamp(_look.outfit, 0, Appearance.OutfitNames.Length - 1)] + "  ·  " +
                                Appearance.WalkNames[Mathf.Clamp(_look.walkStyle, 0, Appearance.WalkNames.Length - 1)] + "  ·  " +
                                Appearance.AttitudeNames[Mathf.Clamp(_look.attitude, 0, Appearance.AttitudeNames.Length - 1)] +
                                "\n" + _look.VoiceLine();
            }
        }

        public static void SkipNow()
        {
            var all = FindObjectsByType<CharacterCreator>(FindObjectsInactive.Include);
            foreach (var c in all)
                if (c) c.Confirm();
        }

        void Confirm()
        {
            if (string.IsNullOrWhiteSpace(_look.displayName)) _look.displayName = "Walker";
            AppearanceStore.Save(_look);
            _person.Apply(_look);
            IsOpen = false;
            if (_player)
            {
                _player.creatorLocked = false;
                _player.transform.rotation = Quaternion.identity;
            }
            if (_cam)
            {
                _cam.creatorFraming = false;
                _cam.yaw = Mathf.PI;
                var eye = _cam.GetComponent<Camera>();
                if (eye)
                {
                    eye.clearFlags = CameraClearFlags.Skybox;
                    HubLook.ApplySky(WorldId.Hub);
                }
            }
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
            _onDone?.Invoke();
            Destroy(gameObject);
        }

        void Slide(Transform parent, string name, float x, float y, float w, float min, float max, float value, Action<float> set)
        {
            Label(parent, name, 13, TextAnchor.MiddleLeft, new Vector2(x, y - 0.018f), new Vector2(x + w, y + 0.018f), new Color(0.92f, 0.82f, 0.62f));
            var go = new GameObject(name + "Slider");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            Stretch(rt, x, y - 0.042f, x + w, y - 0.018f);
            var bg = go.AddComponent<Image>();
            bg.color = new Color(0.18f, 0.10f, 0.05f, 0.9f);
            var slider = go.AddComponent<Slider>();
            slider.minValue = min;
            slider.maxValue = max;
            slider.value = value;
            var fillArea = new GameObject("Fill Area").AddComponent<RectTransform>();
            fillArea.SetParent(rt, false);
            Stretch(fillArea, 0, 0, 1, 1);
            var fill = new GameObject("Fill");
            fill.transform.SetParent(fillArea, false);
            var frt = fill.AddComponent<RectTransform>();
            Stretch(frt, 0, 0.2f, 1, 0.8f);
            fill.AddComponent<Image>().color = new Color(0.85f, 0.58f, 0.22f, 0.95f);
            slider.fillRect = frt;
            var handleArea = new GameObject("Handle Slide Area").AddComponent<RectTransform>();
            handleArea.SetParent(rt, false);
            Stretch(handleArea, 0, 0, 1, 1);
            var handle = new GameObject("Handle");
            handle.transform.SetParent(handleArea, false);
            var hrt = handle.AddComponent<RectTransform>();
            hrt.sizeDelta = new Vector2(14, 0);
            Stretch(hrt, 0, 0, 0, 1);
            handle.AddComponent<Image>().color = new Color(1f, 0.9f, 0.65f);
            slider.handleRect = hrt;
            slider.targetGraphic = handle.GetComponent<Image>();
            slider.onValueChanged.AddListener(v => { set(v); Apply(); });
        }

        void Grid(Transform parent, string[] names, float x, float y, float w, int current, Action<int> pick)
        {
            float bw = w;
            float bh = 0.042f;
            for (int i = 0; i < names.Length; i++)
            {
                int idx = i;
                int col = i % 2;
                int row = i / 2;
                float x0 = x + col * (bw * 0.52f);
                float y1 = y - row * (bh + 0.008f);
                var b = Button(parent, names[i], new Vector2(x0, y1 - bh), new Vector2(x0 + bw * 0.48f, y1), () => pick(idx));
                if (idx == current)
                    b.GetComponent<Image>().color = new Color(0.55f, 0.34f, 0.12f, 0.95f);
            }
        }

        static Button Button(Transform parent, string label, Vector2 min, Vector2 max, UnityEngine.Events.UnityAction click)
        {
            var go = new GameObject(label);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            Stretch(rt, min.x, min.y, max.x, max.y);
            var img = go.AddComponent<Image>();
            img.color = new Color(0.22f, 0.12f, 0.06f, 0.92f);
            var b = go.AddComponent<Button>();
            b.targetGraphic = img;
            b.onClick.AddListener(click);
            var tgo = new GameObject("Text");
            tgo.transform.SetParent(go.transform, false);
            var trt = tgo.AddComponent<RectTransform>();
            Stretch(trt, 0, 0, 1, 1);
            var tx = tgo.AddComponent<Text>();
            tx.text = label;
            tx.alignment = TextAnchor.MiddleCenter;
            tx.color = new Color(1f, 0.9f, 0.7f);
            tx.fontSize = 15;
            tx.font = UiFont();
            return b;
        }

        static Text Label(Transform parent, string s, int size, TextAnchor anchor, Vector2 min, Vector2 max, Color c)
        {
            var go = new GameObject(s.Length > 24 ? "Label" : s);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            Stretch(rt, min.x, min.y, max.x, max.y);
            var t = go.AddComponent<Text>();
            t.text = s;
            t.fontSize = size;
            t.alignment = anchor;
            t.color = c;
            t.font = UiFont();
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        static void Head(Transform parent, string s, float x, float y)
        {
            Label(parent, s, 15, TextAnchor.MiddleLeft, new Vector2(x, y - 0.02f), new Vector2(x + 0.22f, y + 0.02f), new Color(1f, 0.78f, 0.4f));
        }

        static Image Panel(Transform parent, Vector2 min, Vector2 max, Color c)
        {
            var go = new GameObject("Panel");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            Stretch(rt, min.x, min.y, max.x, max.y);
            var img = go.AddComponent<Image>();
            img.color = c;
            img.raycastTarget = true;
            return img;
        }

        static void Stretch(RectTransform rt, float x0, float y0, float x1, float y1)
        {
            rt.anchorMin = new Vector2(x0, y0);
            rt.anchorMax = new Vector2(x1, y1);
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }

        static Font UiFont()
        {
            var f = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (!f) f = Resources.GetBuiltinResource<Font>("Arial.ttf");
            return f;
        }

        static void EnsureEventSystem()
        {
            if (EventSystem.current) return;
            var es = new GameObject("EventSystem");
            es.AddComponent<EventSystem>();
#if ENABLE_INPUT_SYSTEM
            es.AddComponent<InputSystemUIInputModule>();
#else
            es.AddComponent<StandaloneInputModule>();
#endif
        }
    }
}
