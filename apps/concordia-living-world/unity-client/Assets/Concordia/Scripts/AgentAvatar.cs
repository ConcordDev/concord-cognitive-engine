using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// AgentBody pawn. Same ModularPerson stack as the hero. No human Input.
    /// Spawned only after character:bind — kernel already wrote affect_state.
    /// </summary>
    public class AgentAvatar : MonoBehaviour
    {
        public string characterId;
        public ConcordiaPlayer dummy;
        ModularPerson _person;
        CharacterController _cc;
        AgentMotor _motor;
        Appearance _look;
        public static AgentAvatar Live { get; private set; }

        public static AgentAvatar Present(string characterId, Appearance look, Vector3 pose, float yaw)
        {
            if (string.IsNullOrEmpty(characterId)) return null;
            foreach (var a in Object.FindObjectsByType<AgentAvatar>(FindObjectsInactive.Exclude))
            {
                if (a && a.characterId == characterId)
                {
                    a.transform.position = pose;
                    Grounding.Snap(a._cc);
                    return a;
                }
            }
            var go = new GameObject("Agent_" + characterId);
            go.transform.position = pose;
            go.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            var host = ContinentStream.Live
                ? (ContinentStream.Live.ChunkOf(WorldClock.World) ?? ContinentStream.Live.ChunkOf(WorldId.Hub))
                : null;
            if (host) go.transform.SetParent(host, true);
            var av = go.AddComponent<AgentAvatar>();
            av.characterId = characterId;
            av._look = look ?? new Appearance();
            if (string.IsNullOrEmpty(av._look.displayName)) av._look.displayName = "agent";
            av._person = ModularPerson.Attach(go.transform, av._look);
            av._cc = Grounding.EnsureController(go, 1.8f * av._look.height);
            Grounding.Snap(av._cc);
            av._motor = go.AddComponent<AgentMotor>();
            av._motor.Bind(av);
            PersonLabel.Attach(go.transform, av._look.displayName, "agent");
            Live = av;
            return av;
        }

        public ModularPerson Person => _person;
        public CharacterController Cc => _cc;
        public AgentMotor Motor => _motor;

        public static void KitchenBind()
        {
            var client = ConcordClient.Live;
            if (client && client.Connected)
            {
                var last = PlayerPrefs.GetString("concordia-agent-character", "");
                if (!string.IsNullOrEmpty(last))
                {
                    _ = client.BindAgentCharacter(last);
                    return;
                }
                _ = client.CreateAgentCharacter("grok-bot");
                return;
            }
            ConcordiaHUD.Announce("no gateway", "AgentBody will not fake a soul offline.");
        }

        void OnEnable()
        {
            Live = this;
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
            var client = ConcordClient.Live;
            if (client && client.Connected && !string.IsNullOrEmpty(characterId))
                _ = client.UnbindAgentCharacter(characterId, transform.position, transform.eulerAngles.y);
        }

        public Vector3 Pose => transform.position;
        public float Yaw => transform.eulerAngles.y;
        public Appearance Look => _look;
    }
}
