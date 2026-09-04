using UnityEngine;

namespace Concordia
{
    public class TrainingDummy : MonoBehaviour
    {
        public float hp = 80;
        public bool unburied;
        public bool living;
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
            if (hp > 0) return;
            QuestLog.NoteDefeat(name);
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
            if (_rend == null) _rend = GetComponentsInChildren<Renderer>(true);
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
