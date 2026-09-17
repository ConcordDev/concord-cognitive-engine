using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia // FORCE_REFRESH_0024
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
        Quaternion _hipsRest, _spineRest, _chestRest, _lArmRest, _lForeRest, _rArmRest, _rForeRest;
        Quaternion _lUpRest, _lLegRest, _rUpRest, _rLegRest, _headRest;
        Vector3 _hipPos0;
        float _speed, _vert, _slashT, _slashDur, _phase, _sit, _sitShown, _shown, _hitT, _landT, _anticipateT, _staggerT;
        int _slashBeat;
        bool _slashHeavy;
        bool _grounded = true;
        FightStyle _style = FightStyle.MuayThai;
        bool _built;
        bool _authored;
        bool _biped;
        bool _clipsFit;
        Animator _anim;
        SkinnedMeshRenderer _skinMesh;
        Renderer _modelRenderer;
        Transform _modelTransform;
        int _plantFrames;
        NpcLife _life;
        static int _bodySeq;
        static string _lastPrefabPath;
        public static WorldId CastingWorld = WorldId.Hub;
        static WorldId _castBodyWorld = WorldId.Hub;

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
            CxDress.EnsureSockets(p);
            CxDress.Person(p, look, Canon.SteelLive(CastingWorld, root.transform.position));
            p.sword = MakeSword();
            var grip = p.rightHand && p.rightHand.Find("CX_Grip_R") ? p.rightHand.Find("CX_Grip_R") : (p.rightHand ? p.rightHand : p.transform);
            CharacterGear.Grip(p.sword, grip, 1.05f, true, false);
            CharacterVisualProfile.Apply(root, CastingWorld, look);
            if (hero) CxDress.HeroKit(p);
            _castBodyWorld = CastingWorld;
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
            CxDress.EnsureGripSockets(person);
            CxDress.Person(person, look, Canon.SteelLive(CastingWorld, pos));
            var h = 1.7f * (look != null ? look.height : 1f);
            var cc = Grounding.EnsureController(go, h);
            Grounding.Snap(cc);
            if (wander)
            {
                var w = go.AddComponent<NpcWander>();
                w.roam = roam;
            }
            PersonLabel.Attach(go.transform, look != null ? look.displayName : go.name, null);
            CharacterVisualProfile.Apply(go, CastingWorld, look);
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

        public void Slash() => Slash(false, 0);

        public void Slash(bool heavy, int beat)
        {
            _slashHeavy = heavy;
            _slashBeat = beat < 0 ? 0 : beat % 3;
            _slashDur = CombatMotion.Duration(heavy, _style);
            _slashT = _slashDur;
            _anticipateT = 0f;
            if (_anim && _anim.runtimeAnimatorController)
            {
                if (HasParam(_anim, "Attack")) _anim.SetTrigger("Attack");
                else if (HasParam(_anim, "Slash")) _anim.SetTrigger("Slash");
                if (heavy && HasParam(_anim, "AttackHeavy")) _anim.SetTrigger("AttackHeavy");
            }
        }
        public void Anticipate() => _anticipateT = 0.32f;
        public void BindStyle(FightStyle s)
        {
            _style = s;
            if (sword) sword.SetActive(s == FightStyle.Sword);
        }
        public void Sit(bool on) => _sit = on ? 1f : 0f;
        public void Hurt() => _hitT = 0.42f;
        public void Stagger() => _staggerT = 0.55f;
        public void Land() => _landT = 0.28f;
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

            // No primitive people. A missing imported human stays invisible and is
            // reported once instead of degrading the world into training dummies.
            _built = false;
            Debug.LogWarning("Concordia ModularPerson has no usable imported human asset; visual body omitted.");
        }

        bool TryBindAuthored(bool hero)
        {
            var prefab = LoadPersonPrefab(hero);
            if (!prefab) return false;
            var body = Object.Instantiate(prefab, transform);
            body.name = "AuthoredPerson";
            body.SetActive(true);
            _modelRenderer = FindRendererBearingChild(body);
            _modelTransform = _modelRenderer ? _modelRenderer.transform : null;
            if (!_modelRenderer)
            {
                body.SetActive(false);
                Debug.LogWarning("Concordia ModularPerson imported human has no renderer-bearing child; visual body omitted.");
                return false;
            }
            foreach (var renderer in body.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer) continue;
                renderer.gameObject.SetActive(true);
                renderer.enabled = true;
            }
            DressFromPrefabFolder(body);
            FreePacks.PaintIfBlank(body, _lastPrefabPath);
            body.transform.localPosition = Vector3.zero;
            body.transform.localRotation = Quaternion.identity;
            body.transform.localScale = Vector3.one;
            foreach (var c in body.GetComponentsInChildren<Collider>()) Object.Destroy(c);

            // Quaternius (Casual_Male/Female etc.) uses its own dot-notation naming —
            // "UpperArm.L", "Fist.L", "Foot.L" — that matched none of the existing Bip01/Mixamo
            // candidates, so every Quaternius character silently fell into the "painted mesh, not
            // Mixamo-rigged" fallback below: a static bind pose with no procedural motion at all.
            // Confirmed via the live bone hierarchy (Hips, Head, Neck, Torso, Abdomen, UpperArm.L/R,
            // LowerArm.L/R, Fist.L/R, UpperLeg.L/R, LowerLeg.L/R, Foot.L/R). Added as another
            // aliased convention, same pattern as Bip01/mixamorig: — not a parallel system.
            _hip = FindBone(body.transform, "Bip01 Pelvis", "Bip01", "Hips", "mixamorig:Hips");
            _spine = FindBone(body.transform, "Bip01 Spine", "Spine", "mixamorig:Spine", "Abdomen");
            _chest = FindBone(body.transform, "Bip01 Spine2", "Bip01 Spine1", "Chest", "UpperChest", "Spine1", "mixamorig:Spine1", "Torso") ?? _spine;
            _neck = FindBone(body.transform, "Bip01 Neck", "Neck", "mixamorig:Neck");
            _head = FindBone(body.transform, "Bip01 Head", "Head", "mixamorig:Head");
            _uArmL = FindBone(body.transform, "Bip01 L UpperArm", "LeftArm", "Left_UpperArm", "mixamorig:LeftArm", "UpperArm.L");
            _fArmL = FindBone(body.transform, "Bip01 L Forearm", "LeftForeArm", "Left_LowerArm", "mixamorig:LeftForeArm", "LowerArm.L");
            _handL = FindBone(body.transform, "Bip01 L Hand", "LeftHand", "Left_Hand", "mixamorig:LeftHand", "Fist.L");
            _uArmR = FindBone(body.transform, "Bip01 R UpperArm", "RightArm", "Right_UpperArm", "mixamorig:RightArm", "UpperArm.R");
            _fArmR = FindBone(body.transform, "Bip01 R Forearm", "RightForeArm", "Right_LowerArm", "mixamorig:RightForeArm", "LowerArm.R");
            _handR = FindBone(body.transform, "Bip01 R Hand", "RightHand", "Right_Hand", "mixamorig:RightHand", "Fist.R");
            _uLegL = FindBone(body.transform, "Bip01 L Thigh", "LeftUpLeg", "Left_UpperLeg", "mixamorig:LeftUpLeg", "UpperLeg.L");
            _lLegL = FindBone(body.transform, "Bip01 L Calf", "LeftLeg", "Left_LowerLeg", "mixamorig:LeftLeg", "LowerLeg.L");
            _footL = FindBone(body.transform, "Bip01 L Foot", "LeftFoot", "Left_Foot", "mixamorig:LeftFoot", "Foot.L");
            _uLegR = FindBone(body.transform, "Bip01 R Thigh", "RightUpLeg", "Right_UpperLeg", "mixamorig:RightUpLeg", "UpperLeg.R");
            _lLegR = FindBone(body.transform, "Bip01 R Calf", "RightLeg", "Right_LowerLeg", "mixamorig:RightLeg", "LowerLeg.R");
            _footR = FindBone(body.transform, "Bip01 R Foot", "RightFoot", "Right_Foot", "mixamorig:RightFoot", "Foot.R");
            leftHand = _handL;
            rightHand = _handR;
            if (!_hip || !_head || !_uArmL || !_uArmR)
            {
                // Kenney mini-characters are painted meshes, not Mixamo rigs.
                _skinMesh = _modelRenderer as SkinnedMeshRenderer;
                float h = _modelRenderer ? RendererBoundsForValidation(_modelRenderer).size.y : RendererHeight(body);
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

            _skinMesh = _modelRenderer as SkinnedMeshRenderer;
            if (_skinMesh)
            {
                _skinMesh.updateWhenOffscreen = true;
                _skinMesh.enabled = true;
            }
            float worldH = _modelRenderer ? RendererBoundsForValidation(_modelRenderer).size.y : RendererHeight(body);
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
            Capture(_chest, ref _chestRest);
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
            PlantAuthoredFeet(body.transform);
            CxDress.Person(this, look, Canon.SteelLive(CastingWorld, transform.position));
            Debug.Log("Concordia ModularPerson bound owner=" + name +
                " model=" + (_modelTransform ? _modelTransform.name : "null") +
                " prefab=" + (_lastPrefabPath ?? "") +
                " ctrl=" + (ctrl ? ctrl.name : "none"));
            return true;
        }

        void PlantAuthoredFeet(Transform body)
        {
            if (!body) return;
            float minY = float.MaxValue;
            foreach (var r in body.GetComponentsInChildren<Renderer>(true))
            {
                if (!r || !r.enabled) continue;
                if (!(r is SkinnedMeshRenderer) && r.bounds.size.y > 6.5f) continue;
                minY = Mathf.Min(minY, RendererBoundsForValidation(r).min.y);
            }
            if (minY > 1e8f) return;
            float dy = transform.position.y - minY;
            if (Mathf.Abs(dy) < 0.02f || Mathf.Abs(dy) > 2.6f) return;
            body.position += Vector3.up * dy;
        }

