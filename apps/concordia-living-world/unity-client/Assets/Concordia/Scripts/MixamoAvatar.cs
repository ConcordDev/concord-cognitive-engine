using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Soldier.glb already has Idle / Walk / Run. Play those.
    /// Procedural jump only while airborne (no jump clip). Never write hip position.
    /// </summary>
    public class MixamoAvatar : MonoBehaviour
    {
        public Transform rightHand;
        public GameObject sword;
        public Animator animator;
        float _slashT, _speed, _vert;
        bool _grounded = true, _bound;
        int _plantFrames;
        Transform _body, _hips, _spine, _lArm, _lFore, _rArm, _rFore, _lUp, _lLeg, _rUp, _rLeg;
        Quaternion _hipsRest, _spineRest, _lArmRest, _lForeRest, _rArmRest, _rForeRest;
        Quaternion _lUpRest, _lLegRest, _rUpRest, _rLegRest;

        public static MixamoAvatar Attach(Transform parent, GameObject prefab)
        {
            var root = new GameObject("Mixamo");
            root.transform.SetParent(parent, false);
            var av = root.AddComponent<MixamoAvatar>();
            GameObject body;
            if (prefab != null)
            {
                body = Object.Instantiate(prefab, root.transform);
                body.transform.localPosition = Vector3.zero;
                body.transform.localRotation = Quaternion.identity;
                body.transform.localScale = Vector3.one;
            }
            else
            {
                body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                body.name = "StandIn";
                body.transform.SetParent(root.transform, false);
                body.transform.localPosition = new Vector3(0, 0.9f, 0);
                Object.Destroy(body.GetComponent<Collider>());
            }

            av.Bind(body.transform);
            av.sword = MakeSword();
            var socket = av.rightHand != null ? av.rightHand : root.transform;
            av.sword.transform.SetParent(socket, false);
            av.sword.transform.localPosition = new Vector3(0.02f, 0.04f, 0.08f);
            av.sword.transform.localRotation = Quaternion.Euler(70, 0, 12);
            CharacterGear.Attach(body, "shield-round", false, 0.55f);
            return av;
        }

        public void Bind(Transform body)
        {
            if (!body) return;
            _body = body;
            animator = body.GetComponentInChildren<Animator>();
            if (!animator) animator = body.gameObject.AddComponent<Animator>();
            animator.enabled = true;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            if (!animator.runtimeAnimatorController)
            {
                var ctrl = Resources.Load<RuntimeAnimatorController>("Concordia/SoldierLocomotion");
#if UNITY_EDITOR
                if (!ctrl)
                    ctrl = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                        "Assets/Concordia/Anim/SoldierLocomotion.controller");
                if (!ctrl)
                    ctrl = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                        "Assets/Concordia/Resources/Concordia/SoldierLocomotion.controller");
#endif
                if (ctrl) animator.runtimeAnimatorController = ctrl;
            }
            rightHand = FindBone(body, "mixamorig:RightHand", "RightHand");
            _rArm = FindBone(body, "mixamorig:RightArm", "RightArm");
            _rFore = FindBone(body, "mixamorig:RightForeArm", "RightForeArm");
            _lArm = FindBone(body, "mixamorig:LeftArm", "LeftArm");
            _lFore = FindBone(body, "mixamorig:LeftForeArm", "LeftForeArm");
            _hips = FindBone(body, "mixamorig:Hips", "Hips");
            _spine = FindBone(body, "mixamorig:Spine1", "mixamorig:Spine");
            _lUp = FindBone(body, "mixamorig:LeftUpLeg", "LeftUpLeg");
            _lLeg = FindBone(body, "mixamorig:LeftLeg", "LeftLeg");
            _rUp = FindBone(body, "mixamorig:RightUpLeg", "RightUpLeg");
            _rLeg = FindBone(body, "mixamorig:RightLeg", "RightLeg");
            Capture(_hips, ref _hipsRest);
            Capture(_spine, ref _spineRest);
            Capture(_lArm, ref _lArmRest);
            Capture(_lFore, ref _lForeRest);
            Capture(_rArm, ref _rArmRest);
            Capture(_rFore, ref _rForeRest);
            Capture(_lUp, ref _lUpRest);
            Capture(_lLeg, ref _lLegRest);
            Capture(_rUp, ref _rUpRest);
            Capture(_rLeg, ref _rLegRest);
            _bound = true;
        }

        static void Capture(Transform t, ref Quaternion rest)
        {
            if (t) rest = t.localRotation;
        }

        public void SetGait(float speed, bool grounded, float vert = 0f)
        {
            _speed = speed;
            _grounded = grounded;
            _vert = vert;
            if (animator && animator.runtimeAnimatorController)
            {
                animator.SetFloat("Speed", grounded ? speed : 0f);
                animator.SetBool("Grounded", grounded);
                animator.enabled = grounded;
            }
        }

        public void Slash() => _slashT = 0.48f;

        void LateUpdate()
        {
            if (_plantFrames < 4) { PlantFeet(); _plantFrames++; }
            if (!_grounded && _bound) ApplyJump();
            else if (_bound && (animator == null || animator.runtimeAnimatorController == null))
                ApplyProceduralGait();
            if (_slashT <= 0 || _rArm == null) return;
            _slashT -= Time.deltaTime;
            var t = 1f - Mathf.Clamp01(_slashT / 0.48f);
            float wind = t < 0.25f ? t / 0.25f : t < 0.45f ? 1f : 1f - (t - 0.45f) / 0.55f;
            var swing = t < 0.4f ? Mathf.Lerp(-70, 100, t / 0.4f) : Mathf.Lerp(100, 0, (t - 0.4f) / 0.6f);
            _rArm.localRotation *= Quaternion.Euler(swing * wind, 20f * wind, 0);
            if (_rFore) _rFore.localRotation *= Quaternion.Euler(-18f * wind, 0, 0);
        }

        float _phase;

        void ApplyProceduralGait()
        {
            float dt = Time.deltaTime;
            float spd = _grounded ? _speed : 0f;
            _phase += dt * (spd > 0.3f ? Mathf.Lerp(5f, 9f, Mathf.InverseLerp(0.3f, 7f, spd)) : 1.5f);
            float w = Mathf.InverseLerp(0.3f, 4.5f, spd);
            float s = Mathf.Sin(_phase);
            if (_lArm) _lArm.localRotation = _lArmRest * Quaternion.Euler(-28f * s * w, 0f, 8f * w);
            if (_rArm) _rArm.localRotation = _rArmRest * Quaternion.Euler(28f * s * w, 0f, -8f * w);
            if (_lUp) _lUp.localRotation = _lUpRest * Quaternion.Euler(32f * s * w, 0f, 0f);
            if (_rUp) _rUp.localRotation = _rUpRest * Quaternion.Euler(-32f * s * w, 0f, 0f);
            if (_spine) _spine.localRotation = _spineRest * Quaternion.Euler(Mathf.Sin(Time.time * 1.6f) * 3f, 4f * s * w, 0f);
        }

        void PlantFeet()
        {
            var skins = GetComponentsInChildren<SkinnedMeshRenderer>();
            if (skins.Length == 0) return;
            var b = skins[0].bounds;
            for (int i = 1; i < skins.Length; i++) b.Encapsulate(skins[i].bounds);
            var cc = GetComponentInParent<CharacterController>();
            float ground = cc ? cc.transform.position.y : 0f;
            var delta = ground - b.min.y;
            if (Mathf.Abs(delta) < 0.002f) return;
            transform.position += Vector3.up * delta;
        }

        void ApplyJump()
        {
            var rising = _vert > 0.4f;
            var tuck = rising ? 0.8f : 0.25f;
            if (_lUp) _lUp.localRotation = _lUpRest * Quaternion.Euler(rising ? -16f : 14f, 0f, 6f);
            if (_rUp) _rUp.localRotation = _rUpRest * Quaternion.Euler(rising ? -16f : 14f, 0f, -6f);
            if (_lLeg) _lLeg.localRotation = _lLegRest * Quaternion.Euler(tuck * 65f, 0f, 0f);
            if (_rLeg) _rLeg.localRotation = _rLegRest * Quaternion.Euler(tuck * 65f, 0f, 0f);
            if (_lArm) _lArm.localRotation = _lArmRest * Quaternion.Euler(rising ? -22f : 12f, 0f, 40f);
            if (_rArm) _rArm.localRotation = _rArmRest * Quaternion.Euler(rising ? -22f : 12f, 0f, -40f);
            if (_spine) _spine.localRotation = _spineRest * Quaternion.Euler(rising ? -10f : 8f, 0f, 0f);
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

        static GameObject MakeSword()
        {
            var mesh = FreePacks.Mesh("longsword") ?? FreePacks.Mesh("weapon-sword");
            if (mesh)
            {
                var held = Object.Instantiate(mesh);
                held.name = "HeldSword";
                foreach (var c in held.GetComponentsInChildren<Collider>()) Object.Destroy(c);
                FreePacks.FitMax(held, 1.05f);
                return held;
            }
            var g = new GameObject("HeldSword");
            void Part(PrimitiveType t, Vector3 p, Vector3 s, Color c)
            {
                var m = GameObject.CreatePrimitive(t);
                m.transform.SetParent(g.transform, false);
                m.transform.localPosition = p;
                m.transform.localScale = s;
                Object.Destroy(m.GetComponent<Collider>());
                var mr = m.GetComponent<MeshRenderer>();
                mr.sharedMaterial = new Material(mr.sharedMaterial) { color = c };
            }
            Part(PrimitiveType.Cylinder, new Vector3(0, 0.07f, 0), new Vector3(0.04f, 0.07f, 0.04f), new Color(0.3f, 0.2f, 0.12f));
            Part(PrimitiveType.Cube, new Vector3(0, 0.16f, 0), new Vector3(0.22f, 0.03f, 0.04f), new Color(0.85f, 0.82f, 0.75f));
            Part(PrimitiveType.Cube, new Vector3(0, 0.55f, 0), new Vector3(0.035f, 0.75f, 0.09f), new Color(0.9f, 0.88f, 0.82f));
            return g;
        }
    }
}
