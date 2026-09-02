using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>Asynchronous, native-DSH-only file host for one player social turn.</summary>
public sealed class SocialBridgeHost : IDisposable
{
    private const string Version = "0.0.9";
    private static readonly HashSet<string> ResponseKinds = new(StringComparer.Ordinal)
    {
        "reply", "question", "disagreement", "suggestion", "uncertain",
    };
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };
    private readonly string root;
    private readonly CancellationTokenSource cancellation = new();
    private readonly TimeSpan timeout;
    private DateTimeOffset? deadline;
    private Task? publishTask;
    private Task<NativeSocialBridgeResult?>? pollTask;
    private int pollCountdown;
    private bool closed;

    /// <summary>
    /// The turn timeout is a wall-clock deadline, not a tick count: game
    /// pauses and loading stutters otherwise inflate the real wait.
    /// </summary>
    public SocialBridgeHost(string bridgeDirectory, int pollIntervalTicks, TimeSpan timeout)
    {
        if (string.IsNullOrWhiteSpace(bridgeDirectory))
        {
            throw new ArgumentException("A native DSH social turn requires a bridge directory.", nameof(bridgeDirectory));
        }
        if (timeout <= TimeSpan.Zero && timeout != System.Threading.Timeout.InfiniteTimeSpan)
        {
            throw new ArgumentOutOfRangeException(nameof(timeout));
        }
        this.root = bridgeDirectory;
        this.PollIntervalTicks = Math.Clamp(pollIntervalTicks, 1, 600);
        this.timeout = timeout;
    }

    public int PollIntervalTicks { get; }
    public TimeSpan Timeout => this.timeout;
    public NativeSocialBridgeTurn? Turn { get; private set; }

    public void Start(NativeSocialBridgeTurn turn)
    {
        if (this.Turn is not null) throw new InvalidOperationException("A native DSH social turn is already active.");
        ValidateTurn(turn);
        this.Turn = turn;
        this.deadline = this.timeout == System.Threading.Timeout.InfiniteTimeSpan ? null : DateTimeOffset.UtcNow + this.timeout;
        this.publishTask = this.PublishAsync(turn, this.cancellation.Token);
    }

    /// <summary>Never blocks the game thread; emits a DSH result or an explicit failure.</summary>
    public SocialBridgeHostUpdate Update()
    {
        if (this.closed) return SocialBridgeHostUpdate.None;
        var turn = this.Turn ?? throw new InvalidOperationException("The native DSH social host has not started.");
        if (this.publishTask is not null)
        {
            if (!this.publishTask.IsCompleted) return SocialBridgeHostUpdate.None;
            if (this.publishTask.IsFaulted) return this.Fail(this.publishTask.Exception?.GetBaseException() ?? new InvalidOperationException("Social bridge publish failed."));
            this.publishTask = null;
        }
        if (this.deadline is { } deadline && DateTimeOffset.UtcNow > deadline)
        {
            return this.Fail(new TimeoutException("DSH did not return a social response before the bridge timeout."));
        }
        if (this.pollTask is not null)
        {
            if (!this.pollTask.IsCompleted) return SocialBridgeHostUpdate.None;
            if (this.pollTask.IsFaulted) return this.Fail(this.pollTask.Exception?.GetBaseException() ?? new InvalidOperationException("Social bridge read failed."));
            var result = this.pollTask.GetAwaiter().GetResult();
            this.pollTask = null;
            if (result is not null)
            {
                if (result.Id != turn.Id || result.Source != "dsh") return this.Fail(new InvalidDataException("Social bridge returned a mismatched or non-DSH result."));
                try
                {
                    ValidateResult(turn, result);
                }
                catch (InvalidDataException error)
                {
                    return this.Fail(error);
                }
                this.closed = true;
                this.CleanupFiles();
                return result.Status == "completed" && !string.IsNullOrWhiteSpace(result.Text)
                    ? SocialBridgeHostUpdate.Completed(result)
                    : SocialBridgeHostUpdate.Failed(new InvalidOperationException($"{result.Code ?? "DSH_SOCIAL_TURN_FAILED"}: {result.Message ?? "DSH rejected the social turn."}"), result.TraceId);
            }
            this.pollCountdown = this.PollIntervalTicks;
        }
        if (this.pollCountdown > 0) this.pollCountdown--;
        else this.pollTask = this.TryReadAsync(turn.Id, this.cancellation.Token);
        return SocialBridgeHostUpdate.None;
    }

    public void Dispose()
    {
        this.closed = true;
        this.cancellation.Cancel();
        this.cancellation.Dispose();
    }

    /// <summary>
    /// Best-effort deletion of the consumed turn/result files so the social
    /// lanes do not grow without bound. A leftover that cannot be deleted now
    /// is removed by the next <see cref="SweepStaleFiles"/> pass.
    /// </summary>
    public void CleanupFiles()
    {
        var id = this.Turn?.Id;
        if (id is null) return;
        foreach (var path in new[]
                 {
                     Path.Combine(this.root, "social-inbox", $"turn-{id}.json"),
                     Path.Combine(this.root, "social-outbox", $"result-{id}.json"),
                 })
        {
            TryDelete(path);
        }
    }

    /// <summary>
    /// Removes social-lane files older than the cutoff (default 7 days),
    /// including temporary leftovers; called at day start so abandoned turns
    /// from crashed sessions cannot accumulate forever. Covers every
    /// project/session lane and any unmigrated root-level lanes.
    /// </summary>
    public static void SweepStaleFiles(string bridgeDirectory, TimeSpan? maxAge = null)
    {
        var cutoff = DateTimeOffset.UtcNow - (maxAge ?? TimeSpan.FromDays(7));
        var directories = new List<string>();
        foreach (var session in DecisionBridgeLayout.ListSessionDirectories(bridgeDirectory))
        {
            directories.Add(Path.Combine(session, "social-inbox"));
            directories.Add(Path.Combine(session, "social-outbox"));
        }
        directories.Add(Path.Combine(bridgeDirectory, "social-inbox"));
        directories.Add(Path.Combine(bridgeDirectory, "social-outbox"));
        foreach (var path in directories)
        {
            if (!Directory.Exists(path)) continue;
            foreach (var file in Directory.EnumerateFiles(path))
            {
                try
                {
                    if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    // The sweep is best-effort; the next pass retries.
                }
            }
        }
    }

    private SocialBridgeHostUpdate Fail(Exception error)
    {
        this.closed = true;
        this.CleanupFiles();
        return SocialBridgeHostUpdate.Failed(error, $"social:{this.Turn?.Id ?? "unknown"}");
    }

    private static void ValidateTurn(NativeSocialBridgeTurn turn)
    {
        if (turn.Version != Version)
        {
            throw new InvalidOperationException($"A native DSH social turn must use wire version {Version}.");
        }
        if (string.IsNullOrWhiteSpace(turn.Id))
        {
            throw new InvalidOperationException("A native DSH social turn requires an id.");
        }
        var message = turn.Message.Content?.Trim() ?? string.Empty;
        if (message.Length == 0 || message.Length > 800)
        {
            throw new InvalidOperationException("A social turn message must contain 1 to 800 characters.");
        }
        if (turn.Observations.Any(observation => string.IsNullOrWhiteSpace(observation.Id)))
        {
            throw new InvalidOperationException("Every social observation requires a non-empty id.");
        }
    }

    /// <summary>
    /// Validates the whole result shape against the bridge contract, not just
    /// its identity: version, status, response structure, and grounding in the
    /// turn's own observations and memory. The DSH side validates its own
    /// output before writing; this is the Player-side defense in depth.
    /// </summary>
    private static void ValidateResult(NativeSocialBridgeTurn turn, NativeSocialBridgeResult result)
    {
        if (result.Version != Version)
        {
            throw new InvalidDataException($"Social bridge result version {result.Version} does not match the wire contract {Version}.");
        }
        if (result.Status != "completed" && result.Status != "error")
        {
            throw new InvalidDataException($"Social bridge result status {result.Status} is neither completed nor error.");
        }
        if (result.Status == "error")
        {
            if (string.IsNullOrWhiteSpace(result.Code) || string.IsNullOrWhiteSpace(result.Message))
            {
                throw new InvalidDataException("A social bridge error result requires a code and a message.");
            }
            return;
        }
        var response = result.Response ?? throw new InvalidDataException("A completed social bridge result requires a response object.");
        if (string.IsNullOrWhiteSpace(response.Text))
        {
            throw new InvalidDataException("A completed social response requires non-empty text.");
        }
        if (response.Text.Length > 800)
        {
            throw new InvalidDataException("A completed social response exceeds the 800 character limit.");
        }
        if (!ResponseKinds.Contains(response.Kind))
        {
            throw new InvalidDataException($"A social response kind must be one of reply, question, disagreement, suggestion, uncertain; got {response.Kind}.");
        }
        if (response.BasedOnObservationIds is { Length: > 8 })
        {
            throw new InvalidDataException("A social response may cite at most 8 observations.");
        }
        var knownObservationIds = turn.Observations.Select(observation => observation.Id).ToHashSet(StringComparer.Ordinal);
        if (response.BasedOnObservationIds is not null && response.BasedOnObservationIds.Any(id => !knownObservationIds.Contains(id)))
        {
            throw new InvalidDataException("The social response cited an observation the turn never advertised.");
        }
        // This mod authors priorMemory as null on the social turn, so the only
        // available memory id is none; a claimed id is always unavailable.
        if (!string.IsNullOrEmpty(response.BasedOnMemoryId))
        {
            throw new InvalidDataException("The social response cited memory the turn never carried.");
        }
        if (response.RememberLatestReceipt && string.IsNullOrWhiteSpace(response.MemorySummary))
        {
            throw new InvalidDataException("A remembered receipt requires a memory summary.");
        }
        if (!response.RememberLatestReceipt && !string.IsNullOrEmpty(response.MemorySummary))
        {
            throw new InvalidDataException("A memory summary requires remembering the latest receipt.");
        }
    }

    private async Task PublishAsync(NativeSocialBridgeTurn turn, CancellationToken token)
    {
        var directory = Path.Combine(this.root, "social-inbox");
        Directory.CreateDirectory(directory);
        // The DSH host writes both successful responses and error receipts to
        // this sibling. Creating it before publishing the turn prevents a
        // fast consumer from observing an inbox whose reply path cannot exist.
        Directory.CreateDirectory(Path.Combine(this.root, "social-outbox"));
        var path = Path.Combine(directory, $"turn-{turn.Id}.json");
        if (File.Exists(path)) throw new InvalidOperationException($"Refusing to overwrite existing social turn {turn.Id}.");
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(turn, JsonOptions), token).ConfigureAwait(false);
            File.Move(temporaryPath, path);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private async Task<NativeSocialBridgeResult?> TryReadAsync(string id, CancellationToken token)
    {
        var path = Path.Combine(this.root, "social-outbox", $"result-{id}.json");
        if (!File.Exists(path)) return null;
        var json = await ReadBoundedAsync(path, token).ConfigureAwait(false);
        return JsonSerializer.Deserialize<NativeSocialBridgeResult>(json, JsonOptions)
            ?? throw new InvalidDataException("DSH wrote an empty social bridge result.");
    }

    /// <summary>
    /// Reads at most <see cref="DecisionBridgeFiles.MaxFileBytes"/> bytes; the
    /// social lane previously read unbounded text, making it the one bridge
    /// reader that a malformed file could balloon.
    /// </summary>
    private static async Task<string> ReadBoundedAsync(string path, CancellationToken token)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
        if (stream.Length > DecisionBridgeFiles.MaxFileBytes)
        {
            throw new InvalidDataException($"Social bridge file exceeds the {DecisionBridgeFiles.MaxFileBytes} byte limit.");
        }
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync().ConfigureAwait(false);
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // The next sweep pass removes the leftover.
        }
    }
}

