using Concordia.GameplayCore;

namespace Concordia.ConKay
{
    /// <summary>
    /// Explicit read-only composition adapter for a future HUD/bridge route. Binding only
    /// changes which existing bridge instance the source observes; it never calls bridge APIs.
    /// </summary>
    public sealed class ConKayGameplayCoreAdapter : IConKayBridgeAdapter
    {
        GameplayCoreBridge _bridge;
        IConKayRuntimeSource _source;

        public IConKayRuntimeSource Source => _source;
        public bool IsBound => _bridge != null;

        public void Bind(object bridge)
        {
            _bridge = bridge as GameplayCoreBridge;
            _source = _bridge == null ? new ConKayRuntimeSource() : new ConKayRuntimeSource(_bridge);
        }
    }
}
