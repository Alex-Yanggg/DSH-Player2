using System;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace DSHPlayer2.Core;

/// <summary>
/// Same-clock latency trace (P2-0015 T0.1). Every stage of a turn — key press,
/// publish, host pickup, agent ready, first token, completion, result write,
/// Player pickup, render — is one JSONL line stamped with the machine's UTC
/// wall clock, so the Mod and the DSH host can be joined on <c>lane</c> and
/// <c>key</c> without sharing a process. Each side owns its own file
/// (<see cref="ModFileName"/> here, <c>latency-host.jsonl</c> in the host) so
/// two processes never contend for one handle. Diagnostics only.
/// </summary>
public static class LatencyTrace
{
    public const string ModFileName = "latency-mod.jsonl";

    public static string PathFor(string bridgeDirectory) => Path.Combine(bridgeDirectory, "development-logs", ModFileName);

    /// <summary>Appends one stage; I/O failures propagate to the caller's logger.</summary>
    public static void Append(string bridgeDirectory, string lane, string key, string stage, DateTimeOffset at, string? detail = null)
    {
        if (string.IsNullOrWhiteSpace(bridgeDirectory)) throw new ArgumentException("A latency trace requires a bridge directory.", nameof(bridgeDirectory));
        if (string.IsNullOrWhiteSpace(lane)) throw new ArgumentException("A latency trace requires a lane.", nameof(lane));
        if (string.IsNullOrWhiteSpace(key)) throw new ArgumentException("A latency trace requires a key.", nameof(key));
        if (string.IsNullOrWhiteSpace(stage)) throw new ArgumentException("A latency trace requires a stage.", nameof(stage));
        Directory.CreateDirectory(Path.Combine(bridgeDirectory, "development-logs"));
        File.AppendAllText(PathFor(bridgeDirectory), Render(lane, key, stage, at, detail) + Environment.NewLine);
    }

    /// <summary>One trace line; exposed so tests and replays can pin the format.</summary>
    public static string Render(string lane, string key, string stage, DateTimeOffset at, string? detail = null)
    {
        return JsonSerializer.Serialize(new
        {
            at = at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            source = "mod",
            lane,
            key,
            stage,
            detail,
        });
    }
}
