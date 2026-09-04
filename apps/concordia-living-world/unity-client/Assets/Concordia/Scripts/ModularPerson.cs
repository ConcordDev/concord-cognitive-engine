using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia // FORCE_REFRESH_0022
{
    /// <summary>
    /// Authored Kenney person when the mesh is imported; primitive fallback otherwise.
    /// Never non-uniform-scale bones with descendants. Never Mixamo Soldier. Never T-pose.
    /// </summary>
    public class ModularPerson : MonoBehaviour
    {
        public Appearance look = new Appearance();
        public Transform rightHand, leftHand;
        public GameObject sword;

        Transform _hip, _spine, _chest, _neck, _head;
        Transform _uArmL, _fArmL, _handL, _uArmR, _fArmR, _handR;
        Transform _uLegL, _lLegL, _footL, _uLegR, _lLegR, _footR;
        Transform _jaw, _brow, _nose, _eyeL, _eyeR, _hairRoot;
        Vector3 _eye0;
        Transform _tunic, _coat, _coatL, _coatR, _sash, _pelvisMesh, _skull;
        Vector3 _tunic0, _coat0, _coatL0, _coatR0, _pelvis0, _skull0, _jaw0;
        Renderer[] _skin, _shirt, _pants, _trim, _hair, _eyes;
        Quaternion _hipsRest, _spineRest, _lArmRest, _lForeRest, _rArmRest, _rForeRest;
        Quaternion _lUpRest, _lLegRest, _rUpRest, _rLegRest, _headRest;
        Vector3 _hipPos0;
        float _speed, _vert, _slashT, _phase, _sit, _sitShown, _shown, _hitT, _landT;
        bool _grounded = true;
        bool _built;
        bool _authored;
        bool _biped;
        bool _clipsFit;
        Animator _anim;
        SkinnedMeshRenderer _skinMesh;
        int _plantFrames;
        NpcLife _life;
        static int _bodySeq;
        static string _lastPrefabPath;
        public static WorldId CastingWorld = WorldId.Hub;

        static readonly string[] SkinFiles =
        {
            "skaterFemaleA", "skaterMaleA", "cyborgFemaleA",
            "criminalMaleA", "skaterMaleA", "cyborgFemaleA"
        };

        public static ModularPerson Attach(Transform parent, Appearance look)
            => Attach(parent, look, false);

        /// <summary>
        /// Live player. Rocketbox adult with authored textures. Never Mixamo
        /// Soldier/Vanguard — that mesh has no folder albedo and lands clay-white.
        /// </summary>
        public static ModularPerson AttachHero(Transform parent, Appearance look)
            => Attach(parent, look, true);

        static ModularPerson Attach(Transform parent, Appearance look, bool hero)
        {
            var root = new GameObject("Person");
            root.transform.SetParent(parent, false);
            root.transform.localPosition = Vector3.zero;
            root.transform.localRotation = Quaternion.identity;
            var p = root.AddComponent<ModularPerson>();
            p.Build(hero);
            p.Apply(look ?? new Appearance());
            p.sword = MakeSword();
            CharacterGear.Grip(p.sword, p.rightHand ? p.rightHand : p.transform, 1.05f, true, false);
            return p;
        }

        public static GameObject SpawnNpc(Transform parent, Vector3 pos, float yaw, Appearance look, bool wander, float roam = 10f)
        {
            var go = new GameObject(string.IsNullOrEmpty(look?.displayName) ? "Citizen" : look.displayName);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, yaw, 0);
            var person = go.AddComponent<ModularPerson>();
            person.Build();
            person.Apply(look ?? Appearance.Random(go.GetHashCode()));
            var h = 1.7f * (look != null ? look.height : 1f);
            var cc = Grounding.EnsureController(go, h);
            Grounding.Snap(cc);
            if (wander)
            {
                var w = go.AddComponent<NpcWander>();
                w.roam = roam;
            }
            return go;
        }

        public void SetGait(float speed, bool grounded, float vert = 0f)
        {
            _speed = speed;
            _grounded = grounded;
            _vert = vert;
            if (_anim && _anim.runtimeAnimatorController)
            {
                _anim.enabled = true;
                if (HasParam(_anim, "Speed")) _anim.SetFloat("Speed", grounded ? speed : 0f);
                if (HasParam(_anim, "Grounded")) _anim.SetBool("Grounded", grounded);
                if (HasParam(_anim, "MotionSpeed")) _anim.SetFloat("MotionSpeed", grounded ? 1f : 0f);
            }
        }

        public void Slash()
        {
            _slashT = 0.48f;
            if (_anim && _anim.runtimeAnimatorController)
            {
                if (HasParam(_anim, "Attack")) _anim.SetTrigger("Attack");
                else if (HasParam(_anim, "Slash")) _anim.SetTrigger("Slash");
            }
        }
        public void Sit(bool on) => _sit = on ? 1f : 0f;
        public void Hurt() => _hitT = 0.32f;
        public void Land() => _landT = 0.22f;
        public float PlanarSpeed => _speed;

        bool Talking()
        {
            if (!_life) _life = GetComponentInParent<NpcLife>();
            return _life && _life.IsTalking;
        }

        public void Build() => Build(false);

        public void Build(bool hero)
        {
            if (_built) return;
            _built = true;
            if (TryBindAuthored(hero)) return;
            BuildPrimitive();
        }

        bool TryBindAuthored(bool hero)
        {
            var prefab = LoadPersonPrefab(hero);
            if (!prefab) return false;
            var body = Object.Instantiate(prefab, transform);
            body.name = "AuthoredPerson";
            DressFromPrefabFolder(body);
            FreePacks.PaintIfBlank(body, _lastPrefabPath);
            body.transform.localPosition = Vector3.zero;
            body.transform.localRotation = Quaternion.identity;
            body.transform.localScale = Vector3.one;
            foreach (var c in body.GetComponentsInChildren<Collider>()) Object.Destroy(c);

            _hip = FindBone(body.transform, "Bip01 Pelvis", "Bip01", "Hips", "mixamorig:Hips");
            _spine = FindBone(body.transform, "Bip01 Spine", "Spine", "mixamorig:Spine");
            _chest = FindBone(body.transform, "Bip01 Spine2", "Bip01 Spine1", "Chest", "UpperChest", "Spine1", "mixamorig:Spine1") ?? _spine;
            _neck = FindBone(body.transform, "Bip01 Neck", "Neck", "mixamorig:Neck");
            _head = FindBone(body.transform, "Bip01 Head", "Head", "mixamorig:Head");
            _uArmL = FindBone(body.transform, "Bip01 L UpperArm", "LeftArm", "Left_UpperArm", "mixamorig:LeftArm");
            _fArmL = FindBone(body.transform, "Bip01 L Forearm", "LeftForeArm", "Left_LowerArm", "mixamorig:LeftForeArm");
            _handL = FindBone(body.transform, "Bip01 L Hand", "LeftHand", "Left_Hand", "mixamorig:LeftHand");
            _uArmR = FindBone(body.transform, "Bip01 R UpperArm", "RightArm", "Right_UpperArm", "mixamorig:RightArm");
            _fArmR = FindBone(body.transform, "Bip01 R Forearm", "RightForeArm", "Right_LowerArm", "mixamorig:RightForeArm");
            _handR = FindBone(body.transform, "Bip01 R Hand", "RightHand", "Right_Hand", "mixamorig:RightHand");
            _uLegL = FindBone(body.transform, "Bip01 L Thigh", "LeftUpLeg", "Left_UpperLeg", "mixamorig:LeftUpLeg");
            _lLegL = FindBone(body.transform, "Bip01 L Calf", "LeftLeg", "Left_LowerLeg", "mixamorig:LeftLeg");
            _footL = FindBone(body.transform, "Bip01 L Foot", "LeftFoot", "Left_Foot", "mixamorig:LeftFoot");
            _uLegR = FindBone(body.transform, "Bip01 R Thigh", "RightUpLeg", "Right_UpperLeg", "mixamorig:RightUpLeg");
            _lLegR = FindBone(body.transform, "Bip01 R Calf", "RightLeg", "Right_LowerLeg", "mixamorig:RightLeg");
            _footR = FindBone(body.transform, "Bip01 R Foot", "RightFoot", "Right_Foot", "mixamorig:RightFoot");
            leftHand = _handL;
            rightHand = _handR;
            if (!_hip || !_head || !_uArmL || !_uArmR)
            {
                // Kenney mini-characters are painted meshes, not Mixamo rigs.
                _skinMesh = body.GetComponentInChildren<SkinnedMeshRenderer>();
                float h = RendererHeight(body);
                if (h > 0.15f) body.transform.localScale *= Mathf.Clamp(1.72f / h, 0.05f, 10f);
                _authored = true;
                leftHand = rightHand = body.transform;
                return true;
            }

            // Only collapse 100-unit FBX roots. Flattening every child made
            // visor/head meshes 100× and read as giant balls.
            if (body.transform.localScale.x > 10f)
                body.transform.localScale = Vector3.one;
            if (_hip && _hip.localScale.x > 10f)
                _hip.localScale = Vector3.one;
            var fbxRoot = FindBone(body.transform, "Root");
            if (fbxRoot && fbxRoot.localScale.x > 10f)
                fbxRoot.localScale = Vector3.one;
            body.transform.localPosition = Vector3.zero;
            body.transform.localRotation = Quaternion.identity;

            _skinMesh = body.GetComponentInChildren<SkinnedMeshRenderer>();
            if (_skinMesh)
            {
                _skinMesh.updateWhenOffscreen = true;
                _skinMesh.enabled = true;
            }
            float worldH = RendererHeight(body);
            if (worldH > 0.2f && (worldH < 1.2f || worldH > 2.4f))
                body.transform.localScale *= Mathf.Clamp(1.72f / worldH, 0.05f, 8f);

            _anim = body.GetComponentInChildren<Animator>();
            if (!_anim) _anim = body.AddComponent<Animator>();
            _anim.applyRootMotion = false;
            _anim.cullingMode = AnimatorCullingMode.AlwaysAnimate;

            _biped = NameHasBip(_uArmL) || NameHasBip(_hip);
            StripPrefabWeapons(body);
            Capture(_hip, ref _hipsRest);
            if (_hip) _hipPos0 = _hip.localPosition;
            Capture(_spine, ref _spineRest);
            Capture(_uArmL, ref _lArmRest);
            Capture(_fArmL, ref _lForeRest);
            Capture(_uArmR, ref _rArmRest);
            Capture(_fArmR, ref _rForeRest);
            Capture(_uLegL, ref _lUpRest);
            Capture(_lLegL, ref _lLegRest);
            Capture(_uLegR, ref _rUpRest);
            Capture(_lLegR, ref _rLegRest);
            Capture(_head, ref _headRest);

            // Mixamo/Kevin clips need a Humanoid avatar. Rocketbox ships Generic
            // Bip01 — map it, or LateUpdate gait is the honest floor.
            var built = TryBipedAvatar(body);
            if (built) _anim.avatar = built;
            var ctrl = LoadLocomotion();
            var av = _anim.avatar;
            // Mixamo clips on 3ds Max Biped skate and sink the hips. Authored
            // BipedHinge gait is the accurate walk for this skeleton. Clips
            // stay available for a true Mixamo humanoid.
            _clipsFit = !_biped && ctrl && av && av.isHuman && av.isValid;
            bool clipsFit = _clipsFit;
            if (_clipsFit)
            {
                _anim.runtimeAnimatorController = ctrl;
                _anim.enabled = true;
            }
            else
            {
                _anim.runtimeAnimatorController = null;
                _anim.enabled = false;
                HangAuthoredArms(0f);
            }

            // Kenney already has a painted head. Extra hair/coat cubes were 1000-unit and hid the person.
            _authored = true;
            try
            {
                var b = _skinMesh ? _skinMesh.bounds : default;
                System.IO.File.WriteAllText("/tmp/concordia-person-bind.txt",
                    System.DateTime.Now.ToString("o") + " authored=True kenney=True hero=" + hero +
                    " prefab=" + (_lastPrefabPath ?? "") +
                    " ctrl=" + (ctrl ? ctrl.name : "none") +
                    " clipsFit=" + clipsFit +
                    " biped=" + _biped +
                    " uArmL=" + (_uArmL ? _uArmL.name : "null") +
                    " bounds=" + b +
                    " scale=" + body.transform.localScale + " hip=" + (_hip ? _hip.name : "null") + "\n");
            }
            catch { }
            Debug.Log("Concordia ModularPerson bound prefab=" + (_lastPrefabPath ?? "") + " ctrl=" + (ctrl ? ctrl.name : "none"));
            return true;
        }

        static GameObject LoadPersonPrefab(bool hero)
        {
            GameObject go = null;
#if UNITY_EDITOR
            // Mixamo Vanguard has no folder albedo. Rocketbox is the painted adult.
            var adult = new[]
            {
                "Assets/Concordia/Models/humans/rocketbox/Male_Adult_01/Male_Adult_01.fbx",
                "Assets/Concordia/Models/humans/rocketbox/Male_Adult_05/Male_Adult_05.fbx",
                "Assets/Concordia/Models/humans/rocketbox/Male_Adult_08/Male_Adult_08.fbx",
                "Assets/Concordia/Models/humans/rocketbox/Female_Adult_01/Female_Adult_01.fbx",
                "Assets/Concordia/Models/humans/rocketbox/Female_Adult_04/Female_Adult_04.fbx"
            };
            int start = hero ? 0 : Mathf.Abs(_bodySeq++) % adult.Length;
            for (int i = 0; i < adult.Length; i++)
            {
                var p = adult[(start + i) % adult.Length];
                go = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                if (!go) continue;
                _lastPrefabPath = p;
                return go;
            }
#endif
            string[] stems = { "Male_Adult_01", "Male_Adult_05", "Female_Adult_01", "Knight" };
            for (int i = 0; i < stems.Length; i++)
            {
                go = FreePacks.Mesh(stems[i]);
                if (!go) continue;
#if UNITY_EDITOR
                _lastPrefabPath = AssetDatabase.GetAssetPath(go);
#endif
                return go;
            }
            return go;
        }

        static void DressFromPrefabFolder(GameObject body)
        {
#if UNITY_EDITOR
            if (!body) return;
            if (string.IsNullOrEmpty(_lastPrefabPath))
                _lastPrefabPath = InferRocketboxPath(body);
            if (string.IsNullOrEmpty(_lastPrefabPath)) return;
            var dir = System.IO.Path.GetDirectoryName(_lastPrefabPath);
            if (string.IsNullOrEmpty(dir)) return;
            var texDir = dir.Replace("\\", "/") + "/Textures";
            if (!AssetDatabase.IsValidFolder(texDir)) return;
            Texture2D bodyC = null, bodyN = null, headC = null, headN = null, opac = null;
            foreach (var guid in AssetDatabase.FindAssets("t:Texture", new[] { texDir }))
            {
                var p = AssetDatabase.GUIDToAssetPath(guid);
                var fn = System.IO.Path.GetFileName(p).ToLowerInvariant();
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
                if (!t) continue;
                if (fn.Contains("opacity")) opac = t;
                else if (fn.Contains("head") && fn.Contains("normal") && !fn.Contains("wrinkle")) headN = t;
                else if (fn.Contains("head") && fn.Contains("color")) headC = t;
                else if (fn.Contains("body") && fn.Contains("normal")) bodyN = t;
                else if (fn.Contains("body") && fn.Contains("color")) bodyC = t;
            }
            foreach (var r in body.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                if (mats == null || mats.Length == 0) continue;
                var dressed = new Material[mats.Length];
                for (int i = 0; i < mats.Length; i++)
                {
                    var mn = mats[i] ? mats[i].name.ToLowerInvariant() : "";
                    bool namedOp = mn.Contains("opacity") || mn.Contains("hair") || mn.Contains("lash") || mn.Contains("alpha");
                    bool namedHead = mn.Contains("head") || mn.Contains("face") || mn.Contains("eye");
                    bool namedBody = mn.Contains("body") || mn.Contains("skin") || mn.Contains("torso");
                    bool isOp, isHead;
                    if (namedOp || namedHead || namedBody)
                    {
                        isOp = namedOp;
                        isHead = namedHead && !namedOp;
                    }
                    else if (mats.Length > 1)
                    {
                        // Rocketbox hipoly: body, head, opacity — mesh itself is often named *_opacity.
                        isHead = i == 1;
                        isOp = i >= 2;
                    }
                    else
                    {
                        isOp = false;
                        isHead = false;
                    }
                    var albedo = isOp ? (opac ? opac : headC) : isHead ? (headC ? headC : bodyC) : (bodyC ? bodyC : headC);
                    var nrm = isHead ? headN : bodyN;
                    if (!albedo) { dressed[i] = mats[i]; continue; }
                    var m = HubLook.Lit(Color.white, 0.03f, 0.28f);
                    var urp = Shader.Find("Universal Render Pipeline/Lit");
                    if (urp && (m.shader == null || m.shader.name.IndexOf("Universal", System.StringComparison.OrdinalIgnoreCase) < 0))
                        m.shader = urp;
                    if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", albedo);
                    if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", albedo);
                    if (nrm)
                    {
                        if (m.HasProperty("_BumpMap")) m.SetTexture("_BumpMap", nrm);
                        m.EnableKeyword("_NORMALMAP");
                    }
                    if (isOp)
                    {
                        m.SetFloat("_Cutoff", 0.32f);
                        m.EnableKeyword("_ALPHATEST_ON");
                        m.SetOverrideTag("RenderType", "TransparentCutout");
                        m.renderQueue = 2450;
                    }
                    dressed[i] = m;
                }
                r.sharedMaterials = dressed;
            }
#endif
        }

        static string InferRocketboxPath(GameObject body)
        {
            string n = "";
            foreach (var r in body.GetComponentsInChildren<Renderer>(true))
                if (r) { n = r.gameObject.name.ToLowerInvariant(); break; }
            string folder = null;
            if (n.StartsWith("m002")) folder = "Male_Adult_01";
            else if (n.StartsWith("m009")) folder = "Male_Adult_05";
            else if (n.StartsWith("m014")) folder = "Male_Adult_08";
            else if (n.StartsWith("f001")) folder = "Female_Adult_01";
            else if (n.StartsWith("f004")) folder = "Female_Adult_04";
            if (folder == null) return null;
            return "Assets/Concordia/Models/humans/rocketbox/" + folder + "/" + folder + ".fbx";
        }

        static RuntimeAnimatorController LoadLocomotion()
        {
            var c = Resources.Load<RuntimeAnimatorController>("Concordia/SoldierLocomotion");
#if UNITY_EDITOR
            if (!c)
                c = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                    "Assets/Concordia/Anim/SoldierLocomotion.controller");
            if (!c)
                c = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                    "Assets/Concordia/Resources/Concordia/SoldierLocomotion.controller");
            if (!c)
                c = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                    "Assets/SourceFiles/StarterAssets/ThirdPersonController/Character/Animations/StarterAssetsThirdPerson.controller");
            if (!c)
                c = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                    "Assets/Kevin Iglesias/Human Animations/Unity Demo Scenes/Human Basic Motions/AnimatorControllers/HumanBasicMotionsScene.controller");
