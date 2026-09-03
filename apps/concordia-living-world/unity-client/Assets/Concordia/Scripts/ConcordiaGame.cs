using System;
using System.IO;
using UnityEngine;

namespace Concordia
{
    public class ConcordiaGame : MonoBehaviour
    {
        public GameObject soldierPrefab;
        public WorldId world = WorldId.Hub;
        ConcordiaPlayer _player;
        WorldBuilder _world;
        WorldGate[] _gates;
        LoreStone[] _stones;
        GuestNpc[] _npcs;
        float _probeAt;

        void Start()
        {
            HubObjectives.Reset();
            try { File.WriteAllText("/tmp/concordia-play-started.txt", System.DateTime.Now.ToString("o") + " world=" + world); } catch {}
            if (Camera.main) Camera.main.gameObject.SetActive(false);

            var camGo = new GameObject("ChaseCam");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.18f;
            cam.farClipPlane = 220f;
            camGo.AddComponent<AudioListener>();
            var chase = camGo.AddComponent<ChaseCamera>();

            var pgo = new GameObject("Player");
            pgo.transform.position = new Vector3(Canon.Spawn.x, 0.12f, Canon.Spawn.z);
            var cc = pgo.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.center = new Vector3(0, 0.9f, 0);
            cc.radius = 0.28f;
            _player = pgo.AddComponent<ConcordiaPlayer>();
            _player.cc = cc;
            _player.cam = chase;
            _player.world = world;
            chase.target = pgo.transform;
            chase.yaw = Mathf.PI;
            chase.Bind();
            chase.AimAt(pgo.transform);
            cam.clearFlags = CameraClearFlags.Skybox;
            camGo.transform.position = new Vector3(Canon.Spawn.x + 1.7f, 2.7f, Canon.Spawn.z - 5.2f);
            camGo.transform.LookAt(new Vector3(Canon.Spawn.x, 1.4f, Canon.Spawn.z));

            var look = AppearanceStore.HasSaved ? AppearanceStore.Load() : new Appearance();
            _player.person = ModularPerson.Attach(pgo.transform, look);
            _player.onInteract = TryInteract;
            pgo.AddComponent<ConcordiaHUD>().player = _player;
            pgo.AddComponent<Footsteps>();
            var feel = pgo.AddComponent<CombatFeel>();
            feel.body = cc;
            feel.cam = cam;
            pgo.AddComponent<EvoResolver>();
            var kernelGo = new GameObject("ConcordClient");
            var kernel = kernelGo.AddComponent<ConcordClient>();
            kernel.OnEvent += HandleKernelEvent;

            var wgo = new GameObject("WorldBuilder");
            _world = wgo.AddComponent<WorldBuilder>();
            _world.player = _player;
            _world.Build(world);
            Grounding.Snap(cc);
            var py = pgo.transform.position.y;
            if (py < 0f || py > 3.5f)
                pgo.transform.position = new Vector3(Canon.Spawn.x, 0.12f, Canon.Spawn.z);
            camGo.transform.position = pgo.transform.position + new Vector3(1.7f, 2.55f, -5.2f);
            camGo.transform.LookAt(pgo.transform.position + Vector3.up * 1.3f);
            try { HubLook.Apply(cam, world); } catch (Exception e) { Debug.LogException(e); }

            if (!AppearanceStore.HasSaved)
            {
                pgo.transform.rotation = Quaternion.identity;
                chase.creatorFraming = true;
                CharacterCreator.Open(_player.person, _player, chase, () =>
                {
                    ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
                    Debug.Log("Concordia: " + _player.person.look.displayName + " entered the Unburned Court.");
                });
            }
            else
            {
                pgo.transform.rotation = Quaternion.identity;
                chase.yaw = Mathf.PI;
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
                ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
            }
            Debug.Log("Concordia hub: Unburned Court under the bronze dome. Eight named gates. No soldier.");
            StartCoroutine(ConcordiaShot.Grab());
        }

