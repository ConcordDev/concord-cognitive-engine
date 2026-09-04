using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Concordia
{
    [RequireComponent(typeof(CharacterController))]
    public class ConcordiaPlayer : MonoBehaviour
    {
        public CharacterController cc;
        public ChaseCamera cam;
        public MixamoAvatar avatar;
        public ModularPerson person;
        public bool creatorLocked;
        public float dtu = 12f;
        public WorldId world = WorldId.Hub;
        public float hp = 100, stamina = 100, poise = 12;
        public float hostility;
        Vector3 _vel;
        float _yaw, _slashUntil, _dodgeUntil, _attackKind, _coyote;
        bool _wasGrounded = true;
        public string prompt;
        public string toast;
        public string kitWeapon;
        public bool menuOpen;
        public bool talkOpen;
        public bool focusTalk;
        public string talkDraft = "";
        public GuestNpc talkNpc;
        public readonly System.Collections.Generic.List<string> talkLog = new System.Collections.Generic.List<string>();
        public System.Action<string> onTalkSend;
        float _toastT;
        public System.Action<string> onToast;
        public System.Func<Vector3, string> onInteract;
        public static ConcordiaPlayer Live { get; private set; }
        public bool Busy => talkOpen || menuOpen;
        float _dmgMul = 1f;
        GameObject _heldKit;
        TrainingDummy _pendingKernelTarget;
        float _moveSentAt;

        void OnEnable() => Live = this;
        void OnDisable() { if (Live == this) Live = null; }
        void Reset() => cc = GetComponent<CharacterController>();

        void Update()
        {
            if (creatorLocked)
            {
                if (cc)
                {
                    if (cc.isGrounded && _vel.y < 0f) _vel.y = -1.5f;
                    else _vel.y += -22f * Time.deltaTime;
                    _vel.x = 0f;
                    _vel.z = 0f;
                    cc.Move(_vel * Time.deltaTime);
                }
                return;
            }
            var dt = Time.deltaTime;
            var style = Canon.Get(world).style;
            HandleMenuKeys();
            LookInput();
            var axes = Busy ? Vector2.zero : MoveAxes();
            var sprint = !Busy && KeyHeld(KeyCode.LeftShift);
            var speed = (sprint ? 8.1f : 5.2f) * style.speedMul;
            var fwd = cam.PlanarForward;
            var right = cam.PlanarRight;
            var wish = fwd * axes.y + right * axes.x;
            if (wish.sqrMagnitude > 1f) wish.Normalize();

            if (cc.slopeLimit < 50f) cc.slopeLimit = 50f;
            if (cc.stepOffset < 0.4f) cc.stepOffset = 0.48f;
            cc.minMoveDistance = 0f;
            cc.skinWidth = 0.08f;

            var grounded = cc.isGrounded;
            if (grounded) _coyote = 0.14f;
            else _coyote -= dt;
            if (!Busy && KeyDown(KeyCode.Space) && _coyote > 0f)
            {
                _vel.y = 8.2f;
                _coyote = 0f;
                grounded = false;
            }
            if (!Busy && KeyDown(KeyCode.X) && Time.time > _dodgeUntil)
            {
                _vel += wish.normalized * 12.4f;
                _dodgeUntil = Time.time + 0.38f;
                stamina -= 18;
            }
            if (person && wish.sqrMagnitude > 0.04f) person.Sit(false);

            if (grounded && !_wasGrounded) person?.Land();
            _wasGrounded = grounded;
            if (grounded && _vel.y < 0) _vel.y = -1.5f;
            else _vel.y += -22f * dt;

            var air = grounded ? 1f : 0.86f;
            var move = wish * speed * air;
            _vel.x = Mathf.Lerp(_vel.x, move.x, 1f - Mathf.Exp(-(grounded ? 14f : 4.2f) * dt));
            _vel.z = Mathf.Lerp(_vel.z, move.z, 1f - Mathf.Exp(-(grounded ? 14f : 4.2f) * dt));
            cc.Move(_vel * dt);

            var planar = new Vector3(_vel.x, 0, _vel.z);
            if (planar.sqrMagnitude > 0.2f)
            {
                _yaw = Mathf.Atan2(planar.x, planar.z);
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.Euler(0, _yaw * Mathf.Rad2Deg, 0), 1f - Mathf.Exp(-12f * dt));
            }

            cam.sprinting = sprint && planar.magnitude > 4f;
            cam.inCombat = Time.time < _slashUntil;
            avatar?.SetGait(planar.magnitude, grounded, _vel.y);
            person?.SetGait(planar.magnitude, grounded, _vel.y);

            if (Time.time >= _moveSentAt)
            {
                _moveSentAt = Time.time + 0.08f;
                var client = ConcordClient.Live;
                if (client && client.Connected)
                    _ = client.SendMove(transform.position.x, transform.position.y, transform.position.z, client.WorldId);
            }

            stamina = Mathf.Min(100, stamina + 18f * dt);
            poise = Mathf.Min(12 * style.poiseMul, poise + 4.2f * dt);
            if (world == WorldId.Tunya && planar.magnitude < 0.4f) poise = Mathf.Min(12 * style.poiseMul, poise + 8f * dt);

            if (!Busy && MouseDown(0) && Cursor.lockState == CursorLockMode.Locked)
            {
                if (KitBag.Art == 2) TrySpecial();
                else TryAttack(KitBag.Art == 1);
            }
            if (!Busy && KeyDown(KeyCode.F)) TryAttack(true);
            if (!Busy && KeyDown(KeyCode.G)) TrySpecial();
            if (!talkOpen && KeyDown(KeyCode.E)) Interact();
            if (!Busy && KeyDown(KeyCode.Q)) CycleKit();

            prompt = nearPrompt;
            if (_toastT > 0) _toastT -= dt;
        }

        string nearPrompt;

        public void SetNearPrompt(string p) => nearPrompt = p;

        public void EquipWorldKit()
        {
            var city = CityAtlas.Nearest(world, transform.position, 22f);
            var fac = city != null ? PersonKit.FactionOf(world, city.factionId) : null;
            if (fac == null)
            {
                var facs = WorldBook.Factions(world);
                if (facs.Length > 0) fac = facs[0];
            }
            kitWeapon = PersonKit.WeaponStem(fac, GetHashCode());
            HoldFromBag(kitWeapon);
        }

        void CycleKit()
        {
            var facs = WorldBook.Factions(world);
            if (facs.Length == 0) { Toast("No faction kit in this world."); return; }
            var i = 0;
            for (int n = 0; n < facs.Length; n++)
                if (PersonKit.WeaponStem(facs[n], n) == kitWeapon) { i = (n + 1) % facs.Length; break; }
            var fac = facs[i];
            kitWeapon = PersonKit.WeaponStem(fac, i);
            HoldFromBag(kitWeapon);
            Toast((fac.name ?? "kit") + " — " + kitWeapon);
        }

        public void HoldFromBag(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return;
            kitWeapon = stem;
            KitBag.HoldWeapon(stem);
            if (_heldKit) Destroy(_heldKit);
            if (person)
            {
                if (person.sword) person.sword.SetActive(false);
                _heldKit = CharacterGear.Attach(person.gameObject, stem, true, 1.05f);
            }
        }

        public void OpenTalk(GuestNpc npc, string first)
        {
            talkOpen = true;
            menuOpen = false;
            talkNpc = npc;
            talkDraft = "";
            talkLog.Clear();
            if (!string.IsNullOrEmpty(first)) talkLog.Add(first);
            focusTalk = true;
            UnlockCursor();
        }

        public void CloseTalk()
        {
            talkOpen = false;
            talkNpc = null;
            talkDraft = "";
            LockCursor();
        }

        public void AppendTalk(string line)
        {
            if (!string.IsNullOrEmpty(line)) talkLog.Add(line);
        }

        public void SubmitTalk()
        {
            var typed = (talkDraft ?? "").Trim();
            if (typed.Length == 0) return;
            talkLog.Add("You: " + typed);
            talkDraft = "";
            focusTalk = true;
            onTalkSend?.Invoke(typed);
        }

        public void ToggleMenu()
        {
            menuOpen = !menuOpen;
            if (menuOpen)
            {
                talkOpen = false;
                UnlockCursor();
            }
            else LockCursor();
        }

        void UnlockCursor()
        {
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        void LockCursor()
        {
            if (Busy) return;
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        void HandleMenuKeys()
        {
            if (talkOpen && KeyDown(KeyCode.Return)) SubmitTalk();
            if (KeyDown(KeyCode.I) && !talkOpen) ToggleMenu();
            if (Busy) return;
            if (KeyDown(KeyCode.Alpha1)) { KitBag.Art = 0; Toast(KitBag.ArtName(world)); }
            if (KeyDown(KeyCode.Alpha2)) { KitBag.Art = 1; Toast(KitBag.ArtName(world)); }
            if (KeyDown(KeyCode.Alpha3)) { KitBag.Art = 2; Toast(KitBag.ArtName(world)); }
        }

        void TryAttack(bool heavy)
        {
            var style = Canon.Get(world).style;
            var art = heavy ? style.heavy : style.light;
            var live = Canon.SteelLive(world, transform.position);
            avatar?.Slash();
            person?.Slash();
            _slashUntil = Time.time + (heavy ? 0.82f : 0.52f);
            _attackKind = heavy ? 1 : 0;
            stamina -= heavy ? 28 : 12;
            if (!live)
            {
                FlowerBurst();
                SkillLedger.Record(art, false);
                Toast("The ground refuses it.");
                return;
            }
            if (world == WorldId.Fantasy)
            {
                hostility += 1.2f;
                if (hostility > 8) { hp -= 4; Toast("The curse turns inward."); }
            }
            var connected = HitScan(heavy, 1f);
            SkillLedger.Record(art, connected);
            var feel = GetComponent<CombatFeel>();
            feel?.Strike(heavy, connected);
        }

        void TrySpecial()
        {
            var style = Canon.Get(world).style;
            if (stamina < 22f) { Toast("Winded."); return; }
            stamina -= 22f;
            person?.Slash();
            _slashUntil = Time.time + 0.7f;
            var live = Canon.SteelLive(world, transform.position);
            if (!live)
            {
                FlowerBurst();
                SkillLedger.Record(style.special, false);
                Toast(style.special + " dies as flowers.");
                return;
            }
            bool connected = false;
            switch (world)
            {
                case WorldId.Ruins:
                    hp = Mathf.Min(100, hp + 10f);
                    connected = HitScan(true, 1.15f);
                    Toast(style.special + " — a fall pulled back.");
                    break;
                case WorldId.Tunya:
                    poise = 12f * style.poiseMul;
                    connected = HitScan(false, 1.1f);
                    Toast(style.special + " — grove restores poise.");
                    break;
                case WorldId.Fantasy:
                    hostility = Mathf.Max(0f, hostility - 5f);
                    connected = HitScan(true, 1.05f);
                    Toast(style.special + " — the curse folds inward, not out.");
                    break;
                case WorldId.Crime:
                    _dmgMul = 1.55f;
                    connected = HitScan(true, 1.05f);
                    Toast(style.special + " — the bill arrives now.");
                    break;
                case WorldId.Cyber:
                    connected = HitScan(true, 1.4f);
                    Toast(style.special + " — pulse.");
                    break;
                case WorldId.Frontier:
                    _vel += cam.PlanarForward * 11f;
                    connected = HitScan(true, 1.25f);
                    Toast(style.special + " — dust sprint.");
                    break;
                case WorldId.Superhero:
                    connected = HitScan(true, 1.6f);
                    Toast(style.special + " — they stand.");
                    break;
                case WorldId.Crucible:
                    ReviveNearest();
                    connected = HitScan(true, 1.2f);
                    Toast(style.special + " — un-end it.");
                    break;
                case WorldId.Sere:
                    connected = HitScan(true, 1.2f);
                    Toast(style.special + " — " + style.power);
                    break;
                default:
                    connected = HitScan(true, 1.2f);
                    Toast(style.special + " — " + style.power);
                    break;
            }
            SkillLedger.Record(style.special, connected);
        }

        bool HitScan(bool heavy, float reachMul)
        {
            var style = Canon.Get(world).style;
            float reach = (heavy ? 3.2f : 2.8f) * reachMul * (world == WorldId.Cyber ? 1.25f : 1f);
            var origin = transform.position + Vector3.up * 1.15f;
            var hits = Physics.SphereCastAll(origin, 0.85f, transform.forward, reach, ~0, QueryTriggerInteraction.Collide);
            float dmg = (heavy ? 26f : 14f) * _dmgMul * style.massMul;
            _dmgMul = 1f;
            TrainingDummy dummy = FindDummy(hits);
            if (!dummy)
            {
                var cols = Physics.OverlapSphere(origin + transform.forward * 1.4f, 1.6f, ~0, QueryTriggerInteraction.Collide);
                dummy = FindDummy(cols);
            }
            if (!dummy)
            {
                foreach (var d in FindObjectsByType<TrainingDummy>(FindObjectsInactive.Exclude))
                {
                    if (!d) continue;
                    var to = d.transform.position - transform.position;
                    to.y = 0f;
                    if (to.magnitude > 3.4f) continue;
                    if (Vector3.Dot(transform.forward, to.sqrMagnitude > 0.01f ? to.normalized : transform.forward) < 0.05f) continue;
                    dummy = d;
                    break;
                }
            }
            if (!dummy) return false;
            var client = ConcordClient.Live;
            if (client && client.Connected)
            {
                // Kernel resolves HP. Presentation already played the swing.
                _pendingKernelTarget = dummy;
                Toast(dummy.name + " — Concord resolving");
                _ = client.SendAttack(dummy.name, dmg, reach, liveWeapon());
                return true;
            }
            dummy.Hit(dmg, world);
            HubObjectives.NoteArenaHit();
            Toast(dummy.name + "  " + Mathf.Ceil(dummy.hp) + "  — local. Concord {ok:false, reason:'no_gateway'}");
            return true;
        }

        /// <summary>Apply combat:attack:ack from the Concord kernel. Never invent HP.</summary>
        public void ApplyKernelAttackAck(bool ok, bool refused, float damage, string error, string reason)
        {
            var dummy = _pendingKernelTarget;
            _pendingKernelTarget = null;
            if (refused)
            {
                Toast("The ground refuses it. Concord {reason:'" + (reason ?? "refused") + "'}");
                return;
            }
            if (!ok)
            {
                Toast("Concord {ok:false, error:'" + (error ?? "rejected") + "'}");
                return;
            }
            if (dummy) dummy.ApplyServerHit(damage, world);
            HubObjectives.NoteArenaHit();
            if (dummy) Toast(dummy.name + "  " + Mathf.Ceil(dummy.hp));
        }

        static TrainingDummy FindDummy(RaycastHit[] hits)
        {
            if (hits == null) return null;
            foreach (var hit in hits)
            {
                if (!hit.collider) continue;
                var d = hit.collider.GetComponentInParent<TrainingDummy>();
                if (d) return d;
            }
            return null;
        }

        static TrainingDummy FindDummy(Collider[] cols)
        {
            if (cols == null) return null;
            foreach (var c in cols)
            {
                if (!c) continue;
                var d = c.GetComponentInParent<TrainingDummy>();
                if (d) return d;
            }
            return null;
        }

        public void TakeHit(float dmg, string from)
        {
            if (!Canon.SteelLive(world, transform.position))
            {
                FlowerBurst();
                Toast("The ground refuses " + from + ".");
                return;
            }
            hp -= dmg;
            poise = Mathf.Max(0f, poise - dmg * 0.25f);
            _vel -= transform.forward * 1.8f;
            person?.Hurt();
            Toast(from + " hits.");
            if (hp > 0f) return;
            hp = 100f;
            poise = 12f;
            cc.enabled = false;
            var spawn = world == WorldId.Hub ? Canon.Spawn : new Vector3(0f, 0.12f, 2f);
            transform.position = spawn;
            cc.enabled = true;
            Grounding.Snap(cc);
            Toast("You fall. The world does not.");
        }

        void ReviveNearest()
        {
            TrainingDummy best = null;
            float bestD = 10f;
            foreach (var d in FindObjectsByType<TrainingDummy>(FindObjectsInactive.Exclude))
            {
                if (d.hp > 0f) continue;
                var dist = Vector3.Distance(transform.position, d.transform.position);
                if (dist < bestD) { bestD = dist; best = d; }
            }
            best?.Revive();
        }

        string liveWeapon() => Canon.SteelLive(world, transform.position) ? "sword" : "flower";

        void FlowerBurst()
        {
            var p = transform.position + transform.forward * 1.1f + Vector3.up * 0.9f;
            var stems = new[] { "flower_redA", "flower_yellowA", "flower_purpleA" };
            var petals = new[]
            {
                new Color(0.92f, 0.22f, 0.38f),
                new Color(0.95f, 0.78f, 0.22f),
                new Color(0.62f, 0.28f, 0.82f)
            };
            for (int i = 0; i < 8; i++)
            {
                var at = p + Random.insideUnitSphere * 0.42f;
                var f = FreePacks.Spawn(stems[i % stems.Length], null, at, Random.Range(0, 360f), 0.28f);
                if (!f)
                {
                    f = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    f.name = "Petal";
                    f.transform.position = at;
                    f.transform.localScale = Vector3.one * Random.Range(0.06f, 0.12f);
                    var r = f.GetComponent<Renderer>();
                    if (r) r.sharedMaterial = HubLook.Lit(petals[i % petals.Length], 0.12f, 0.55f);
                    var col = f.GetComponent<Collider>();
                    if (col) Destroy(col);
                }
                else
                    foreach (var c in f.GetComponentsInChildren<Collider>()) Destroy(c);
                Destroy(f, 1.4f);
            }
        }

        void Interact()
        {
            var msg = onInteract?.Invoke(transform.position);
            if (!string.IsNullOrEmpty(msg)) Toast(msg);
        }

        public void Notice(string s) => Toast(s);

        void Toast(string s)
        {
            toast = s;
            _toastT = 4.8f;
            onToast?.Invoke(s);
        }

        public string HudLine()
        {
            var w = Canon.Get(world);
            var live = Canon.SteelLive(world, transform.position) ? "LIVE STEEL" : "FLOWER-LAW";
            return w.title + "  ·  " + w.refusal + "  ·  " + live;
        }

        Vector2 MoveAxes()
        {
            float x = 0, y = 0;
#if ENABLE_INPUT_SYSTEM
            if (Keyboard.current != null)
            {
                if (Keyboard.current.aKey.isPressed) x -= 1;
                if (Keyboard.current.dKey.isPressed) x += 1;
                if (Keyboard.current.wKey.isPressed) y += 1;
                if (Keyboard.current.sKey.isPressed) y -= 1;
            }
#else
            x = Input.GetAxisRaw("Horizontal");
            y = Input.GetAxisRaw("Vertical");
#endif
            return new Vector2(x, y);
        }

        void LookInput()
        {
            if (talkOpen && KeyDown(KeyCode.Escape))
            {
                CloseTalk();
                return;
            }
            if (menuOpen && KeyDown(KeyCode.Escape))
            {
                menuOpen = false;
                LockCursor();
                return;
            }
            if (Busy) return;
            if (KeyDown(KeyCode.Escape) || KeyDown(KeyCode.Tab))
            {
                Cursor.lockState = Cursor.lockState == CursorLockMode.Locked ? CursorLockMode.None : CursorLockMode.Locked;
                Cursor.visible = Cursor.lockState != CursorLockMode.Locked;
            }
            if (Cursor.lockState != CursorLockMode.Locked)
            {
#if ENABLE_INPUT_SYSTEM
                if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame && !MouseOverHud())
#else
                if (Input.GetMouseButtonDown(0))
#endif
                {
                    Cursor.lockState = CursorLockMode.Locked;
                    Cursor.visible = false;
                }
                return;
            }
#if ENABLE_INPUT_SYSTEM
            if (Mouse.current == null) return;
            cam.Look(Mouse.current.delta.ReadValue());
#else
            cam.Look(new Vector2(Input.GetAxis("Mouse X") * 22f, Input.GetAxis("Mouse Y") * 22f));
#endif
        }

        static bool MouseOverHud() => Live != null && Live.Busy;

#if ENABLE_INPUT_SYSTEM
        static Key? ToKey(KeyCode k) => k switch
        {
            KeyCode.LeftShift => Key.LeftShift,
            KeyCode.Space => Key.Space,
            KeyCode.X => Key.X,
            KeyCode.F => Key.F,
            KeyCode.G => Key.G,
            KeyCode.Q => Key.Q,
            KeyCode.E => Key.E,
            KeyCode.I => Key.I,
            KeyCode.Return => Key.Enter,
            KeyCode.Alpha1 => Key.Digit1,
            KeyCode.Alpha2 => Key.Digit2,
            KeyCode.Alpha3 => Key.Digit3,
            KeyCode.Escape => Key.Escape,
            KeyCode.Tab => Key.Tab,
            _ => null
        };
#endif

        bool KeyDown(KeyCode k)
        {
#if ENABLE_INPUT_SYSTEM
            if (Keyboard.current == null) return false;
            var key = ToKey(k);
            return key.HasValue && Keyboard.current[key.Value].wasPressedThisFrame;
#else
            return Input.GetKeyDown(k);
#endif
        }

        bool KeyHeld(KeyCode k)
        {
#if ENABLE_INPUT_SYSTEM
            if (Keyboard.current == null) return false;
            var key = ToKey(k);
            return key.HasValue && Keyboard.current[key.Value].isPressed;
#else
            return Input.GetKey(k);
#endif
        }

        bool MouseDown(int b)
        {
#if ENABLE_INPUT_SYSTEM
            if (Mouse.current == null) return false;
            return b == 0 ? Mouse.current.leftButton.wasPressedThisFrame : Mouse.current.rightButton.wasPressedThisFrame;
#else
            return Input.GetMouseButtonDown(b);
#endif
        }
    }
}