#endif
            if (!c) c = Resources.Load<RuntimeAnimatorController>("Concordia/KenneyLocomotion");
            return c;
        }

        static bool HasParam(Animator a, string n)
        {
            foreach (var p in a.parameters)
                if (p.name == n) return true;
            return false;
        }

        static float RendererHeight(GameObject go)
        {
            var rends = go.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return 0f;
            var b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            return b.size.y;
        }

        void BuildPrimitive()
        {
            _hip = Bone(transform, "Hips", new Vector3(0f, 0.96f, 0f));
            _spine = Bone(_hip, "Spine", new Vector3(0f, 0.12f, 0f));
            _chest = Bone(_spine, "Chest", new Vector3(0f, 0.20f, 0f));
            _neck = Bone(_chest, "Neck", new Vector3(0f, 0.18f, 0f));
            _head = Bone(_neck, "Head", new Vector3(0f, 0.14f, 0f));

            _uArmL = Bone(_chest, "UpperArmL", new Vector3(-0.22f, 0.12f, 0f));
            _fArmL = Bone(_uArmL, "ForeArmL", new Vector3(-0.28f, 0f, 0f));
            _handL = Bone(_fArmL, "HandL", new Vector3(-0.26f, 0f, 0f));
            _uArmR = Bone(_chest, "UpperArmR", new Vector3(0.22f, 0.12f, 0f));
            _fArmR = Bone(_uArmR, "ForeArmR", new Vector3(0.28f, 0f, 0f));
            _handR = Bone(_fArmR, "HandR", new Vector3(0.26f, 0f, 0f));
            leftHand = _handL;
            rightHand = _handR;

            _uLegL = Bone(_hip, "UpperLegL", new Vector3(-0.11f, -0.04f, 0f));
            _lLegL = Bone(_uLegL, "LowerLegL", new Vector3(0f, -0.42f, 0f));
            _footL = Bone(_lLegL, "FootL", new Vector3(0f, -0.40f, 0.04f));
            _uLegR = Bone(_hip, "UpperLegR", new Vector3(0.11f, -0.04f, 0f));
            _lLegR = Bone(_uLegR, "LowerLegR", new Vector3(0f, -0.42f, 0f));
            _footR = Bone(_lLegR, "FootR", new Vector3(0f, -0.40f, 0.04f));

            _uArmL.localRotation = Quaternion.Euler(0f, 0f, 78f);
            _uArmR.localRotation = Quaternion.Euler(0f, 0f, -78f);
            _fArmL.localRotation = Quaternion.Euler(0f, 0f, 8f);
            _fArmR.localRotation = Quaternion.Euler(0f, 0f, -8f);

            var skin = HubLook.Lit(new Color(0.72f, 0.52f, 0.38f), 0.04f, 0.38f);
            var cloth = HubLook.Lit(new Color(0.8f, 0.72f, 0.58f), 0.02f, 0.28f);
            var dark = HubLook.Lit(new Color(0.22f, 0.18f, 0.14f), 0.02f, 0.22f);

            _pelvisMesh = Part(_hip, PrimitiveType.Cube, new Vector3(0f, -0.02f, 0f), new Vector3(0.34f, 0.16f, 0.20f), dark, "Pelvis").transform;
            _tunic = Part(_chest, PrimitiveType.Cube, new Vector3(0f, 0.02f, 0f), new Vector3(0.38f, 0.40f, 0.22f), cloth, "Tunic").transform;
            Part(_spine, PrimitiveType.Cube, Vector3.zero, new Vector3(0.28f, 0.18f, 0.18f), cloth, "Waist");
            Part(_neck, PrimitiveType.Cube, new Vector3(0f, 0.02f, 0f), new Vector3(0.10f, 0.12f, 0.10f), skin, "NeckMesh");

            _skull = Part(_head, PrimitiveType.Capsule, new Vector3(0f, 0.02f, 0.01f), new Vector3(0.20f, 0.13f, 0.22f), skin, "Skull").transform;
            _jaw = Part(_head, PrimitiveType.Cube, new Vector3(0f, -0.10f, 0.02f), new Vector3(0.14f, 0.08f, 0.15f), skin, "Jaw").transform;
            _nose = Part(_head, PrimitiveType.Cube, new Vector3(0f, -0.01f, -0.12f), new Vector3(0.04f, 0.05f, 0.07f), skin, "Nose").transform;
            _brow = Part(_head, PrimitiveType.Cube, new Vector3(0f, 0.07f, -0.10f), new Vector3(0.16f, 0.025f, 0.04f), skin, "Brow").transform;
            Part(_head, PrimitiveType.Sphere, new Vector3(-0.12f, 0.01f, 0f), new Vector3(0.05f, 0.07f, 0.06f), skin, "EarL");
            Part(_head, PrimitiveType.Sphere, new Vector3(0.12f, 0.01f, 0f), new Vector3(0.05f, 0.07f, 0.06f), skin, "EarR");

            _eyeL = Part(_head, PrimitiveType.Sphere, new Vector3(-0.05f, 0.03f, -0.10f), new Vector3(0.045f, 0.045f, 0.04f), HubLook.Lit(Color.white, 0f, 0.8f), "EyeL").transform;
            _eyeR = Part(_head, PrimitiveType.Sphere, new Vector3(0.05f, 0.03f, -0.10f), new Vector3(0.045f, 0.045f, 0.04f), HubLook.Lit(Color.white, 0f, 0.8f), "EyeR").transform;
            _eye0 = _eyeL.localScale;
            Part(_eyeL, PrimitiveType.Sphere, new Vector3(0f, 0f, -0.012f), new Vector3(0.55f, 0.55f, 0.4f), HubLook.Emit(new Color(0.2f, 0.3f, 0.5f), 0.4f), "IrisL");
            Part(_eyeR, PrimitiveType.Sphere, new Vector3(0f, 0f, -0.012f), new Vector3(0.55f, 0.55f, 0.4f), HubLook.Emit(new Color(0.2f, 0.3f, 0.5f), 0.4f), "IrisR");

            _hairRoot = new GameObject("Hair").transform;
            _hairRoot.SetParent(_head, false);
            BuildHair();

            Limb(_uArmL, _fArmL, _handL, -1f, skin, cloth);
            Limb(_uArmR, _fArmR, _handR, 1f, skin, cloth);

            Part(_uLegL, PrimitiveType.Capsule, new Vector3(0f, -0.20f, 0f), new Vector3(0.14f, 0.22f, 0.14f), dark, "ThighL");
            Part(_lLegL, PrimitiveType.Capsule, new Vector3(0f, -0.18f, 0f), new Vector3(0.12f, 0.20f, 0.12f), dark, "CalfL");
            Part(_footL, PrimitiveType.Cube, new Vector3(0f, -0.03f, -0.06f), new Vector3(0.10f, 0.07f, 0.22f), dark, "BootL");
            Part(_uLegR, PrimitiveType.Capsule, new Vector3(0f, -0.20f, 0f), new Vector3(0.14f, 0.22f, 0.14f), dark, "ThighR");
            Part(_lLegR, PrimitiveType.Capsule, new Vector3(0f, -0.18f, 0f), new Vector3(0.12f, 0.20f, 0.12f), dark, "CalfR");
            Part(_footR, PrimitiveType.Cube, new Vector3(0f, -0.03f, -0.06f), new Vector3(0.10f, 0.07f, 0.22f), dark, "BootR");

            // Coat is a LAYER: thin back panel + side flaps. Not a second torso cube.
            _coat = Part(_chest, PrimitiveType.Cube, new Vector3(0f, -0.10f, 0.12f), new Vector3(0.42f, 0.52f, 0.08f), cloth, "Coat").transform;
            _coatL = Part(_chest, PrimitiveType.Cube, new Vector3(-0.20f, -0.10f, 0.02f), new Vector3(0.06f, 0.50f, 0.22f), cloth, "CoatL").transform;
            _coatR = Part(_chest, PrimitiveType.Cube, new Vector3(0.20f, -0.10f, 0.02f), new Vector3(0.06f, 0.50f, 0.22f), cloth, "CoatR").transform;
            _sash = Part(_hip, PrimitiveType.Cube, new Vector3(0f, 0.06f, 0f), new Vector3(0.38f, 0.07f, 0.22f), HubLook.Lit(new Color(0.55f, 0.35f, 0.16f), 0.15f, 0.4f), "Sash").transform;

            _tunic0 = _tunic.localScale;
            _coat0 = _coat.localScale;
            _coatL0 = _coatL.localScale;
            _coatR0 = _coatR.localScale;
            _pelvis0 = _pelvisMesh.localScale;
            _skull0 = _skull.localScale;
            _jaw0 = _jaw.localScale;

            _skin = FindRend("Skull", "Jaw", "Nose", "Brow", "EarL", "EarR", "NeckMesh", "UpperArmL", "UpperArmR", "ForeArmL", "ForeArmR", "HandL", "HandR");
            _shirt = FindRend("Tunic", "Waist");
            _pants = FindRend("ThighL", "ThighR", "CalfL", "CalfR", "Pelvis", "BootL", "BootR");
            _trim = FindRend("Sash", "Coat", "CoatL", "CoatR");
            _hair = _hairRoot.GetComponentsInChildren<Renderer>(true);
            _eyes = FindRend("IrisL", "IrisR");
            try
            {
                System.IO.File.WriteAllText("/tmp/concordia-person-bind.txt",
                    System.DateTime.Now.ToString("o") + " authored=False kenney=False primitive=True\n");
            }
            catch { }
            Debug.Log("Concordia ModularPerson primitive fallback (Kenney not bound)");
        }

        void Limb(Transform upper, Transform fore, Transform hand, float side, Material skin, Material cloth)
        {
            Part(upper, PrimitiveType.Capsule, new Vector3(side * 0.12f, 0f, 0f), new Vector3(0.10f, 0.16f, 0.10f), cloth, upper.name);
            var cap = upper.Find(upper.name);
            if (cap) cap.localRotation = Quaternion.Euler(0f, 0f, 90f);
            Part(fore, PrimitiveType.Capsule, new Vector3(side * 0.12f, 0f, 0f), new Vector3(0.08f, 0.14f, 0.08f), skin, fore.name);
            var f = fore.Find(fore.name);
            if (f) f.localRotation = Quaternion.Euler(0f, 0f, 90f);
            Part(hand, PrimitiveType.Sphere, Vector3.zero, new Vector3(0.09f, 0.08f, 0.06f), skin, hand.name);
        }

        void BuildHair()
        {
            var mat = HubLook.Lit(new Color(0.12f, 0.08f, 0.06f), 0.02f, 0.18f);
            HairPart("Crop", PrimitiveType.Sphere, new Vector3(0f, 0.08f, 0.01f), new Vector3(0.26f, 0.12f, 0.26f), mat);
            HairPart("Short", PrimitiveType.Sphere, new Vector3(0f, 0.10f, 0.00f), new Vector3(0.27f, 0.16f, 0.27f), mat);
            HairPart("Sweep", PrimitiveType.Sphere, new Vector3(0.02f, 0.10f, -0.04f), new Vector3(0.26f, 0.14f, 0.28f), mat);
            HairPart("Bun", PrimitiveType.Sphere, new Vector3(0f, 0.08f, 0.02f), new Vector3(0.25f, 0.12f, 0.25f), mat);
            HairPart("BunKnot", PrimitiveType.Sphere, new Vector3(0f, 0.14f, 0.08f), new Vector3(0.12f, 0.12f, 0.12f), mat);
            HairPart("Long", PrimitiveType.Sphere, new Vector3(0f, 0.08f, 0.04f), new Vector3(0.26f, 0.14f, 0.24f), mat);
            HairPart("LongFall", PrimitiveType.Capsule, new Vector3(0f, -0.06f, 0.10f), new Vector3(0.16f, 0.22f, 0.10f), mat);
            HairPart("Topknot", PrimitiveType.Sphere, new Vector3(0f, 0.06f, 0.01f), new Vector3(0.22f, 0.08f, 0.22f), mat);
            HairPart("Knot", PrimitiveType.Sphere, new Vector3(0f, 0.16f, 0.00f), new Vector3(0.10f, 0.12f, 0.10f), mat);
        }

        void HairPart(string n, PrimitiveType t, Vector3 pos, Vector3 sc, Material m)
        {
            var go = Part(_hairRoot, t, pos, sc, m, n);
            go.SetActive(false);
        }

        public void Apply(Appearance a)
        {
            if (a == null) a = new Appearance();
            look = a;
            if (!_built) Build();

            float h = Mathf.Clamp(a.height, 0.86f, 1.16f);
            transform.localScale = Vector3.one * h;

            // Bones with descendants stay at 1. Body type scales MESH parts only.
            if (_hip) _hip.localScale = Vector3.one;
            if (_spine) _spine.localScale = Vector3.one;
            if (_chest) _chest.localScale = Vector3.one;
            if (_neck) _neck.localScale = Vector3.one;
            if (_head) _head.localScale = Vector3.one;
            var fbxRoot2 = FindBone(transform, "Root");
            if (fbxRoot2) fbxRoot2.localScale = Vector3.one;

            float w = Mathf.Clamp(a.width, 0.8f, 1.28f);
            float sh = Mathf.Clamp(a.shoulders, 0.82f, 1.28f);
            float ch = Mathf.Clamp(a.chest, 0.86f, 1.24f);
            float hp = Mathf.Lerp(0.92f, 1.12f, Mathf.Clamp01(a.hips));
            float hd = Mathf.Clamp(a.head, 0.88f, 1.16f);

            if (_tunic) _tunic.localScale = new Vector3(_tunic0.x * sh, _tunic0.y * ch, _tunic0.z);
            if (_coat) _coat.localScale = new Vector3(_coat0.x * sh, _coat0.y * ch, _coat0.z);
            if (_coatL) _coatL.localScale = new Vector3(_coatL0.x, _coatL0.y * ch, _coatL0.z * w);
            if (_coatR) _coatR.localScale = new Vector3(_coatR0.x, _coatR0.y * ch, _coatR0.z * w);
            if (_pelvisMesh) _pelvisMesh.localScale = new Vector3(_pelvis0.x * w, _pelvis0.y, _pelvis0.z * hp);
            if (_skull) _skull.localScale = _skull0 * hd;
            if (_jaw)
            {
                var js = _jaw0 == Vector3.zero ? _jaw.localScale : _jaw0;
                _jaw.localScale = new Vector3(js.x * Mathf.Clamp(a.jaw, 0.8f, 1.3f), js.y * Mathf.Lerp(0.85f, 1.2f, a.jaw * 0.5f + 0.5f), js.z);
            }
            if (_brow) _brow.localPosition = new Vector3(0f, Mathf.Lerp(0.04f, 0.10f, a.brow), -0.10f);
            if (_nose)
            {
                _nose.localPosition = new Vector3(0f, -0.01f, Mathf.Lerp(-0.10f, -0.15f, a.nose));
                _nose.localScale = new Vector3(0.04f, Mathf.Lerp(0.04f, 0.07f, a.nose), Mathf.Lerp(0.05f, 0.09f, a.nose));
            }
            if (_hairRoot) _hairRoot.localScale = Vector3.one * hd;

            if (_authored) ApplyAuthoredLook(a);
            else
            {
                Tint(_skin, a.SkinColor());
                Tint(_shirt, a.ShirtColor());
                Tint(_pants, a.PantsColor());
                Tint(_trim, a.TrimColor());
                Tint(_hair, a.HairColor());
                Tint(_eyes, a.EyeColor() * 1.4f, true);
            }

            bool coat = a.HasCoat;
            if (_coat) _coat.gameObject.SetActive(coat);
            if (_coatL) _coatL.gameObject.SetActive(coat);
            if (_coatR) _coatR.gameObject.SetActive(coat);
            if (_sash) _sash.gameObject.SetActive(a.HasSash);

            if (_hairRoot)
            {
                int hs = Mathf.Clamp(a.hairStyle, 0, 5);
                foreach (Transform c in _hairRoot)
                    c.gameObject.SetActive(false);
                void On(string n)
                {
                    var t = _hairRoot.Find(n);
                    if (t) t.gameObject.SetActive(true);
                }
                switch (hs)
                {
                    case 0: On("Crop"); break;
                    case 1: On("Short"); break;
                    case 2: On("Sweep"); break;
                    case 3: On("Bun"); On("BunKnot"); break;
                    case 4: On("Long"); On("LongFall"); break;
                    default: On("Topknot"); On("Knot"); break;
                }
            }
        }

        void ApplyAuthoredLook(Appearance a)
        {
            // Kenney mini-characters and KayKit knights are already painted.
            // Replacing their materials with a skin tint washed the plaza.
            Tint(_trim, a.TrimColor());
            Tint(_hair, a.HairColor());
        }

        static Texture2D LoadSkinTex(string stem)
        {
            var t = Resources.Load<Texture2D>("Concordia/Person/" + stem);
            if (t) return t;
#if UNITY_EDITOR
            t = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Concordia/Resources/Concordia/Person/" + stem + ".png");
            if (!t) t = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Concordia/Models/living/kenney-person/" + stem + ".png");
#endif
            return t;
        }

        void LateUpdate()
        {
            if (!_built) return;
            if (_authored && _plantFrames < 8)
            {
                StripGiantAndFallback();
                if (_clipsFit && _plantFrames == 6 && _handL && _uArmL)
                {
                    float dy = _handL.position.y - _uArmL.position.y;
                    if (dy > -0.22f)
                    {
                        _clipsFit = false;
                        if (_anim)
                        {
                            _anim.runtimeAnimatorController = null;
                            _anim.enabled = false;
                        }
                        HangAuthoredArms(0f);
                    }
                }
                _plantFrames++;
            }

            bool animating = _clipsFit && !_biped && _authored && _anim && _anim.enabled && _anim.runtimeAnimatorController
                && _anim.avatar && _anim.avatar.isHuman && _anim.avatar.isValid && _grounded && _sit < 0.4f
                && _speed > 0.35f;
            if (!animating)
            {
                if (_authored) ApplyAuthoredGait();
                else ApplyPrimitiveGait();
            }
            else
                ApplyAuthoredAttitude();

            if (_slashT > 0f && _uArmR)
            {
                _slashT -= Time.deltaTime;
                var t = 1f - Mathf.Clamp01(_slashT / 0.48f);
                float wind = t < 0.08f ? t / 0.08f : t < 0.5f ? 1f : 1f - (t - 0.5f) / 0.5f;
                var swing = t < 0.32f ? Mathf.Lerp(-20f, 125f, t / 0.32f) : Mathf.Lerp(125f, 0f, (t - 0.32f) / 0.68f);
                float arc = swing * wind;
                if (_biped)
                {
                    _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, 18f + arc * 0.95f, false);
                    if (_fArmR) _fArmR.localRotation = _rForeRest * ForeDelta(36f + 28f * wind, false);
                }
                else
                    _uArmR.localRotation *= Quaternion.Euler(arc, 18f * wind, 0f);
            }

            // Idle plant only. While moving the gait owns the feet — planting
            // every LateUpdate yanks the whole body and reads as a stomp.
            if (_authored && _sit < 0.4f && _shown < 0.35f && _grounded) PlantFeet();

            if (_eyeL && _eyeR && _eye0.sqrMagnitude > 0.0001f)
            {
                float blink = Mathf.PingPong(Time.time * 0.35f + transform.position.x, 3.2f);
                float lid = blink > 3.05f ? 0.15f : 1f;
                _eyeL.localScale = new Vector3(_eye0.x, _eye0.y * lid, _eye0.z);
                _eyeR.localScale = new Vector3(_eye0.x, _eye0.y * lid, _eye0.z);
            }
        }

        void ApplyPrimitiveGait()
        {
            if (!_hip || !_uArmL || !_uArmR) return;
            float dt = Time.deltaTime;
            _shown = Mathf.Lerp(_shown, _grounded ? _speed : 0f, 1f - Mathf.Exp(-14f * dt));
            _sitShown = Mathf.MoveTowards(_sitShown, _sit, dt * 6f);
            if (_hitT > 0f) _hitT -= dt;
            if (_landT > 0f) _landT -= dt;
            float spd = _shown;
            float walk = Mathf.InverseLerp(0.28f, 3.8f, spd);
            float jog = Mathf.InverseLerp(3.4f, 5.6f, spd);
            float run = Mathf.InverseLerp(5.4f, 8.0f, spd);
            if (spd > 0.25f) _phase += dt * (Mathf.Lerp(4.4f, 5.6f, walk) + 1.35f * jog + 1.15f * run);
            else _phase += dt * 1.35f;
            int ws = look != null ? look.walkStyle : 0;
            float armAmp = ws == 1 ? 44f : ws == 2 ? 16f : ws == 3 ? 22f : ws == 4 ? 36f : 32f;
            float legAmp = ws == 1 ? 40f : ws == 2 ? 24f : ws == 3 ? 28f : ws == 4 ? 42f : 34f;
            float hipSway = ws == 1 ? 12f : ws == 2 ? 4f : 8f;
            armAmp = Mathf.Lerp(0f, armAmp, walk);
            legAmp = Mathf.Lerp(0f, legAmp, Mathf.Max(walk, run));
            if (run > 0.1f) { armAmp += 12f * run; legAmp += 14f * run; }

            float s = Mathf.Sin(_phase);
            float c = Mathf.Cos(_phase);
            float punch = Mathf.Sin(_phase * 2f);
            float breath = Mathf.Sin(Time.time * 1.55f) * 0.014f;
            int att = look != null ? look.attitude : 0;
            float cock = att == 1 ? 7f : att == 2 ? 0f : att == 3 ? -4f : 3f;
            float chin = att == 2 ? -8f : att == 3 ? 4f : 0f;
            float idleArm = att == 2 ? -8f : att == 1 ? 6f : 0f;
            float sit = _sitShown;
            float hit = Mathf.Clamp01(_hitT / 0.32f);
            float land = Mathf.Clamp01(_landT / 0.22f);

            _hip.localRotation = Quaternion.Euler(
                sit * 18f + run * 7f + land * 14f + hit * 10f,
                cock * (1f - walk) + s * hipSway * walk,
                c * 3.5f * walk);
            if (_spine) _spine.localRotation = Quaternion.Euler(-4f + breath * 22f + sit * 10f + land * 8f, s * 5f * walk, -c * 2.5f * walk);
            if (_chest) _chest.localRotation = Quaternion.Euler((att == 2 ? -6f : -2f) + breath * 10f + punch * 2f * walk, -s * 4f * walk, 0f);
            if (_head) _head.localRotation = Quaternion.Euler(
                chin + Mathf.Sin(Time.time * 0.7f) * 3f * (1f - walk) - land * 6f - hit * 8f,
                Mathf.Sin(Time.time * 0.45f) * 8f * (1f - walk) + s * 6f * walk,
                0f);

            float hang = 78f;
            _uArmL.localRotation = Quaternion.Euler(-armAmp * s + idleArm + punch * 4f * walk, 8f, hang);
            if (sword)
            {
                _uArmR.localRotation = Quaternion.Euler(armAmp * s * 0.35f - idleArm, 18f, -50f);
                if (_fArmR) _fArmR.localRotation = Quaternion.Euler(12f + walk * 8f, 0f, -38f);
            }
            else
            {
                _uArmR.localRotation = Quaternion.Euler(armAmp * s - idleArm, -8f, -hang);
                if (_fArmR) _fArmR.localRotation = Quaternion.Euler(0f, 0f, -10f - walk * 14f);
            }
            if (_fArmL) _fArmL.localRotation = Quaternion.Euler(0f, 0f, 10f + walk * 14f);

            float squat = sit * 55f + land * 18f + hit * 12f;
            float kneeL = Mathf.Max(0f, -s) * legAmp * 0.95f;
            float kneeR = Mathf.Max(0f, s) * legAmp * 0.95f;
            if (_uLegL) _uLegL.localRotation = Quaternion.Euler(legAmp * s + squat, 0f, 4f);
            if (_uLegR) _uLegR.localRotation = Quaternion.Euler(-legAmp * s + squat, 0f, -4f);
            if (_lLegL) _lLegL.localRotation = Quaternion.Euler(kneeL + sit * 40f, 0f, 0f);
            if (_lLegR) _lLegR.localRotation = Quaternion.Euler(kneeR + sit * 40f, 0f, 0f);
            if (_footL) _footL.localRotation = Quaternion.Euler(-6f - sit * 10f + Mathf.Max(0f, s) * 18f * walk, 0f, 0f);
            if (_footR) _footR.localRotation = Quaternion.Euler(-6f - sit * 10f + Mathf.Max(0f, -s) * 18f * walk, 0f, 0f);

            if (!_grounded)
            {
                float rising = _vert > 0.4f ? 1f : 0f;
                if (_uLegL) _uLegL.localRotation = Quaternion.Euler(rising * -16f + 12f, 0f, 6f);
                if (_uLegR) _uLegR.localRotation = Quaternion.Euler(rising * -16f + 12f, 0f, -6f);
                if (_lLegL) _lLegL.localRotation = Quaternion.Euler(50f, 0f, 0f);
                if (_lLegR) _lLegR.localRotation = Quaternion.Euler(50f, 0f, 0f);
                _uArmL.localRotation = Quaternion.Euler(rising * -20f, 0f, 50f);
                _uArmR.localRotation = Quaternion.Euler(rising * -20f, 0f, -50f);
            }
        }

        static bool NameHasBip(Transform t) =>
            t && t.name.IndexOf("Bip", System.StringComparison.OrdinalIgnoreCase) >= 0;

        /// <summary>
        /// Mixamo hang is local Z from T-pose. 3ds Max Biped hangs on local X
        /// (along-bone). Guessing Mixamo Z on a Bip01 arm leaves the T-pose.
        /// </summary>
        Quaternion ArmDelta(float swing, float hang, bool left)
        {
            return Quaternion.Euler(left ? -swing : swing, 0f, left ? hang : -hang);
        }

        /// <summary>
        /// Biped local X is along-bone (shoulderward). Euler-on-X only twists.
        /// Point -X at world down so the hand actually drops.
        /// </summary>
        Quaternion BipedArm(Transform bone, Quaternion rest, float swing, bool left)
        {
            if (!bone || !bone.parent) return rest;
            Vector3 along = rest * Vector3.left;
            Vector3 parentDown = bone.parent.InverseTransformDirection(Vector3.down);
            Vector3 outboard = bone.parent.InverseTransformDirection((left ? -1f : 1f) * transform.right);
            Vector3 target = (parentDown + outboard * 0.18f).normalized;
            var hung = Quaternion.FromToRotation(along, target) * rest;
            if (Mathf.Abs(swing) < 0.05f) return hung;
            Vector3 side = bone.parent.InverseTransformDirection(transform.right);
            return Quaternion.AngleAxis(left ? swing : -swing, side) * hung;
        }

        Quaternion ForeDelta(float curl, bool left)
        {
            if (_biped) return Quaternion.Euler(left ? curl : -curl, 0f, 0f);
            return Quaternion.Euler(0f, 0f, left ? curl : -curl);
        }

        Quaternion BipedHinge(Transform bone, Quaternion rest, float degrees)
        {
            if (!bone || !bone.parent) return rest;
            Vector3 side = bone.parent.InverseTransformDirection(transform.right);
            return Quaternion.AngleAxis(degrees, side) * rest;
        }

        Quaternion LegDelta(float swing, float sit, bool left)
        {
            return Quaternion.Euler(swing + sit, 0f, left ? 4f : -4f);
        }

        Quaternion KneeDelta(float curl)
        {
            return Quaternion.Euler(curl, 0f, 0f);
        }

        void HangAuthoredArms(float walk)
        {
            float swing = 0f;
            float hang = Mathf.Lerp(_biped ? 70f : 72f, _biped ? 38f : 28f, walk);
            if (_biped)
            {
                if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, swing, true);
                if (_uArmR) _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, swing, false);
                return;
            }
            if (_uArmL) _uArmL.localRotation = _lArmRest * ArmDelta(0f, hang, true);
            if (_uArmR) _uArmR.localRotation = _rArmRest * ArmDelta(0f, hang, false);
        }

        void ApplyAuthoredGait()
        {
            if (!_hip || !_uArmL || !_uArmR) return;
            float dt = Time.deltaTime;
            _shown = Mathf.Lerp(_shown, _grounded ? _speed : 0f, 1f - Mathf.Exp(-12f * dt));
            _sitShown = Mathf.MoveTowards(_sitShown, _sit, dt * 6f);
            float spd = _shown;
            // Walk / jog / run. Old Lerp(6.4, 10.6) + 56° knees was a march.
            float walk = Mathf.InverseLerp(0.28f, 3.8f, spd);
            float jog = Mathf.InverseLerp(3.4f, 5.6f, spd);
            float run = Mathf.InverseLerp(5.4f, 8.0f, spd);
            float cadence = spd > 0.28f
                ? Mathf.Lerp(4.4f, 5.6f, walk) + 1.35f * jog + 1.15f * run
                : 1.35f;
            _phase += dt * cadence;
            float s = Mathf.Sin(_phase);
            float sit = _sitShown;
            float breath = Mathf.Sin(Time.time * 1.55f) * 3f;
            float moving = Mathf.Clamp01(walk + jog * 0.35f);
            float hang = Mathf.Lerp(72f, 28f, moving);
            float hipAmp = 22f * walk + 14f * jog + 10f * run;
            float kneeSwing = 22f * walk + 6f * jog + 4f * run;
            float kneeStance = 8f + 4f * jog + 6f * run;
            float armAmp = 22f * walk + 14f * jog + 10f * run;
            float lean = 4f * walk + 6f * jog + 8f * run;
            float idle = 1f - moving;
            float shift = Mathf.Sin(Time.time * 1.15f + transform.position.x) * 6f * idle;
            bool talk = Talking();
            float talkLift = talk ? 16f + Mathf.Sin(Time.time * 5.2f) * 11f : 0f;
            float talkCurl = talk ? 20f + Mathf.Abs(Mathf.Sin(Time.time * 6.1f)) * 14f : 0f;
            // Opposite arm to the stepping leg — ipsilateral swing reads as a march.
            float contra = -s * armAmp;
            if (_biped)
            {
                if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, contra - breath * 0.15f + shift * 0.4f, true);
                if (_uArmR) _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, contra - breath * 0.15f + talkLift, false);
            }
            else
            {
                if (_uArmL) _uArmL.localRotation = _lArmRest * ArmDelta(contra - breath * 0.15f, hang, true);
                if (_uArmR) _uArmR.localRotation = _rArmRest * ArmDelta(contra - breath * 0.15f + talkLift, hang, false);
            }
            if (_fArmL) _fArmL.localRotation = _lForeRest * ForeDelta(10f + 10f * moving, true);
            if (_fArmR) _fArmR.localRotation = _rForeRest * ForeDelta(10f + 10f * moving + talkCurl, false);
            float liftL = Mathf.Max(0f, s);
            float liftR = Mathf.Max(0f, -s);
            if (_biped)
            {
                if (_uLegL) _uLegL.localRotation = BipedHinge(_uLegL, _lUpRest, hipAmp * s + sit * 50f + shift * 0.5f);
                if (_uLegR) _uLegR.localRotation = BipedHinge(_uLegR, _rUpRest, -hipAmp * s + sit * 50f - shift * 0.5f);
                if (_lLegL) _lLegL.localRotation = BipedHinge(_lLegL, _lLegRest, kneeStance + liftL * kneeSwing + sit * 38f);
                if (_lLegR) _lLegR.localRotation = BipedHinge(_lLegR, _rLegRest, kneeStance + liftR * kneeSwing + sit * 38f);
            }
            else
            {
                if (_uLegL) _uLegL.localRotation = _lUpRest * LegDelta(hipAmp * 0.85f * s, sit * 50f, true);
                if (_uLegR) _uLegR.localRotation = _rUpRest * LegDelta(-hipAmp * 0.85f * s, sit * 50f, false);
                if (_lLegL) _lLegL.localRotation = _lLegRest * KneeDelta(kneeStance + liftR * kneeSwing + sit * 38f);
                if (_lLegR) _lLegR.localRotation = _rLegRest * KneeDelta(kneeStance + liftL * kneeSwing + sit * 38f);
            }
            if (_hip)
            {
                float bob = moving > 0.05f ? -0.018f * moving - 0.012f * run + 0.022f * Mathf.Abs(s) * (0.55f + 0.45f * run) : 0f;
                _hip.localPosition = _hipPos0 + new Vector3(0f, bob, 0f);
                _hip.localRotation = _hipsRest * Quaternion.Euler(sit * 16f + lean + shift * 0.4f, 6f * s * moving + shift, 0f);
            }
            if (_spine) _spine.localRotation = _spineRest * Quaternion.Euler(breath + sit * 8f + lean * 0.35f, 4f * s * moving, 0f);
            ApplyAuthoredAttitude();
            if (!_grounded)
            {
                var rising = _vert > 0.4f;
                var tuck = rising ? 0.8f : 0.25f;
                if (_biped)
                {
                    if (_uLegL) _uLegL.localRotation = BipedHinge(_uLegL, _lUpRest, rising ? -16f : 14f);
                    if (_uLegR) _uLegR.localRotation = BipedHinge(_uLegR, _rUpRest, rising ? -16f : 14f);
                    if (_lLegL) _lLegL.localRotation = BipedHinge(_lLegL, _lLegRest, tuck * 65f);
                    if (_lLegR) _lLegR.localRotation = BipedHinge(_lLegR, _rLegRest, tuck * 65f);
                    if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, rising ? -18f : 12f, true);
                    if (_uArmR) _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, rising ? -18f : 12f, false);
                }
                else
                {
                    if (_uLegL) _uLegL.localRotation = _lUpRest * LegDelta(rising ? -16f : 14f, 0f, true);
                    if (_uLegR) _uLegR.localRotation = _rUpRest * LegDelta(rising ? -16f : 14f, 0f, false);
                    if (_lLegL) _lLegL.localRotation = _lLegRest * KneeDelta(tuck * 65f);
                    if (_lLegR) _lLegR.localRotation = _rLegRest * KneeDelta(tuck * 65f);
                    if (_uArmL) _uArmL.localRotation = _lArmRest * ArmDelta(0f, rising ? 50f : 40f, true);
                    if (_uArmR) _uArmR.localRotation = _rArmRest * ArmDelta(0f, rising ? 50f : 40f, false);
                }
            }
        }

        void ApplyAuthoredAttitude()
        {
            if (!_head) return;
            int att = look != null ? look.attitude : 0;
            float chin = att == 2 ? -8f : att == 3 ? 4f : 0f;
            float walk = Mathf.InverseLerp(0.35f, 4.6f, _grounded ? _speed : 0f);
            float idle = 1f - walk;
            bool talk = Talking();
            float nod = talk ? Mathf.Sin(Time.time * 4.4f) * 6f : Mathf.Sin(Time.time * 0.7f) * 3f * idle;
            float glance = talk ? Mathf.Sin(Time.time * 1.1f) * 10f : Mathf.Sin(Time.time * 0.45f) * 12f * idle;
            _head.localRotation = _headRest * Quaternion.Euler(chin + nod, glance, 0f);
        }


        void StripGiantAndFallback()
        {
            bool any = false;
            Bounds enc = default;
            Renderer biggest = null;
            float maxDim = 0f;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var s = r.bounds.size;
                float d = Mathf.Max(s.x, Mathf.Max(s.y, s.z));
                if (d > maxDim) { maxDim = d; biggest = r; }
                string n = r.gameObject.name;
                bool extra = n == "Crop" || n == "Short" || n == "Sweep" || n == "Bun" || n == "BunKnot"
                    || n == "Long" || n == "LongFall" || n == "Topknot" || n == "Knot"
                    || n == "Coat" || n == "CoatL" || n == "CoatR" || n == "Tunic" || n == "Sash" || n == "Pelvis";
                if (_authored && extra && !(r is SkinnedMeshRenderer))
                {
                    r.enabled = false;
                    r.gameObject.SetActive(false);
                    continue;
                }
                if (d > 6.5f && !(r is SkinnedMeshRenderer))
                {
                    r.enabled = false;
                    continue;
                }
                if (!r.enabled || !r.gameObject.activeInHierarchy) continue;
                if (!any) { enc = r.bounds; any = true; }
                else enc.Encapsulate(r.bounds);
            }
            float hy = any ? enc.size.y : 0f;
            bool broken = !any || hy < 0.45f || hy > 6.5f;
            try
            {
                var kenneyXf = transform.Find("KenneyPerson");
                System.IO.File.WriteAllText("/tmp/concordia-person-bind.txt",
                    System.DateTime.Now.ToString("o")
                    + " authored=" + _authored
                    + " enc=" + (any ? enc.ToString() : "none")
                    + " hy=" + hy.ToString("0.000")
                    + " maxDim=" + maxDim.ToString("0.000")
                    + " biggest=" + (biggest ? biggest.name : "null")
                    + " broken=" + broken
                    + " kenneyLossy=" + (kenneyXf ? kenneyXf.lossyScale.ToString() : "none")
                    + " personLossy=" + transform.lossyScale
                    + "\n");
            }
            catch { }
            if (!broken) return;
            var kenney = transform.Find("KenneyPerson");
            if (kenney)
            {
                kenney.gameObject.SetActive(false);
                Object.Destroy(kenney.gameObject);
            }
            _authored = false;
            _built = false;
            _skinMesh = null;
            _anim = null;
            _hip = _spine = _chest = _neck = _head = null;
            _uArmL = _fArmL = _handL = _uArmR = _fArmR = _handR = null;
            _uLegL = _lLegL = _footL = _uLegR = _lLegR = _footR = null;
            _hairRoot = _coat = _coatL = _coatR = _tunic = _sash = _pelvisMesh = _skull = _jaw = null;
            Build();
            Apply(look);
            Debug.LogWarning("Concordia ModularPerson Kenney unusable (hy=" + hy + " maxDim=" + maxDim + ") — primitive visible fallback");
        }

        static void StripPrefabWeapons(GameObject body)
        {
            if (!body) return;
            foreach (var t in body.GetComponentsInChildren<Transform>(true))
            {
                if (!t || t == body.transform) continue;
                var n = t.name.ToLowerInvariant();
                if (n.Contains("heldsword")) continue;
                if (!(n.Contains("sword") || n.Contains("weapon") || n.Contains("blade") || n.Contains("shield")))
                    continue;
                t.gameObject.SetActive(false);
            }
        }

        void PlantFeet()
        {
            float footY = float.MaxValue;
            if (_footL) footY = Mathf.Min(footY, _footL.position.y);
            if (_footR) footY = Mathf.Min(footY, _footR.position.y);
            if (footY > 40f) return;
            var cc = GetComponentInParent<CharacterController>();
            float ground = cc ? cc.transform.position.y : transform.position.y;
            var delta = (ground + 0.08f) - footY;
            if (Mathf.Abs(delta) < 0.006f) return;
            if (Mathf.Abs(delta) > 1.8f) return;
            transform.position += Vector3.up * Mathf.Clamp(delta, -0.16f, 0.16f);
        }

        static void Capture(Transform t, ref Quaternion rest)
        {
            if (t) rest = t.localRotation;
        }

        static HumanBone MapHuman(string muscle, Transform t)
        {
            return new HumanBone
            {
                humanName = muscle,
                boneName = t.name,
                limit = new HumanLimit { useDefaultValues = true }
            };
        }

        Avatar TryBipedAvatar(GameObject body)
        {
            if (!body || !_hip || !_uArmL || !_uArmR || !_head) return null;
            var human = new System.Collections.Generic.List<HumanBone>();
            if (_hip) human.Add(MapHuman("Hips", _hip));
            if (_spine) human.Add(MapHuman("Spine", _spine));
            if (_chest) human.Add(MapHuman("Chest", _chest));
            if (_neck) human.Add(MapHuman("Neck", _neck));
            if (_head) human.Add(MapHuman("Head", _head));
            var clavL = FindBone(body.transform, "Bip01 L Clavicle");
            var clavR = FindBone(body.transform, "Bip01 R Clavicle");
            if (clavL) human.Add(MapHuman("LeftShoulder", clavL));
            if (clavR) human.Add(MapHuman("RightShoulder", clavR));
            if (_uArmL) human.Add(MapHuman("LeftUpperArm", _uArmL));
            if (_fArmL) human.Add(MapHuman("LeftLowerArm", _fArmL));
            if (_handL) human.Add(MapHuman("LeftHand", _handL));
            if (_uArmR) human.Add(MapHuman("RightUpperArm", _uArmR));
            if (_fArmR) human.Add(MapHuman("RightLowerArm", _fArmR));
            if (_handR) human.Add(MapHuman("RightHand", _handR));
            if (_uLegL) human.Add(MapHuman("LeftUpperLeg", _uLegL));
            if (_lLegL) human.Add(MapHuman("LeftLowerLeg", _lLegL));
            if (_footL) human.Add(MapHuman("LeftFoot", _footL));
            if (_uLegR) human.Add(MapHuman("RightUpperLeg", _uLegR));
            if (_lLegR) human.Add(MapHuman("RightLowerLeg", _lLegR));
            if (_footR) human.Add(MapHuman("RightFoot", _footR));
            var toeL = FindBone(body.transform, "Bip01 L Toe0");
            var toeR = FindBone(body.transform, "Bip01 R Toe0");
            if (toeL) human.Add(MapHuman("LeftToes", toeL));
            if (toeR) human.Add(MapHuman("RightToes", toeR));
            var xforms = body.GetComponentsInChildren<Transform>(true);
            var skel = new SkeletonBone[xforms.Length];
            for (int i = 0; i < xforms.Length; i++)
            {
                var t = xforms[i];
                skel[i] = new SkeletonBone
                {
                    name = t.name,
                    position = t.localPosition,
                    rotation = t.localRotation,
                    scale = t.localScale
                };
            }
            var desc = new HumanDescription
            {
                human = human.ToArray(),
                skeleton = skel,
                armStretch = 0.05f,
                legStretch = 0.05f,
                upperArmTwist = 0.5f,
                lowerArmTwist = 0.5f,
                upperLegTwist = 0.5f,
                lowerLegTwist = 0.5f,
                feetSpacing = 0f,
                hasTranslationDoF = false
            };
            try
            {
                var av = AvatarBuilder.BuildHumanAvatar(body, desc);
                if (av && av.isHuman && av.isValid) return av;
                if (av) Object.Destroy(av);
            }
            catch { }
            return null;
        }

        static Transform FindBone(Transform root, params string[] names)
        {
            var all = root.GetComponentsInChildren<Transform>(true);
            foreach (var n in names)
            foreach (var x in all)
                if (string.Equals(x.name, n, System.StringComparison.OrdinalIgnoreCase))
                    return x;
            return null;
        }

        static Transform Bone(Transform parent, string n, Vector3 local)
        {
            var t = new GameObject(n).transform;
            t.SetParent(parent, false);
            t.localPosition = local;
            t.localRotation = Quaternion.identity;
            return t;
        }

        static GameObject Part(Transform parent, PrimitiveType t, Vector3 pos, Vector3 sc, Material mat, string n)
        {
            var go = GameObject.CreatePrimitive(t);
            go.name = n;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = sc;
            Object.Destroy(go.GetComponent<Collider>());
            var r = go.GetComponent<Renderer>();
            if (r) r.sharedMaterial = mat;
            go.layer = parent.gameObject.layer;
            return go;
        }

        Renderer[] FindRend(params string[] names)
        {
            var list = new System.Collections.Generic.List<Renderer>();
            var all = GetComponentsInChildren<Renderer>(true);
            foreach (var r in all)
                foreach (var n in names)
                    if (r.gameObject.name == n) list.Add(r);
            return list.ToArray();
        }

        static void Tint(Renderer[] rs, Color c, bool emit = false)
        {
            if (rs == null) return;
            var m = emit ? HubLook.Emit(c, 1.2f) : HubLook.Lit(c, 0.04f, 0.34f);
            foreach (var r in rs) if (r) r.sharedMaterial = m;
        }

        public static void StampSash(GameObject go, Color col)
        {
            if (!go) return;
            var sash = GameObject.CreatePrimitive(PrimitiveType.Cube);
            sash.name = "FactionSash";
            sash.transform.SetParent(go.transform, false);
            sash.transform.localPosition = new Vector3(0.02f, 1.15f, 0.12f);
            sash.transform.localScale = new Vector3(0.42f, 0.08f, 0.16f);
            sash.transform.localRotation = Quaternion.Euler(12f, 0f, -18f);
            Object.Destroy(sash.GetComponent<Collider>());
            var r = sash.GetComponent<Renderer>();
            if (r) r.sharedMaterial = HubLook.Lit(col, 0.08f, 0.28f);
        }

        static GameObject MakeSword()
        {
            var mesh = FreePacks.Mesh("longsword") ?? FreePacks.Mesh("weapon-sword");
            if (mesh)
            {
                var held = Object.Instantiate(mesh);
                held.name = "HeldSword";
                foreach (var c in held.GetComponentsInChildren<Collider>()) Object.Destroy(c);
                FreePacks.PaintIfBlank(held);
                return held;
            }
            var g = new GameObject("HeldSword");
            void Bit(PrimitiveType t, Vector3 p, Vector3 s, Color c)
            {
                var m = GameObject.CreatePrimitive(t);
                m.transform.SetParent(g.transform, false);
                m.transform.localPosition = p;
                m.transform.localScale = s;
                Object.Destroy(m.GetComponent<Collider>());
                m.GetComponent<Renderer>().sharedMaterial = HubLook.Lit(c, 0.6f, 0.7f);
            }
            Bit(PrimitiveType.Cylinder, new Vector3(0, 0.07f, 0), new Vector3(0.04f, 0.07f, 0.04f), new Color(0.3f, 0.2f, 0.12f));
            Bit(PrimitiveType.Cube, new Vector3(0, 0.16f, 0), new Vector3(0.22f, 0.03f, 0.04f), new Color(0.85f, 0.82f, 0.75f));
            Bit(PrimitiveType.Cube, new Vector3(0, 0.55f, 0), new Vector3(0.035f, 0.75f, 0.09f), new Color(0.9f, 0.88f, 0.82f));
            return g;
        }
    }
}
