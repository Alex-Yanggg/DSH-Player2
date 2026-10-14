using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The companion's mind is one DSH session per save, in DSH's own automation
/// profile (<c>dsh --profile acp</c>) started by the mod. This class owns that
/// child process and the save's session; the game thread sends plain prompts
/// and drains what the companion says. DSH owns models, tools, goals, memory
/// hooks and logs; nothing here interprets a reply.
/// </summary>
internal sealed class DshCompanion : IDisposable
{
    private const string SessionFile = "dsh-session-id";

    private readonly IMonitor monitor;
    private readonly ModConfig config;
    private readonly JsonObject gameEndpoint;
    private AcpClient? client;
    private string? identity;
    private Task<string>? opening;
    private string? sessionDirectory;
    private volatile bool initialized;
    private int promptsInFlight;

    public DshCompanion(IMonitor monitor, ModConfig config, JsonObject gameEndpoint)
    {
        this.monitor = monitor;
        this.config = config;
        this.gameEndpoint = gameEndpoint;
    }

    /// <summary>True while a prompt the game sent has not been answered.</summary>
    public bool IsReplying => this.promptsInFlight > 0;

    /// <summary>
    /// Opens (or resumes) the save's session, restarting DSH when the chosen
    /// companion changed: the persona is bound per process.
    /// </summary>
    public void OpenSave(CompanionChoice companion, string sessionDirectory)
    {
        Directory.CreateDirectory(sessionDirectory);
        var patch = this.Patch(companion);
        var key = patch.ToJsonString();
        if (this.client is null || this.client.HasExited || this.identity != key)
        {
            this.Stop();
            var patchPath = Path.Combine(this.config.DecisionBridgeDirectory, "player2.patch.yml");
            Directory.CreateDirectory(this.config.DecisionBridgeDirectory);
            File.WriteAllText(patchPath, key);
            this.client = AcpClient.Launch(ResolveDshCommand(this.config.DshCommand), new[] { patchPath }, this.config.DecisionBridgeDirectory, this.Environment());
            this.identity = key;
            this.monitor.Log($"Player2 started DSH (acp profile) for companion {companion.Name}.", LogLevel.Info);
        }
        else if (this.sessionDirectory == sessionDirectory && this.opening is { IsFaulted: false })
        {
            return; // the next day of the same save: the session stays open
        }
        var client = this.client;
        this.sessionDirectory = sessionDirectory;
        this.opening = Task.Run(async () =>
        {
            if (!this.initialized)
            {
                await client.InitializeAsync().ConfigureAwait(false);
                this.initialized = true;
            }
            var stored = File.Exists(Path.Combine(sessionDirectory, SessionFile)) ? File.ReadAllText(Path.Combine(sessionDirectory, SessionFile)).Trim() : null;
            var id = await client.OpenSessionAsync(stored, sessionDirectory, new JsonArray()).ConfigureAwait(false);
            File.WriteAllText(Path.Combine(sessionDirectory, SessionFile), id);
            return id;
        });
    }

    /// <summary>
    /// Sends one marked prompt (<c>[chat day=N] …</c>, <c>[day-start day=N]</c>,
    /// <c>[day-end day=N]</c>, <c>[resume]</c>). DSH queues prompts that arrive
    /// while the companion is busy. Returns false when no save session is open.
    /// </summary>
    public bool Send(string text)
    {
        var client = this.client;
        var opening = this.opening;
        if (client is null || opening is null || client.HasExited) return false;
        this.promptsInFlight++;
        _ = Task.Run(async () =>
        {
            try
            {
                var id = await opening.ConfigureAwait(false);
                await client.PromptAsync(id, text).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                // The failure also arrives as a turn-ended event when DSH answered at all.
                client.Events.Enqueue(new AcpEvent("failed", "", ex.Message));
            }
        });
        return true;
    }

    /// <summary>Stops the turn in flight (a paused game); an active goal stays and is resumed later.</summary>
    public void Cancel()
    {
        if (this.client is { HasExited: false } client && this.opening is { IsCompletedSuccessfully: true } opening)
        {
            client.Cancel(opening.Result);
        }
    }

