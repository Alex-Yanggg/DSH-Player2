using System;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace DSHPlayer2.Core;

/// <summary>
/// Reads the short-lived heartbeat written by the mounted native DSH Player2
/// bundle. A listening Web port alone is not evidence that the bundle which
/// owns the file bridge has finished loading.
/// </summary>
public static class DshBridgeReadiness
{
    public const string ReadyDirectoryName = "runtime";
    public const string ReadyFilePattern = "ready-*.json";
    public static readonly TimeSpan DefaultFreshness = TimeSpan.FromSeconds(5);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Returns the newest valid, fresh native-DSH heartbeat, if any.</summary>
    public static DshBridgeReadyMarker? TryGetReadyMarker(
        string bridgeDirectory,
        DateTimeOffset now,
        TimeSpan? freshness = null)
    {
        if (string.IsNullOrWhiteSpace(bridgeDirectory))
        {
            return null;
        }
        var allowedAge = freshness ?? DefaultFreshness;
        if (allowedAge <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(freshness), "DSH readiness freshness must be positive.");
        }

        var directory = Path.Combine(Path.GetFullPath(bridgeDirectory), ReadyDirectoryName);
        if (!Directory.Exists(directory))
        {
            return null;
        }

        return Directory.EnumerateFiles(directory, ReadyFilePattern)
            .Select(path => TryRead(path, now, allowedAge))
            .Where(marker => marker is not null)
            .OrderByDescending(marker => marker!.HeartbeatAt)
            .FirstOrDefault();
    }

    private static DshBridgeReadyMarker? TryRead(string path, DateTimeOffset now, TimeSpan freshness)
    {
        try
        {
            var modifiedAt = new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero);
            var age = now - modifiedAt;
            if (age < TimeSpan.FromSeconds(-2) || age > freshness)
            {
                return null;
            }
            var info = new FileInfo(path);
            if (info.Length is <= 0 or > DecisionBridgeFiles.MaxFileBytes)
            {
                return null;
            }
            var marker = JsonSerializer.Deserialize<DshBridgeReadyMarker>(File.ReadAllText(path), JsonOptions);
            return marker is not null &&
                marker.Version == DecisionBridgeRules.WireVersion &&
                marker.Status == "ready" &&
                marker.Source == "dsh" &&
                marker.Pid > 0 &&
                !string.IsNullOrWhiteSpace(marker.InstanceId)
                    ? marker with { HeartbeatAt = modifiedAt }
                    : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Validated DSH bundle lifecycle evidence.</summary>
public sealed record DshBridgeReadyMarker(
    string Version,
    string Status,
    string Source,
    int Pid,
    string InstanceId,
    string StartedAt)
{
    public DateTimeOffset HeartbeatAt { get; init; }
}

/// <summary>
/// Graded readiness below the bundle heartbeat (P2-0015 T0.4). The Mod asks DSH
/// to pre-compose one session's social ("mouth") lane with a warm-up request
/// when a save loads; the host answers with a mouth-ready marker once the
/// persona preset and lane agent exist. Warming composes and resumes only — it
/// never runs a model turn or pre-generates a line.
/// </summary>
public static class MouthReadiness
{
    public const string WarmupDirectoryName = "warmup";
    public const string ReadinessDirectoryName = "readiness";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static string WarmupPath(string sessionDirectory) => Path.Combine(sessionDirectory, WarmupDirectoryName, "mouth.json");
    public static string ReadyPath(string sessionDirectory) => Path.Combine(sessionDirectory, ReadinessDirectoryName, "mouth.json");

    /// <summary>Publishes (or replaces) the warm-up request for one session.</summary>
    public static MouthWarmupRequest WriteWarmupRequest(string sessionDirectory, BridgeCompanionIdentity companion, string requestedAt)
    {
        if (string.IsNullOrWhiteSpace(sessionDirectory)) throw new ArgumentException("A warm-up request requires a session directory.", nameof(sessionDirectory));
        ArgumentNullException.ThrowIfNull(companion);
        var request = new MouthWarmupRequest(DecisionBridgeRules.WireVersion, requestedAt, companion);
        var path = WarmupPath(sessionDirectory);
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $".mouth.json.{Guid.NewGuid():N}.tmp");
        File.WriteAllText(temporary, JsonSerializer.Serialize(request, JsonOptions));
        File.Move(temporary, path, overwrite: true);
        return request;
    }

    /// <summary>Returns the host's mouth-ready marker when it answers this exact warm-up request.</summary>
    public static MouthReadyMarker? TryReadReady(string sessionDirectory, string requestedAt)
    {
        try
        {
            var path = ReadyPath(sessionDirectory);
            var info = new FileInfo(path);
            if (!info.Exists || info.Length is <= 0 or > DecisionBridgeFiles.MaxFileBytes) return null;
            var marker = JsonSerializer.Deserialize<MouthReadyMarker>(File.ReadAllText(path), JsonOptions);
            return marker is not null && marker.Status == "ready" && marker.Source == "dsh" && marker.RequestedAt == requestedAt ? marker : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }
}

public sealed record MouthWarmupRequest(string Version, string RequestedAt, BridgeCompanionIdentity Companion);

/// <summary>Host evidence that one session's social lane is composed and resumable.</summary>
public sealed record MouthReadyMarker(string Version, string Status, string Source, string RequestedAt, string ReadyAt, string SessionId, string Mode, double ComposeMs);
