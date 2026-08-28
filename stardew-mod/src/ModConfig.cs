namespace DSHPlayer2.Stardew;

/// <summary>Player-owned local configuration for the optional asynchronous DSH bridge.</summary>
internal sealed class ModConfig
{
    /// <summary>Trusted per-save bridge root. Empty keeps the deterministic local proposal.</summary>
    public string DecisionBridgeDirectory { get; set; } = string.Empty;

    /// <summary>Game ticks between outbox polls; 60 ticks is approximately one second.</summary>
    public int PollIntervalTicks { get; set; } = 60;

    /// <summary>Ticks before the current day falls back to the local deterministic proposal.</summary>
    public int RequestTimeoutTicks { get; set; } = 3600;
}
