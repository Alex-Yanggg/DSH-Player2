using System;
using System.Globalization;

namespace DSHPlayer2.Core;

/// <summary>
/// The adapter-supplied vocabulary that keeps the core game-neutral: which
/// adapter id and game id a turn advertises, and how semantic targets are
/// spelled. The core logic never names a game; an adapter passes its profile
/// in. <see cref="StardewValley"/> is the current instantiation — adding a
/// second adapter means declaring another profile, not editing the core.
/// </summary>
public sealed record AdapterProfile(
    string AdapterId,
    string GameId,
    string LocationUriScheme,
    string TileUriScheme)
{
    /// <summary>The Stardew Valley SMAPI adapter's profile.</summary>
    public static readonly AdapterProfile StardewValley = new(
        "stardew-smapi",
        "stardew-valley",
        "stardew-location",
        "stardew-tile");

    /// <summary>Formats the semantic location target one turn advertises.</summary>
    public string FormatLocationTarget(string location, int tileX, int tileY) =>
        $"{LocationUriScheme}:{location}:tile:{tileX},{tileY}";

    /// <summary>Formats the prior-outcome tile target one day later recalls.</summary>
    public string FormatTileTarget(int tileX, int tileY) =>
        $"{TileUriScheme}:{tileX},{tileY}";

    /// <summary>
    /// Parses a location target of the shape <c>&lt;scheme&gt;:&lt;location&gt;:tile:&lt;x&gt;,&lt;y&gt;</c>.
    /// The scheme itself is not matched — the target string is self-consistent
    /// data authored by this same profile on the Player side.
    /// </summary>
    public bool TryParseLocationTarget(string? target, out string location, out int tileX, out int tileY)
    {
        location = string.Empty;
        tileX = 0;
        tileY = 0;
        if (string.IsNullOrEmpty(target))
        {
            return false;
        }
        var schemeEnd = target.IndexOf(':', StringComparison.Ordinal);
        if (schemeEnd <= 0)
        {
            return false;
        }
        var remainder = target[(schemeEnd + 1)..];
        var separator = remainder.IndexOf(":tile:", StringComparison.Ordinal);
        if (separator <= 0)
        {
            return false;
        }
        location = remainder[..separator];
        var coordinates = remainder[(separator + ":tile:".Length)..].Split(',');
        return coordinates.Length == 2 &&
            int.TryParse(coordinates[0], NumberStyles.None, CultureInfo.InvariantCulture, out tileX) &&
            int.TryParse(coordinates[1], NumberStyles.None, CultureInfo.InvariantCulture, out tileY) &&
            tileX >= 0 && tileY >= 0;
    }
}
