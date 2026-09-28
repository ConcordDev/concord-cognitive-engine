using UnityEngine;

namespace Concordia
{
    public class TrainingDummy : MonoBehaviour
    {
        public float hp = 80;
        public bool unburied;
        public bool living;
        [SerializeField] string kernelTargetId = "ArenaDummy";
        /// <summary>Kernel combat id. GameObject name is presentation-only (L4).</summary>
        public string KernelId => string.IsNullOrEmpty(kernelTargetId) ? "ArenaDummy" : kernelTargetId;
        /// <summary>Court gym only. Road hostiles and fauna stay dead.</summary>
        public bool Gym => !living && GetComponent<Hostile>() == null && GetComponent<FaunaLife>() == null;
        /// <summary>
        /// Kernel owns the Arena dummy and dungeon bosses. Road hostiles are
        /// Unity-authored (`road-*`) — kernel reject used to eat the kill.
        /// </summary>
        public bool KernelAuthored
        {
            get
            {
                if (living) return false;
                if (GetComponent<Hostile>()) return false;
                if (GetComponent<FaunaLife>()) return false;
                if (!string.IsNullOrEmpty(kernelTargetId) && kernelTargetId.StartsWith("road-"))
                    return false;
                return true;
            }
        }
        /// <summary>Toast a person, not the HP vessel type name.</summary>
        public string GuestLabel
        {
            get
            {
                var guest = GetComponent<GuestNpc>() ?? GetComponentInParent<GuestNpc>();
                if (guest != null && guest.def != null && !string.IsNullOrEmpty(guest.def.name))
                    return guest.def.name;
                if (name.StartsWith("Bandit_")) return "Bandit";
                if (name.StartsWith("DelveBoss_")) return "Camp boss";
                if (name.StartsWith("Watcher_")) return "Watcher";
                if (name.StartsWith("Fauna_")) return "Beast";
                if (Gym) return "Dummy";
                return name;
            }
        }

        public void BindId(string id)
        {
            if (!string.IsNullOrEmpty(id)) kernelTargetId = id;
        }
        float _reviveAt;
        Vector3 _home;
        Vector3 _scale0;
        Renderer[] _rend;
        MaterialPropertyBlock _block;
        float _flash;

        void Awake()
        {
            _home = transform.position;
            _scale0 = transform.localScale;
            _rend = GetComponentsInChildren<Renderer>();
            _block = new MaterialPropertyBlock();
            if (!GetComponent<CharacterController>() && GetComponentInChildren<Collider>() == null)
                FreePacks.EnsureCollider(gameObject, 1.8f);
        }

        void Update()
        {
            if (_flash > 0f)
            {
                _flash -= Time.deltaTime;
                float k = Mathf.Clamp01(_flash / 0.16f);
                transform.localScale = _scale0 * (1f + 0.09f * k);
                FlashMats(Color.Lerp(Color.white, new Color(1f, 0.28f, 0.08f), k));
            }
            else if (_rend != null)
                FlashMats(Color.white);

            if (!living && GetComponent<FaunaLife>() == null && GetComponent<Hostile>() == null)
                transform.position = Vector3.Lerp(transform.position, _home, 1f - Mathf.Exp(-7f * Time.deltaTime));

            if (unburied && hp <= 0 && Time.time >= _reviveAt)
            {
                hp = 80;
                transform.position = _home;
                SetVisible(true);
            }
        }

        public void Hit(float dmg, WorldId world)
        {
            ApplyDamage(dmg, world);
        }

        public void SyncHp(float next)
        {
            if (next < hp) _flash = 0.16f;
            hp = next;
        }

        /// <summary>HP from combat:attack:ack. Same presentation as the offline sandbox Hit.</summary>
        public void ApplyServerHit(float dmg, WorldId world)
        {
            ApplyDamage(dmg, world);
        }

        void ApplyDamage(float dmg, WorldId world)
        {
            if (hp <= 0) return;
            hp -= dmg;
            _flash = 0.16f;
            transform.position += -transform.forward * 0.42f + Vector3.up * 0.06f;
            transform.rotation *= Quaternion.Euler(0f, dmg >= 22f ? 16f : 7f, 0f);
            var person = GetComponentInChildren<ModularPerson>();
            person?.Hurt();
            if (dmg >= 22f) person?.Stagger();
            var av = GetComponentInChildren<MixamoAvatar>();
            av?.Hit();
            if (dmg >= 22f) av?.Stagger();
            if (hp > 0) return;
            var boss = GetComponent<WorldBoss>();
            if (boss)
            {
                boss.Fall();
                return;
            }
            QuestLog.NoteDefeat(name);
            if (!Gym)
            {
                if (GetComponent<FaunaLife>() == null)
                {
                    try { WorldClock.NoteKill(KernelId); }
                    catch (System.Exception e) { Debug.LogException(e); }
                }
                RoadWorld.DropSpoils(transform);
                KitBag.AddLoot("road-spoils", "road spoils");
                var who = GuestLabel;
                RoadWorld.NoticeKill(who, transform.position);
                if (ConcordiaPlayer.Live) ConcordiaPlayer.Live.Notice(who + " down.");
                var hostile = GetComponent<Hostile>();
                if (hostile) hostile.enabled = false;
                if (world == WorldId.Ruins || world == WorldId.Crucible)
                {
                    unburied = true;
                    _reviveAt = Time.time + 7f;
                    SetVisible(false);
                }
                else
                {
                    SetVisible(false);
                    gameObject.SetActive(false);
                }
                return;
            }
            if (world == WorldId.Ruins || world == WorldId.Crucible)
            {
                unburied = true;
                _reviveAt = Time.time + 7f;
                SetVisible(false);
            }
            else if (world == WorldId.Hub)
            {
                hp = 80;
                transform.position = _home;
            }
            else SetVisible(false);
        }

        public void Revive()
        {
            hp = 80;
            transform.position = _home;
            SetVisible(true);
        }

        void SetVisible(bool v)
        {
            _rend = GetComponentsInChildren<Renderer>(true);
            foreach (var r in _rend) if (r) r.enabled = v;
            foreach (var c in GetComponentsInChildren<Collider>(true))
                if (c) c.enabled = v;
            var cc = GetComponent<CharacterController>();
            if (cc) cc.enabled = v;
        }

        void FlashMats(Color c)
        {
            if (_rend == null) return;
            if (_block == null) _block = new MaterialPropertyBlock();
            foreach (var r in _rend)
            {
                if (!r) continue;
                r.GetPropertyBlock(_block);
                _block.SetColor("_BaseColor", c);
                _block.SetColor("_Color", c);
                r.SetPropertyBlock(_block);
            }
        }
    }
}
