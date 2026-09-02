using System;
using System.Diagnostics;
using DSHPlayer2.Core;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>
/// Owns the DSH Web process this mod started and the readiness verdict for
/// the native Player2 bundle: start once at SMAPI entry, poll the heartbeat
/// on the game thread, and stop only the owned process tree at exit. The
/// bundle being alive is the game's gate for publishing any turn.
/// </summary>
internal sealed class DshProcessSupervisor
{
    private readonly ModConfig config;
    private readonly IMonitor monitor;
    private Process? dshWebProcess;
    private string? autoStartError;
    private int readinessCountdown;
    private bool ready;

    public DshProcessSupervisor(ModConfig config, IMonitor monitor)
    {
        this.config = config;
        this.monitor = monitor;
    }

    /// <summary>Whether the bridge heartbeat is fresh right now.</summary>
    public bool IsReady => this.ready;

    /// <summary>The auto-start failure, if any, surfaced with the startup timeout.</summary>
    public string? AutoStartError => this.autoStartError;

    /// <summary>Boots the existing DSH Web profile once; Player2 never starts a separate model runtime.</summary>
    public void EnsureStarted()
    {
        if (!this.config.AutoStartDshWeb)
        {
            this.monitor.Log("Player2 automatic DSH Web startup is disabled by config.", LogLevel.Info);
            return;
        }
        if (DshWebLauncher.IsListening(this.config.DshWebPort))
        {
            this.monitor.Log($"Player2 found DSH Web already listening on port {this.config.DshWebPort}; it will not start a second profile.", LogLevel.Info);
            return;
        }
        try
        {
            this.dshWebProcess = DshWebLauncher.Start(this.config.DshProfile, this.config.DshWebPort, this.config.ApiKeyMode);
            this.monitor.Log(
                $"Player2 started the normal DSH profile '{this.config.DshProfile}' (pid {this.dshWebProcess.Id}); waiting for its Player2 bundle to own the bridge.",
                LogLevel.Info);
        }
        catch (Exception ex)
        {
            this.autoStartError = ex.Message;
            this.monitor.Log($"Player2 could not auto-start DSH Web: {ex.Message}", LogLevel.Error);
        }
    }

    /// <summary>Polls the readiness heartbeat at the configured cadence; never blocks.</summary>
    public void PollReadiness()
    {
        if (this.readinessCountdown > 0)
        {
            this.readinessCountdown--;
            return;
        }
        this.readinessCountdown = Math.Clamp(this.config.PollIntervalTicks, 1, 600);
        var marker = DshBridgeReadiness.TryGetReadyMarker(
            this.config.DecisionBridgeDirectory,
            DateTimeOffset.UtcNow);
        var wasReady = this.ready;
        this.ready = marker is not null;
        if (!wasReady && marker is not null)
        {
            this.autoStartError = null;
            this.monitor.Log(
                $"Player2 native DSH bundle is ready (pid {marker.Pid}, instance {marker.InstanceId}).",
                LogLevel.Info);
        }
    }

    /// <summary>Drops the readiness verdict when the player returns to the title screen.</summary>
    public void ResetForTitle()
    {
        this.ready = false;
        this.readinessCountdown = 0;
    }

    /// <summary>Keeps DSH available across save/title transitions and stops only the owned tree at SMAPI exit.</summary>
    public void StopOwnedProcess()
    {
        if (this.dshWebProcess is null)
        {
            return;
        }
        try
        {
            DshWebLauncher.StopTree(this.dshWebProcess);
            this.monitor.Log("Player2 stopped the DSH Web process tree it started for this SMAPI session.", LogLevel.Info);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 could not stop its owned DSH Web process: {ex.Message}", LogLevel.Warn);
        }
    }
}