public sealed record NativeSocialBridgeTurn(
    string Version, string Id, string CreatedAt, int GameDay, NativeCompanionIdentity Companion,
    NativeAdapterDescriptor Adapter, NativeObservation[] Observations, object? PriorMemory, object? LatestReceipt,
    NativePlayerMessage Message);
public sealed record NativeCompanionIdentity(
    string Name,
    string Role,
    BridgeCompanionSoul Soul);
public sealed record NativeAdapterDescriptor(string Id, string GameId, string AccessMode, object[] Capabilities);
public sealed record NativeObservation(string Id, string Kind, string ObservedAt, object? ExpiresAt, string Source, string AccessMode, double Confidence, object Facts);

/// <summary>Typed world facts for the social turn's world observation.</summary>
public sealed record NativeWorldFacts(string Weather, string Location);

/// <summary>One bounded inventory line inside the social turn's self observation.</summary>
public sealed record NativeInventoryItemFact(string Name, int Count);

/// <summary>Typed farmer facts for the social turn's self observation.</summary>
public sealed record NativeSelfFacts(
    string FarmerName,
    int Money,
    int InventorySlotsUsed,
    int InventorySlotCapacity,
    NativeInventoryItemFact[] Inventory,
    bool InventoryTruncated);

public sealed record NativePlayerMessage(string Id, string Content, string CreatedAt);
public sealed class NativeSocialBridgeResult
{
    public string Version { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string TraceId { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public NativeSocialResponse? Response { get; set; }
    public string? Code { get; set; }
    public string? Message { get; set; }
    public string? Text => this.Response?.Text;
}
public sealed class NativeSocialResponse
{
    public string Kind { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string[]? BasedOnObservationIds { get; set; }
    public string? BasedOnMemoryId { get; set; }
    public bool RememberLatestReceipt { get; set; }
    public string? MemorySummary { get; set; }
}
public sealed record SocialBridgeHostUpdate(NativeSocialBridgeResult? Result, Exception? Error, string? TraceId)
{
    public static readonly SocialBridgeHostUpdate None = new(null, null, null);
    public static SocialBridgeHostUpdate Completed(NativeSocialBridgeResult result) => new(result, null, result.TraceId);
    public static SocialBridgeHostUpdate Failed(Exception error, string traceId) => new(null, error, traceId);
}
