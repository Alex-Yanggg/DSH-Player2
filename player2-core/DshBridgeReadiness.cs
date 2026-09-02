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
