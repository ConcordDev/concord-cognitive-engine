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

        // ---- Gameplay core (Concordia.Core) -------------------------------------------------
        // ActionRunner owns strike timing and defensive windows. HitResolver is the one
        // incoming grammar (i-frame / parry / block / hit). ActorState is the feel body
        // for those windows — it does NOT replace kernel HP. Kernel-authored dummies still
        // wait on ApplyKernelAttackAck ("Never invent HP"). Road/Present hostiles stay local.
        readonly Core.ActorState _body = new Core.ActorState();
        readonly Core.ActionRunner _action = new Core.ActionRunner();

        static readonly Core.ActionDef DodgeAction = new Core.ActionDef
        {
            Id = "dodge",
            Kind = Core.ActionKind.Dodge,
            StartupMs = 0,
            ActiveMs = 350,
            RecoveryMs = 30,     // 380ms total — matches the legacy _dodgeUntil budget
            IFrameStartMs = 0,
            IFrameEndMs = 350,   // matches the legacy 0.35s i-frame window
            StaminaCost = 18f
        };

        static readonly Core.ActionDef HopIFrame = new Core.ActionDef
        {
            Id = "hop",
            Kind = Core.ActionKind.Dodge,
            StartupMs = 0,
            ActiveMs = 280,
            RecoveryMs = 20,
            IFrameStartMs = 0,
            IFrameEndMs = 280,
            StaminaCost = 0f
        };

        static readonly Core.ActionDef GuardAction = new Core.ActionDef
        {
            Id = "block",
            Kind = Core.ActionKind.Block,
            StartupMs = 0,
            ActiveMs = 500,
            RecoveryMs = 80,
            ParryStartMs = 0,
            ParryEndMs = 120     // early C is a parry; the rest is a held guard
        };

        /// Single source of truth for "am I currently invulnerable". Reads the core first; falls
        /// back to the legacy timer so a sweep hop that failed TryBegin still has a window.
        public bool IsInvulnerable => _action.IsInvulnerable || Time.time < _iframeUntil;

        float _yaw, _slashUntil, _dodgeUntil, _iframeUntil, _attackKind, _coyote;
        float _hitstop, _comboUntil;
        int _comboBeat;
        bool _scanArmed;
        Core.ActionDef _presented;
        bool _wasGrounded = true;
        public string prompt;
        public string toast;
        public string kitWeapon;
        public bool menuOpen;
        public bool skillOpen;
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
        public bool Busy => talkOpen || menuOpen || skillOpen;
        float _dmgMul = 1f;
        GameObject _heldKit;
        TrainingDummy _pendingKernelTarget;
        float _moveSentAt;
        WorldId _fightWorld = (WorldId)(-1);
        Vector3 _forceWalk = Vector3.forward;
        float _forceWalkT;
        Vector3 _recvAt;

        void OnEnable()
        {
            Live = this;
            var body = GetComponent<LivingBody>() ?? gameObject.AddComponent<LivingBody>();
            LivingBody.BindHero(body);
            body.SyncToClock(WorldClock.Hour);
        }
        void OnDisable() { if (Live == this) Live = null; }
        void Reset() => cc = GetComponent<CharacterController>();

        void Update()
        {
            // Advance the gameplay core first so IsInvulnerable / CanAct are correct for the rest
            // of this frame. Integer ms: frame windows are a contract, and float drift across a
            // long session would quietly move parry/i-frame timing.
            _action.Tick(Mathf.RoundToInt(Time.deltaTime * 1000f), _body);
            if (_action.Current == null) _presented = null;
            else if (_action.ElapsedMs == 0 && IsStrike(_action.Current))
                CommitStrike(_action.Current);

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
            if (_fightWorld != world)
            {
                _fightWorld = world;
                var fs = Canon.PickFight(null, null, world);
                avatar?.BindStyle(fs);
                person?.BindStyle(fs);
            }
            HandleMenuKeys();
            LookInput();
            var axes = Busy ? Vector2.zero : MoveAxes();
            var sprint = !Busy && KeyHeld(KeyCode.LeftShift);
            var speed = (sprint ? 8.1f : 5.2f) * style.speedMul;
            var fwd = cam.PlanarForward;
            var right = cam.PlanarRight;
            var wish = fwd * axes.y + right * axes.x;
            if (_forceWalkT > 0f)
            {
                _forceWalkT -= dt;
                wish = _forceWalk;
                sprint = true;
                speed = 8.1f * style.speedMul;
            }
            if (wish.sqrMagnitude > 1f) wish.Normalize();

            if (cc.slopeLimit < 50f) cc.slopeLimit = 50f;
            if (cc.stepOffset < 0.4f) cc.stepOffset = 0.48f;
            cc.minMoveDistance = 0f;
            cc.skinWidth = 0.08f;

            var grounded = cc.isGrounded;
            if (grounded) _coyote = 0.14f;
            else _coyote -= dt;
            var wall = (cc.collisionFlags & CollisionFlags.Sides) != 0;
            var climbHeld = !Busy && KeyHeld(KeyCode.Space);
            var climbing = climbHeld && wall && LivingBody.Hero && LivingBody.Hero.CanClimb && stamina > 8f;
            if (climbing)
            {
                LivingBody.Hero.Climb(dt);
                stamina -= 22f * dt;
                _vel.y = 2.6f;
                _coyote = 0f;
                grounded = false;
            }
            else if (!Busy && KeyDown(KeyCode.Space) && _coyote > 0f)
            {
                _vel.y = 8.2f;
                _coyote = 0f;
                grounded = false;
                if (Hostile.TelegraphKind == "sweep")
                {
                    _body.Stamina = stamina;
                    _action.TryBegin(HopIFrame, _body);
                    _iframeUntil = Time.time + 0.28f;
                    var hop = ConcordClient.Live;
                    if (hop != null) hop.SendDodge(false, "jump");
                }
            }
            // Dodge now goes through the gameplay core. TryBegin is the gate: it enforces the
            // phase machine (no dodge-cancelling a dodge) and the stamina cost, and returns false
            // honestly rather than starting a free action. i-frames come from the ActionDef window.
            if (!Busy && KeyDown(KeyCode.X))
            {
                _body.Stamina = stamina;                    // legacy bar is still the display source
                if (_action.TryBegin(DodgeAction, _body))
                {
                    stamina = _body.Stamina;                // core charged the cost
                    _vel += wish.normalized * 12.4f;
                    _dodgeUntil = Time.time + 0.38f;        // kept in sync during migration
                    _iframeUntil = Time.time + 0.35f;
                    var client = ConcordClient.Live;
                    if (client != null) client.SendDodge();
                }
            }
            if (!Busy && KeyHeld(KeyCode.C))
            {
                _body.Stamina = stamina;
                if (_action.CanAct) _action.TryBegin(GuardAction, _body);
            }
            if (person && wish.sqrMagnitude > 0.04f) person.Sit(false);

            if (grounded && !_wasGrounded) person?.Land();
            _wasGrounded = grounded;
            if (grounded && _vel.y < 0) _vel.y = -1.5f;
            else if (!climbing) _vel.y += -22f * dt;

            var air = grounded ? 1f : (climbing ? 0.55f : 0.86f);
            if (LivingBody.Hero)
            {
                if (sprint && wish.sqrMagnitude > 0.04f)
                    LivingBody.Hero.Tick(0f, true);
            }
            var move = wish * speed * air * (LivingBody.Hero ? LivingBody.Hero.MoveMul : 1f);
            var accel = grounded ? (sprint ? 14f : 8.2f) : 4.2f;
            _vel.x = Mathf.Lerp(_vel.x, move.x, 1f - Mathf.Exp(-accel * dt));
            _vel.z = Mathf.Lerp(_vel.z, move.z, 1f - Mathf.Exp(-accel * dt));
            if (_hitstop > 0f)
            {
                _hitstop -= dt;
                _vel.x *= 0.42f;
                _vel.z *= 0.42f;
            }
            cc.Move(_vel * dt);
            ReceiveLand();

            var planar = new Vector3(_vel.x, 0, _vel.z);
            if (planar.sqrMagnitude > 0.2f)
            {
                _yaw = Mathf.Atan2(planar.x, planar.z);
                var turn = sprint ? 12f : 7.2f;
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.Euler(0, _yaw * Mathf.Rad2Deg, 0), 1f - Mathf.Exp(-turn * dt));
            }

            cam.sprinting = sprint && planar.magnitude > 6.2f;
            cam.inCombat = Time.time < _slashUntil || !_action.IsIdle;
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

            if (_action.JustBecameActive && IsStrike(_action.Current) && _scanArmed)
            {
                var connected = HitScan(_action.Current);
                if (!string.IsNullOrEmpty(_action.Current.Id)) SkillLedger.Record(_action.Current.Id, connected);
                var feel = GetComponent<CombatFeel>();
                var heavy = _action.Current.Kind == Core.ActionKind.HeavyAttack;
                feel?.Strike(heavy, connected, SkillLattice.KickMul(SkillLattice.ActiveSkill), SkillLattice.ActiveSkill);
                if (connected) _hitstop = 0.045f;
            }

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

        /// <summary>
        /// F8-style land/you/clock without needing MegaworldMap in a probe.
        /// Hungry is a word on this line — not a TextMesh on a berm sign.
        /// </summary>
        public string LandLine
        {
            get
            {
                var need = LivingBody.Hero ? LivingBody.Hero.NeedLine : null;
                var line = "land " + MegaworldMap.RegionAt(transform.position)
                    + " · you " + world
                    + " · clock " + WorldClock.World;
                if (!string.IsNullOrEmpty(need)) line += " · " + need;
                if (KitBag.HasLoot()) line += " · pack";
                return line;
            }
        }

        /// <summary>
        /// Same cc.Move path as WASD, world bearing (Sundering is +Z). A one-shot
        /// CharacterController.Move from execute_code is not a walk.
        /// </summary>
        public void WalkBearing(Vector3 dir, float seconds)
        {
            dir.y = 0f;
            _forceWalk = dir.sqrMagnitude > 0.01f ? dir.normalized : Vector3.forward;
            _forceWalkT = Mathf.Max(0.2f, seconds);
        }

        public bool WalkingBearing => _forceWalkT > 0f;

        void LateUpdate()
        {
            if (creatorLocked) return;
            var p = transform.position;
            var dx = p.x - _recvAt.x;
            var dz = p.z - _recvAt.z;
            if (dx * dx + dz * dz < 0.16f) return;
            ReceiveLand();
        }

        void ReceiveLand()
        {
            _recvAt = transform.position;
            ContinentStream.Live?.ReceiveHere(_recvAt);
        }

        /// <summary>
        /// Warp that also receives. execute_code that only sets transform.position
        /// never Ticks — Stand is not a walked day. Prefer WalkBearing.
        /// </summary>
        public void Stand(Vector3 p)
        {
            if (cc) cc.enabled = false;
            transform.position = p;
            if (cc) cc.enabled = true;
            Grounding.Snap(cc);
            ReceiveLand();
        }

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
            if (person) CxDress.HeroKit(person);
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
            Toast((fac.name ?? "kit") + " — " + KitBag.PrettyWeapon(kitWeapon));
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
            skillOpen = false;
            talkNpc = npc;
            talkDraft = "";
            talkLog.Clear();
            if (!string.IsNullOrEmpty(first)) talkLog.Add(first);
            focusTalk = true;
            UnlockCursor();
            Bonds.TalkBump(Bonds.Key(npc));
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
                skillOpen = false;
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

        public void ToggleSkillSheet()
        {
            skillOpen = !skillOpen;
            if (skillOpen)
            {
                menuOpen = false;
                talkOpen = false;
                UnlockCursor();
            }
            else LockCursor();
        }

        void HandleMenuKeys()
        {
            if (talkOpen && KeyDown(KeyCode.Return)) SubmitTalk();
            if (KeyDown(KeyCode.I) && !talkOpen) ToggleMenu();
            if (KeyDown(KeyCode.K) && !talkOpen) ToggleSkillSheet();
            if (talkOpen) return;
            if (KeyDown(KeyCode.Alpha1)) { SkillLattice.SelectSlot(0); Toast(SkillLattice.HudLine()); }
            if (KeyDown(KeyCode.Alpha2)) { SkillLattice.SelectSlot(1); Toast(SkillLattice.HudLine()); }
            if (KeyDown(KeyCode.Alpha3)) { SkillLattice.SelectSlot(2); Toast(SkillLattice.HudLine()); }
            if ((menuOpen || skillOpen) && KeyDown(KeyCode.LeftBracket)) SkillLattice.CycleGroup(-1);
            if ((menuOpen || skillOpen) && KeyDown(KeyCode.RightBracket)) SkillLattice.CycleGroup(1);
            if (!Busy && KeyDown(KeyCode.H)) ConcordClient.Live?.RequestRunStart("horde");
            if (!Busy && KeyDown(KeyCode.J)) ConcordClient.Live?.RequestRunStart("extraction");
        }

        void TryAttack(bool heavy)
        {
            var style = Canon.Get(world).style;
            var fs = Canon.PickFight(null, null, world);
            var art = heavy ? style.heavy : style.light;
            QueueStrike(MakeStrike(heavy, fs, art, 1f, heavy ? 28f : 12f, heavy ? 26f : 14f));
        }

        void TrySpecial()
        {
            if (!_action.CanAct) return;
            var style = Canon.Get(world).style;
            var fs = Canon.PickFight(null, null, world);
            if (stamina < 22f) { Toast("Winded."); return; }
            float reach = 1.2f;
            switch (world)
            {
                case WorldId.Ruins: reach = 1.15f; break;
                case WorldId.Tunya: reach = 1.1f; break;
                case WorldId.Fantasy: reach = 1.05f; break;
                case WorldId.Crime: reach = 1.05f; break;
                case WorldId.Cyber: reach = 1.4f; break;
                case WorldId.Frontier: reach = 1.25f; break;
                case WorldId.Superhero: reach = 1.6f; break;
                default: reach = 1.2f; break;
            }
            var def = MakeStrike(true, fs, style.special, reach, 22f, 26f);
            _body.Stamina = stamina;
            if (!_action.TryBegin(def, _body)) return;
            stamina = _body.Stamina;
            CommitStrike(def);
            if (!_scanArmed) return;
            switch (world)
            {
                case WorldId.Ruins:
                    hp = Mathf.Min(100, hp + 10f);
                    Toast(style.special + " — a fall pulled back.");
                    break;
                case WorldId.Tunya:
                    poise = 12f * style.poiseMul;
                    Toast(style.special + " — grove restores poise.");
                    break;
                case WorldId.Fantasy:
                    hostility = Mathf.Max(0f, hostility - 5f);
                    Toast(style.special + " — the curse folds inward, not out.");
                    break;
                case WorldId.Crime:
                    _dmgMul = 1.55f;
                    Toast(style.special + " — the bill arrives now.");
                    break;
                case WorldId.Cyber:
                    Toast(style.special + " — pulse.");
                    break;
                case WorldId.Frontier:
                    _vel += cam.PlanarForward * 11f;
                    Toast(style.special + " — dust sprint.");
                    break;
                case WorldId.Superhero:
                    Toast(style.special + " — they stand.");
                    break;
                case WorldId.Crucible:
                    ReviveNearest();
                    Toast(style.special + " — un-end it.");
                    break;
                default:
                    Toast(style.special + " — " + style.power);
                    break;
            }
        }

        static bool IsStrike(Core.ActionDef def) =>
            def != null && (def.Kind == Core.ActionKind.LightAttack || def.Kind == Core.ActionKind.HeavyAttack);

        Core.ActionDef MakeStrike(bool heavy, FightStyle fs, string id, float reachMul, float staminaCost, float damage)
        {
            CombatMotion.StrikeWindows(heavy, fs, out var start, out var active, out var rec, out var cancel);
            return new Core.ActionDef
            {
                Id = id,
                Kind = heavy ? Core.ActionKind.HeavyAttack : Core.ActionKind.LightAttack,
                StartupMs = start,
                ActiveMs = active,
                RecoveryMs = rec,
                CancelAfterMs = cancel,
                StaminaCost = staminaCost,
                Damage = damage,
                PoiseDamage = damage * 0.25f,
                ReachMeters = (heavy ? 3.2f : 2.8f) * reachMul * (world == WorldId.Cyber ? 1.25f : 1f)
            };
        }

        void QueueStrike(Core.ActionDef def)
        {
            if (def == null) return;
            _body.Stamina = stamina;
            if (!_action.CanAct)
            {
                _action.Buffer(def, _body);
                return;
            }
            if (!_action.TryBegin(def, _body)) return;
            stamina = _body.Stamina;
            CommitStrike(def);
        }

        void CommitStrike(Core.ActionDef def)
        {
            if (def == null || !IsStrike(def) || ReferenceEquals(def, _presented)) return;
            _presented = def;
            var heavy = def.Kind == Core.ActionKind.HeavyAttack;
            var fs = Canon.PickFight(null, null, world);
            if (Time.time > _comboUntil) _comboBeat = 0;
            var beat = _comboBeat;
            _comboBeat = (_comboBeat + 1) % 3;
            avatar?.Slash(heavy, beat);
            person?.Slash(heavy, beat);
            _slashUntil = Time.time + CombatMotion.ComboOpen(heavy, fs);
            _comboUntil = Time.time + CombatMotion.Duration(heavy, fs) * 1.25f;
            _attackKind = heavy ? 1 : 0;
            _scanArmed = Canon.SteelLive(world, transform.position);
            if (!_scanArmed)
            {
                FlowerBurst();
                SkillLedger.Record(def.Id, false);
                Toast(def.Id == Canon.Get(world).style.special
                    ? def.Id + " dies as flowers."
                    : "The ground refuses it.");
                return;
            }
            if (world == WorldId.Fantasy && def.Id != Canon.Get(world).style.special)
            {
                hostility += 1.2f;
                if (hostility > 8) { hp -= 4; Toast("The curse turns inward."); }
            }
        }

        bool HitScan(Core.ActionDef def)
        {
            var style = Canon.Get(world).style;
            var heavy = def != null && def.Kind == Core.ActionKind.HeavyAttack;
            float reach = def != null ? def.ReachMeters : ((heavy ? 3.2f : 2.8f) * (world == WorldId.Cyber ? 1.25f : 1f));
            var origin = transform.position + Vector3.up * 1.15f;
            var hits = Physics.SphereCastAll(origin, 0.85f, transform.forward, reach, ~0, QueryTriggerInteraction.Collide);
            float dmg = (def != null ? def.Damage : (heavy ? 26f : 14f)) * _dmgMul * style.massMul;
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
            var boss = dummy.GetComponent<WorldBoss>() ?? dummy.GetComponentInParent<WorldBoss>();
            if (boss != null && client && client.Connected && !string.IsNullOrEmpty(client.DungeonInstanceId))
            {
                _pendingKernelTarget = dummy;
                Toast(dummy.GuestLabel + " — Concord resolving");
                _ = client.SendDungeonHit(dmg);
                return true;
            }
            if (client && client.Connected && dummy.KernelAuthored)
            {
                // Kernel resolves gym / dungeon HP. Road hostiles are local.
                _pendingKernelTarget = dummy;
                Toast(dummy.GuestLabel + " — Concord resolving");
                _ = client.SendAttack(dummy.name, dmg, reach, liveWeapon(), transform.position.x, transform.position.z);
                return true;
            }
            dmg = WorldField.ScaleDamage(dmg, world, transform.position, "athletics");
            dummy.Hit(dmg, world);
            HubObjectives.NoteArenaHit();
            var label = dummy.GuestLabel;
            if (dummy.KernelAuthored)
                Toast(label + "  " + Mathf.Ceil(dummy.hp) + "  — local. Concord {ok:false, reason:'no_gateway'}");
            else
                Toast(label + (dummy.hp > 0f ? "  " + Mathf.Ceil(dummy.hp) : "  down"));
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
            if (dummy) Toast(dummy.GuestLabel + "  " + Mathf.Ceil(dummy.hp));
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

        public void TakeHit(float dmg, string from, float knockback = -1f)
        {
            if (!Canon.SteelLive(world, transform.position))
            {
                FlowerBurst();
                Toast("The ground refuses " + from + ".");
                return;
            }

            var defenseName = (!cc.isGrounded && _vel.y > 1f) || (_action.Current != null && _action.Current.Id == "hop")
                ? "jump"
                : (_action.IsParrying ? "parry" : "dodge");
            var iframeOk = IsInvulnerable
                && (string.IsNullOrEmpty(Hostile.TelegraphKind) || Hostile.CounterMatches(Hostile.TelegraphKind, defenseName));
            var feel = GetComponent<CombatFeel>();
            if (iframeOk)
            {
                feel?.Present(new Core.HitResult { Outcome = Core.DefenseOutcome.Dodged },
                    transform.position + transform.forward * 1.15f + Vector3.up * 1.05f);
                Toast("the cut passes through");
                return;
            }

            _body.Health = hp;
            _body.Stamina = stamina;
            var attack = new Core.AttackContext
            {
                Damage = dmg,
                PoiseDamage = dmg * 0.25f,
                ReachMeters = 16f,
                DistanceMeters = 1f,
                Impulse = knockback > 0f ? knockback : 0f
            };
            // Wrong-counter dodge still has i-frames on the runner; don't let them eat this swing.
            var runner = _action.IsInvulnerable ? null : _action;
            var result = Core.HitResolver.Resolve(attack, _body, runner);
            stamina = _body.Stamina;
            feel?.Present(result, transform.position + transform.forward * 1.15f + Vector3.up * 1.05f);

            if (result.Outcome == Core.DefenseOutcome.Parried)
            {
                Toast("Parry.");
                return;
            }
            if (result.Outcome == Core.DefenseOutcome.Dodged)
            {
                Toast("the cut passes through");
                return;
            }
            if (result.Outcome == Core.DefenseOutcome.OutOfRange) return;

            hp = _body.Health;
            if (result.Outcome == Core.DefenseOutcome.Blocked)
                Toast("Guarded — " + Mathf.Ceil(result.DamageDealt) + " damage.");
            else
                Toast(from + " hits.");

            poise = Mathf.Max(0f, poise - result.PoiseDamageDealt);
            var impulse = result.Impulse > 0f ? result.Impulse : (knockback >= 0f ? knockback : 0f);
            _vel -= transform.forward * 1.8f;
            person?.Hurt();
            avatar?.Hit();
            if (result.Outcome == Core.DefenseOutcome.GuardBroken || impulse > 1.8f || poise < 2.5f || result.Stagger == Core.StaggerTier.Knockdown)
            {
                avatar?.Knockdown();
                person?.Stagger();
            }
            else if (result.Stagger != Core.StaggerTier.None || poise < 4f || impulse > 1.1f)
            {
                avatar?.Stagger();
                person?.Stagger();
            }
            feel?.ApplyAck(true, impulse > 0f ? impulse : Mathf.Min(result.DamageDealt * 0.08f, 2.4f), false, false);
            if (hp > 0f) return;
            hp = 100f;
            _body.Health = 100f;
            poise = 12f;
            cc.enabled = false;
            var spawn = world == WorldId.Hub ? Canon.Spawn
                : ContinentStream.Live
                    ? MegaworldMap.Present(world) + new Vector3(0f, 0.12f, 2f)
                    : Canon.SteelSpawn;
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
            SkillPylon nearest = null;
            float best = 3.4f;
            foreach (var p in FindObjectsByType<SkillPylon>(FindObjectsInactive.Exclude))
            {
                if (!p) continue;
                var d = Vector3.Distance(transform.position, p.transform.position);
                if (d < best) { best = d; nearest = p; }
            }
            if (nearest != null)
            {
                Toast(nearest.Take());
                return;
            }
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
            if (skillOpen && KeyDown(KeyCode.Escape))
            {
                skillOpen = false;
                LockCursor();
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