        void RefreshProbe()
        {
            _gates = FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude);
            _stones = FindObjectsByType<LoreStone>(FindObjectsInactive.Exclude);
            _npcs = FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude);
            _probeAt = Time.unscaledTime;
        }

        void Update()
        {
            if (!_player || CharacterCreator.IsOpen) return;
            if (_gates == null || Time.unscaledTime - _probeAt > 0.25f) RefreshProbe();
            var pos = _player.transform.position;
            string prompt = null;
            float best = 3.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < best) { best = d; prompt = g.Prompt; }
                    if (d < 9f && g.def.world != WorldId.Hub) HubObjectives.NoteGateWalked(g.def.world);
                }
            if (_stones != null)
                foreach (var s in _stones)
                {
                    if (!s) continue;
                    var d = Vector3.Distance(pos, s.transform.position);
                    if (d < best) { best = d; prompt = s.Prompt; }
                }
            if (_npcs != null)
                foreach (var n in _npcs)
                {
                    if (!n) continue;
                    var d = Vector3.Distance(pos, n.transform.position);
                    if (d < best) { best = d; prompt = n.Prompt; }
                }
            _player.SetNearPrompt(prompt);
        }

        string TryInteract(Vector3 pos)
        {
            RefreshProbe();
            WorldGate gate = null;
            LoreStone stone = null;
            GuestNpc npc = null;
            float best = 3.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < best) { best = d; gate = g; stone = null; npc = null; }
                }
            if (_stones != null)
                foreach (var s in _stones)
                {
                    if (!s) continue;
                    var d = Vector3.Distance(pos, s.transform.position);
                    if (d < best) { best = d; stone = s; gate = null; npc = null; }
                }
            if (_npcs != null)
                foreach (var n in _npcs)
                {
                    if (!n) continue;
                    var d = Vector3.Distance(pos, n.transform.position);
                    if (d < best) { best = d; npc = n; gate = null; stone = null; }
                }
            if (gate != null)
            {
                Travel(gate.def.world);
                return "The Ring opens — " + gate.def.name + ". " + gate.def.theNo;
            }
            if (stone != null) return stone.title + "\n" + stone.text;
            if (npc != null)
            {
                if (npc.def.id == "lamplighter") HubObjectives.NoteLamp();
                return npc.def.name + ": " + npc.def.line;
            }
            return null;
        }

        public void Travel(WorldId next)
        {
            HubObjectives.NoteTravel(world, next);
            world = next;
            _player.world = next;
            var spawn = next == WorldId.Hub ? Canon.Spawn : new Vector3(0f, 0.12f, 2f);
            _player.cc.enabled = false;
            _player.transform.position = spawn;
            _player.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
            _player.cc.enabled = true;
            if (_player.cam) _player.cam.yaw = Mathf.PI;
            _world.Build(next);
            _gates = null;
            Grounding.Snap(_player.cc);
            try { if (Camera.main) HubLook.Apply(Camera.main, next); } catch (Exception e) { Debug.LogException(e); }
            var w = Canon.Get(next);
            var steel = Canon.SteelLive(next, spawn)
                ? "Live steel. Combat is allowed here."
                : "Flower-law. Blades die as flowers except in the Arena.";
            ConcordiaHUD.Announce(w.title, w.refusal);
            _player.Notice(w.law + " " + steel);
            var client = ConcordClient.Live;
            if (client && client.Connected)
                _ = client.RequestScene(WorldBook.Folder(next));
        }

        void HandleKernelEvent(string evt, string json)
        {
            if (evt != "combat:attack:ack") return;
            KernelAckEnvelope env = null;
            try { env = JsonUtility.FromJson<KernelAckEnvelope>(json); }
            catch { return; }
            if (env?.data == null) return;
            _player?.ApplyKernelAttackAck(env.data.ok, env.data.refused, env.data.damage, env.data.error, env.data.reason);
        }

        void OnDestroy()
        {
            var kernel = ConcordClient.Live;
            if (kernel != null) kernel.OnEvent -= HandleKernelEvent;
        }

        [Serializable]
        class KernelAckEnvelope
        {
            public string evt;
            public KernelAckData data;
        }

        [Serializable]
        class KernelAckData
        {
            public bool ok;
            public bool refused;
            public float damage;
            public string error;
            public string reason;
        }
    }
}