static GameObject LoadPersonPrefab(bool hero)
        {
            GameObject go = null;

            // REVERTED (2026-09-17): Aura's work order said "Quaternius Humanoid replace
            // polo/khakis", and CX_Humanoid_Female.prefab (below) does wrap Rocketbox's f001 mesh
            // — but that instruction predates the FreePacks.PaintIfBlank skin-texture fix earlier
            // this session (real f001_body_color/f001_head_color photo-scanned maps, previously
            // imported but never bound). "Polo/khakis" described an UNTEXTURED grey mannequin; that
            // no longer exists. The real fix was binding the textures Rocketbox already had, not
            // swapping the model. Quaternius (Casual_Male/Female — tried here) is a flat-shaded
            // toon/low-poly pack with no texture maps at all — wrong aesthetic entirely for a
            // photorealistic target. Left corrected (real-world import scale + Concordia dot-
            // notation bone aliases now match) in case a genuinely stylized use ever needs it, but
            // it is not the hero and must not be checked first here.
#if UNITY_EDITOR
            var cx = hero
                ? "Assets/Concordia/Generated/Prefabs/CX_Humanoid_Male.prefab"
                : "Assets/Concordia/Generated/Prefabs/CX_Humanoid_Female.prefab";
            go = AssetDatabase.LoadAssetAtPath<GameObject>(cx);
            if (!go)
                go = AssetDatabase.LoadAssetAtPath<GameObject>(
                    hero
                        ? "Assets/Concordia/Generated/Rig/CX_Humanoid_Male.fbx"
                        : "Assets/Concordia/Generated/Rig/CX_Humanoid_Female.fbx");
            if (go)
            {
                _lastPrefabPath = AssetDatabase.GetAssetPath(go);
                return go;
            }
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
            var stems = new[] { "Male_Adult_01", "Male_Adult_05", "Female_Adult_01", "Female_Adult_04" };
            for (int i = 0; i < stems.Length; i++)
            {
                go = FreePacks.Mesh(stems[i]);
                if (!go) continue;
#if UNITY_EDITOR
                _lastPrefabPath = AssetDatabase.GetAssetPath(go);
#endif
                return go;
            }
            return null;
        }

        static string SteelCostumePath(WorldId world)
        {
            if (world == WorldId.Crime)
                return "Assets/Concordia/Models/kaykit/adventures/gltf/Barbarian.glb";
            if (world == WorldId.Cyber)
                return "Assets/Concordia/Models/kaykit/adventures/gltf/Mage.glb";
            return "Assets/Concordia/Models/kaykit/adventures/gltf/Knight.glb";
        }

        /// <summary>
        /// Rebuild the authored body after Travel so Hub polo does not follow
        /// the player into a steel world (and Knight does not return to Hub).
        /// </summary>
        public static void RecastBody(ModularPerson person)
        {
            if (!person) return;
            if (_castBodyWorld == CastingWorld && person.transform.childCount > 0) return;
            _castBodyWorld = CastingWorld;
            person.RebuildForWorld();
        }

        void RebuildForWorld()
        {
            bool hero = GetComponentInParent<ConcordiaPlayer>() != null;
            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                var c = transform.GetChild(i);
                if (!c) continue;
                Object.DestroyImmediate(c.gameObject);
            }
            _built = false;
            _authored = false;
            _biped = false;
            _clipsFit = false;
            _anim = null;
            _skinMesh = null;
            _modelRenderer = null;
            _modelTransform = null;
            _hip = _spine = _chest = _neck = _head = null;
            _uArmL = _fArmL = _handL = _uArmR = _fArmR = _handR = null;
            _uLegL = _lLegL = _footL = _uLegR = _lLegR = _footR = null;
            _hairRoot = _coat = _coatL = _coatR = _tunic = _sash = _pelvisMesh = _skull = _jaw = null;
            leftHand = rightHand = null;
            sword = null;
            Build(hero);
            Apply(look ?? new Appearance());
            CxDress.EnsureSockets(this);
            CxDress.Person(this, look, Canon.SteelLive(CastingWorld, transform.position));
            sword = MakeSword();
            var grip = rightHand && rightHand.Find("CX_Grip_R") ? rightHand.Find("CX_Grip_R") : (rightHand ? rightHand : transform);
            CharacterGear.Grip(sword, grip, 1.05f, true, false);
            if (GetComponentInParent<ConcordiaPlayer>()) CxDress.HeroKit(this);
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

        static Bounds RendererBoundsForValidation(Renderer renderer)
        {
            if (!renderer) return default;
            var skinned = renderer as SkinnedMeshRenderer;
            if (skinned)
            {
                var local = skinned.localBounds;
                if (local.size.sqrMagnitude < 0.000001f && skinned.sharedMesh)
                    local = skinned.sharedMesh.bounds;
                if (local.size.sqrMagnitude >= 0.000001f)
                {
                    var t = skinned.transform;
                    var min = local.min;
                    var max = local.max;
                    var b = new Bounds(t.TransformPoint(new Vector3(min.x, min.y, min.z)), Vector3.zero);
                    b.Encapsulate(t.TransformPoint(new Vector3(min.x, min.y, max.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(min.x, max.y, min.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(min.x, max.y, max.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(max.x, min.y, min.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(max.x, min.y, max.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(max.x, max.y, min.z)));
                    b.Encapsulate(t.TransformPoint(new Vector3(max.x, max.y, max.z)));
                    return b;
                }
            }
            return renderer.bounds;
        }

        static Renderer FindRendererBearingChild(GameObject go)
        {
            if (!go) return null;
            foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (r && r.sharedMesh) return r;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                if (r) return r;
            return null;
        }

        static float RendererHeight(GameObject go)
        {
            var rends = go.GetComponentsInChildren<Renderer>(true);
            if (rends.Length == 0) return 0f;
            var b = RendererBoundsForValidation(rends[0]);
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(RendererBoundsForValidation(rends[i]));
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
            if (_authored && _plantFrames < 24)
            {
                StripGiantAndFallback(_plantFrames >= 20);
                var authoredBody = transform.Find("AuthoredPerson");
                if (authoredBody && authoredBody.gameObject.activeInHierarchy)
                    PlantAuthoredFeet(authoredBody);
                if (_clipsFit && _plantFrames == 6 && _handL && _uArmL)
                {
                    float dy = _handL.position.y - _uArmL.position.y;
                    if (dy > -0.22f && !_anim)
                    {
                        _clipsFit = false;
                        HangAuthoredArms(0f);
                    }
                }
                _plantFrames++;
            }

            bool animating = _clipsFit && !_biped && _authored && _anim && _anim.enabled && _anim.runtimeAnimatorController
                && _anim.avatar && _anim.avatar.isHuman && _anim.avatar.isValid && _sit < 0.4f;
            if (!animating)
            {
                if (_authored) ApplyAuthoredGait();
                else ApplyPrimitiveGait();
            }
            else
                ApplyAuthoredAttitude();

            if (_slashT > 0f && _uArmR)
                ApplyAuthoredStrike();
            else if (_anticipateT > 0f && _uArmR)
            {
                _anticipateT -= Time.deltaTime;
                var t = Mathf.Clamp01(_anticipateT / 0.32f);
                if (_style == FightStyle.Capoeira && _uLegR)
                    _uLegR.localRotation *= Quaternion.Euler(-28f * t, 0f, 0f);
                else
                    _uArmR.localRotation *= Quaternion.Euler(-40f * t, 12f * t, 0f);
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

        void ApplyAuthoredStrike()
        {
            _slashT -= Time.deltaTime;
            var dur = Mathf.Max(0.08f, _slashDur);
            var u = 1f - Mathf.Clamp01(_slashT / dur);
            var swing = CombatMotion.Pulse(u);
            var beat = _slashBeat;
            var heavy = _slashHeavy;
            var kick = _style == FightStyle.Capoeira
                || (_style == FightStyle.MuayThai && (heavy || beat == 2))
                || (heavy && beat == 2 && _style != FightStyle.Sword && _style != FightStyle.WingChun);

            if (_hip)
            {
                var yaw = beat == 1 ? -16f : 18f;
                if (heavy) yaw *= 1.28f;
                _hip.localRotation = _hipsRest * Quaternion.Euler(8f * swing, yaw * swing, 0f);
            }
            if (_spine)
                _spine.localRotation = _spineRest * Quaternion.Euler((beat == 2 ? 16f : 8f) * swing, 0f, (beat == 1 ? 10f : -12f) * swing);

            if (kick && _uLegR)
            {
                if (_biped)
                {
                    _uLegR.localRotation = BipedHinge(_uLegR, _rUpRest, -18f - 70f * swing);
                    if (_lLegR) _lLegR.localRotation = BipedHinge(_lLegR, _rLegRest, 18f + 36f * swing);
                    if (_uLegL) _uLegL.localRotation = BipedHinge(_uLegL, _lUpRest, 12f * swing);
                    if (_uArmR) _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, 22f, false);
                    if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, 16f, true);
                }
                else
                {
                    _uLegR.localRotation *= Quaternion.Euler(-90f * swing, 0f, 8f * swing);
                    if (_hip) _hip.localRotation *= Quaternion.Euler(10f * swing, -28f * swing, 0f);
                }
                return;
            }

            if (_style == FightStyle.WingChun)
            {
                var chain = Mathf.Sin(u * Mathf.PI * 3f) * 22f * swing;
                var leftLead = beat == 1;
                if (_biped)
                {
                    _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, leftLead ? 18f - chain * 0.5f : 28f + chain, false);
                    if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, leftLead ? 28f + chain : 22f - chain * 0.5f, true);
                }
                else
                {
                    _uArmR.localRotation *= Quaternion.Euler(-28f * swing + chain, 0f, 0f);
                    if (_uArmL) _uArmL.localRotation *= Quaternion.Euler(-22f * swing - chain * 0.5f, 0f, 10f * swing);
                }
                return;
            }

            float arc = (heavy ? 110f : 88f) * swing;
            if (beat == 1)
            {
                if (_biped)
                {
                    if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, 18f + arc * 0.95f, true);
                    if (_fArmL) _fArmL.localRotation = _lForeRest * ForeDelta(36f + 28f * swing, true);
                    if (_uArmR) _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, 12f - 18f * swing, false);
                }
                else
                {
                    if (_uArmL) _uArmL.localRotation *= Quaternion.Euler(arc, -18f * swing, 0f);
                    _uArmR.localRotation *= Quaternion.Euler(-12f * swing, 8f * swing, 0f);
                }
                return;
            }

            if (beat == 2)
            {
                if (_biped)
                {
                    _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, 8f + arc * 1.15f, false);
                    if (_fArmR) _fArmR.localRotation = _rForeRest * ForeDelta(48f * swing, false);
                    if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, 10f * swing, true);
                }
                else
                    _uArmR.localRotation *= Quaternion.Euler(-8f - arc, 8f * swing, 4f);
                return;
            }

            if (_biped)
            {
                _uArmR.localRotation = BipedArm(_uArmR, _rArmRest, 18f + arc * 0.95f, false);
                if (_fArmR) _fArmR.localRotation = _rForeRest * ForeDelta(36f + 28f * swing, false);
                if (_uArmL) _uArmL.localRotation = BipedArm(_uArmL, _lArmRest, 14f - 10f * swing, true);
            }
            else
                _uArmR.localRotation *= Quaternion.Euler(arc, 18f * swing, 0f);
        }

        void ApplyPrimitiveGait()
        {
            if (!_hip || !_uArmL || !_uArmR) return;
            float dt = Time.deltaTime;
            _shown = Mathf.Lerp(_shown, _grounded ? _speed : 0f, 1f - Mathf.Exp(-14f * dt));
            _sitShown = Mathf.MoveTowards(_sitShown, _sit, dt * 6f);
            if (_hitT > 0f) _hitT -= dt;
            if (_landT > 0f) _landT -= dt;
            if (_staggerT > 0f) _staggerT -= dt;
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
            float hit = _hitT > 0f ? CombatMotion.Pulse(1f - _hitT / 0.42f) : 0f;
            float land = _landT > 0f ? CombatMotion.Pulse(1f - _landT / 0.28f) : 0f;
            float stagger = _staggerT > 0f ? CombatMotion.Pulse(1f - _staggerT / 0.55f) : 0f;

            _hip.localRotation = Quaternion.Euler(
                sit * 18f + run * 7f + land * 14f + hit * 10f + stagger * 12f,
                cock * (1f - walk) + s * hipSway * walk - 16f * hit,
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
            if (_hitT > 0f) _hitT -= dt;
            if (_landT > 0f) _landT -= dt;
            if (_staggerT > 0f) _staggerT -= dt;
            float spd = _shown;
            // Walk 5.2 / sprint 8.1 — don't treat a walk as a run (old cutoff was 4).
            float walk = Mathf.InverseLerp(0.28f, 4.6f, spd);
            float jog = Mathf.InverseLerp(4.4f, 6.4f, spd);
            float run = Mathf.InverseLerp(6.2f, 8.2f, spd);
            float cadence = spd > 0.28f
                ? Mathf.Lerp(4.2f, 7.6f, Mathf.InverseLerp(0.4f, 8.2f, spd))
                : 1.35f;
            _phase += dt * cadence;
            float s = Mathf.Sin(_phase);
            float a = Mathf.Sin(_phase - 0.42f); // limbs overlap; they don't tick in lockstep
            float sit = _sitShown;
            float breath = Mathf.Sin(Time.time * 1.55f) * 3f;
            float moving = Mathf.Clamp01(Mathf.InverseLerp(0.2f, 1.4f, spd));
            float hang = Mathf.Lerp(72f, 28f, moving);
            float hipAmp = Mathf.Lerp(9f, 16f, run) * moving;
            float kneeSwing = Mathf.Lerp(14f, 20f, run) * moving;
            float kneeStance = 6f + 4f * jog + 2f * run;
            float armAmp = Mathf.Lerp(16f, 34f, run) * moving;
            float lean = 2f * walk + 5f * jog + 11f * run;
            float idle = 1f - moving;
            float shift = Mathf.Sin(Time.time * 1.15f + transform.position.x) * 6f * idle;
            float hit = _hitT > 0f ? CombatMotion.Pulse(1f - _hitT / 0.42f) : 0f;
            float land = _landT > 0f ? CombatMotion.Pulse(1f - _landT / 0.28f) : 0f;
            float stagger = _staggerT > 0f ? CombatMotion.Pulse(1f - _staggerT / 0.55f) : 0f;
            bool talk = Talking();
            float talkLift = talk ? 16f + Mathf.Sin(Time.time * 5.2f) * 11f : 0f;
            float talkCurl = talk ? 20f + Mathf.Abs(Mathf.Sin(Time.time * 6.1f)) * 14f : 0f;
            // Opposite arm to the stepping leg — ipsilateral swing reads as a march.
            float contra = -a * armAmp;
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
                _hip.localPosition = _hipPos0 + new Vector3(0f, bob - 0.03f * land, 0f);
                _hip.localRotation = _hipsRest * Quaternion.Euler(sit * 16f + lean + shift * 0.4f + 8f * land + 12f * stagger, 6f * s * moving + shift - 16f * hit, 0f);
            }
            if (_spine) _spine.localRotation = _spineRest * Quaternion.Euler(breath + sit * 8f + lean * 0.35f + 14f * hit + 6f * land, 4f * s * moving, 10f * stagger);
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


void StripGiantAndFallback(bool allowFallback = true)
        {
            bool any = false;
            Bounds enc = default;
            float maxDim = 0f;
            if (_modelRenderer)
            {
                if (!_modelRenderer.gameObject.activeSelf) _modelRenderer.gameObject.SetActive(true);
                if (!_modelRenderer.enabled) _modelRenderer.enabled = true;
                var primaryBounds = RendererBoundsForValidation(_modelRenderer);
                var primarySize = primaryBounds.size;
                if (primarySize.sqrMagnitude >= 0.000001f)
                {
                    enc = primaryBounds;
                    any = true;
                    maxDim = Mathf.Max(primarySize.x, Mathf.Max(primarySize.y, primarySize.z));
                }
            }
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r || !r.enabled || r == _modelRenderer) continue;
                var s = RendererBoundsForValidation(r).size;
                float d = Mathf.Max(s.x, Mathf.Max(s.y, s.z));
                if (d > maxDim) maxDim = d;
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
                var rb = RendererBoundsForValidation(r);
                if (!any) { enc = rb; any = true; }
                else enc.Encapsulate(rb);
            }

            float hy = any ? enc.size.y : 0f;
            if (any && hy >= 0.45f && hy <= 6.5f) return;

            var body = transform.Find("AuthoredPerson") ?? transform.Find("KenneyPerson");
            if (body && hy > 6.5f)
            {
                body.localScale *= Mathf.Clamp(1.72f / hy, 0.1f, 1f);
                PlantAuthoredFeet(body);
                return;
            }

            if (body) body.gameObject.SetActive(false);
            if (allowFallback)
            {
                var skinned = _modelRenderer as SkinnedMeshRenderer;
                Debug.LogWarning("Concordia ModularPerson imported body invalid owner=" + name +
                    " model=" + (_modelTransform ? _modelTransform.name : "null") +
                    " active=" + (_modelRenderer && _modelRenderer.gameObject.activeInHierarchy) +
                    " enabled=" + (_modelRenderer && _modelRenderer.enabled) +
                    " localBounds=" + (skinned ? skinned.localBounds.ToString() : "n/a") +
                    " meshBounds=" + (skinned && skinned.sharedMesh ? skinned.sharedMesh.bounds.ToString() : "n/a") +
                    " hy=" + hy + " maxDim=" + maxDim + "; body disabled with no primitive fallback.");
            }
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
#if UNITY_EDITOR
            var baked = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/Concordia/Generated/Prefabs/CX_Weapon_Longsword.prefab");
            if (baked)
            {
                var held = Object.Instantiate(baked);
                held.name = "HeldSword";
                foreach (var c in held.GetComponentsInChildren<Collider>()) Object.Destroy(c);
                return held;
            }
#endif
            var fromCx = CxDress.HeldWeapon("longsword");
            if (fromCx) return fromCx;
            var mesh = FreePacks.Mesh("longsword") ?? FreePacks.Mesh("Sword16") ?? FreePacks.Mesh("weapon-sword");
            if (!mesh) return null;
            var go = Object.Instantiate(mesh);
            go.name = "HeldSword";
            foreach (var c in go.GetComponentsInChildren<Collider>()) Object.Destroy(c);
            FreePacks.PaintIfBlank(go);
            return go;
        }
    }
}
