using System;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace DSHPlayer2.Core;

/// <summary>
/// Append-only JSONL development log at
/// <c>&lt;bridge&gt;/development-logs/player2-host.jsonl</c>. Diagnostics only:
/// it is never a player-visible fallback channel and every entry carries its
/// trace id and the game day it was written on.
/// </summary>
public static class DevelopmentLogWriter
{
    public const string FileName = "player2-host.jsonl";

    /// <summary>Appends one bounded entry; I/O failures propagate to the caller's logger.</summary>
    public static void Append(string bridgeDirectory, string code, string traceId, string message, int? gameDay)
    {
        if (string.IsNullOrWhiteSpace(bridgeDirectory))
        {
            throw new ArgumentException("A development log requires a bridge directory.", nameof(bridgeDirectory));
        }
        var directory = Path.Combine(bridgeDirectory, "development-logs");
        Directory.CreateDirectory(directory);
        var entry = JsonSerializer.Serialize(new
        {
            at = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            code,
            traceId,
            message,
            gameDay,
        });
        File.AppendAllText(Path.Combine(directory, FileName), entry + Environment.NewLine);
    }
}