    /// <summary>Game thread: what the companion said and whether something failed since the last tick.</summary>
    public IEnumerable<AcpEvent> Drain()
    {
        var client = this.client;
        if (client is null) yield break;
        if (this.opening is { IsFaulted: true } failed)
        {
            this.opening = null;
            yield return new AcpEvent("failed", "", failed.Exception?.GetBaseException().Message ?? "the session did not open");
        }
        while (client.Events.TryDequeue(out var item))
        {
            if (item.Kind == AcpClient.TurnEnded || item.Kind == "failed") this.promptsInFlight = Math.Max(0, this.promptsInFlight - 1);
            if (item.Kind == AcpClient.Exited)
            {
                this.promptsInFlight = 0;
                var detail = client.Diagnostics;
                yield return item with { Text = detail.Length == 0 ? item.Text : $"{item.Text}: {detail}" };
                continue;
            }
            yield return item;
        }
    }

    public void Stop()
    {
        this.client?.Dispose();
        this.client = null;
        this.identity = null;
        this.opening = null;
        this.sessionDirectory = null;
        this.initialized = false;
        this.promptsInFlight = 0;
    }

    public void Dispose() => this.Stop();

    /// <summary>
    /// The per-process overlay on DSH's acp profile: the persona, the Player2
    /// plugin with the game's hands, and no coding tools. JSON is valid YAML.
    /// </summary>
    private JsonArray Patch(CompanionChoice companion)
    {
        var plugin = new JsonObject
        {
            ["characterName"] = companion.Name,
            ["relationshipRole"] = companion.Role,
            ["soul"] = new JsonObject
            {
                ["values"] = JsonSerializer.SerializeToNode(companion.SoulValues),
                ["bonds"] = JsonSerializer.SerializeToNode(companion.SoulBonds),
                ["voice"] = companion.SoulVoice.Trim(),
                ["boundaries"] = JsonSerializer.SerializeToNode(companion.SoulBoundaries),
            },
            ["knobs"] = JsonSerializer.SerializeToNode(companion.Knobs.ToWire()),
            ["gameUrl"] = this.gameEndpoint["url"]!.GetValue<string>(),
            ["gameToken"] = this.gameEndpoint["headers"]![0]!["value"]!.GetValue<string>()["Bearer ".Length..],
        };
        var patch = new JsonArray
        {
            new JsonObject { ["insert"] = new JsonArray(new JsonObject { ["id"] = "player2-companion", ["name"] = "@dsh-player2/dsh-companion-plugin", ["config"] = plugin }) },
            new JsonObject { ["id"] = "system-prompt", ["config"] = new JsonObject { ["personaPrefix"] = $"You are {companion.Name}.", ["personaSuffix"] = "" } },
        };
        foreach (var tool in CodingPlugins) patch.Add(new JsonObject { ["id"] = tool, ["disabled"] = true });
        return patch;
    }

    /// <summary>acp-profile plugins a farm companion has no use for.</summary>
    private static readonly string[] CodingPlugins =
    {
        "tool-bash", "tool-pwsh", "tool-fs", "tool-fs-search", "tool-jobs", "tool-todo", "tool-workflow",
        "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents",
        "plan-mode", "agent-instructions",
    };

    /// <summary>The API key reaches DSH only through its environment; Player2 never stores or logs it.</summary>
    private Dictionary<string, string> Environment()
    {
        var environment = new Dictionary<string, string>();
        var key = System.Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY");
        if (string.IsNullOrWhiteSpace(key) && this.config.ApiKeyMode == ApiKeyMode.IncludeUserRegistry && OperatingSystem.IsWindows())
        {
            key = System.Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY", EnvironmentVariableTarget.User);
        }
        if (!string.IsNullOrWhiteSpace(key)) environment["DEEPSEEK_API_KEY"] = key;
        return environment;
    }

    /// <summary>The configured command, else the standard per-user pnpm shim, else PATH.</summary>
    private static string ResolveDshCommand(string configured)
    {
        if (!string.IsNullOrWhiteSpace(configured)) return configured;
        if (!OperatingSystem.IsWindows()) return "dsh";
        var shim = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "pnpm", "bin", "dsh.cmd");
        return File.Exists(shim) ? shim : "dsh.cmd";
    }
}
