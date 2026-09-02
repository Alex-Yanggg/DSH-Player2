using System;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class AdapterProfileTests
{
    private static readonly AdapterProfile Custom = new("other-adapter", "other-game", "otherville-location", "otherville-tile");

    [Fact]
    public void FormatsAndParsesLocationTargetsForAnyScheme()
    {
        var target = Custom.FormatLocationTarget("Village", 3, 9);

        Assert.Equal("otherville-location:Village:tile:3,9", target);
        Assert.True(Custom.TryParseLocationTarget(target, out var location, out var x, out var y));
        Assert.Equal("Village", location);
        Assert.Equal(3, x);
        Assert.Equal(9, y);
    }

    [Fact]
    public void ParsesAreSchemeAgnosticButStrictAboutShape()
    {
        Assert.True(AdapterProfile.StardewValley.TryParseLocationTarget("stardew-location:Farm:tile:12,8", out var location, out var x, out var y));
        Assert.Equal("Farm", location);
        Assert.Equal(12, x);
        Assert.Equal(8, y);

        Assert.False(AdapterProfile.StardewValley.TryParseLocationTarget("no-scheme", out _, out _, out _));
        Assert.False(AdapterProfile.StardewValley.TryParseLocationTarget("scheme::tile:1,2", out _, out _, out _));
        Assert.False(AdapterProfile.StardewValley.TryParseLocationTarget("scheme:Farm:tile:x,y", out _, out _, out _));
        Assert.False(AdapterProfile.StardewValley.TryParseLocationTarget("scheme:Farm:tile:-1,2", out _, out _, out _));
        Assert.False(AdapterProfile.StardewValley.TryParseLocationTarget(null, out _, out _, out _));
    }

    [Fact]
    public void TileTargetsRoundTripTheirScheme()
    {
        Assert.Equal("stardew-tile:12,8", AdapterProfile.StardewValley.FormatTileTarget(12, 8));
        Assert.Equal("otherville-tile:1,2", Custom.FormatTileTarget(1, 2));
    }
}
